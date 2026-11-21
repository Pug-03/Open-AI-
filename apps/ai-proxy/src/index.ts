// Walk We's optional text-to-speech proxy (Cloudflare Worker).

import { z } from 'zod';
export interface Env {
  /** Comma-separated origins allowed to call this Worker, e.g. "https://walkwe.app,http://localhost:5173". */
  ALLOWED_ORIGINS: string;
  /** Workers Rate Limiting binding (wrangler.toml [[ratelimits]]). */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** Whole-service ceiling, all clients together (wrangler.toml). */
  GLOBAL_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** ElevenLabs key for /speak (wrangler secret). Without it /speak answers 204 and the app uses the phone's voice. */
  ELEVENLABS_API_KEY?: string;
  /** ElevenLabs voice and model (wrangler.toml [vars]); both speak Thai and English. */
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_MODEL?: string;
}

/** /speak body: short text to read aloud (a navigation step, a route summary). */
const speakSchema = z.strictObject({
  text: z.string().trim().min(1).max(300),
  lang: z.enum(['th', 'en']),
});

/** Text to speech through ElevenLabs; returns the MP3 as the response body. */
async function speak(env: Env, body: unknown, cors: HeadersInit): Promise<Response> {
  // No voice key: 204 tells the app to use the phone's own voice (not an error).
  if (!env.ELEVENLABS_API_KEY) return new Response(null, { status: 204, headers: { 'x-tts': 'off', ...cors } });
  const { text, lang } = speakSchema.parse(body);
  const voice = env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_22050_32`, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL || 'eleven_flash_v2_5', language_code: lang }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) return json({ error: 'rate_limited' }, 429, cors);
  if (!res.ok) return json({ error: 'upstream' }, 502, cors);
  return new Response(res.body, { status: 200, headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400', ...cors } });
}

const MAX_BODY_BYTES = 4_096;

const json = (body: unknown, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

function corsFor(req: Request, env: Env): HeadersInit | null {
  const origin = req.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  // Browsers always send Fetch Metadata on these calls; requiring it turns away
  // scripts that only fake the Origin header. Not a hard gate: the real ceiling
  // is the prepaid credit plus the console's spend limit.
  if (req.method !== 'OPTIONS' && (req.headers.get('sec-fetch-mode') !== 'cors' || !req.headers.get('sec-fetch-site'))) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) throw new Error('too_large');
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new Error('too_large');
  return JSON.parse(text);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsFor(req, env);
    if (!cors) return new Response('forbidden', { status: 403 });
    if (new URL(req.url).pathname !== '/speak') return json({ error: 'not_found' }, 404, cors);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405, cors);

    // Rate limit per client address (used only as a limiter key, never stored or logged).
    const who = req.headers.get('cf-connecting-ip') ?? 'unknown';
    if (env.RATE_LIMITER) {
      // One budget per client across all paths, plus one shared by everyone.
      const [mine, all] = await Promise.all([
        env.RATE_LIMITER.limit({ key: `ip:${who}` }),
        env.GLOBAL_LIMITER ? env.GLOBAL_LIMITER.limit({ key: 'all' }) : Promise.resolve({ success: true }),
      ]);
      const success = mine.success && all.success;
      if (!success) return json({ error: 'rate_limited' }, 429, cors);
    }

    try {
      return await speak(env, await readJson(req), cors);
    } catch {
      return json({ error: 'bad_request' }, 400, cors);
    }
  },
};
