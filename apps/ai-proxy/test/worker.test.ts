import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';

const ORIGIN = 'https://app.example';
const env = (over: Partial<Env> = {}): Env => ({ ALLOWED_ORIGINS: ORIGIN, ELEVENLABS_API_KEY: 'k', ...over });

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

  it('returns 204 when no ElevenLabs key is set', async () => {
    const res = await call(env({ ELEVENLABS_API_KEY: undefined }), { body: body({ text: 'hi', lang: 'en' }) });
    expect(res.status).toBe(204);
    expect(res.headers.get('x-tts')).toBe('off');
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

  it('streams audio from ElevenLabs on success', async () => {
    const fetchMock = vi.fn(async () => new Response('mp3', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call(env(), { body: body({ text: 'hello', lang: 'en' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(await res.text()).toBe('mp3');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('maps upstream failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    expect((await call(env(), { body: body({ text: 'hi', lang: 'en' }) })).status).toBe(502);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 429 })));
    expect((await call(env(), { body: body({ text: 'hi', lang: 'en' }) })).status).toBe(429);
  });
});
