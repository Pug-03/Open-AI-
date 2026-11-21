export type ResearchSource = { url: string; note: string };
export type ResearchAgent = {
  start(publicName: string): Promise<string>;
  poll(sessionId: string): Promise<{ status: 'researching' | 'failed' } | { status: 'complete'; sources: ResearchSource[] }>;
};

export function createAgentsResearch(options: { apiKey: string; fetchImpl?: typeof fetch }): ResearchAgent;
