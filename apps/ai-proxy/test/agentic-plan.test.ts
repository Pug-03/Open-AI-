import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { handleAgenticCompanion, handleAgenticIntent, handleAgenticPlan } from '../src/agentic-plan';
import proxy from '../src/index';

const area = readFileSync(new URL('../../../data/areas/siam.json', import.meta.url), 'utf8');
const incidents = readFileSync(new URL('../../../data/incidents/bangkok.json', import.meta.url), 'utf8');
const signal = new AbortController().signal;
const limiter = { limit: async () => ({ success: true }) };
const trip = {
  from: 'bts:CEN', to: 'osm:W356193680', date: '2026-11-21', time: '12:00',
  mode: 'day', language: 'en', noStairs: false,
};
const origin = 'https://walkwe-test.example';
const requestPlan = (body: unknown, accept = 'application/json') =>
  new Request('https://proxy-test.example/agentic/plan', {
    method: 'POST', body: JSON.stringify(body),
    headers: { origin, accept, 'content-type': 'application/json', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site' },
  });

afterEach(() => vi.unstubAllGlobals());

it('applies Planner and Critic to the canonical public graph and keeps private location data out of requests', async () => {
  const models: string[] = [];
  const dataOrigin = 'https://agentic-test.example';
  const transport = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.origin === dataOrigin) {
      expect(['/data/areas/siam.json', '/data/incidents/bangkok.json']).toContain(url.pathname);
      return new Response(url.pathname.includes('/areas/') ? area : incidents, { headers: { 'content-type': 'application/json' } });
    }
    expect(url.href).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    models.push(body.model);
    expect(body.store).toBe(false);
    expect(JSON.stringify(body.input)).not.toMatch(/coordinates|13\.74563|100\.53418/);
    const action = (name: string, args: object) =>
      Response.json({ status: 'completed', output: [
        { type: 'function_call', name, call_id: name, arguments: JSON.stringify(args) },
      ] });
    if (models.length === 1) return action('get_trip_snapshot', {});
    if (models.length === 2) return action('finish_from_snapshot', { emphasis: 'sun_exposure' });
    const { draft, evidence } = JSON.parse(body.input[0].content);
    expect(draft.claims.every((claim: { evidence_ids: string[] }) => claim.evidence_ids
      .every(id => evidence.some((row: { evidence_id: string; dataset_version: string }) =>
        row.evidence_id === id && row.dataset_version.startsWith('web2:'))))).toBe(true);
    return action('finish_review', {
      claim_checks: draft.claims.map((claim: { claim_id: string; evidence_ids: string[] }) => ({
        claim_id: claim.claim_id, evidence_ids: claim.evidence_ids, result: 'supported', reason: 'ok',
      })),
      wording_flags: [], verdict: 'accept',
    });
  });
  vi.stubGlobal('fetch', transport);

  const env = { OPENAI_API_KEY: 'fixture-key', WALKWE_DATA_ORIGIN: dataOrigin };
  const invalid = await handleAgenticPlan({ ...trip, coordinates: [13.74, 100.53] }, env, signal);
  expect(invalid.status).toBe(400);
  expect(transport).not.toHaveBeenCalled();

  const fallback = await handleAgenticPlan(trip, env, signal);
  expect(fallback.body).toMatchObject({
    status: 'ok', source: 'worker', provenance: 'public_web2_graph',
    datasetVersion: expect.stringMatching(/^web2:[a-f0-9]{24}$/),
    text: expect.stringMatching(/Estimated walk: \d+ min/),
  });
  expect(models).toEqual([]);

  const plan = await proxy.fetch(requestPlan(trip, 'application/x-ndjson'), {
    ...env, ALLOWED_ORIGINS: origin, OPENAI_AGENTIC_ORIGIN: origin,
    RATE_LIMITER: limiter, GLOBAL_LIMITER: limiter, AGENTIC_MODEL_LIMITER: limiter,
  });
  expect(plan.status).toBe(200);
  expect(plan.headers.get('content-type')).toContain('application/x-ndjson');
  expect(plan.headers.get('cache-control')).toBe('no-store');
  expect(plan.headers.get('access-control-allow-origin')).toBe(origin);
  const records = (await plan.text()).trim().split('\n').map(line => JSON.parse(line));
  const result = records.pop();
  expect(records).toEqual([
    { type: 'progress', stage: 'routes', state: 'working' },
    { type: 'progress', stage: 'routes', state: 'done' },
    { type: 'progress', stage: 'evidence', state: 'working' },
    { type: 'progress', stage: 'evidence', state: 'done' },
    { type: 'progress', stage: 'review', state: 'working' },
    { type: 'progress', stage: 'critique', state: 'working' },
    { type: 'progress', stage: 'critique', state: 'done' },
    { type: 'progress', stage: 'review', state: 'done' },
  ]);
  expect(result.type).toBe('result');
  expect(result.result).toMatchObject({
    status: 'ok', source: 'verified_planner',
    trace: expect.arrayContaining([expect.objectContaining({ step: 'critic', passed: true })]),
    text: expect.stringMatching(/Estimated sun exposure:/),
  });
  expect(models).toEqual(['gpt-6.1-terra', 'gpt-6.1-terra', 'gpt-6.1-sol']);
});

it('keeps legacy JSON and skips model activity in the streamed deterministic plan', async () => {
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(input);
    expect(url.origin).toBe('https://fallback-stream.example');
    return new Response(url.pathname.includes('/areas/') ? area : incidents, { headers: { 'content-type': 'application/json' } });
  });
  const env = { ALLOWED_ORIGINS: origin, WALKWE_DATA_ORIGIN: 'https://fallback-stream.example' };
  const json = await proxy.fetch(requestPlan(trip), env);
  expect(json.status).toBe(200);
  expect(json.headers.get('content-type')).toBe('application/json');
  const plan = await json.json();
  expect(plan).toMatchObject({ status: 'ok', source: 'worker' });
  const stream = await proxy.fetch(requestPlan(trip, 'application/x-ndjson'), env);
  expect((await stream.text()).trim().split('\n').map(line => JSON.parse(line))).toEqual([
    { type: 'progress', stage: 'routes', state: 'working' },
    { type: 'progress', stage: 'routes', state: 'done' },
    { type: 'progress', stage: 'evidence', state: 'working' },
    { type: 'progress', stage: 'evidence', state: 'done' },
    { type: 'progress', stage: 'review', state: 'fallback' },
    { type: 'result', result: plan },
  ]);
});

it('stops an active planner when the client cancels the event stream', async () => {
  let signalFromModel: AbortSignal | undefined;
  const dataOrigin = 'https://cancel-stream.example';
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.origin === dataOrigin) {
      return Promise.resolve(new Response(url.pathname.includes('/areas/') ? area : incidents, {
        headers: { 'content-type': 'application/json' },
      }));
    }
    expect(url.href).toBe('https://api.openai.com/v1/responses');
    signalFromModel = init?.signal ?? undefined;
    const signal = signalFromModel!;
    return new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const res = await proxy.fetch(requestPlan(trip, 'application/x-ndjson'), {
    ALLOWED_ORIGINS: origin, OPENAI_AGENTIC_ORIGIN: origin, OPENAI_API_KEY: 'fixture-key', WALKWE_DATA_ORIGIN: dataOrigin,
    RATE_LIMITER: limiter, GLOBAL_LIMITER: limiter, AGENTIC_MODEL_LIMITER: limiter,
  });
  const reader = res.body!.getReader();
  const first = await reader.read();
  expect(JSON.parse(new TextDecoder().decode(first.value))).toEqual({ type: 'progress', stage: 'routes', state: 'working' });
  await vi.waitFor(() => expect(signalFromModel).toBeDefined());
  await reader.cancel();
  expect(signalFromModel?.aborted).toBe(true);
});

it('prefills a draft with public landmark IDs without calling a provider', async () => {
  const transport = vi.fn();
  vi.stubGlobal('fetch', transport);
  const reply = await handleAgenticIntent({ text: 'สามทุ่มจากสยามไปเซ็นทรัลเวิลด์', language: 'th' }, {}, signal);
  expect(reply.body).toMatchObject({
    status: 'confirm', source: 'system', from: 'bts:CEN', to: 'osm:W157482067',
    time: '21:00', mode: 'night', noStairs: false,
  });
  expect(transport).not.toHaveBeenCalled();
});

it('keeps unknown lighting unknown when comparing the two night preferences', async () => {
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const path = new URL(input).pathname;
    return new Response(path.includes('/areas/') ? area : incidents, { headers: { 'content-type': 'application/json' } });
  });
  const env = { WALKWE_DATA_ORIGIN: 'https://night-test.example' };
  const night = { ...trip, to: 'osm:W365999406', mode: 'night', time: '21:00' };
  const unchosen = await handleAgenticPlan(night, env, signal);
  expect(unchosen.body).toMatchObject({
    status: 'ok', decision: 'VERIFY', evidenceIds: expect.arrayContaining([expect.stringMatching(/^edge:/)]),
    clarification: { options: [
      { value: 'direct', ref: expect.any(String) }, { value: 'prefer_evidence', ref: expect.any(String) },
    ] },
  });
  const direct = await handleAgenticPlan({ ...night, preference: 'direct' }, env, signal);
  const conservative = await handleAgenticPlan({ ...night, preference: 'prefer_evidence' }, env, signal);
  expect(direct.body).toMatchObject({ status: 'ok', decision: 'VERIFY', clarification: null });
  expect(conservative.body).toMatchObject({ status: 'ok', decision: 'VERIFY', clarification: null });
  if (!('recommendedId' in direct.body) || !('recommendedId' in conservative.body)) throw new Error('missing routes');
  expect(direct.body.recommendedId).not.toBe(conservative.body.recommendedId);
  expect(direct.body.routes).toHaveLength(conservative.body.routes!.length);
  expect(direct.body.routes).toEqual(expect.arrayContaining(conservative.body.routes));
});

it('asks once about missing lighting even if both choices retain the same route', async () => {
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const path = new URL(input).pathname;
    return new Response(path.includes('/areas/') ? area : incidents, { headers: { 'content-type': 'application/json' } });
  });
  const env = { WALKWE_DATA_ORIGIN: 'https://stable-night-test.example' };
  const night = { ...trip, to: 'osm:W157482067', mode: 'night', time: '21:00' };
  const unchosen = await handleAgenticPlan(night, env, signal);
  if (!('recommendedId' in unchosen.body)) throw new Error('missing routes');
  const routeId = unchosen.body.recommendedId;
  expect(unchosen.body).toMatchObject({
    status: 'ok', decision: 'ACT', evidenceIds: expect.arrayContaining([expect.stringMatching(/^edge:/)]),
    clarification: {
      text: expect.stringContaining('Both assumptions suggest the same route'),
      options: [{ value: 'direct', ref: routeId }, { value: 'prefer_evidence', ref: routeId }],
    },
  });
  const answered = await handleAgenticPlan({ ...night, preference: 'prefer_evidence' }, env, signal);
  expect(answered.body).toMatchObject({
    status: 'ok', recommendedId: routeId, decision: 'ACT', clarification: null, routes: unchosen.body.routes,
  });
});

it('localizes companion guidance and keeps the two-alert limit and silent model choice', async () => {
  const event = { event: 'closing', unknownMeters: 12, language: 'en', warnings: 1, handled: ['nightfall'] };
  const local = await handleAgenticCompanion(event, {}, signal);
  expect(local.body).toMatchObject({
    action: 'offer_replan', warnings: 2, handled: ['nightfall', 'closing'], text: expect.stringContaining('may close'),
  });
  const transport = vi.fn(async (_request: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(JSON.parse(body.input)).toEqual({ event: 'closing', route: { unknown: 12 }, warnings: 1 });
    return Response.json({ status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: '{"action":"silent"}' }] },
    ] });
  });
  vi.stubGlobal('fetch', transport);
  const env = { OPENAI_API_KEY: 'fixture-key', RATE_LIMITER: limiter, GLOBAL_LIMITER: limiter };
  const exhausted = await handleAgenticCompanion({ ...event, warnings: 2 }, env, signal);
  expect(exhausted.body).toEqual({ action: 'silent', warnings: 2, handled: ['nightfall'] });
  expect(await handleAgenticCompanion({ ...event, latitude: 13.74 }, env, signal)).toMatchObject({ status: 400 });
  expect(transport).not.toHaveBeenCalled();
  const silent = await handleAgenticCompanion(event, env, signal);
  expect(silent.body).toEqual({ action: 'silent', warnings: 1, handled: ['nightfall', 'closing'] });
  expect(transport).toHaveBeenCalledTimes(1);
});
