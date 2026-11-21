import { z } from 'zod';
import { env } from './env.ts';
import { LANDMARKS } from './components/plan/landmarks.ts';
import type { PickedPlace } from './store/plan.ts';
import { placeId, time, preference, routeRequestSchema, type AgenticRequest } from './agenticRequest.ts';

export type { AgenticRequest, RoutePreference } from './agenticRequest.ts';
export const intentResponseSchema = z.object({
  status: z.literal('confirm'),
  from: placeId.nullable(),
  to: placeId.nullable(),
  mode: z.enum(['day', 'night', 'auto']),
  time: time.nullable(),
  noStairs: z.boolean(),
  source: z.union([z.literal('system'), z.string().regex(/^gpt-[\w.-]{1,76}$/)]).optional(),
});
export type AgenticIntent = z.infer<typeof intentResponseSchema>;

export const planResponseSchema = z.union([
  z.object({
    status: z.literal('ok'),
    datasetVersion: z.string().max(120),
    provenance: z.literal('public_web2_graph'),
    source: z.enum(['worker', 'verified_planner']),
    decision: z.enum(['ACT', 'VERIFY']),
    text: z.string().min(1).max(1200),
    recommendedId: z.string(),
    evidenceIds: z.array(z.string()).max(256),
    routes: z.array(z.object({
      id: z.string(),
      meters: z.number().finite().min(0),
      minutes: z.number().finite().min(0),
      lit: z.number().finite().min(0),
      unknown: z.number().finite().min(0),
      sunMinutes: z.number().finite().min(0).nullable(),
    })).max(16).optional(),
    clarification: z.object({
      id: z.string(),
      text: z.string().max(450),
      options: z.array(z.object({ value: preference, label: z.string().max(120), ref: z.string() })).length(2),
    }).nullable(),
    trace: z.array(z.object({
      step: z.string().regex(/^[a-z_]{1,40}$/),
      status: z.string().regex(/^[a-z_]{1,40}$/).optional(),
      passed: z.boolean().optional(),
    })).max(32).optional(),
  }),
  z.object({
    status: z.enum(['no_path', 'out_of_coverage', 'invalid', 'worker_error', 'stale_snapshot']),
    decision: z.literal('ABSTAIN'),
  }),
]);
export type AgenticPlan = z.infer<typeof planResponseSchema>;
const progressSchema = z.object({
  type: z.literal('progress'),
  stage: z.enum(['routes', 'evidence', 'review', 'critique']),
  state: z.enum(['working', 'done', 'fallback']),
});
export type AgenticProgressEvent = z.infer<typeof progressSchema>;

export function publicLandmark(id: string | null, lang: 'th' | 'en'): PickedPlace | null {
  const place = LANDMARKS.find(candidate => candidate.id === id);
  return place ? {
    id: place.id, name: place[lang], detail: place[lang === 'th' ? 'en' : 'th'],
    location: { lat: place.lat, lng: place.lng }, kind: 'search',
  } : null;
}

export function planRequest(
  from: PickedPlace, to: PickedPlace, localDeparture: string, options: Pick<AgenticRequest, 'language' | 'mode' | 'noStairs'>,
): AgenticRequest | null {
  // Only send IDs for the catalogue points themselves. A nearby pin is a different trip.
  if (![from, to].every(point => LANDMARKS.some(place => place.id === point.id
    && place.lat === point.location.lat && place.lng === point.location.lng))) return null;
  const [date, time] = localDeparture.split('T');
  const parsed = routeRequestSchema.safeParse({ from: from.id, to: to.id, date, time, ...options });
  return parsed.success && from.id !== to.id ? parsed.data : null;
}

async function sendRequest(path: string, body: object, signal: AbortSignal, timeout: number, accept = 'application/json') {
  if (!env.voiceProxyUrl) throw new Error('agentic_unavailable');
  const response = await fetch(`${env.voiceProxyUrl}${path}`, {
    method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json', accept },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  });
  if (!response.ok) throw new Error('agentic_unavailable');
  return response;
}

async function post<T>(path: string, body: object, schema: z.ZodType<T>, signal: AbortSignal, timeout: number): Promise<T> {
  return schema.parse(await (await sendRequest(path, body, signal, timeout)).json());
}

export const receiveIntent = (text: string, language: 'th' | 'en', signal: AbortSignal) =>
  post('/agentic/intent', { text, language }, intentResponseSchema, signal, 12_000);

export async function readPlanReview(response: Response, onProgress: (event: AgenticProgressEvent) => void) {
  if (!response.headers.get('content-type')?.startsWith('application/x-ndjson')) {
    return planResponseSchema.parse(await response.json());
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('agentic_unavailable');
  const decoder = new TextDecoder();
  let buffer = '';
  let bytes = 0;

  const readLine = (line: string): AgenticPlan | undefined => {
    if (!line.trim()) return;
    const event: unknown = JSON.parse(line);
    if (typeof event === 'object' && event !== null && 'type' in event && event.type === 'result' && 'result' in event) {
      return planResponseSchema.parse(event.result);
    }
    const progress = progressSchema.safeParse(event);
    if (!progress.success) throw new Error('agentic_unavailable');
    onProgress(progress.data);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        const last = readLine(buffer + decoder.decode());
        if (last) return last;
        throw new Error('agentic_unavailable');
      }
      bytes += value.byteLength;
      if (bytes > 128 * 1024) throw new Error('agentic_unavailable');
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const result = readLine(line);
        if (result) return result;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function reviewRoute(
  request: AgenticRequest, signal: AbortSignal, onProgress: (event: AgenticProgressEvent) => void,
) {
  const response = await sendRequest('/agentic/plan', request, signal, 27_000, 'application/x-ndjson');
  return readPlanReview(response, onProgress);
}

const companionEvent = z.enum(['closing', 'nightfall', 'rain', 'unknown']);
export type CompanionEvent = z.infer<typeof companionEvent>;
export const companionStateSchema = z.object({
  warnings: z.number().int().min(0).max(2),
  handled: z.array(companionEvent).max(4),
});
const companionResponse = companionStateSchema.extend({ action: z.enum(['silent', 'warn', 'offer_replan']) });
export type CompanionState = z.infer<typeof companionStateSchema>;
export const checkCompanion = (
  event: CompanionEvent, unknownMeters: number, language: 'th' | 'en', state: CompanionState, signal: AbortSignal,
) => post('/agentic/companion', { event, unknownMeters, language, ...state }, companionResponse, signal, 5_500);
