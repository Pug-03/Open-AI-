// Walk We speech, route review, and authenticated evidence/SOS services.

import { z } from 'zod';
import { rankEvidence } from './route-evidence';
import { handleAgenticCompanion, handleAgenticIntent, handleAgenticPlan, type AgenticProgress } from './agentic-plan';
import { handleBrowserResearch, handleEvidence, isEvidencePath, isResearchPath, type EvidenceEnv } from './evidence';
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
  OPENAI_LIVE_ORIGIN?: string;
  OPENAI_AGENTIC_ORIGIN?: string;
}

/** /speak body: short text to read aloud (a navigation step, a route summary). */
const speakSchema = z.strictObject({
  text: z.string().trim().min(1).max(300),
  lang: z.enum(['th', 'en']),
});

const MAX_BODY_BYTES = 4_096;
const agenticHandlers = new Map<string, (body: unknown, env: Env, signal: AbortSignal) =>
  Promise<{ body: unknown; status: number }>>([
  ['/agentic/intent', handleAgenticIntent],
  ['/agentic/plan', handleAgenticPlan],
  ['/agentic/companion', handleAgenticCompanion],
]);

const json = (body: unknown, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

const PLAN_EVENTS = 'application/x-ndjson';

function streamPlan(body: unknown, env: Env, signal: AbortSignal, noStore: HeadersInit): Response {
  const downstream = new AbortController();
  const active = AbortSignal.any([signal, downstream.signal]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: { type: 'progress' } & AgenticProgress | { type: 'result'; result: unknown } | { type: 'error' }) => {
        if (!active.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const onProgress = (progress: AgenticProgress) => send({ type: 'progress', ...progress });
      void handleAgenticPlan(body, env, active, onProgress).then(
        ({ status, body }) => send(status === 200 ? { type: 'result', result: body } : { type: 'error' }),
        () => send({ type: 'error' }),
      ).finally(() => { if (!downstream.signal.aborted) controller.close(); });
    },
    cancel() {
      downstream.abort();
    },
  });
  const headers = new Headers(noStore);
  headers.set('content-type', `${PLAN_EVENTS}; charset=utf-8`);
  headers.append('vary', 'accept');
  return new Response(stream, { headers });
}

function corsFor(req: Request, env: Env, origin = req.headers.get('origin') ?? ''): HeadersInit | null {
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
    const url = new URL(req.url);
    const path = url.pathname;
    const browserResearch = isResearchPath(path) && (req.headers.has('origin') || req.headers.has('x-walkwe-research-session'));
    if (isEvidencePath(path) && !browserResearch) return handleEvidence(req, env);
    const origin = req.headers.get('origin') ?? (browserResearch && req.headers.get('sec-fetch-site') === 'same-origin' ? url.origin : '');
    const originHeaders = corsFor(req, env, origin);
    if (!originHeaders) return new Response('forbidden', { status: 403 });
    const cors = {
      ...originHeaders,
      ...(path === '/sos' ? { 'access-control-allow-credentials': 'true' } : {}),
      ...(browserResearch ? {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-walkwe-research-session',
      } : {}),
    };
    const agenticHandler = agenticHandlers.get(path);
    if (!browserResearch && !agenticHandler && !['/speak', '/route-evidence', '/voice/live', '/voice/live/speak', '/sos'].includes(path)) {
      return json({ error: 'not_found' }, 404, cors);
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const method = browserResearch && path !== '/agents/research' ? 'GET' : 'POST';
    if (req.method !== method) return json({ error: 'method' }, 405, cors);
    if (path === '/route-evidence' && (!env.OPENAI_API_KEY || !env.RATE_LIMITER || !env.GLOBAL_LIMITER)) {
      return json({ error: 'unavailable' }, 503, cors);
    }

    const noStore = { ...cors, 'cache-control': 'no-store' };
    if (browserResearch && (!env.OPENAI_API_KEY || !env.RATE_LIMITER || !env.GLOBAL_LIMITER
      || !env.AGENTIC_MODEL_LIMITER || origin !== env.OPENAI_AGENTIC_ORIGIN)) {
      return json({ status: 'unavailable' }, 503, noStore);
    }
    // The paid endpoints require both limiter bindings before they call a model.
    if (env.RATE_LIMITER) {
      const who = req.headers.get('cf-connecting-ip') ?? 'unknown';
      const scope = browserResearch ? 'research' : path === '/sos' ? 'sos' : 'app';
      const [mine, all] = await Promise.all([
        env.RATE_LIMITER.limit({ key: `${scope}:ip:${who}` }),
        env.GLOBAL_LIMITER ? env.GLOBAL_LIMITER.limit({ key: `${scope}:all` }) : Promise.resolve({ success: true }),
      ]);
      if (!mine.success || !all.success) return json({ error: 'rate_limited' }, 429, noStore);
    }

    if (browserResearch) {
      if (method === 'POST' && !(await env.AGENTIC_MODEL_LIMITER!.limit({ key: 'research' })
        .catch(() => ({ success: false }))).success) return json({ status: 'rate_limited' }, 429, noStore);
      const response = await handleBrowserResearch(req, env);
      const headers = new Headers(response.headers);
      new Headers(noStore).forEach((value, name) => headers.set(name, value));
      return new Response(response.body, { status: response.status, headers });
    }

    if (path === '/sos') return handleSos(req, env, noStore);

    if (agenticHandler) {
      const body = await readJson(req).catch(() => null);
      const modelEnabled = env.OPENAI_API_KEY && env.RATE_LIMITER && env.GLOBAL_LIMITER
        && req.headers.get('origin') === env.OPENAI_AGENTIC_ORIGIN
        && (await env.AGENTIC_MODEL_LIMITER?.limit({ key: 'model' }).catch(() => ({ success: false })))?.success;
      const planEnv = modelEnabled ? env : { ...env, OPENAI_API_KEY: undefined };
      if (path === '/agentic/plan' && req.headers.get('accept') === PLAN_EVENTS) {
        return streamPlan(body, planEnv, req.signal, noStore);
      }
      const result = await agenticHandler(body, planEnv, req.signal);
      return json(result.body, result.status, noStore);
    }

    if (path === '/voice/live' || path === '/voice/live/speak' || path === '/speak') {
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
      const result = await rankEvidence(body, env.OPENAI_API_KEY!);
      return json(result.body, result.status, noStore);
    } catch {
      return json({ error: 'bad_request' }, 400, cors);
    }
  },
};
