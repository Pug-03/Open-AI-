export type Light = 'lit' | 'dim' | 'dark';
export type TimeBand = 'day' | 'night';
export type Observation = { reporterId: string; value: Light | 'cannot_tell'; segmentId: string; timeBand: TimeBand };
export type LightingProposal = {
  status: 'pending_review'; kind: 'lighting'; segmentId: string; timeBand: TimeBand;
  value: Light; counts: Record<Light, number>; distinctReports: number;
  recommendation?: 'review' | 'collect_more'; model?: string;
};
type Model = { structured(role: 'steward' | 'news', options: {
  instructions: string; input: unknown; schema: unknown; signal?: AbortSignal;
}): Promise<unknown> };

export function draftLightingProposal(input: { segmentId: string; timeBand: TimeBand; observations: Observation[] }):
  LightingProposal | { status: 'invalid' | 'insufficient_evidence' };
export function stewardReview(input: { proposal: LightingProposal; model: Model | null }): Promise<LightingProposal>;
export function auditPhoto(input: { trustedImage: string; consentGranted: boolean }, model: Model | null): Promise<
  { status: 'cannot_tell' } | { status: 'pending_review'; lighting: Light | 'cannot_tell'; sidewalk: string; quality: string }>;
export function draftNews(input: { text: string; sourceUrl: string; allowedSegmentIds: string[] }, model: Model | null): Promise<
  { status: 'invalid' } | { status: 'pending_review'; kind: 'news'; sourceUrl: string; category: string | null;
    happenedOn: string | null; publishedOn: string | null; segmentId: string | null }>;
export function reviewProposal<T>(input: { proposalId: string; decision: 'approve' | 'reject'; expectedVersion: string }, options: {
  actor: { id: string; role: string };
  store: { decidePending(args: typeof input & { reviewerId: string }): Promise<T> };
}): Promise<T | { status: 'forbidden' | 'invalid' }>;
