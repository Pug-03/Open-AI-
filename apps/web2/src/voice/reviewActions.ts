import { speechParts, type ReplyLanguage, type VoiceActions } from '@walkwe/core/voice';
import type { AgenticRequest } from '../agentic.ts';
import { routeReviewSpeech, type RouteReviewController } from './routeReview.ts';

const unavailable = (language: ReplyLanguage) => speechParts(language, locale => locale === 'th'
  ? 'ตรวจหลักฐานไม่สำเร็จตอนนี้ คุณยังดูเส้นทางที่แอปคำนวณได้'
  : 'I could not review the evidence just now. You can still use the routes in the app.');

export function routeReviewActions(
  review: RouteReviewController,
  current: () => AgenticRequest | null,
  resolve: (signal: AbortSignal) => Promise<AgenticRequest | null>,
  onReview?: () => void,
): Pick<VoiceActions, 'review_route' | 'answer_route_review'> {
  return {
    review_route: async ({ language }, signal) => {
      const request = await resolve(signal);
      if (signal.aborted) return [];
      if (!request) return speechParts(language, locale => locale === 'th'
        ? 'เลือกต้นทางกับปลายทางจากรายชื่อสถานที่สาธารณะในสยามก่อน แล้วสั่งตรวจเส้นทางได้เลย'
        : 'Choose two public landmarks in Siam, then ask me to review the route.');
      onReview?.();
      const result = await review.run(request, undefined, signal);
      if (signal.aborted) return [];
      return result ? routeReviewSpeech(result, language, request.mode) : unavailable(language);
    },
    answer_route_review: async ({ language, preference }, signal) => {
      const request = current();
      if (!request || !review.pendingClarification?.options.some(option => option.value === preference)) {
        return speechParts(language, locale => locale === 'th'
          ? 'ตอนนี้ไม่มีคำถามเรื่องไฟที่รอคำตอบ สั่งตรวจเส้นทางได้เลย'
          : 'No lighting question is awaiting an answer. You can ask me to review the route.');
      }
      const result = await review.run(request, preference, signal);
      if (signal.aborted) return [];
      return result ? routeReviewSpeech(result, language, request.mode, true) : unavailable(language);
    },
  };
}
