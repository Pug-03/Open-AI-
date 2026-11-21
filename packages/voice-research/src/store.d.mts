import type { ResearchSource } from './agents.mjs';

type ResearchJob = {
  id: string;
  segmentId: string;
  datasetVersion?: string;
  status: 'starting' | 'researching' | 'failed' | 'pending_review' | 'no_sources';
  providerId?: string;
  sourceCount?: number;
  completedAt?: number;
  expiresAt: number;
};
export type ResearchDraft = {
  id: string;
  segmentId: string;
  datasetVersion?: string;
  kind: 'web_research';
  status: 'pending_review';
  sources: ResearchSource[];
  createdAt: number;
};
type Transaction = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
};
type Storage<T extends Transaction> = Transaction & {
  transaction<R>(operation: (tx: T) => Promise<R>): Promise<R>;
};
export type ResearchStore = {
  claim(input: { owner: string; segmentId: string; publicName: string; datasetVersion?: string }): Promise<{
    job: ResearchJob; created: boolean; cached: boolean;
  }>;
  get(owner: string, id: string): Promise<ResearchJob | null>;
  start(id: string, providerId: string): Promise<void>;
  finish(id: string, sources: ResearchSource[] | null): Promise<ResearchJob | undefined>;
};

export function createResearchStore<T extends Transaction>(storage: Storage<T>, now?: () => number,
  recordDraft?: (tx: T, draft: ResearchDraft) => Promise<void>): ResearchStore;
