import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';

const ORIGIN = 'https://app.example';
const ok = { limit: async () => ({ success: true }) };
const env = (over: Partial<Env> = {}): Env => ({
  ALLOWED_ORIGINS: ORIGIN, OPENAI_LIVE_ORIGIN: ORIGIN, OPENAI_API_KEY: 'mock-key',
  RATE_LIMITER: ok, GLOBAL_LIMITER: ok, ...over,
});

const call = (e: Env, init: { method?: string; origin?: string | null; mode?: string | null; body?: string; path?: string } = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.mode !== null) headers['sec-fetch-mode'] = init.mode ?? 'cors';
  return worker.fetch(
    new Request(`https://w.example${init.path ?? '/speak'}`, { method: init.method ?? 'POST', headers, body: init.body }),
    e,
  );
};
const body = (o: unknown) => JSON.stringify(o);

afterEach(() => vi.unstubAllGlobals());

describe('ai-proxy worker', () => {
  it('rejects unknown origins', async () => {
    expect((await call(env(), { origin: 'https://evil.example', body: body({ text: 'hi', lang: 'en' }) })).status).toBe(403);
  });

  it('rejects requests without Fetch Metadata', async () => {
    expect((await call(env(), { mode: null, body: body({ text: 'hi', lang: 'en' }) })).status).toBe(403);
  });

  it('answers the CORS preflight', async () => {
    const res = await call(env(), { method: 'OPTIONS', mode: null });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('404s other paths and 405s other methods', async () => {
    expect((await call(env(), { path: '/other', body: '{}' })).status).toBe(404);
    expect((await call(env(), { method: 'GET' })).status).toBe(405);
  });

  it('returns 503 when hosted speech is unavailable', async () => {
    const res = await call(env({ OPENAI_API_KEY: undefined }), { body: body({ text: 'hi', lang: 'en' }) });
    expect(res.status).toBe(503);
  });

  it('returns 429 when the per-client limit is hit', async () => {
    const limiter = { limit: async () => ({ success: false }) };
    expect((await call(env({ RATE_LIMITER: limiter }), { body: body({ text: 'hi', lang: 'en' }) })).status).toBe(429);
  });

  it('returns 429 when the global limit is hit', async () => {
    const ok = { limit: async () => ({ success: true }) };
    const no = { limit: async () => ({ success: false }) };
    expect((await call(env({ RATE_LIMITER: ok, GLOBAL_LIMITER: no }), { body: body({ text: 'hi', lang: 'en' }) })).status).toBe(429);
  });

  it('validates the body', async () => {
    for (const bad of ['not json', body({ text: '', lang: 'en' }), body({ text: 'x'.repeat(301), lang: 'en' }), body({ text: 'hi', lang: 'fr' }), body({ text: 'hi', lang: 'en', extra: 1 })]) {
      expect((await call(env(), { body: bad })).status).toBe(400);
    }
  });

  it('rejects oversized bodies', async () => {
    expect((await call(env(), { body: body({ text: 'hi', lang: 'en', pad: 'x'.repeat(5000) }) })).status).toBe(400);
  });

  it('maps a failed OpenAI speech connection to an upstream error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 500 })));
    expect((await call(env(), { body: body({ text: 'hi', lang: 'en' }) })).status).toBe(502);
  });
});

describe('route evidence ranking', () => {
  const path = '/route-evidence';
  const limit = async () => ({ success: true });
  const enabled = env({ OPENAI_API_KEY: 'mock-key', RATE_LIMITER: { limit }, GLOBAL_LIMITER: { limit } });
  const request = {
    mode: 'night',
    candidates: [
      { id: 0, kind: 'go', reason: 'lit', meters: 100 },
      { id: 1, kind: 'caution', reason: 'unknown-light', meters: 90 },
    ],
  };
  const respond = (ids: number[]) => new Response(body({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: body({ ids }) }] }],
  }));

  it('requires spend limits and rejects free text or coordinates before calling the provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await call(env({ RATE_LIMITER: undefined }), { path, body: body(request) })).status).toBe(503);
    expect((await call(enabled, { path, body: body({ ...request, coordinates: [13, 100] }) })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes only supplied IDs and rejects repeated, unknown or incomplete selections', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
    for (const ids of [[0, 0], [0, 2], [0]]) {
      fetchMock.mockResolvedValueOnce(respond(ids));
      expect((await call(enabled, { path, body: body(request) })).status).toBe(422);
    }
    fetchMock.mockResolvedValueOnce(respond([1, 0]));
    const result = await call(enabled, { path, body: body(request) });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ids: [1, 0] });
    expect(result.headers.get('cache-control')).toBe('no-store');
    const upstream = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(JSON.parse(upstream.input)).toEqual(request);
    expect(upstream.store).toBe(false);
  });
});
