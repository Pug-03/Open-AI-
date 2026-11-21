import { afterEach, expect, it, vi } from 'vitest';
import { screenTools, voiceTools } from '@walkwe/core/voice';
import worker from '../src/index.ts';

const origin = 'http://localhost:4173';
const limiter = { limit: async () => ({ success: true }) };
const env = { ALLOWED_ORIGINS: origin, OPENAI_LIVE_ORIGIN: origin, OPENAI_API_KEY: 'mock-key', RATE_LIMITER: limiter, GLOBAL_LIMITER: limiter };
const post = (path: string, body: object, from = origin) => new Request(`https://proxy.test${path}`, {
  method: 'POST', body: JSON.stringify(body),
  headers: { origin: from, 'content-type': 'application/json', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site' },
});
afterEach(() => vi.unstubAllGlobals());

it('registers the Walk We tools by screen and gives the browser only the SDP answer', async () => {
  const upstream = vi.fn(async (_url: string, _options: RequestInit) => Response.json({ transport: { sdp: 'v=0\r\n' }, private: 'hidden' }));
  vi.stubGlobal('fetch', upstream);
  const offer = { sdp: 'v=0\r\n', lang: 'th', screen: 'navigate' };
  expect((await worker.fetch(post('/voice/live', offer, 'https://untrusted.test'), env)).status).toBe(403);
  expect((await worker.fetch(post('/voice/live', offer), { ...env, OPENAI_API_KEY: undefined })).status).toBe(503);
  expect((await worker.fetch(post('/voice/live', { ...offer, coordinates: [0, 0] }), env)).status).toBe(400);
  expect((await worker.fetch(post('/voice/live', offer), { ...env, GLOBAL_LIMITER: { limit: async () => ({ success: false }) } })).status).toBe(429);
  expect(upstream).not.toHaveBeenCalled();
  const response = await worker.fetch(post('/voice/live', offer), env);
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ sdp: 'v=0\r\n' });
  const [url, params] = upstream.mock.lastCall!;
  const { session } = JSON.parse(params.body as string);
  expect(url).toBe('https://api.openai.com/v1/live/sessions');
  expect(session).toMatchObject({ model: 'gpt-live-1.1', store: false, delegation: { type: 'responses', responses: { model: 'gpt-6.1-terra', parallel_tool_calls: false } } });
  expect(session.delegation.responses.tools.map((tool: { name: string }) => tool.name)).toEqual(screenTools.navigate);
  expect(new Set(Object.values(screenTools).flat())).toEqual(new Set(Object.keys(voiceTools)));
  expect(Object.keys(voiceTools)).toHaveLength(16);

  await worker.fetch(post('/voice/live', { ...offer, screen: 'plan' }), env);
  const planSession = JSON.parse(upstream.mock.lastCall![1].body as string).session;
  expect(planSession.delegation.responses.tools.map((tool: { name: string }) => tool.name)).toEqual(screenTools.plan);
  expect(screenTools.plan).toEqual(expect.arrayContaining([
    'plan_trip', 'find_routes', 'review_route', 'answer_route_review', 'ask_trip', 'start_navigation',
  ]));
  expect(planSession.delegation.responses.instructions).toContain('wait for the user’s next turn');
  expect(planSession.delegation.responses.instructions).toContain('prefer_evidence means assume they are dark');
});

it('uses the deterministic Intent if the paid Agentic budget or origin is unavailable', async () => {
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  const request = () => post('/agentic/intent', { text: 'จาก BTS สยาม ไป เซ็นทรัลเวิลด์', language: 'th' });
  const denied = { limit: vi.fn(async () => ({ success: false })) };
  const result = await worker.fetch(request(), { ...env, OPENAI_AGENTIC_ORIGIN: origin, AGENTIC_MODEL_LIMITER: denied });
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ source: 'system', from: 'bts:CEN', to: 'osm:W157482067' });
  expect(denied.limit).toHaveBeenCalledOnce();
  expect((await worker.fetch(request(), { ...env, AGENTIC_MODEL_LIMITER: limiter })).status).toBe(200);
  expect(upstream).not.toHaveBeenCalled();
});

it('isolates SOS limiter keys from public AI traffic', async () => {
  const shared = { limit: vi.fn(async ({ key }: { key: string }) => ({ success: key.startsWith('sos:') })) };
  const opts = { ...env, RATE_LIMITER: shared, GLOBAL_LIMITER: shared };
  expect((await worker.fetch(post('/agentic/intent', {}), opts)).status).toBe(429);
  expect((await worker.fetch(post('/sos', { action: 'prepare', mode: 'live' }), opts)).status).toBe(503);
  expect(shared.limit.mock.calls.map(([{ key }]) => key)).toEqual(['app:ip:unknown', 'app:all', 'sos:ip:unknown', 'sos:all']);
});

class FakeAudioSocket extends EventTarget {
  constructor(private readonly transcript: string) { super(); }
  emit(event: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  accept() { this.emit({ type: 'session.created' }); }
  close() { this.dispatchEvent(new Event('close')); }
  send(raw: string) {
    const event = JSON.parse(raw);
    if (event.type === 'session.update') this.emit({ type: 'session.updated' });
    if (event.type !== 'response.create') return;
    this.emit({ type: 'response.created', response: { id: 'audio-1' } });
    this.emit({ type: 'response.output_audio.delta', response_id: 'audio-1', delta: 'AAAAAA==' });
    this.emit({ type: 'response.output_audio_transcript.done', response_id: 'wrong-audio', transcript: 'Walk 10 metres' });
    this.emit({ type: 'response.output_audio_transcript.done', response_id: 'audio-1', transcript: this.transcript });
    this.emit({ type: 'response.done', response: { id: 'audio-1', status: 'completed' } });
  }
}

it('releases OpenAI audio only when the response transcript matches the requested distance', async () => {
  let transcript = 'Walk 900 metres.';
  vi.stubGlobal('fetch', vi.fn(async () => ({ webSocket: new FakeAudioSocket(transcript) })));
  const request = () => post('/voice/live/speak', { text: 'Walk 10 metres', lang: 'en' });
  expect((await worker.fetch(request(), env)).status).toBe(409);
  transcript = 'Walk 10 metres.';
  const verified = await worker.fetch(request(), env);
  expect(verified.headers.get('content-type')).toBe('audio/wav');
  const bytes = await verified.arrayBuffer();
  expect(new DataView(bytes).getUint32(24, true)).toBe(24_000);
  expect(bytes.byteLength).toBe(48);
});
