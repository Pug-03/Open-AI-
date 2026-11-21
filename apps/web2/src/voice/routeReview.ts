import { useEffect, useState, useSyncExternalStore } from 'react';
import { speechParts, type ReplyLanguage } from '@walkwe/core/voice';
import { reviewRoute, type AgenticPlan, type AgenticProgressEvent, type AgenticRequest, type RoutePreference } from '../agentic.ts';

type SuccessfulReview = Extract<AgenticPlan, { status: 'ok' }>;
type ReviewStages = Partial<Record<AgenticProgressEvent['stage'], AgenticProgressEvent['state']>>;

interface ReviewState {
  result: AgenticPlan | null;
  stages: ReviewStages;
  busy: boolean;
  failed: boolean;
  answered: boolean;
  pendingClarification: SuccessfulReview['clarification'];
  change: { previousUnknown?: number } | null;
}

const empty: ReviewState = {
  result: null, stages: {}, busy: false, failed: false, answered: false,
  pendingClarification: null, change: null,
};

const tripKey = ({ from, to, date, time, mode, noStairs }: AgenticRequest) =>
  JSON.stringify([from, to, date, time, mode, noStairs]);

function lightingQuestion(result: AgenticPlan) {
  if (result.status !== 'ok') return null;
  const offer = result.clarification;
  if (offer?.id !== 'night_lighting_preference' || new Set(offer.options.map(option => option.value)).size !== 2) return null;
  return offer;
}

function routeMetrics(result: SuccessfulReview) {
  return result.routes?.find(route => route.id === result.recommendedId);
}

export function createRouteReview(requestReview: typeof reviewRoute = reviewRoute) {
  const listeners = new Set<() => void>();
  let state = empty;
  let scope: string | null = null;
  let active: AbortController | null = null;

  function publish(next: ReviewState) {
    state = next;
    listeners.forEach(listener => listener());
  }

  function reset() {
    const request = active;
    active = null;
    scope = null;
    request?.abort();
    publish(empty);
  }

  async function run(request: AgenticRequest, preference?: RoutePreference, voiceSignal?: AbortSignal): Promise<AgenticPlan | null> {
    if (active || voiceSignal?.aborted) return null;
    const key = tripKey(request);
    const prior = key === scope ? state : empty;
    if (preference && !prior.pendingClarification?.options.some(option => option.value === preference)) return null;

    const controller = new AbortController();
    active = controller;
    scope = key;
    const signal = voiceSignal ? AbortSignal.any([controller.signal, voiceSignal]) : controller.signal;
    const cancel = () => {
      if (active !== controller) return;
      active = null;
      publish(prior);
    };
    signal.addEventListener('abort', cancel, { once: true });
    publish({ ...prior, stages: {}, busy: true, failed: false });

    try {
      const result = await requestReview({ ...request, preference }, signal, ({ stage, state: status }) => {
        if (active === controller) publish({ ...state, stages: { ...state.stages, [stage]: status } });
      });
      if (active !== controller || signal.aborted) return null;

      const stages = { ...state.stages };
      let change: ReviewState['change'] = null;
      if (result.status === 'ok') {
        const critic = result.trace?.filter(entry => entry.step === 'critic').at(-1);
        stages.routes = 'done';
        stages.evidence = 'done';
        stages.review = result.source === 'verified_planner' ? 'done' : 'fallback';
        if (critic?.passed != null) stages.critique = critic.passed ? 'done' : 'fallback';
        if (preference && prior.result?.status === 'ok' && prior.result.datasetVersion === result.datasetVersion
          && prior.result.recommendedId !== result.recommendedId) {
          change = { previousUnknown: routeMetrics(prior.result)?.unknown };
        }
      }
      publish({ result, stages, change, busy: false, failed: false, answered: Boolean(preference),
        pendingClarification: request.mode === 'night' && !preference ? lightingQuestion(result) : null });
      return result;
    } catch {
      if (active === controller) publish({ ...state, busy: false, failed: true });
      return null;
    } finally {
      signal.removeEventListener('abort', cancel);
      if (active === controller) active = null;
    }
  }

  return {
    run, reset,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export function useRouteReview() {
  const [review] = useState(() => createRouteReview());
  const state = useSyncExternalStore(review.subscribe, review.getSnapshot, review.getSnapshot);
  useEffect(() => review.reset, [review]);
  return { ...state, run: review.run, reset: review.reset };
}

export type RouteReviewController = ReturnType<typeof useRouteReview>;

export function routeReviewSpeech(result: AgenticPlan | null, language: ReplyLanguage, mode: AgenticRequest['mode'], answered = false) {
  return speechParts(language, locale => {
    const th = locale === 'th';
    if (result?.status !== 'ok') return th
      ? 'ตรวจเส้นทางด้วยเสียงไม่ได้ตอนนี้ คุณยังดูเส้นทางบนแผนที่ได้'
      : 'I could not complete the route review. Your map routes are still available.';
    if (mode === 'night' && !answered && lightingQuestion(result)) return th
      ? 'ยังไม่ทราบข้อมูลไฟบางช่วง ให้ลองเทียบโดยสมมติว่าช่วงเหล่านั้นมีไฟ หรือไม่มีไฟครับ'
      : 'Lighting is unverified on some stretches. Should I compare the routes assuming those stretches are lit or unlit?';

    const source = result.source === 'verified_planner'
      ? (th ? 'ตรวจข้อเสนอของ AI แล้ว' : 'The AI proposal passed the route checks.')
      : (th ? 'นี่คือผลจากตัวคำนวณเส้นทาง' : 'This is the routing engine’s result.');
    const route = routeMetrics(result);
    if (!route) return th ? 'ไม่มีตัวเลขเส้นทางให้ยืนยัน ลองดูรายละเอียดบนแผนที่ครับ'
      : 'I have no route measurements to confirm. Check the details on the map.';
    const meters = Math.round(route.meters);
    const minutes = Math.round(route.minutes);
    const summary = th ? `ทางที่เสนอประมาณ ${meters} เมตร ใช้เวลาเดิน ${minutes} นาที`
      : `The suggested walk is about ${meters} meters and takes ${minutes} minutes.`;
    if (mode === 'night') {
      const unknown = Math.round(route.unknown);
      return th ? `${source} ${summary} ยังไม่ทราบสถานะไฟ ${unknown} เมตร`
        : `${source} ${summary} Lighting is unverified for ${unknown} meters.`;
    }
    if (route.sunMinutes == null) return `${source} ${summary}`;
    return th ? `${source} ${summary} คาดว่าโดนแดด ${route.sunMinutes} นาที`
      : `${source} ${summary} Estimated sun exposure is ${route.sunMinutes} minutes.`;
  });
}
