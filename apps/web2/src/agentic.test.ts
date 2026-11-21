import { describe, expect, it, vi } from 'vitest';
import { intentResponseSchema, planRequest, planResponseSchema, publicLandmark, readPlanReview } from './agentic.ts';

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

describe('route review events', () => {
  const result = { status: 'ok', datasetVersion: 'test', provenance: 'public_web2_graph',
    source: 'worker', decision: 'VERIFY', text: 'ข้อมูลไฟไม่ครบ', recommendedId: 'direct',
    evidenceIds: ['edge:12'], clarification: null };
  const lines = (events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n');
  const headers = { 'content-type': 'application/x-ndjson; charset=utf-8' };

  it('reports progress before validating the final result, including split Thai UTF-8 bytes', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    const events = vi.fn();
    const pending = readPlanReview(new Response(body, { headers }), events);
    const encoder = new TextEncoder();
    const progress = { type: 'progress', stage: 'routes', state: 'working' };
    stream.enqueue(encoder.encode(lines([progress]) + '\n'));
    await vi.waitFor(() => expect(events).toHaveBeenCalledExactlyOnceWith(progress));

    const resultBytes = encoder.encode(lines([{ type: 'result', result }]));
    const split = resultBytes.indexOf(0xe0) + 1;
    stream.enqueue(resultBytes.slice(0, split));
    stream.enqueue(resultBytes.slice(split));
    stream.close();
    await expect(pending).resolves.toEqual(result);
  });

  it('supports plain JSON responses and rejects an interrupted stream', async () => {
    const progress = vi.fn();
    await expect(readPlanReview(Response.json(result), progress)).resolves.toEqual(result);
    expect(progress).not.toHaveBeenCalled();
    await expect(readPlanReview(new Response(lines([{ type: 'progress', stage: 'routes', state: 'working' }]), { headers }), progress))
      .rejects.toThrow('agentic_unavailable');
    await expect(readPlanReview(new Response(lines([{ type: 'error' }]), { headers }), progress))
      .rejects.toThrow('agentic_unavailable');
  });
});
