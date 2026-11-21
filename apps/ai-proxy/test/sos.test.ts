import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleSos, SosOutbox, type SosBindings } from '../src/sos.ts';

const enrolled = { id: 'contact', label: 'My contact', destination: 'private-destination', verified: true, consented: true };

function testHarness() {
  const time = vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const attempts = new Map<string, { instance: SosOutbox; records: Map<string, unknown> }>();
  const transport = vi.fn(async (_request: Request) => Response.json({ status: 'provider_accepted' }));
  let recipients = [enrolled];
  const directory = vi.fn(async (request: Request) => {
    const cookie = request.headers.get('cookie');
    if (cookie === 'session=sender') return Response.json({ actorId: 'owner', recipients });
    if (cookie === 'session=recipient') return Response.json({ actorId: 'contact', recipients: [] });
    if (cookie === 'session=other') return Response.json({ actorId: 'other', recipients: [] });
    return new Response(null, { status: 401 });
  });
  const env: SosBindings = {
    SOS_DIRECTORY: { fetch: (url: string, init: RequestInit) => directory(new Request(url, init)) } as unknown as Fetcher,
    SOS_TRANSPORT: { fetch: (url: string, init: RequestInit) => transport(new Request(url, init)) } as unknown as Fetcher,
  };
  env.SOS_OUTBOX = {
    idFromName: (name: string) => name,
    get(key: string) {
      const existing = attempts.get(key);
      if (existing) return { fetch: (url: string, init: RequestInit) => existing.instance.fetch(new Request(url, init)) };
      const records = new Map<string, unknown>();
      let tail = Promise.resolve<unknown>(undefined);
      const storage = {
        get: async (name: string) => structuredClone(records.get(name)),
        put: async (name: string, value: unknown) => { records.set(name, structuredClone(value)); },
        setAlarm: async () => {},
        deleteAll: async () => { records.clear(); },
        transaction<T>(body: (tx: unknown) => Promise<T>) {
          const next = tail.then(() => body(storage));
          tail = next.catch(() => undefined);
          return next;
        },
      };
      const instance = new SosOutbox({ storage } as unknown as DurableObjectState, env);
      attempts.set(key, { instance, records });
      return { fetch: (url: string, init: RequestInit) => instance.fetch(new Request(url, init)) };
    },
  } as unknown as DurableObjectNamespace;
  const call = (payload: object, cookie: string | null = 'session=sender') => handleSos(new Request('https://sos-proxy/sos', {
    method: 'POST', headers: cookie ? { cookie } : {}, body: JSON.stringify(payload),
  }), env, { 'access-control-allow-origin': 'https://walk.test', 'access-control-allow-credentials': 'true' });
  const id = async () => {
    const res = await call({ action: 'prepare', mode: 'live' });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    const body = await res.json() as { status: string; id: string; recipients: unknown[] };
    expect(body.recipients).toEqual([{ id: enrolled.id, label: enrolled.label }]);
    return body.id;
  };
  return {
    time, env, attempts, transport, directory, call, id,
    revoke: () => { recipients = []; },
    enrollAnother: () => { recipients.push({ ...enrolled, id: 'second-contact', destination: 'other-private-destination' }); },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('authenticated SOS relay', () => {
  it('leaves the active flow disabled without bindings or identity and keeps practice local', async () => {
    const { call, directory, env, transport } = testHarness();
    expect(await (await call({ action: 'prepare', mode: 'practice' })).json()).toEqual({ status: 'practice_only' });
    expect(await (await call({ action: 'prepare', mode: 'live' }, null)).json()).toEqual({ status: 'forbidden' });
    expect(directory).not.toHaveBeenCalled();
    expect((await call({ action: 'prepare', mode: 'live' }, 'session=fake')).status).toBe(403);
    env.SOS_TRANSPORT = undefined;
    expect((await call({ action: 'prepare', mode: 'live' })).status).toBe(503);
    expect(transport).not.toHaveBeenCalled();
  });

  it('checks countdown, freshness, sender ownership, cancellation and current recipient consent', async () => {
    const { call, id, time, transport, revoke } = testHarness();
    const first = await id();
    const second = await id();
    const confirm = { action: 'confirm', id: first, recipientId: enrolled.id, location: null };
    expect(await (await call(confirm)).json()).toEqual({ status: 'too_early' });
    time.mockReturnValue(105_000);
    expect(await (await call({ ...confirm, location: { latitude: 13, longitude: 100, observedAt: 30_000 } })).json()).toEqual({ status: 'stale_location' });
    expect((await call({ action: 'status', id: first }, 'session=other')).status).toBe(404);
    expect(await (await call({ action: 'cancel', id: first })).json()).toEqual({ status: 'cancelled' });
    expect(await (await call(confirm)).json()).toEqual({ status: 'cancelled' });
    revoke();
    expect((await call({ ...confirm, id: second })).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });

  it('atomically claims a send once, excludes unauthorized acknowledgement and persists no coordinates', async () => {
    const { call, id, time, transport, attempts, enrollAnother } = testHarness();
    const alertId = await id();
    enrollAnother();
    time.mockReturnValue(105_000);
    let started!: () => void;
    const sendStarted = new Promise<void>((resolve) => { started = resolve; });
    let finish!: (response: Response) => void;
    transport.mockImplementation(async () => {
      started();
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const location = { latitude: 13.7, longitude: 100.5, observedAt: 105_000 };
    const request = { action: 'confirm', id: alertId, recipientId: enrolled.id, location };
    const firstSend = call(request);
    await sendStarted;
    try {
      const mismatched = await call({ ...request, recipientId: 'second-contact' });
      expect(mismatched.status).toBe(409);
      expect(await mismatched.json()).toEqual({ status: 'conflict' });
      expect(await (await call(request)).json()).toEqual({ status: 'sending' });
      expect(transport).toHaveBeenCalledTimes(1);
      const transportRequest = transport.mock.calls[0]![0];
      expect(transportRequest.headers.get('idempotency-key')).toBe(alertId);
      expect(await transportRequest.json()).toEqual({ alertId, verifiedDestination: enrolled.destination, location });
      expect(JSON.stringify(attempts.get(alertId)?.records.get('alert'))).not.toMatch(/13\.7|private-destination/);
      expect((await call({ action: 'acknowledge', id: alertId })).status).toBe(404);
    } finally {
      finish(Response.json({ status: 'provider_accepted' }));
    }
    expect(await (await firstSend).json()).toEqual({ status: 'provider_accepted' });
    expect(await (await call({ action: 'status', id: alertId }, 'session=recipient')).json()).toEqual({ status: 'provider_accepted', canAcknowledge: true });
    expect(await (await call({ action: 'acknowledge', id: alertId }, 'session=recipient')).json()).toEqual({ status: 'acknowledged' });
    expect(await (await call({ action: 'status', id: alertId })).json()).toEqual({ status: 'acknowledged', canAcknowledge: false });
    expect(await (await call(request)).json()).toEqual({ status: 'acknowledged' });
    const afterAcknowledgement = await call({ ...request, recipientId: 'second-contact' });
    expect(afterAcknowledgement.status).toBe(409);
    expect(await afterAcknowledgement.json()).toEqual({ status: 'conflict' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('keeps a timeout uncertain and never resends an already claimed attempt', async () => {
    const { call, id, time, transport } = testHarness();
    const alertId = await id();
    time.mockReturnValue(105_000);
    transport.mockRejectedValue(new Error('timeout'));
    const request = { action: 'confirm', id: alertId, recipientId: enrolled.id, location: null };
    expect(await (await call(request)).json()).toEqual({ status: 'delivery_unknown' });
    expect(await (await call(request)).json()).toEqual({ status: 'delivery_unknown' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await (await call({ action: 'acknowledge', id: alertId }, 'session=recipient')).json()).toEqual({ status: 'acknowledged' });
  });
});
