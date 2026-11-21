import { describe, expect, it, vi } from 'vitest';
import type { AgenticPlan, AgenticRequest, reviewRoute } from '../agentic.ts';
import { createRouteReview, routeReviewSpeech } from './routeReview.ts';

vi.mock('../agentic.ts', () => ({ reviewRoute: vi.fn() }));

const trip: AgenticRequest = {
  from: 'bts:CEN', to: 'osm:W157482067', date: '2026-11-21', time: '21:00',
  noStairs: false, mode: 'night', language: 'th',
};
const before = {
  status: 'ok', source: 'verified_planner', provenance: 'public_web2_graph',
  datasetVersion: 'demo-1', decision: 'ACT', recommendedId: 'r1', text: 'Model draft with 900 meters',
  evidenceIds: ['edge:e1'], routes: [{ id: 'r1', meters: 121, minutes: 2, lit: 100, unknown: 21, sunMinutes: null }],
  clarification: { id: 'night_lighting_preference', text: 'Model prompt', options: [
    { value: 'direct', label: 'Option A', ref: 'r1' },
    { value: 'prefer_evidence', label: 'Option B', ref: 'r2' },
  ] },
  trace: [{ step: 'critic', passed: true }],
} satisfies AgenticPlan;
const after = {
  ...before, source: 'worker', recommendedId: 'r2', clarification: null,
  routes: [{ id: 'r2', meters: 141, minutes: 3, lit: 130, unknown: 11, sunMinutes: null }],
} satisfies AgenticPlan;

describe('shared route review', () => {
  it('shares progress and answers a live offer once, including in another reply language', async () => {
    const request = vi.fn<typeof reviewRoute>();
    request.mockImplementationOnce(async (_trip, _signal, progress) => {
      progress({ type: 'progress', stage: 'evidence', state: 'working' });
      return before;
    }).mockResolvedValueOnce(after);
    const review = createRouteReview(request);

    await expect(review.run(trip, 'direct')).resolves.toBeNull();
    const active = review.run(trip);
    expect(review.getSnapshot()).toMatchObject({ busy: true, stages: { evidence: 'working' } });
    await expect(review.run(trip)).resolves.toBeNull();
    await expect(active).resolves.toBe(before);
    expect(review.getSnapshot().pendingClarification).toEqual(before.clarification);

    await expect(review.run({ ...trip, time: '20:00' }, 'prefer_evidence')).resolves.toBeNull();
    await expect(review.run({ ...trip, language: 'en' }, 'prefer_evidence')).resolves.toBe(after);
    expect(review.getSnapshot()).toMatchObject({ answered: true, pendingClarification: null,
      change: { previousUnknown: 21 }, stages: { review: 'fallback' } });
    await expect(review.run(trip, 'prefer_evidence')).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('restores a pending offer on voice cancellation and discards responses for a reset trip', async () => {
    const request = vi.fn<typeof reviewRoute>().mockResolvedValueOnce(before);
    let resolve!: (result: AgenticPlan) => void;
    request.mockImplementationOnce(() => new Promise(resolveRequest => { resolve = resolveRequest; }));
    const review = createRouteReview(request);
    await review.run(trip);

    const voice = new AbortController();
    const followUp = review.run(trip, 'direct', voice.signal);
    voice.abort();
    expect(request.mock.calls[1]?.[1].aborted).toBe(true);
    expect(review.getSnapshot()).toMatchObject({ busy: false, pendingClarification: before.clarification });
    resolve(after);
    await expect(followUp).resolves.toBeNull();

    request.mockImplementationOnce(() => new Promise(resolveRequest => { resolve = resolveRequest; }));
    const abandoned = review.run(trip, 'direct');
    review.reset();
    expect(request.mock.calls[2]?.[1].aborted).toBe(true);
    resolve(after);
    await expect(abandoned).resolves.toBeNull();
    expect(review.getSnapshot()).toMatchObject({ result: null, pendingClarification: null });
  });
});

describe('voice review readback', () => {
  it('asks with fixed localized choices and reads only checked route measurements afterward', () => {
    const prompt = routeReviewSpeech(before, 'both', 'night');
    expect(prompt[0]?.text).toContain('มีไฟ หรือไม่มีไฟ');
    expect(prompt[1]?.text).toContain('lit or unlit');
    expect(prompt.map(part => part.text).join()).not.toContain('Model prompt');

    const response = routeReviewSpeech(after, 'en', 'night', true)[0]?.text;
    expect(response).toContain('routing engine');
    expect(response).toContain('141 meters');
    expect(response).toContain('unverified for 11 meters');
    expect(response).not.toMatch(/900|assuming|safe/);

    const repeatedOffer = routeReviewSpeech(before, 'en', 'night', true)[0]?.text;
    expect(repeatedOffer).toContain('proposal passed the route checks');
    expect(repeatedOffer).not.toContain('assuming');
  });
});
