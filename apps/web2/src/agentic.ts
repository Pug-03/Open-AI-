import { z } from 'zod';
import { env } from './env.ts';
import { LANDMARKS } from './components/plan/landmarks.ts';
import type { PickedPlace } from './store/plan.ts';

const placeId = z.string().refine(id => LANDMARKS.some(place => place.id === id));
const language = z.enum(['th', 'en']);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const preference = z.enum(['direct', 'prefer_evidence']);
const routeRequestSchema = z.object({
  from: placeId,
  to: placeId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time,
  mode: z.enum(['day', 'night']),
  language,
  noStairs: z.boolean(),
  preference: preference.optional(),
});

export type AgenticRequest = z.infer<typeof routeRequestSchema>;
export type RoutePreference = z.infer<typeof preference>;
export const intentResponseSchema = z.object({
  status: z.literal('confirm'),
  from: placeId.nullable(),
  to: placeId.nullable(),
  mode: z.enum(['day', 'night', 'auto']),
  time: time.nullable(),
  noStairs: z.boolean(),
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

async function post<T>(path: string, body: object, schema: z.ZodType<T>, signal: AbortSignal, timeout: number): Promise<T> {
  if (!env.voiceProxyUrl) throw new Error('agentic_unavailable');
  const response = await fetch(`${env.voiceProxyUrl}${path}`, {
    method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  });
  if (!response.ok) throw new Error('agentic_unavailable');
  return schema.parse(await response.json());
}

export const receiveIntent = (text: string, language: 'th' | 'en', signal: AbortSignal) =>
  post('/agentic/intent', { text, language }, intentResponseSchema, signal, 12_000);

export const reviewRoute = (request: AgenticRequest, signal: AbortSignal) =>
  post('/agentic/plan', request, planResponseSchema, signal, 27_000);

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
