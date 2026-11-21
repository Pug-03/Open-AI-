import type { BrowserContext, Page, Route } from '@playwright/test';
import { SIAM, asReturningUser, expect, test, waitForPageTransition } from './fixtures.ts';

const proxy = process.env.VITE_AI_PROXY_URL?.replace(/\/$/, '');
type VoiceMock = {
  emit: (event: object) => void;
  outgoing: string[];
  spoken: { lang: string; text: string }[];
  microphoneRequests: number;
  microphoneStops: number;
  listening: boolean;
};
type VoiceWindow = typeof window & { voiceMock: VoiceMock };

const cors = {
  'access-control-allow-origin': process.env.WALKWE_TEST_APP_ORIGIN ?? 'http://localhost:4175',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

async function mockVoice(page: Page, context: BrowserContext, screen: 'plan' | 'navigate') {
  const speech: { lang: string; text: string }[] = [];
  let sessions = 0;
  const mockProxy = async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
    } else if (request.url().endsWith('/speak')) {
      speech.push(request.postDataJSON());
      await route.fulfill({ status: 409, headers: cors });
    } else {
      expect(request.postDataJSON()).toEqual({ screen, lang: 'th', sdp: 'v=0\r\n' });
      sessions += 1;
      await route.fulfill({ status: 201, headers: cors, json: { sdp: 'v=0\r\n' } });
    }
  };
  await context.route(`${proxy}/voice/live`, mockProxy);
  await context.route(`${proxy}/voice/live/speak`, mockProxy);
  await page.addInitScript(() => {
    const mock: VoiceMock = {
      emit: () => undefined, outgoing: [], spoken: [], microphoneRequests: 0, microphoneStops: 0, listening: false,
    };
    Object.defineProperty(window, 'voiceMock', { value: mock });
    const track = {
      get enabled() { return mock.listening; },
      set enabled(enabled: boolean) { mock.listening = enabled; },
      stop: () => { mock.listening = false; mock.microphoneStops += 1; },
    };
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

  const call = (name: string, args: object, id: string) => page.evaluate((event) => (window as VoiceWindow).voiceMock.emit(event), {
    type: 'response.event', delegation_id: id, event: { type: 'response.output_item.done', item: {
      type: 'function_call', name, call_id: id, arguments: JSON.stringify(args),
    } },
  });
  return { call, speech, sessionCount: () => sessions };
}

test('GPT-Live repeats verified navigation steps and opens SOS without sending', async ({ page, context }) => {
  test.skip(!proxy || process.env.VITE_VOICE_PROVIDER !== 'openai', 'Build with GPT-Live and a mocked proxy origin.');
  await asReturningUser(page, { ww_lang: 'th' });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(SIAM);
  await context.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: { hourly: { time: [], cloud_cover: [] } } }));
  await page.clock.install({ time: new Date('2026-10-15T14:00:00+07:00') });
  await page.clock.resume();
  let relayRequests = 0;
  await context.route('**/sos', (route) => {
    relayRequests += 1;
    return route.fulfill({ status: 503 });
  });
  const { call, speech, sessionCount } = await mockVoice(page, context, 'navigate');

  await page.goto('/plan?demo=1');
  await page.getByTestId('start-nav').click();
  await expect(page).toHaveURL(/\/navigate$/);
  await waitForPageTransition(page);
  const voice = page.getByTestId('live-voice');
  await voice.getByRole('button', { name: 'คุยกับ Walk We' }).click();
  await expect(voice.getByRole('status')).toContainText('ฟังอยู่');
  expect(sessionCount()).toBe(1);
  expect(await page.evaluate(() => (window as VoiceWindow).voiceMock.microphoneRequests)).toBe(1);

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

test('one GPT-Live session plans a walk, asks about lighting, and reads the checked answer', async ({ page, context }, testInfo) => {
  test.skip(!proxy || process.env.VITE_VOICE_PROVIDER !== 'openai', 'Build with GPT-Live and a mocked proxy origin.');
  await asReturningUser(page, { ww_lang: 'th' });
  await page.clock.install({ time: new Date('2026-11-21T14:00:00+07:00') });
  await page.clock.resume();
  const { call, speech, sessionCount } = await mockVoice(page, context, 'plan');
  const from = 'bts:CEN';
  const to = 'osm:W365999406';
  const planCalls: unknown[] = [];
  let releaseFirst!: () => void;
  const firstReview = new Promise<void>(resolve => { releaseFirst = resolve; });
  await context.route(`${proxy}/agentic/*`, async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.url().endsWith('/intent')) return route.fulfill({ headers: cors, json: {
      status: 'confirm', from, to, mode: 'night', time: '21:00', noStairs: false, source: 'gpt-6.1-terra',
    } });

    expect(request.url()).toBe(`${proxy}/agentic/plan`);
    expect(request.headers().accept).toBe('application/x-ndjson');
    const input = request.postDataJSON();
    planCalls.push(input);
    const answered = input.preference === 'prefer_evidence';
    if (!answered) await firstReview;
    const result = {
      status: 'ok', datasetVersion: 'voice-test-graph', provenance: 'public_web2_graph', source: 'verified_planner',
      decision: 'VERIFY', text: answered ? 'ตรวจข้อเสนอหลังเลือกสมมติฐานแล้ว' : 'ข้อมูลไฟบางช่วงยังไม่ครบ',
      recommendedId: answered ? 'evidence' : 'direct', evidenceIds: ['edge:30181'],
      routes: [
        { id: 'direct', meters: 311, lit: 32, unknown: 279, minutes: 4, sunMinutes: null },
        { id: 'evidence', meters: 316, lit: 156, unknown: 160, minutes: 4, sunMinutes: null },
      ],
      clarification: answered ? null : {
        id: 'night_lighting_preference', text: 'อยากให้ลองเทียบโดยสมมติว่าช่วงนี้มีไฟหรือไม่มีไฟ',
        options: [
          { label: 'สมมติว่ามีไฟ', value: 'direct', ref: 'direct' },
          { label: 'สมมติว่าไม่มีไฟ', value: 'prefer_evidence', ref: 'evidence' },
        ],
      },
      trace: [{ step: 'verify', passed: true }, { step: 'critic', passed: true }],
    };
    const events = ['routes', 'evidence', 'review', 'critique'].flatMap(stage =>
      ['working', 'done'].map(state => ({ type: 'progress', stage, state })));
    return route.fulfill({ headers: cors, contentType: 'application/x-ndjson',
      body: [...events, { type: 'result', result }].map(event => JSON.stringify(event)).join('\n') + '\n',
    });
  });

  await page.goto('/plan');
  const voice = page.getByTestId('live-voice');
  await voice.getByRole('button', { name: 'คุยกับ Walk We' }).click();
  await expect(voice).toHaveAttribute('data-voice-phase', 'ready');

  await call('answer_route_review', { language: 'th', preference: 'direct' }, 'premature-answer');
  await expect.poll(() => speech.at(-1)?.text).toContain('ไม่มีคำถามเรื่องไฟที่รอคำตอบ');
  await expect(voice).toHaveAttribute('data-voice-phase', 'ready');
  expect(planCalls).toHaveLength(0);

  await call('plan_trip', { language: 'th', utterance: 'จาก BTS สยาม ไปสยามสแควร์วันตอนสามทุ่ม' }, 'draft');
  await expect(page.getByTestId('point-to')).toContainText('สยามสแควร์วัน');
  await expect(voice).toHaveAttribute('data-voice-phase', 'ready');
  await call('find_routes', { language: 'th' }, 'find');
  await expect(page.locator('.route-option').first()).toBeVisible();
  const selected = page.locator('.route-option[aria-pressed="true"]');
  const selection = await selected.getAttribute('data-testid');
  await expect(voice).toHaveAttribute('data-voice-phase', 'ready');

  await call('review_route', { language: 'th' }, 'review');
  try {
    await expect(voice).toHaveAttribute('data-voice-phase', 'working');
    await expect.poll(() => page.evaluate(() => (window as VoiceWindow).voiceMock.listening)).toBe(false);
  } finally {
    releaseFirst();
  }
  await expect(voice).toHaveAttribute('data-voice-phase', 'awaiting');
  await expect.poll(() => speech.at(-1)?.text).toContain('มีไฟ หรือไม่มีไฟ');
  const review = page.getByTestId('agentic-review');
  await expect(review.locator('[data-stage][data-stage-state="done"]')).toHaveCount(4);
  await expect(review.locator('[data-stage="routes"]')).toBeInViewport();
  await expect(review.getByRole('button', { name: 'สมมติว่าไม่มีไฟ' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as VoiceWindow).voiceMock.listening)).toBe(true);
  if (testInfo.project.name === 'iphone-15') {
    await page.screenshot({ path: testInfo.outputPath('voice-awaiting-lighting-choice.png') });
  }

  await call('answer_route_review', { language: 'en', preference: 'prefer_evidence' }, 'answer');
  await expect.poll(() => speech.at(-1)?.text).toContain('Lighting is unverified for 160 meters.');
  expect(speech.at(-1)?.lang).toBe('en');
  await expect(voice).toHaveAttribute('data-voice-phase', 'ready');
  await expect(review).toContainText('ตรวจข้อเสนอหลังเลือกสมมติฐานแล้ว');
  await expect(review.getByRole('button', { name: 'สมมติว่าไม่มีไฟ' })).toHaveCount(0);
  await expect(selected).toHaveAttribute('data-testid', selection!);
  expect(planCalls).toEqual([
    { from, to, date: '2026-11-21', time: '21:00', mode: 'night', language: 'th', noStairs: false },
    { from, to, date: '2026-11-21', time: '21:00', mode: 'night', language: 'th', noStairs: false, preference: 'prefer_evidence' },
  ]);
  expect(sessionCount()).toBe(1);
  expect(await page.evaluate(() => (window as VoiceWindow).voiceMock.microphoneRequests)).toBe(1);
  await voice.getByRole('button', { name: 'ปิดไมค์ Walk We' }).click();
  await expect(voice).toHaveAttribute('data-voice-phase', 'idle');
});
