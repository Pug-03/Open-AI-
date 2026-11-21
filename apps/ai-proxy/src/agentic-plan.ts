import { z } from 'zod';
import {
  applyApprovedLighting, isWeb2Place, publicWeb2Places, type RoutingResult,
} from '../../web2/agentic/routing-core.mjs';
import { createWorkflows, type PlanProgress } from '../../../packages/walkwe-agentic/src/agentic-workflow/agents.mjs';
import { createModelClient } from '../../../packages/walkwe-agentic/src/integrations/openai.mjs';
import { loadHostedRouting } from './agentic-routing';
import { readApprovedLighting, type EvidenceEnv } from './evidence';
import type { Env } from './index';

type AgenticEnv = EvidenceEnv & Pick<Env, 'RATE_LIMITER' | 'GLOBAL_LIMITER'>;
export type AgenticProgress = PlanProgress | { stage: 'routes'; state: 'working' | 'done' | 'fallback' };

const dayStamp = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(date => {
  const instant = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date;
});
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const language = z.enum(['th', 'en']);
const publicId = z.string().max(48).refine(isWeb2Place);
const planSchema = z.strictObject({
  from: publicId, to: publicId, date: dayStamp, time: clock,
  mode: z.enum(['day', 'night']), language, noStairs: z.boolean(),
  preference: z.enum(['direct', 'prefer_evidence']).optional(),
}).refine(request => request.from !== request.to);
const intentSchema = z.strictObject({ text: z.string().trim().min(2).max(500), language });
const companionEvent = z.enum(['closing', 'nightfall', 'rain', 'unknown']);
const companionSchema = z.strictObject({
  event: companionEvent, unknownMeters: z.number().min(0).max(50_000), language,
  warnings: z.number().int().min(0).max(2), handled: z.array(companionEvent).max(4),
}).refine(({ handled }) => new Set(handled).size === handled.length);
const companionMessages = {
  closing: {
    th: 'ทางเชื่อมอาจปิดก่อนคุณเดินถึง ตรวจเวลาเปิดหรือเทียบเส้นทางอื่นได้',
    en: 'A passage may close before you reach it. Check its hours or compare another route.',
  },
  nightfall: {
    th: 'ทริปนี้ใกล้เข้าช่วงกลางคืน ตรวจข้อมูลไฟหรือเทียบเส้นทางโหมดกลางคืนได้',
    en: 'This walk is approaching nightfall. Check lighting information or compare routes in night mode.',
  },
  rain: {
    th: 'มีสัญญาณฝนสำหรับทริปนี้ ตรวจสภาพอากาศและพิจารณาทางที่มีหลังคาได้',
    en: 'There is a rain alert for this trip. Check conditions and consider a covered route.',
  },
  unknown: {
    th: 'บางช่วงของเส้นทางยังไม่มีข้อมูลไฟ เปิดดูหลักฐานรายช่วงได้',
    en: 'Lighting information is missing for part of this route. Open the route evidence for details.',
  },
};
const unavailable = { status: 503, body: { error: 'agentic_unavailable' } };
const invalid = { status: 400, body: { error: 'bad_request' } };
const getModel = (env: AgenticEnv) => env.RATE_LIMITER && env.GLOBAL_LIMITER
  ? createModelClient({ apiKey: env.OPENAI_API_KEY }) : null;

function planText(plan: Extract<RoutingResult, { status: 'ok' }>, lang: 'th' | 'en') {
  const route = plan.routes.find(item => item.id === plan.recommendedId)!;
  if (lang === 'en') {
    const walk = `Estimated walk: ${route.minutes} min`;
    if (plan.mode === 'day') return `${walk}. Estimated sun exposure: ${route.sunMinutes} min.`;
    return `${plan.stress.flipped ? 'Lighting assumptions change the recommendation. ' : ''}${walk}. Mapped as lit: ${Math.round(route.lit)} m. Lighting unverified: ${Math.round(route.unknown)} m.`;
  }
  const walk = `เดินประมาณ ${route.minutes} นาที`;
  if (plan.mode === 'day') return `${walk} คาดว่าโดนแดด ${route.sunMinutes} นาที`;
  return `${plan.stress.flipped ? 'ข้อมูลไฟที่ยังไม่ทราบมีผลต่อคำแนะนำ ' : ''}${walk} ช่วงที่มีข้อมูลว่ามีไฟ ${Math.round(route.lit)} ม. ไม่ทราบสถานะไฟ ${Math.round(route.unknown)} ม.`;
}

export async function handleAgenticPlan(
  body: unknown, env: AgenticEnv, signal: AbortSignal, onProgress?: (progress: AgenticProgress) => void,
) {
  const parsed = planSchema.safeParse(body);
  if (!parsed.success) return invalid;
  const request = parsed.data;
  try {
    signal.throwIfAborted();
    onProgress?.({ stage: 'routes', state: 'working' });
    const dataset = await loadHostedRouting(env.WALKWE_DATA_ORIGIN);
    signal.throwIfAborted();
    let route = dataset.workflowOptions.route(request);
    if (route.status === 'ok') {
      onProgress?.({ stage: 'routes', state: 'done' });
      onProgress?.({ stage: 'evidence', state: 'working' });
    }
    if (route.status === 'ok' && route.mode === 'night') {
      const ids = [...new Set(route.routes.flatMap(candidate => candidate.segments
        .filter(segment => segment.light === 'unknown' && dataset.segmentKnown(segment.id))
        .map(segment => segment.id)))];
      const approved = await readApprovedLighting(env, dataset.version, ids).catch(() => new Map());
      route = applyApprovedLighting(route, approved, request.preference);
    }
    signal.throwIfAborted();
    const model = getModel(env);
    const workflows = createWorkflows({ ...dataset.workflowOptions, model, route: () => route });
    const plan = await workflows.plan(request, { useModel: Boolean(model), signal, onProgress });
    if (plan.status !== 'ok') {
      if (plan.status === 'worker_error' || plan.status === 'stale_snapshot') return unavailable;
      return { status: 200, body: { status: plan.status, decision: plan.decision } };
    }
    onProgress?.({ stage: 'review', state: plan.source === 'verified_planner' ? 'done' : 'fallback' });
    const en = request.language === 'en';
    const { stress } = plan;
    const selected = plan.routes.find(item => item.id === plan.recommendedId)!;
    const missingLighting = plan.mode === 'night' && selected.unknown > 0;
    const evidenceIds = stress.flipped ? stress.evidenceIds : missingLighting
      ? [...new Set(selected.segments.filter(segment => segment.light === 'unknown' && dataset.segmentKnown(segment.id))
        .sort((a, b) => b.length - a.length).map(segment => segment.id))].slice(0, 3)
      : [];
    const question = en
      ? (stress.flipped
        ? 'The comparison changes with unmapped lighting. Which assumption should we use?'
        : 'Some stretches have unmapped lighting. Both assumptions suggest the same route. Which should we use for the review?')
      : (stress.flipped
        ? 'การเปรียบเทียบเปลี่ยนตามช่วงที่ไม่มีข้อมูลไฟ ต้องการลองสมมติฐานไหน?'
        : 'บางช่วงยังไม่มีข้อมูลไฟ ทั้งสองสมมติฐานได้เส้นทางเดียวกัน ต้องการใช้สมมติฐานไหนในการตรวจ?');
    const clarification = !request.preference && (stress.flipped || missingLighting) ? {
      id: 'night_lighting_preference',
      text: question,
      options: [
        { value: 'direct', label: en ? 'Assume unmapped stretches are lit' : 'ลองสมมติว่าช่วงที่ไม่มีข้อมูลมีไฟ', ref: stress.flipped ? stress.optimisticId : selected.id },
        { value: 'prefer_evidence', label: en ? 'Assume unmapped stretches are dark' : 'ลองสมมติว่าช่วงที่ไม่มีข้อมูลไม่มีไฟ', ref: stress.flipped ? stress.pessimisticId : selected.id },
      ],
    } : null;
    return { status: 200, body: {
      status: 'ok', provenance: 'public_web2_graph', source: plan.source,
      datasetVersion: plan.datasetVersion, baseDatasetVersion: dataset.version, mode: plan.mode,
      decision: plan.decision, recommendedId: plan.recommendedId, shortestId: plan.shortestId,
      text: plan.final?.text ?? planText(plan, request.language), clarification,
      evidenceIds,
      routes: plan.routes.map(({ id, meters, minutes, lit, dark, unknown, shade, sunMinutes }) => ({
        id, meters, minutes, lit, dark, unknown, shade, sunMinutes,
      })),
      trace: plan.trace.map(({ step, status, passed }) => ({ step, status, passed })),
    } };
  } catch {
    return unavailable;
  }
}

export async function handleAgenticIntent(body: unknown, env: AgenticEnv, signal: AbortSignal) {
  const parsed = intentSchema.safeParse(body);
  if (!parsed.success) return invalid;
  const model = getModel(env);
  const workflows = createWorkflows({ places: publicWeb2Places, model });
  const intent = await workflows.intent({ text: parsed.data.text, useModel: Boolean(model), signal });
  if (intent.status !== 'confirm') return invalid;
  return { status: 200, body: { status: 'confirm', source: intent.source, ...intent.draft, mode: intent.draft.mode ?? 'auto' } };
}

export async function handleAgenticCompanion(body: unknown, env: AgenticEnv, signal: AbortSignal) {
  const parsed = companionSchema.safeParse(body);
  if (!parsed.success) return invalid;
  const { event, unknownMeters, language: lang, warnings, handled } = parsed.data;
  const model = getModel(env);
  const { action, warnings: nextWarnings, handled: nextHandled } = await createWorkflows({ model }).companion({
    event, route: { unknown: unknownMeters }, warnings, handled, useModel: Boolean(model), signal,
  });
  return { status: 200, body: {
    action, warnings: nextWarnings, handled: nextHandled,
    ...(action !== 'silent' ? { text: companionMessages[event][lang] } : {}),
  } };
}
