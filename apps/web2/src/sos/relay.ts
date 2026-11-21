import { z } from 'zod';
import { SOS_LOCATION_MAX_AGE_MS, type SosLocation } from '../../../../packages/walkwe-agentic/src/safety/sos.mjs';

export const sosAlertId = z.string().uuid();
const preparedSchema = z.object({
  status: z.literal('prepared'), id: sosAlertId,
  recipients: z.array(z.object({ id: z.string(), label: z.string() })).max(20),
});
const statuses = z.enum([
  'prepared', 'cancelled', 'sending', 'acknowledged', 'provider_accepted', 'delivery_unknown', 'failed',
  'too_early', 'expired', 'stale_location', 'invalid_location', 'forbidden', 'not_found', 'unavailable', 'conflict',
]);
const statusResponse = z.object({ status: statuses, canAcknowledge: z.boolean().optional() });

export type PreparedRelay = z.infer<typeof preparedSchema>;
export type RelayStatus = z.infer<typeof statuses>;
type Action = { action: 'confirm'; id: string; recipientId: string; location: SosLocation | null }
  | { action: 'cancel' | 'status' | 'acknowledge'; id: string };

function relayEndpoint(): URL | null {
  const configured = import.meta.env.VITE_SOS_PROXY_URL;
  if (typeof configured !== 'string' || !configured.trim()) return null;
  try {
    const url = new URL(configured);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) return null;
    return new URL('/sos', url);
  } catch {
    return null;
  }
}

async function post(body: object): Promise<unknown> {
  const url = relayEndpoint();
  if (!url) return null;
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', cache: 'no-store',
    body: JSON.stringify(body), signal: AbortSignal.timeout(12_000), redirect: 'error',
  });
  return response.json();
}

export async function prepareSosRelay(): Promise<PreparedRelay | null> {
  try {
    const result = preparedSchema.safeParse(await post({ action: 'prepare', mode: 'live' }));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function updateSosRelay(command: Action): Promise<z.infer<typeof statusResponse>> {
  try {
    const result = statusResponse.safeParse(await post(command));
    if (result.success) return result.data;
  } catch {
    // A browser timeout after confirmation cannot disprove dispatch.
  }
  return { status: command.action === 'confirm' ? 'delivery_unknown' : 'unavailable' };
}

export function relayLocation(fix: { p: { lat: number; lng: number }; observedAt: number } | null, now = Date.now()): SosLocation | null {
  if (!fix || fix.observedAt < now - SOS_LOCATION_MAX_AGE_MS || fix.observedAt > now) return null;
  return { latitude: fix.p.lat, longitude: fix.p.lng, observedAt: fix.observedAt };
}
