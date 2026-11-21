import type { ResearchAgent } from './agents.mjs';
import type { ResearchStore } from './store.mjs';

export function createResearchRoutes(options: {
  authenticate(request: Request): string | null | Promise<string | null>;
  resolvePublicSegment(owner: string, id: string, datasetVersion?: string):
    string | null | { name: string; datasetVersion: string } | Promise<string | null | { name: string; datasetVersion: string }>;
  store: ResearchStore;
  agents: ResearchAgent;
}): (request: Request, ctx: { waitUntil(promise: Promise<unknown>): void }) => Promise<Response | null>;
