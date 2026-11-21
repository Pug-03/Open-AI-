import type { Route } from '@playwright/test';
import { SIAM, asReturningUser, expect, test, waitForPageTransition } from './fixtures.ts';

const proxy = process.env.VITE_AI_PROXY_URL?.replace(/\/$/, '');
type VoiceMock = {
  emit: (event: object) => void;
  outgoing: string[];
  spoken: { lang: string; text: string }[];
  microphoneRequests: number;
  microphoneStops: number;
};
type VoiceWindow = typeof window & { voiceMock: VoiceMock };

test('GPT-Live repeats verified navigation steps and opens SOS without sending', async ({ page, context }) => {
  test.skip(!proxy || process.env.VITE_VOICE_PROVIDER !== 'openai', 'Build with GPT-Live and a mocked proxy origin.');
  await asReturningUser(page, { ww_lang: 'th' });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(SIAM);
  await context.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: { hourly: { time: [], cloud_cover: [] } } }));
  await page.clock.install({ time: new Date('2026-10-15T14:00:00+07:00') });
  await page.clock.resume();

  const speech: { lang: string; text: string }[] = [];
  let sessions = 0;
  let relayRequests = 0;
  await context.route('**/sos', (route) => {
    relayRequests += 1;
    return route.fulfill({ status: 503 });
  });
  const cors = {
    'access-control-allow-origin': 'http://localhost:4175',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  const mockProxy = async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
    } else if (request.url().endsWith('/speak')) {
      speech.push(request.postDataJSON());
      await route.fulfill({ status: 409, headers: cors });
    } else {
      expect(request.postDataJSON()).toEqual({ screen: 'navigate', lang: 'th', sdp: 'v=0\r\n' });
      sessions += 1;
      await route.fulfill({ status: 201, headers: cors, json: { sdp: 'v=0\r\n' } });
    }
  };
  await context.route(`${proxy}/voice/live`, mockProxy);
  await context.route(`${proxy}/voice/live/speak`, mockProxy);
  await page.addInitScript(() => {
    const mock: VoiceMock = {
      emit: () => undefined, outgoing: [], spoken: [], microphoneRequests: 0, microphoneStops: 0,
    };
    Object.defineProperty(window, 'voiceMock', { value: mock });
    const track = { enabled: false, stop: () => { track.enabled = false; mock.microphoneStops += 1; } };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async (constraints: MediaStreamConstraints) => {
      if (constraints.audio !== true || constraints.video) throw new Error('Unexpected microphone constraints');
      mock.microphoneRequests += 1;
      return stream;
    } });
    Object.defineProperty(window, 'speechSynthesis', { value: {
      cancel: () => undefined,
      getVoices: () => [],
      speak: (utterance: SpeechSynthesisUtterance) => {
        mock.spoken.push({ lang: utterance.lang, text: utterance.text });
        utterance.dispatchEvent(new Event('end'));
      },
    } });
    class Channel extends EventTarget {
      readyState = 'open';
      send(raw: string) {
        mock.outgoing.push(raw);
        if (JSON.parse(raw).type === 'session.close') queueMicrotask(() => mock.emit({ type: 'session.closed' }));
      }
      close() { this.readyState = 'closed'; }
    }
    const channel = new Channel();
    mock.emit = (event) => channel.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
    class Peer extends EventTarget {
      iceGatheringState = 'complete';
      localDescription = { sdp: 'v=0\r\n' };
      addTrack() {}
      createDataChannel() { return channel; }
      async createOffer() { return this.localDescription; }
      async setLocalDescription() {}
      async setRemoteDescription() { mock.emit({ type: 'session.started' }); }
      close() { channel.close(); }
    }
    Object.defineProperty(window, 'RTCPeerConnection', { value: Peer });
  });

  await page.goto('/plan?demo=1');
  await page.getByTestId('start-nav').click();
  await expect(page).toHaveURL(/\/navigate$/);
  await waitForPageTransition(page);
  const voice = page.getByTestId('live-voice');
  await voice.getByRole('button', { name: 'คุยกับ Walk We' }).click();
  await expect(voice.getByRole('status')).toContainText('ฟังอยู่');
  expect(sessions).toBe(1);
  expect(await page.evaluate(() => (window as VoiceWindow).voiceMock.microphoneRequests)).toBe(1);

  const call = (name: string, args: object, id: string) => page.evaluate((event) => (window as VoiceWindow).voiceMock.emit(event), {
    type: 'response.event', delegation_id: id, event: { type: 'response.output_item.done', item: {
      type: 'function_call', name, call_id: id, arguments: JSON.stringify(args),
    } },
  });
  await call('repeat_instruction', { which: 'last_instruction', language: 'both', distance_m: 999 }, 'invented');
  await expect(voice.getByRole('status')).toContainText('คำสั่งนี้ยังใช้ไม่ได้');
  expect(speech).toHaveLength(0);
  await call('repeat_instruction', { which: 'last_instruction', language: 'both' }, 'verified');
  await expect.poll(() => page.evaluate(() => (window as VoiceWindow).voiceMock.spoken)).toEqual([
    { lang: 'th-TH', text: expect.stringContaining('เดินต่อ 10 เมตร') },
    { lang: 'en-GB', text: expect.stringMatching(/Walk 10 (?:m|metres)\b/) },
  ]);
  expect(speech.map(({ lang }) => lang)).toEqual(['th', 'en']);
  const outgoing = await page.evaluate(() => (window as VoiceWindow).voiceMock.outgoing.map((packet) => JSON.parse(packet)));
  const verified = outgoing.find((event) => event.item?.call_id === 'verified');
  expect(JSON.parse(verified.item.output)).toMatchObject({ status: 'ok', speak_text: expect.stringContaining('เดินต่อ 10 เมตร') });

  await call('open_sos_sheet', { language: 'th', reason: 'user_asked' }, 'help');
  await expect(page.getByTestId('sos-send')).toBeVisible();
  await expect(page.getByTestId('sos-countdown')).toHaveCount(0);
  await expect(page.getByTestId('dial-191')).toHaveAttribute('href', 'tel:191');
  await expect.poll(() => page.evaluate(() => (window as VoiceWindow).voiceMock.microphoneStops)).toBeGreaterThan(0);
  expect(relayRequests).toBe(0);
});
