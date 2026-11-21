// Walk We speech, route review, and authenticated evidence/SOS services.

import { z } from 'zod';
import { rankEvidence } from './route-evidence';
import { handleAgenticCompanion, handleAgenticIntent, handleAgenticPlan } from './agentic-plan';
import { handleEvidence, isEvidencePath, type EvidenceEnv } from './evidence';
import { createLiveSession, liveOffer, speakWithOpenAI } from './live';
import { handleSos, type SosBindings } from './sos';

export { EvidenceQueue } from './evidence';
export { SosOutbox } from './sos';

export interface Env extends EvidenceEnv, SosBindings {
  /** Comma-separated origins allowed to call this Worker, e.g. "https://walkwe.app,http://localhost:5173". */
  ALLOWED_ORIGINS: string;
  /** Workers Rate Limiting binding (wrangler.toml [[ratelimits]]). */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** Whole-service ceiling, all clients together (wrangler.toml). */
  GLOBAL_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** Dedicated budget for the paid Agentic loop, which may call a model several times per request. */
  AGENTIC_MODEL_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** ElevenLabs key for /speak (wrangler secret). Without it /speak answers 204 and the app uses the phone's voice. */
  ELEVENLABS_API_KEY?: string;
  /** ElevenLabs voice and model (wrangler.toml [vars]); both speak Thai and English. */
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_MODEL?: string;
  OPENAI_LIVE_ORIGIN?: string;
  OPENAI_AGENTIC_ORIGIN?: string;
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
const agenticHandlers = new Map<string, (body: unknown, env: Env, signal: AbortSignal) =>
  Promise<{ body: unknown; status: number }>>([
  ['/agentic/intent', handleAgenticIntent],
  ['/agentic/plan', handleAgenticPlan],
  ['/agentic/companion', handleAgenticCompanion],
]);

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

async function readJson(req: Request, maximum = MAX_BODY_BYTES): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maximum) throw new Error('too_large');
  const text = await req.text();
  if (text.length > maximum) throw new Error('too_large');
  return JSON.parse(text);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (isEvidencePath(path)) return handleEvidence(req, env);
    const originHeaders = corsFor(req, env);
    if (!originHeaders) return new Response('forbidden', { status: 403 });
    const cors = path === '/sos' ? { ...originHeaders, 'access-control-allow-credentials': 'true' } : originHeaders;
    const agenticHandler = agenticHandlers.get(path);
    if (!agenticHandler && !['/speak', '/route-evidence', '/voice/live', '/voice/live/speak', '/sos'].includes(path)) {
      return json({ error: 'not_found' }, 404, cors);
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405, cors);
    if (path === '/route-evidence' && (!env.OPENAI_API_KEY || !env.RATE_LIMITER || !env.GLOBAL_LIMITER)) {
      return json({ error: 'unavailable' }, 503, cors);
    }

    const noStore = { ...cors, 'cache-control': 'no-store' };
    // The paid endpoints require both limiter bindings before they call a model.
    if (env.RATE_LIMITER) {
      const who = req.headers.get('cf-connecting-ip') ?? 'unknown';
      const scope = path === '/sos' ? 'sos' : 'app';
      const [mine, all] = await Promise.all([
        env.RATE_LIMITER.limit({ key: `${scope}:ip:${who}` }),
        env.GLOBAL_LIMITER ? env.GLOBAL_LIMITER.limit({ key: `${scope}:all` }) : Promise.resolve({ success: true }),
      ]);
      if (!mine.success || !all.success) return json({ error: 'rate_limited' }, 429, noStore);
    }

    if (path === '/sos') return handleSos(req, env, noStore);

    if (agenticHandler) {
      const body = await readJson(req).catch(() => null);
      const modelEnabled = env.OPENAI_API_KEY && env.RATE_LIMITER && env.GLOBAL_LIMITER
        && req.headers.get('origin') === env.OPENAI_AGENTIC_ORIGIN
        && (await env.AGENTIC_MODEL_LIMITER?.limit({ key: 'model' }).catch(() => ({ success: false })))?.success;
      const result = await agenticHandler(body, modelEnabled ? env : { ...env, OPENAI_API_KEY: undefined }, req.signal);
      return json(result.body, result.status, noStore);
    }

    if (path === '/voice/live' || path === '/voice/live/speak') {
      const key = env.OPENAI_API_KEY;
      if (!key || !env.RATE_LIMITER || !env.GLOBAL_LIMITER || req.headers.get('origin') !== env.OPENAI_LIVE_ORIGIN) {
        return json({ error: 'unavailable' }, 503, noStore);
      }
      if (path === '/voice/live') {
        const offer = await readJson(req, 65_536).then(value => liveOffer.safeParse(value), () => null);
        if (!offer?.success) return json({ error: 'bad_request' }, 400, noStore);
        try { return json(await createLiveSession(key, offer.data), 201, noStore); }
        catch { return json({ error: 'upstream' }, 502, noStore); }
      }
      const speech = await readJson(req).then(value => speakSchema.safeParse(value), () => null);
      if (!speech?.success) return json({ error: 'bad_request' }, 400, noStore);
      try {
        const audio = await speakWithOpenAI(key, speech.data.text, speech.data.lang);
        if (!audio) return json({ error: 'unverified_audio' }, 409, noStore);
        return new Response(audio, { headers: { ...noStore, 'content-type': 'audio/wav' } });
      } catch { return json({ error: 'upstream' }, 502, noStore); }
    }

    try {
      const body = await readJson(req);
      if (path === '/route-evidence') {
        const result = await rankEvidence(body, env.OPENAI_API_KEY!);
        return json(result.body, result.status, noStore);
      }
      return await speak(env, body, cors);
    } catch {
      return json({ error: 'bad_request' }, 400, cors);
    }
  },
};
