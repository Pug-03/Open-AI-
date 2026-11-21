import { z } from 'zod';
import { createAgentsResearch } from '../../../packages/voice-research/src/agents.mjs';
import { createResearchStore, type ResearchDraft } from '../../../packages/voice-research/src/store.mjs';
import { createResearchRoutes } from '../../../packages/voice-research/src/worker.mjs';
import { createModelClient } from '../../../packages/walkwe-agentic/src/integrations/openai.mjs';
import {
  auditPhoto, draftLightingProposal, draftNews, reviewProposal, stewardReview,
  type Light, type LightingProposal, type Observation, type TimeBand,
} from '../../../packages/walkwe-agentic/src/evidence/review.mjs';
import { loadHostedRouting } from './agentic-routing.ts';

export interface EvidenceEnv {
  EVIDENCE_QUEUE?: DurableObjectNamespace;
  EVIDENCE_REVIEWER_TOKENS?: string;
  EVIDENCE_INGEST_TOKENS?: string;
  OPENAI_API_KEY?: string;
  WALKWE_DATA_ORIGIN?: string;
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  GLOBAL_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const segmentId = z.string().regex(/^edge:(?:0|[1-9]\d{0,8})$/);
const datasetVersion = z.string().regex(/^web2:[0-9a-f]{24}$/);
const proposalId = z.string().uuid();
const identity = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/i);
const token = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const reviewPaths = new Set(['/evidence/pending', '/evidence/decision', '/evidence/audit']);
const ingestPaths = new Set(['/evidence/lighting', '/evidence/news', '/evidence/photo']);
const researchPath = /^\/agents\/research(?:\/[0-9a-f-]{36})?$/;
export const isResearchPath = (path: string) => researchPath.test(path);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const encoder = new TextEncoder();
const validityMs = 90 * 24 * 60 * 60_000;
const queueName = 'walkwe-evidence';

const submitLightingSchema = z.strictObject({
  segmentId, datasetVersion, timeBand: z.enum(['day', 'night']),
  value: z.enum(['lit', 'dim', 'dark', 'cannot_tell']),
});
const submitNewsSchema = z.strictObject({
  datasetVersion, text: z.string().trim().min(1).max(6000), sourceUrl: z.string().url().max(2048),
  allowedSegmentIds: z.array(segmentId).max(20),
});
const submitPhotoSchema = z.strictObject({
  segmentId, datasetVersion, consentGranted: z.literal(true), trustedImage: z.string().max(1_450_000),
});
const decisionSchema = z.strictObject({
  proposalId, expectedVersion: proposalId, decision: z.enum(['approve', 'reject']),
});
const overlaySchema = z.strictObject({ datasetVersion, segmentIds: z.array(segmentId).max(1000) });
const overlayEntry = z.strictObject({ value: z.enum(['lit', 'dim', 'dark']), observedAt: z.string().datetime() });
type OverlayEntry = z.infer<typeof overlayEntry>;

interface Draft {
  id: string;
  revision: string;
  kind: string;
  status: 'pending_review';
  datasetVersion: string;
  createdAt: number;
  [field: string]: unknown;
}
type Report = Pick<Observation, 'value' | 'reporterId'> & { at: number };
type LightingDraft = Draft & LightingProposal & { observedAt: number; validUntil: number; evidenceKey: string };
type LightingState = { reports: Report[]; pendingId?: string; lastApproved?: { value: Light; validUntil: number } };
type ReviewInput = z.infer<typeof decisionSchema>;

function stub(env: EvidenceEnv) {
  const queue = env.EVIDENCE_QUEUE;
  return queue?.get(queue.idFromName(queueName));
}

export function isEvidencePath(path: string) {
  return reviewPaths.has(path) || ingestPaths.has(path) || path === '/evidence/approved' || isResearchPath(path);
}

async function authenticate(value: string | null, source?: string) {
  const provided = token.safeParse(/^Bearer ([A-Za-z0-9_-]+)$/i.exec(value ?? '')?.[1]);
  if (!provided.success || !source) return null;
  const configured: unknown = JSON.parse(source);
  const credentials = z.record(identity, token).safeParse(configured);
  if (!credentials.success) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(provided.data)));
  let owner: string | null = null;
  for (const [id, expected] of Object.entries(credentials.data)) {
    const expectedDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(expected)));
    let diff = 0;
    digest.forEach((byte, index) => { diff |= byte ^ expectedDigest[index]!; });
    if (diff === 0) owner = id;
  }
  return owner;
}

export async function handleEvidence(request: Request, env: EvidenceEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!isEvidencePath(path)) return json({ error: 'not_found' }, 404);
  try {
    const authorization = request.headers.get('authorization');
    const reviewer = (path === '/evidence/approved' || reviewPaths.has(path))
      ? await authenticate(authorization, env.EVIDENCE_REVIEWER_TOKENS) : null;
    const owner = reviewer ?? (reviewPaths.has(path) ? null : await authenticate(authorization, env.EVIDENCE_INGEST_TOKENS));
    if (!owner) return json({ error: 'unauthorized' }, 401);
    if (!env.EVIDENCE_QUEUE) return json({ error: 'unavailable' }, 503);
    const role = reviewer ? 'reviewer' : 'ingest';
    const limits = await Promise.all([
      env.RATE_LIMITER?.limit({ key: `evidence:${role}:${owner}` }),
      env.GLOBAL_LIMITER?.limit({ key: 'all' }),
    ]);
    if (limits.some(limit => limit && !limit.success)) return json({ error: 'rate_limited' }, 429);
    const destination = stub(env)!;
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.set('x-walkwe-evidence-actor', `${role}:${owner}`);
    return await destination.fetch(new Request(request, { headers }));
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}

/** A browser capability grants access only to jobs claimed with that capability. */
export async function handleBrowserResearch(request: Request, env: EvidenceEnv): Promise<Response> {
  const capability = z.string().uuid().safeParse(request.headers.get('x-walkwe-research-session'));
  if (!capability.success) return json({ status: 'unauthorized' }, 401);
  const destination = stub(env);
  if (!destination) return json({ status: 'unavailable' }, 503);
  try {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(capability.data));
    const owner = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const headers = new Headers({
      'content-type': request.headers.get('content-type') ?? '',
      'x-walkwe-evidence-actor': `browser:${owner}`,
    });
    return await destination.fetch(new Request(request, { headers }));
  } catch {
    return json({ status: 'unavailable' }, 503);
  }
}

export async function readApprovedLighting(env: EvidenceEnv, version: string, ids: readonly string[]) {
  const destination = stub(env);
  if (!destination) return new Map<string, OverlayEntry>();
  const parsed = overlaySchema.safeParse({ datasetVersion: version, segmentIds: [...new Set(ids)] });
  if (!parsed.success || parsed.data.segmentIds.length === 0) return new Map<string, OverlayEntry>();
  const response = await destination.fetch('https://evidence.internal/lighting-overlay', {
    method: 'POST', body: JSON.stringify(parsed.data), headers: { 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error('approved lighting unavailable');
  const overlay = z.record(segmentId, overlayEntry).parse(await response.json());
  return new Map(Object.entries(overlay));
}

async function readBody(request: Request, limit = 32_768): Promise<unknown> {
  if (!request.body || request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    throw new Error('invalid body');
  }
  const stream = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await stream.read();
      if (chunk.done) return JSON.parse(text + decoder.decode());
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await stream.cancel();
        throw new Error('body too large');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    stream.releaseLock();
  }
}

const pending = (id: string) => `pending:${id}`;
const audit = (id: string) => `audit:${id}`;
const lightingKey = (version: string, id: string, time: TimeBand) => `lighting:${version}:${id}:${time}`;
const approvedLightingKey = (version: string, id: string) => `approved-lighting:${version}:${id}`;

export class EvidenceQueue {
  private readonly store: DurableObjectStorage;

  constructor(private readonly state: DurableObjectState, private readonly env: EvidenceEnv) {
    this.store = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname: path } = url;
    const actor = /^(reviewer|ingest|browser):([a-z0-9][a-z0-9_.-]{0,63})$/i.exec(request.headers.get('x-walkwe-evidence-actor') ?? '');
    try {
      if (url.hostname === 'evidence.internal' && path === '/lighting-overlay' && request.method === 'POST') {
        return await this.overlay(overlaySchema.parse(await readBody(request)));
      }
      if (!actor || (reviewPaths.has(path) && actor[1] !== 'reviewer')) return json({ error: 'unauthorized' }, 401);
      if (isResearchPath(path)) return await this.research(request, actor[0]);
      if (actor[1] === 'browser') return json({ error: 'unauthorized' }, 401);
      if (request.method === 'GET') {
        if (path === '/evidence/pending') return await this.list(url, 'pending:');
        if (path === '/evidence/audit') return await this.list(url, 'audit:');
        if (path === '/evidence/approved') return await this.list(url, 'approved:');
      }
      if (request.method === 'POST') {
        if (path === '/evidence/decision') return await this.decide(decisionSchema.parse(await readBody(request)), actor[2]!);
        if (path === '/evidence/lighting') return await this.lighting(submitLightingSchema.parse(await readBody(request)), actor[2]!);
        if (path === '/evidence/news') return await this.news(submitNewsSchema.parse(await readBody(request)));
        if (path === '/evidence/photo') {
          return await this.photo(submitPhotoSchema.parse(await readBody(request, 1_451_000)));
        }
      }
      return json({ error: 'method_not_allowed' }, 405);
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError
        || (error instanceof Error && ['body too large', 'invalid body'].includes(error.message))) {
        return json({ error: 'bad_request' }, 400);
      }
      return json({ error: 'unavailable' }, 503);
    }
  }

  private async research(request: Request, owner: string) {
    if (!this.env.OPENAI_API_KEY) return json({ error: 'unavailable' }, 503);
    const route = createResearchRoutes({
      authenticate: () => owner,
      resolvePublicSegment: async (_owner, id, version) => {
        if (!datasetVersion.safeParse(version).success || !segmentId.safeParse(id).success) return null;
        const graph = await loadHostedRouting(this.env.WALKWE_DATA_ORIGIN);
        if (graph.version !== version) return null;
        const name = graph.segmentName(id);
        return name ? { name: `${name}, Bangkok, Thailand`, datasetVersion: graph.version } : null;
      },
      store: createResearchStore<DurableObjectTransaction>(this.store, Date.now, async (tx, draft: ResearchDraft) => {
        if (!draft.datasetVersion) throw new Error('dataset version unavailable');
        await tx.put(pending(draft.id), { ...draft, revision: crypto.randomUUID() });
      }),
      agents: createAgentsResearch({ apiKey: this.env.OPENAI_API_KEY }),
    });
    return (await route(request, this.state)) ?? json({ error: 'not_found' }, 404);
  }

  private async overlay(input: z.infer<typeof overlaySchema>) {
    const result: Record<string, OverlayEntry> = {};
    const keys = input.segmentIds.map(id => approvedLightingKey(input.datasetVersion, id));
    for (let start = 0; start < keys.length; start += 128) {
      const records = await this.store.get<LightingDraft>(keys.slice(start, start + 128));
      for (const row of records.values()) {
        if (row.validUntil > Date.now()) {
          result[row.segmentId] = { value: row.value, observedAt: new Date(row.observedAt).toISOString() };
        }
      }
    }
    return json(result);
  }

  private async list(url: URL, prefix: 'pending:' | 'approved:' | 'audit:') {
    const raw = url.searchParams.get('after');
    const cursor = proposalId.nullable().parse(raw);
    const records = await this.store.list({
      prefix, limit: 51, ...(cursor ? { startAfter: `${prefix}${cursor}` } : {}),
    });
    const page = [...records.entries()].slice(0, 50);
    const next = records.size > 50 ? page.at(-1)?.[0].slice(prefix.length) : null;
    return json({ records: page.map(([, row]) => row), next, evidenceVersion: await this.store.get('version') ?? 0 });
  }

  private async checkGraph(version: string, ids: readonly string[]) {
    const graph = await loadHostedRouting(this.env.WALKWE_DATA_ORIGIN);
    if (version !== graph.version) return json({ error: 'stale_dataset', datasetVersion: graph.version }, 409);
    return ids.every(graph.segmentKnown) ? null : json({ error: 'unknown_segment' }, 404);
  }

  private async lighting(input: z.infer<typeof submitLightingSchema>, reporterId: string) {
    const rejected = await this.checkGraph(input.datasetVersion, [input.segmentId]);
    if (rejected) return rejected;
    const now = Date.now();
    const key = lightingKey(input.datasetVersion, input.segmentId, input.timeBand);
    const result = await this.store.transaction(async tx => {
      const state = await tx.get<LightingState>(key) ?? { reports: [] };
      const prior = state.reports.find(report => report.reporterId === reporterId);
      if (prior && prior.value === input.value && now - prior.at < 60 * 60_000) {
        const draft = state.pendingId ? await tx.get<LightingDraft>(pending(state.pendingId)) : null;
        return draft ? { draft } : null;
      }
      state.reports = state.reports.filter(report => report.at > now - validityMs && report.reporterId !== reporterId);
      state.reports.push({ reporterId, value: input.value, at: now });
      const proposal = draftLightingProposal({
        ...input, observations: state.reports.map(report => ({ ...report, segmentId: input.segmentId, timeBand: input.timeBand })),
      });
      if (proposal.status !== 'pending_review' || (state.lastApproved?.value === proposal.value
        && state.lastApproved.validUntil > now)) {
        if (state.pendingId) await tx.delete(pending(state.pendingId));
        delete state.pendingId;
        await tx.put(key, state);
        return null;
      }
      const supporting = state.reports.filter(report => report.value === proposal.value);
      const row: LightingDraft = {
        ...proposal, datasetVersion: input.datasetVersion, id: state.pendingId ?? crypto.randomUUID(),
        revision: crypto.randomUUID(), createdAt: now, observedAt: Math.max(...supporting.map(report => report.at)),
        validUntil: Math.min(...supporting.map(report => report.at)) + validityMs, evidenceKey: key,
      };
      state.pendingId = row.id;
      await tx.put(key, state);
      await tx.put(pending(row.id), row);
      return { draft: row, proposal };
    });
    if (!result) return json({ status: 'recorded' }, 202);
    const { draft, proposal } = result;
    if (proposal && this.env.OPENAI_API_KEY) {
      this.state.waitUntil(this.advise(draft, proposal, this.env.OPENAI_API_KEY).catch(() => {}));
    }
    return json({ status: draft.status, id: draft.id, revision: draft.revision }, 202);
  }

  private async advise(draft: LightingDraft, proposal: LightingProposal, apiKey: string) {
    const advice = await stewardReview({ proposal, model: createModelClient({ apiKey }) });
    if (!advice.recommendation) return;
    await this.store.transaction(async tx => {
      const current = await tx.get<LightingDraft>(pending(draft.id));
      if (current?.revision === draft.revision) {
        await tx.put(pending(draft.id), { ...current, recommendation: advice.recommendation, model: advice.model });
      }
    });
  }

  private async news(input: z.infer<typeof submitNewsSchema>) {
    const rejected = await this.checkGraph(input.datasetVersion, input.allowedSegmentIds);
    if (rejected) return rejected;
    const draft = await draftNews(input, createModelClient({ apiKey: this.env.OPENAI_API_KEY }));
    if (draft.status === 'invalid') return json({ error: 'bad_request' }, 400);
    return this.addDraft({ ...draft, datasetVersion: input.datasetVersion });
  }

  private async photo(input: z.infer<typeof submitPhotoSchema>) {
    const rejected = await this.checkGraph(input.datasetVersion, [input.segmentId]);
    if (rejected) return rejected;
    const draft = await auditPhoto(input, createModelClient({ apiKey: this.env.OPENAI_API_KEY }));
    if (draft.status === 'cannot_tell') return json(draft, 422);
    return this.addDraft({ ...draft, kind: 'photo', segmentId: input.segmentId, datasetVersion: input.datasetVersion });
  }

  private async addDraft<T extends { kind: string; status: 'pending_review'; datasetVersion: string }>(draft: T) {
    const row: Draft = { ...draft, createdAt: Date.now(), id: crypto.randomUUID(), revision: crypto.randomUUID() };
    await this.store.put(pending(row.id), row);
    return json({ status: row.status, id: row.id, revision: row.revision }, 202);
  }

  private async decide(input: ReviewInput, reviewerId: string) {
    if (input.decision === 'approve') {
      const draft = await this.store.get<Draft>(pending(input.proposalId));
      if (draft) {
        const rejected = await this.checkGraph(draft.datasetVersion, []);
        if (rejected) return rejected;
      }
    }
    const result = await reviewProposal(input, {
      actor: { id: reviewerId, role: 'reviewer' },
      store: { decidePending: data => this.store.transaction(async tx => {
        const id = data.proposalId;
        const prior = await tx.get<ReviewInput & { status: string; reviewerId: string; evidenceVersion: number }>(audit(id));
        if (prior) {
          return prior.decision === data.decision && prior.expectedVersion === data.expectedVersion && prior.reviewerId === reviewerId
            ? prior : { status: 'conflict' };
        }
        const draft = await tx.get<Draft>(pending(id));
        if (!draft) return { status: 'not_found' };
        const lighting = draft.kind === 'lighting' ? draft as LightingDraft : null;
        const approved = data.decision === 'approve';
        if (data.expectedVersion !== draft.revision || (approved && lighting && lighting.validUntil <= Date.now())) {
          return { status: 'conflict' };
        }
        const evidenceVersion = await tx.get<number>('version') ?? 0;
        const version = approved ? evidenceVersion + 1 : evidenceVersion;
        const record = { ...data, status: approved ? 'approved' : 'rejected', evidenceVersion: version, reviewedAt: Date.now() };
        if (lighting) {
          const state = await tx.get<LightingState>(lighting.evidenceKey);
          if (state?.pendingId !== id) return { status: 'conflict' };
          delete state.pendingId;
          if (approved) state.lastApproved = { value: lighting.value, validUntil: lighting.validUntil };
          await tx.put(lighting.evidenceKey, state);
        }
        if (approved) {
          const { evidenceKey: _internal, ...published } = draft;
          const recordToPublish = { ...published, status: 'approved', evidenceVersion: version };
          await tx.put(`approved:${id}`, recordToPublish);
          if (lighting?.timeBand === 'night') await tx.put(approvedLightingKey(lighting.datasetVersion, lighting.segmentId), lighting);
          await tx.put('version', version);
        }
        await tx.put(audit(id), record);
        await tx.delete(pending(id));
        return record;
      }) },
    });
    const status = result.status === 'not_found' ? 404 : result.status === 'conflict' ? 409
      : result.status === 'forbidden' ? 403 : result.status === 'invalid' ? 400 : 200;
    return json(result, status);
  }
}
