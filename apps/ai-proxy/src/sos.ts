import { z } from 'zod';
import {
  acknowledgeSos, SOS_CONFIRM_DELAY_MS, submitSos, type SosDelivery, type SosOutboxAdapter,
} from '../../../packages/walkwe-agentic/src/safety/sos.mjs';

export interface SosBindings {
  SOS_OUTBOX?: DurableObjectNamespace;
  SOS_DIRECTORY?: Fetcher;
  SOS_TRANSPORT?: Fetcher;
}

const PREPARE_MS = 2 * 60_000;
const KEEP_MS = 24 * 60 * 60_000;
const MAX_BYTES = 4096;
const TRANSPORT_TIMEOUT_MS = 8000;
const id = z.string().uuid();
const actor = z.string().trim().min(1).max(128);
const recipient = z.strictObject({
  id: actor, label: z.string().trim().min(1).max(80),
  destination: z.string().min(1).max(1024), verified: z.literal(true), consented: z.literal(true),
});
const session = z.object({ actorId: actor, recipients: z.array(recipient).max(20) })
  .refine(({ recipients }) => new Set(recipients.map((item) => item.id)).size === recipients.length);
const commands = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('prepare'), mode: z.enum(['live', 'practice']) }),
  z.strictObject({ action: z.literal('confirm'), id, recipientId: actor, location: z.strictObject({
    latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), observedAt: z.number().finite(),
  }).nullable() }),
  z.strictObject({ action: z.literal('cancel'), id }),
  z.strictObject({ action: z.literal('status'), id }),
  z.strictObject({ action: z.literal('acknowledge'), id }),
]);

type Command = z.infer<typeof commands>;
type VerifiedRecipient = z.infer<typeof recipient>;
type Operation = Command & { actorId: string; id: string; verifiedRecipient?: VerifiedRecipient };
type AlertStatus = 'prepared' | 'cancelled' | 'sending' | 'acknowledged' | SosDelivery;
type Alert = { ownerId: string; recipientId?: string; status: AlertStatus; readyAt: number; expiresAt: number; updatedAt: number };

const json = (status: string, http = 200, other?: object) => Response.json({ status, ...other }, {
  status: http,
  headers: { 'cache-control': 'no-store' },
});

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let raw = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } catch {
    return null;
  }
}

export async function handleSos(request: Request, env: SosBindings, cors: HeadersInit): Promise<Response> {
  const withCors = (response: Response) => {
    const headers = new Headers(response.headers);
    new Headers(cors).forEach((value, key) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  };
  const result = commands.safeParse(await readBody(request));
  if (!result.success) return withCors(json('invalid', 400));
  const command = result.data;
  if (command.action === 'prepare' && command.mode === 'practice') return withCors(json('practice_only'));
  if (!env.SOS_OUTBOX || !env.SOS_DIRECTORY || !env.SOS_TRANSPORT) return withCors(json('unavailable', 503));
  const cookie = request.headers.get('cookie');
  if (!cookie) return withCors(json('forbidden', 403));

  let active: z.infer<typeof session>;
  try {
    const response = await env.SOS_DIRECTORY.fetch('https://sos-directory/session', {
      method: 'POST', headers: { cookie }, signal: AbortSignal.timeout(3000), redirect: 'error',
    });
    if (response.status === 401 || response.status === 403) return withCors(json('forbidden', 403));
    if (!response.ok) return withCors(json('unavailable', 503));
    active = session.parse(await response.json());
  } catch {
    return withCors(json('unavailable', 503));
  }

  const alertId = command.action === 'prepare' ? crypto.randomUUID() : command.id;
  const operation: Operation = { ...command, actorId: active.actorId, id: alertId };
  const eligibleRecipients = active.recipients.filter((item) => item.id !== active.actorId);
  if (command.action === 'prepare' && eligibleRecipients.length === 0) return withCors(json('no_recipients', 403));
  if (command.action === 'confirm') {
    const records = eligibleRecipients.filter((item) => item.id === command.recipientId);
    if (records.length !== 1) return withCors(json('forbidden', 403));
    operation.verifiedRecipient = records[0];
  }

  try {
    const outbox = env.SOS_OUTBOX.get(env.SOS_OUTBOX.idFromName(alertId));
    const reply = await outbox.fetch('https://sos-outbox/action', { method: 'POST', body: JSON.stringify(operation) });
    if (command.action !== 'prepare' || !reply.ok) return withCors(reply);
    const recipients = eligibleRecipients.map(({ id, label }) => ({ id, label }));
    return withCors(json('prepared', 201, { id: alertId, recipients }));
  } catch {
    return withCors(command.action === 'confirm' ? json('delivery_unknown', 202) : json('unavailable', 503));
  }
}

export class SosOutbox {
  constructor(private readonly state: DurableObjectState, private readonly env: SosBindings) {}

  async fetch(request: Request): Promise<Response> {
    const event = await request.json<Operation>();
    const storage = this.state.storage;
    const now = Date.now();
    if (event.action === 'prepare') {
      if (event.mode === 'practice') return json('practice_only');
      const outcome = await storage.transaction(async (tx) => {
        if (await tx.get('alert')) return 'conflict';
        await tx.setAlarm(now + KEEP_MS);
        await tx.put('alert', { ownerId: event.actorId, status: 'prepared', readyAt: now + SOS_CONFIRM_DELAY_MS, expiresAt: now + PREPARE_MS, updatedAt: now } satisfies Alert);
        return 'prepared';
      });
      return json(outcome, outcome === 'prepared' ? 201 : 409);
    }

    const outbox: SosOutboxAdapter = {
      claimConfirmed: ({ recipientId }) => storage.transaction(async (tx) => {
        const alert = await tx.get<Alert>('alert');
        if (!alert || alert.ownerId !== event.actorId) return { status: 'not_found' };
        if (alert.recipientId && alert.recipientId !== recipientId) return { status: 'conflict' };
        if (alert.status !== 'prepared') return { status: publicStatus(alert, now) };
        if (now < alert.readyAt) return { status: 'too_early' };
        if (now >= alert.expiresAt) return { status: 'expired' };
        if (!event.verifiedRecipient) return { status: 'forbidden' };
        await tx.put('alert', { ...alert, recipientId: event.verifiedRecipient.id, status: 'sending', updatedAt: now } satisfies Alert);
        return { status: 'claimed', verifiedDestination: event.verifiedRecipient.destination };
      }),
      recordResult: ({ status }) => storage.transaction(async (tx) => {
        const alert = await tx.get<Alert>('alert');
        if (alert?.status === 'sending') await tx.put('alert', { ...alert, status, updatedAt: Date.now() } satisfies Alert);
      }),
      confirmRecipientReceipt: ({ recipientId }) => storage.transaction(async (tx) => {
        const alert = await tx.get<Alert>('alert');
        if (!alert || alert.recipientId !== recipientId) return { status: 'not_found' };
        if (alert.status === 'acknowledged') return { status: alert.status };
        if (!['sending', 'provider_accepted', 'delivery_unknown'].includes(alert.status)) return { status: 'conflict' };
        await tx.put('alert', { ...alert, status: 'acknowledged', updatedAt: now } satisfies Alert);
        return { status: 'acknowledged' };
      }),
    };

    if (event.action === 'confirm') {
      const transport = this.env.SOS_TRANSPORT;
      if (!transport) return json('unavailable', 503);
      const result = await submitSos({ mode: 'live', id: event.id, recipientId: event.recipientId, location: event.location }, {
        actor: { id: event.actorId }, outbox, now, transport: {
          async send({ idempotencyKey, verifiedDestination, location }) {
            const response = await transport.fetch('https://sos-transport/send', {
              method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
              body: JSON.stringify({ alertId: idempotencyKey, verifiedDestination, location }),
              signal: AbortSignal.timeout(TRANSPORT_TIMEOUT_MS), redirect: 'error',
            });
            if (!response.ok) return { status: 'delivery_unknown' };
            return z.object({ status: z.enum(['provider_accepted', 'failed']) }).parse(await response.json());
          },
        },
      });
      const alert = await storage.get<Alert>('alert');
      if (alert?.ownerId === event.actorId && alert.recipientId) {
        if (alert.recipientId !== event.recipientId) return resultResponse('conflict');
        if (alert.status === 'acknowledged') return resultResponse('acknowledged');
      }
      return resultResponse(result.status);
    }
    if (event.action === 'acknowledge') {
      const { status } = await acknowledgeSos({ id: event.id }, { actor: { id: event.actorId }, outbox });
      return resultResponse(status);
    }
    if (event.action === 'cancel') {
      const status = await storage.transaction(async (tx) => {
        const alert = await tx.get<Alert>('alert');
        if (!alert || alert.ownerId !== event.actorId) return 'not_found';
        if (alert.status !== 'prepared') return publicStatus(alert, now);
        await tx.put('alert', { ...alert, status: 'cancelled', updatedAt: now } satisfies Alert);
        return 'cancelled';
      });
      return resultResponse(status);
    }
    const alert = await storage.get<Alert>('alert');
    if (!alert || (alert.ownerId !== event.actorId && alert.recipientId !== event.actorId)) return resultResponse('not_found');
    return resultResponse(publicStatus(alert, now), { canAcknowledge: alert.recipientId === event.actorId });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

function publicStatus(alert: Alert, now: number): string {
  if (alert.status === 'prepared' && alert.expiresAt <= now) return 'expired';
  if (alert.status === 'sending' && alert.updatedAt + TRANSPORT_TIMEOUT_MS <= now) return 'delivery_unknown';
  return alert.status;
}

function resultResponse(status: string, details?: object): Response {
  if (status === 'not_found') return json(status, 404);
  if (status === 'forbidden') return json(status, 403);
  if (status === 'unavailable') return json(status, 503);
  if (['too_early', 'expired', 'conflict', 'stale_location', 'invalid_location'].includes(status)) return json(status, 409);
  if (['provider_accepted', 'sending', 'delivery_unknown'].includes(status)) return json(status, 202, details);
  return json(status, 200, details);
}
