import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index.ts';
import { EvidenceQueue, handleEvidence, readApprovedLighting } from '../src/evidence.ts';

const setup = vi.hoisted(() => ({
  version: 'web2:abcdef123456abcdef123456',
  agents: { start: vi.fn(), poll: vi.fn() },
}));
vi.mock('../src/agentic-routing.ts', () => ({
  loadHostedRouting: async () => ({
    version: setup.version,
    segmentKnown: (id: string) => id === 'edge:42' || id === 'edge:46',
    segmentName: (id: string) => id === 'edge:42' ? 'ถนนพระรามที่ 1' : null,
  }),
}));
vi.mock('../../../packages/voice-research/src/agents.mjs', () => ({
  createAgentsResearch: () => setup.agents,
}));

const tokens = {
  reviewer: 'reviewer_'.repeat(4), nina: 'N'.repeat(32), paul: 'P'.repeat(32),
  som: 'S'.repeat(32), ton: 'T'.repeat(32),
};
const { reviewer, ...ingest } = tokens;

type EvidenceEnv = Parameters<typeof handleEvidence>[1];

function queue(options: Partial<EvidenceEnv> = {}) {
  let storage = new Map<string, unknown>();
  let pendingTransaction = Promise.resolve<unknown>(undefined);
  const tasks: Promise<unknown>[] = [];
  const env: EvidenceEnv = {
    EVIDENCE_REVIEWER_TOKENS: JSON.stringify({ reviewer }),
    EVIDENCE_INGEST_TOKENS: JSON.stringify(ingest),
    ...options,
  };
  const api = {
    async get(key: string | string[]) {
      return Array.isArray(key)
        ? new Map(key.filter(item => storage.has(item)).map(item => [item, structuredClone(storage.get(item))]))
        : structuredClone(storage.get(key));
    },
    async put(key: string, value: unknown) { storage.set(key, structuredClone(value)); },
    async delete(key: string) { return storage.delete(key); },
    async list({ prefix, limit, startAfter }: { prefix: string; limit: number; startAfter?: string }) {
      return new Map([...storage.entries()].filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter))
        .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit));
    },
    async transaction(callback: (tx: typeof api) => Promise<unknown>) {
      const result = pendingTransaction.then(async () => {
        const before = storage;
        storage = new Map(before);
        try { return await callback(api); }
        catch (error) { storage = before; throw error; }
      });
      pendingTransaction = result.catch(() => {});
      return result;
    },
  };
  const object = new EvidenceQueue({ storage: api, waitUntil: (task: Promise<unknown>) => { tasks.push(task); } } as never, env);
  env.EVIDENCE_QUEUE = {
    idFromName: vi.fn(() => 'stable-queue'),
    get: vi.fn(() => ({
      fetch: (input: Request | string, init?: RequestInit) => object.fetch(new Request(input, init)),
    })),
  } as never;
  return {
    env, tasks,
    call(path: string, bearer?: string, body?: unknown, headers: Record<string, string> = {}) {
      return handleEvidence(new Request(`https://walkwe.test${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...headers,
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), env);
    },
  };
}

afterEach(() => { vi.clearAllMocks(); });

it('requires distinct authenticated reporters and publishes only the current revision through review', async () => {
  const { call, env } = queue();
  const report = { segmentId: 'edge:42', datasetVersion: setup.version, timeBand: 'night', value: 'lit' };
  expect((await call('/evidence/pending', undefined, undefined, { 'x-walkwe-evidence-actor': 'reviewer:forged' })).status).toBe(401);
  expect((await call('/evidence/pending', tokens.nina)).status).toBe(401);
  expect((await call('/evidence/lighting', tokens.nina, { ...report, reporterId: 'spoofed' })).status).toBe(400);
  expect((await call('/evidence/lighting', tokens.nina, { ...report, segmentId: 'edge:123' })).status).toBe(404);
  expect((await call('/evidence/lighting', tokens.nina, { ...report, datasetVersion: 'web2:aaaaaaaaaaaaaaaaaaaaaaaa' })).status).toBe(409);
  for (const key of [tokens.nina, tokens.nina, tokens.paul]) {
    expect(await (await call('/evidence/lighting', key, report)).json()).toEqual({ status: 'recorded' });
  }
  const draft = await (await call('/evidence/lighting', tokens.som, report)).json();
  const corrected = await (await call('/evidence/lighting', tokens.ton, report)).json();
  expect(draft).toMatchObject({ status: 'pending_review', id: corrected.id });
  const review = { proposalId: draft.id, decision: 'approve', expectedVersion: draft.revision };
  expect((await call('/evidence/decision', tokens.nina, review)).status).toBe(401);
  expect((await call('/evidence/decision', reviewer, review)).status).toBe(409);
  expect((await readApprovedLighting(env, setup.version, ['edge:42'])).size).toBe(0);
  const correct = { ...review, expectedVersion: corrected.revision };
  const [approvedRequest, duplicateRequest] = await Promise.all([
    call('/evidence/decision', reviewer, correct), call('/evidence/decision', reviewer, correct),
  ]);
  const decided = await approvedRequest.json();
  expect(decided).toMatchObject({ status: 'approved', evidenceVersion: 1, reviewerId: 'reviewer' });
  expect(await duplicateRequest.json()).toEqual(decided);
  expect(await (await call('/evidence/pending', reviewer)).json()).toMatchObject({ records: [], evidenceVersion: 1 });
  expect(await (await call('/evidence/audit', reviewer)).json()).toMatchObject({ records: [decided] });
  const approved = await readApprovedLighting(env, setup.version, ['edge:42', 'edge:46']);
  expect([...approved.keys()]).toEqual(['edge:42']);
  expect(approved.get('edge:42')).toMatchObject({ value: 'lit' });
  expect((await readApprovedLighting(env, 'web2:aaaaaaaaaaaaaaaaaaaaaaaa', ['edge:42'])).size).toBe(0);
});

it('lets a reviewer reject an expired lighting draft without publishing it', async () => {
  const { call, env } = queue();
  const startedAt = Date.parse('2026-11-21T00:00:00Z');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
  try {
    const report = { segmentId: 'edge:42', datasetVersion: setup.version, timeBand: 'night', value: 'lit' };
    await call('/evidence/lighting', tokens.nina, report);
    await call('/evidence/lighting', tokens.paul, report);
    const draft = await (await call('/evidence/lighting', tokens.som, report)).json();
    expect(draft.status).toBe('pending_review');
    clock.mockReturnValue(startedAt + 90 * 24 * 60 * 60_000);
    const review = { proposalId: draft.id, expectedVersion: draft.revision };

    expect((await call('/evidence/decision', reviewer, { ...review, decision: 'approve' })).status).toBe(409);
    const rejection = await call('/evidence/decision', reviewer, { ...review, decision: 'reject' });
    expect(rejection.status).toBe(200);
    expect(await rejection.json()).toMatchObject({ status: 'rejected', evidenceVersion: 0 });
    expect(await (await call('/evidence/pending', reviewer)).json()).toMatchObject({ records: [], evidenceVersion: 0 });
    expect(await (await call('/evidence/approved', reviewer)).json()).toMatchObject({ records: [], evidenceVersion: 0 });
    expect((await readApprovedLighting(env, setup.version, ['edge:42'])).size).toBe(0);
  } finally {
    clock.mockRestore();
  }
});

it('stores only the reviewed news draft and leaves rejected news out of the approved snapshot', async () => {
  const { call } = queue();
  const sourceUrl = 'https://example.test/public-news?tracking=remove';
  const { id, revision } = await (await call('/evidence/news', tokens.nina, {
    datasetVersion: setup.version, text: 'Source excerpt for draft extraction', sourceUrl, allowedSegmentIds: ['edge:42'],
  })).json();
  const row = (await (await call('/evidence/pending', reviewer)).json()).records[0];
  expect(row).toMatchObject({ id, revision, kind: 'news', sourceUrl: 'https://example.test/public-news' });
  expect(JSON.stringify(row)).not.toContain('Source excerpt');
  expect(await (await call('/evidence/decision', reviewer, { proposalId: id, expectedVersion: revision, decision: 'reject' })).json())
    .toMatchObject({ status: 'rejected', evidenceVersion: 0 });
  expect(await (await call('/evidence/approved', tokens.nina)).json()).toMatchObject({ records: [], evidenceVersion: 0 });
});

it('enforces the configured evidence budget before invoking the repository', async () => {
  const limit = vi.fn().mockResolvedValue({ success: false });
  const { call, env } = queue({ RATE_LIMITER: { limit } });
  expect((await call('/evidence/pending', reviewer)).status).toBe(429);
  expect(limit).toHaveBeenCalledWith({ key: 'evidence:reviewer:reviewer' });
  expect(env.EVIDENCE_QUEUE?.get).not.toHaveBeenCalled();
});

it('binds research to the current public named edge and its caller before it enters the same queue', async () => {
  setup.agents.start.mockResolvedValue('provider-id');
  setup.agents.poll.mockResolvedValue({ status: 'complete', sources: [{ url: 'https://example.test/report', note: 'Published note' }] });
  const { call, tasks } = queue({ OPENAI_API_KEY: 'mock-only' });
  const base = { segmentId: 'edge:42', datasetVersion: setup.version };
  expect((await call('/agents/research', tokens.nina, { ...base, name: 'client-controlled' })).status).toBe(422);
  expect((await call('/agents/research', tokens.nina, { ...base, segmentId: 'edge:46' })).status).toBe(404);
  expect((await call('/agents/research', tokens.nina, { segmentId: 'edge:42' })).status).toBe(404);
  expect(setup.agents.start).not.toHaveBeenCalled();
  const { id } = await (await call('/agents/research', tokens.nina, base)).json();
  await Promise.all(tasks);
  expect(setup.agents.start).toHaveBeenCalledOnce();
  expect(setup.agents.start).toHaveBeenCalledWith('ถนนพระรามที่ 1, Bangkok, Thailand');
  expect((await call(`/agents/research/${id}`, tokens.paul)).status).toBe(404);
  const result = await (await call(`/agents/research/${id}`, tokens.nina)).json();
  expect(result).toMatchObject({ id, status: 'pending_review', sourceCount: 1 });
  const listed = await (await call('/evidence/pending', reviewer)).json();
  expect(listed.records).toMatchObject([{ id, segmentId: 'edge:42', datasetVersion: setup.version, kind: 'web_research' }]);
  expect(JSON.stringify(listed)).not.toContain('provider-id');
});

it('allows the app to research a named edge and scopes polling to its browser capability', async () => {
  setup.agents.start.mockResolvedValue('browser-provider');
  setup.agents.poll.mockResolvedValue({ status: 'complete', sources: [{ url: 'https://example.test/lighting', note: 'Public record' }] });
  const { call, env, tasks } = queue({ OPENAI_API_KEY: 'mock-only' });
  const origin = 'https://app.test';
  const own = crypto.randomUUID();
  const other = crypto.randomUUID();
  const ok = { limit: vi.fn(async () => ({ success: true })) };
  const config = {
    ...env, ALLOWED_ORIGINS: origin, OPENAI_AGENTIC_ORIGIN: origin,
    RATE_LIMITER: ok, GLOBAL_LIMITER: ok, AGENTIC_MODEL_LIMITER: ok,
  };
  const input = { segmentId: 'edge:42', datasetVersion: setup.version };
  const request = (path: string, method: string, capability?: string, body?: object, from = origin) =>
    worker.fetch(new Request(`https://proxy.test${path}`, {
      method,
      headers: {
        origin: from, 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json',
        ...(capability ? { 'x-walkwe-research-session': capability } : {}),
      },
      body: body && JSON.stringify(body),
    }), config);
  const path = '/agents/research';
  expect((await request(path, 'OPTIONS')).headers.get('access-control-allow-methods')).toContain('GET');
  expect((await request(path, 'POST', own, input, 'https://different.test')).status).toBe(403);
  expect((await request(path, 'POST', undefined, input)).status).toBe(401);
  expect((await request(path, 'POST', own, { ...input, datasetVersion: 'web2:aaaaaaaaaaaaaaaaaaaaaaaa' })).status).toBe(404);
  expect(setup.agents.start).not.toHaveBeenCalled();
  const started = await request(path, 'POST', own, input);
  expect(started.status).toBe(202);
  expect(started.headers.get('access-control-allow-origin')).toBe(origin);
  const { id } = await started.json();
  await Promise.all(tasks);
  expect(setup.agents.start).toHaveBeenCalledWith('ถนนพระรามที่ 1, Bangkok, Thailand');
  expect((await request(`${path}/${id}`, 'GET', other)).status).toBe(404);
  expect((await request('/evidence/pending', 'GET', own)).status).toBe(401);
  const result = await request(`${path}/${id}`, 'GET', own);
  expect(await result.json()).toMatchObject({ id, status: 'pending_review', sourceCount: 1 });
  expect(await (await call('/evidence/pending', reviewer)).json()).toMatchObject({
    records: [{ id, segmentId: input.segmentId, datasetVersion: input.datasetVersion, kind: 'web_research' }],
  });
  expect(ok.limit).toHaveBeenCalledWith({ key: 'research' });
});
