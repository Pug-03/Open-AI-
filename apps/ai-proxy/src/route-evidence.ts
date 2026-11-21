import { z } from 'zod';

const candidate = z.strictObject({
  id: z.number().int().min(0).max(11),
  kind: z.enum(['go', 'caution', 'avoid']),
  reason: z.enum(['covered', 'shade', 'sun', 'lit', 'dark', 'lamp', 'unknown-light', 'no-sidewalk']),
  meters: z.number().int().min(1).max(5000),
});
const inputSchema = z.strictObject({
  mode: z.enum(['day', 'night']),
  candidates: z.array(candidate).min(1).max(12),
}).refine(({ candidates }) => new Set(candidates.map(row => row.id)).size === candidates.length);
const replySchema = z.strictObject({ ids: z.array(z.number().int()).min(1).max(3) });

export async function rankEvidence(raw: unknown, key: string): Promise<{ status: number; body: object }> {
  const input = inputSchema.safeParse(raw);
  if (!input.success) return { status: 400, body: { error: 'bad_request' } };
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        model: 'gpt-6.1-terra',
        store: false,
        reasoning: { effort: 'none' },
        max_output_tokens: 160,
        instructions: 'Select one supplied ID per available kind. Prefer useful mapped evidence. Nearby lamps do not establish lighting on the path. Return only IDs.',
        input: JSON.stringify(input.data),
        text: { format: {
          type: 'json_schema',
          name: 'route_evidence',
          strict: true,
          schema: {
            type: 'object',
            properties: { ids: { type: 'array', items: { type: 'integer' } } },
            required: ['ids'],
            additionalProperties: false,
          },
        } },
      }),
    });
    if (response.status === 429) return { status: 429, body: { error: 'rate_limited' } };
    if (!response.ok) return { status: 502, body: { error: 'upstream' } };
    const data = await response.json() as { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] };
    const text = data.output?.find(item => item.type === 'message')?.content?.find(item => item.type === 'output_text')?.text;
    const selection = replySchema.safeParse(data.status === 'completed' && text ? JSON.parse(text) : null);
    if (selection.success) {
      const kinds = selection.data.ids.map(id => input.data.candidates.find(row => row.id === id)?.kind);
      const expected = new Set(input.data.candidates.map(row => row.kind));
      if (kinds.every(Boolean) && new Set(kinds).size === kinds.length && kinds.length === expected.size) {
        return { status: 200, body: selection.data };
      }
    }
    return { status: 422, body: { error: 'invalid_selection' } };
  } catch {
    return { status: 502, body: { error: 'upstream' } };
  }
}
