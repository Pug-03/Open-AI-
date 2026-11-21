import { createWeb2Routing, type Web2Routing } from '../../web2/agentic/routing-core.mjs';

const WEB2_DATA_ORIGIN = 'https://walkwe-web2.walkwe.workers.dev';
const MAX_DATA_BYTES = 12 * 1024 * 1024;
const REFRESH_MS = 10 * 60 * 1000;
let cache: { origin: string; expires: number; promise: Promise<Web2Routing> } | undefined;

async function readData(origin: string, path: string): Promise<unknown> {
  const response = await fetch(new URL(path, origin), {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')
    || Number(response.headers.get('content-length')) > MAX_DATA_BYTES || !response.body) {
    throw new Error('graph data unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let count = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > MAX_DATA_BYTES) {
        await reader.cancel();
        throw new Error('graph data too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export function loadHostedRouting(dataOrigin = WEB2_DATA_ORIGIN): Promise<Web2Routing> {
  const url = new URL(dataOrigin);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('invalid routing data origin');
  }
  if (cache?.origin === url.origin && cache.expires > Date.now()) return cache.promise;
  const promise = Promise.all([
    readData(url.origin, '/data/areas/siam.json'),
    readData(url.origin, '/data/incidents/bangkok.json'),
  ]).then(([area, incidents]) => createWeb2Routing(area, incidents));
  cache = { origin: url.origin, expires: Date.now() + REFRESH_MS, promise };
  void promise.catch(() => { if (cache?.promise === promise) cache = undefined; });
  return promise;
}
