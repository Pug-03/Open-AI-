export function createResearchClientTool(options: {
  getSelectedSegmentId(): string | undefined;
  getDatasetVersion?(): string;
  announce(text: string): void | Promise<void>;
  signal?: AbortSignal;
  proxyFetch?: typeof fetch;
  pollMs?: number;
  language?: 'th' | 'en';
}): () => Promise<string>;
