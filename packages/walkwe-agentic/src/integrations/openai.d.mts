export interface ModelClient {
  structured(role: string, options: {
    instructions: string; input: unknown; schema: unknown; signal?: AbortSignal;
  }): Promise<unknown>;
  turn(role: string, options: {
    instructions: string; input: unknown; tools: unknown; signal?: AbortSignal;
  }): Promise<unknown>;
}

export function createModelClient(options?: { apiKey?: string; fetchImpl?: typeof fetch }): ModelClient | null;
