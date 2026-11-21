import { describe, expect, it, vi } from 'vitest';
import { intentResponseSchema, planRequest, planResponseSchema, publicLandmark } from './agentic.ts';

vi.mock('./env.ts', () => ({ env: { voiceProxyUrl: null } }));

describe('public landmark review', () => {
  const from = publicLandmark('bts:CEN', 'en')!;
  const to = publicLandmark('osm:W157482067', 'en')!;
  const departure = '2026-11-21T21:00';
  const options = { noStairs: true, language: 'en', mode: 'night' } as const;

  it('sends catalogue identifiers and confirmed settings, without coordinates', () => {
    expect(planRequest(from, to, departure, options)).toEqual({
      from: from.id, to: to.id, date: '2026-11-21', time: '21:00', ...options,
    });
    expect(planRequest({ ...from, location: { ...from.location, lat: 13.74 } }, to, departure, options)).toBeNull();
    expect(planRequest({ ...from, id: 'current' }, to, departure, options)).toBeNull();
    expect(planRequest(from, from, departure, options)).toBeNull();
  });

  it('rejects drafts outside the catalogue and unverified response shapes', () => {
    const draft = { status: 'confirm', from: from.id, to: to.id, time: '21:00', mode: 'night', noStairs: false };
    expect(intentResponseSchema.safeParse(draft).success).toBe(true);
    expect(intentResponseSchema.safeParse({ ...draft, to: 'not-in-catalogue' }).success).toBe(false);
    expect(planResponseSchema.safeParse({ status: 'ok', source: 'verified_planner', text: 'unsupported' }).success).toBe(false);
  });
});
