/// <reference lib="webworker" />
import { activeCity } from '@walkwe/config';
import { Area, AreaRouter, LocalProjection, modeForTime, RoutingError, sunPosition } from '@walkwe/core';
import { areaDatasetSchema, incidentsDatasetSchema, JsonRepository, toAreaInput, withoutPlaceholders, type IncidentsDataset } from '@walkwe/data';
import type { DatasetMeta, FromWorker, HourShade, LayerInfo, PlanScene, ToWorker } from './protocol.ts';
import type { AreaDataset } from '@walkwe/data';

// Loads the pilot dataset once, builds the graph, and answers route requests
// off the UI thread so the sheet and map stay smooth while A* runs.

const repo = new JsonRepository({ baseUrl: '/data/' });
let ready: Promise<{ router: AreaRouter; meta: DatasetMeta; ds: AreaDataset }> | null = null;

function load() {
  ready ??= Promise.all([
    repo.load('areas/siam', (raw) => areaDatasetSchema.parse(raw)),
    // A missing register is not fatal: route without it.
    repo.load(activeCity.incidents.dataset, (raw) => incidentsDatasetSchema.parse(raw)).catch((): IncidentsDataset | null => null),
  ]).then(([ds, inc0]) => {
    // Belt and braces: the build already strips placeholders; never use them in production.
    const inc = inc0 && import.meta.env.PROD ? withoutPlaceholders(inc0) : inc0;
    const area = new Area(
      toAreaInput(
        ds,
        (inc?.items ?? []).map((i) => ({ id: i.id, wayIds: i.wayIds, category: i.category, occurredOn: i.occurredOn, window: i.window, severity: i.severity })),
      ),
    );
    const router = new AreaRouter(area, {
      timeZone: activeCity.timezone,
      defaultMallHours: activeCity.defaultMallHours,
      walkSpeedMps: activeCity.walkSpeedMps,
      incidents: { halfLifeDays: activeCity.incidents.halfLifeDays, outsideWindow: activeCity.incidents.outsideWindow },
    });
    const L = ds.layers;
    const items = L.buildings.items;
    const sources = new Map<string, string>();
    // Sources behind day-mode routing (walkways + shade casters).
    for (const layer of [L.walkways, L.buildings, L.trees, L.elevated, L.malls]) {
      for (const s of layer.source) if (!s.name.startsWith('Walk We')) sources.set(s.name.split(' (')[0]!, s.license);
    }
    const layer = (id: LayerInfo['id'], l: { source: LayerInfo['sources']; updatedAt: string }, count: number): LayerInfo => ({
      id, sources: l.source, updatedAt: l.updatedAt, count,
    });
    const night = router.night;
    let litLen = 0, totLen = 0;
    for (let e = 0; e < area.edgeCount; e++) {
      totLen += area.elen[e]!;
      if (night.litKnown[e]) litLen += area.elen[e]!;
    }
    const meta: DatasetMeta = {
      updatedAt: ds.updatedAt,
      osmUpdatedAt: L.walkways.updatedAt,
      estimatedHeightShare: items.length ? items.filter((b) => b.heightSource !== 'height').length / items.length : 0,
      sources: [...sources].map(([name, license]) => ({ name, license })),
      layers: [
        layer('walkways', L.walkways, L.walkways.ways.length),
        layer('buildings', L.buildings, items.length),
        layer('trees', L.trees, L.trees.points.length / 4),
        layer('elevated', L.elevated, L.elevated.items.length),
        layer('malls', L.malls, L.malls.items.length),
        { id: 'cctv', sources: [...L.cctvBma.source, ...L.cctvOsm.source], updatedAt: L.cctvBma.updatedAt, count: (L.cctvBma.points.length + L.cctvOsm.points.length) / 2 },
        layer('lamps', L.lamps, L.lamps.points.length / 2),
        layer('pois', L.pois, L.pois.points.length / 4),
        ...(inc ? [layer('incidents', inc, inc.items.length)] : []),
      ],
      litKnownShare: totLen ? litLen / totLen : 0,
      malls: { total: L.malls.items.length, withHours: L.malls.items.filter((m) => m.hours).length },
      incidents: { total: inc?.items.length ?? 0, placeholders: inc?.items.filter((i) => i.placeholder).length ?? 0 },
    };
    return { router, meta, ds };
  });
  ready.catch(() => (ready = null)); // allow a retry after a network failure
  return ready;
}

const ROAD_CLASSES = new Set(['primary', 'secondary', 'tertiary', 'trunk']);

/** Cut the drawing layers down to one box and project them to metres. */
function planScene(ds: AreaDataset, bbox: readonly [number, number, number, number]): PlanScene {
  const [w, s, e, n] = bbox;
  const origin = { lat: (s + n) / 2, lng: (w + e) / 2 };
  const P = new LocalProjection(origin);
  // A margin so shadows of buildings just outside still fall into the frame.
  const m = 0.0022;
  const inside = (lat: number, lng: number, pad = 0) => lat >= s - pad && lat <= n + pad && lng >= w - pad && lng <= e + pad;
  const flat = (ll: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < ll.length; i += 2) out.push(Math.round(P.x(ll[i + 1]!) * 10) / 10, Math.round(P.y(ll[i]!) * 10) / 10);
    return out;
  };
  const touches = (ll: number[], pad: number) => {
    for (let i = 0; i < ll.length; i += 2) if (inside(ll[i]!, ll[i + 1]!, pad)) return true;
    return false;
  };
  const L = ds.layers;
  const points = (ll: number[], step: number) => {
    const out: number[] = [];
    for (let i = 0; i < ll.length; i += step) if (inside(ll[i]!, ll[i + 1]!)) out.push(Math.round(P.x(ll[i + 1]!)), Math.round(P.y(ll[i]!)));
    return out;
  };
  const trees: number[] = [];
  for (let i = 0; i < L.trees.points.length; i += 4) {
    if (inside(L.trees.points[i]!, L.trees.points[i + 1]!)) trees.push(Math.round(P.x(L.trees.points[i + 1]!)), Math.round(P.y(L.trees.points[i]!)), L.trees.points[i + 2]!);
  }
  const roads: number[][] = [];
  const nodes = L.walkways.nodes;
  for (const way of L.walkways.ways) {
    if (!ROAD_CLASSES.has(way.cls) || !way.name) continue;
    const ll: number[] = [];
    for (const k of way.nodes) ll.push(nodes[k * 2]!, nodes[k * 2 + 1]!);
    if (touches(ll, 0)) roads.push(flat(ll));
  }
  return {
    origin,
    box: [P.x(w), P.y(s), P.x(e), P.y(n)],
    buildings: L.buildings.items.filter((b) => touches(b.ring, m)).map((b) => ({ ring: flat(b.ring), h: b.h, minH: b.minH, estimated: b.heightSource !== 'height' })),
    decks: L.elevated.items.filter((d) => touches(d.line, m)).map((d) => ({ line: flat(d.line), w: d.w, h: d.h, kind: d.kind })),
    roads,
    trees,
    cctv: [...points(L.cctvBma.points, 2), ...points(L.cctvOsm.points, 2)],
    lamps: points(L.lamps.points, 2),
  };
}

const post = (msg: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    const { router, meta, ds } = await load();
    if (msg.type === 'warm') return post({ id: msg.id, type: 'ready', meta });
    if (msg.type === 'scene') return post({ id: msg.id, type: 'scene', scene: planScene(ds, msg.bbox) });
    if (msg.type === 'hourly') {
      // The same trip at each departure time: how the shade changes through the day.
      const hours: HourShade[] = msg.times.map((iso) => {
        const at = new Date(iso);
        const mode = modeForTime(at, msg.request.from);
        const sunAltitude = sunPosition(at, msg.request.from).altitude;
        if (mode === 'night') return { at: iso, mode, shade: null, shortestShade: null, minutes: null, sunAltitude };
        try {
          const r = router.routeSync({ ...msg.request, departAt: at, mode: 'day' });
          const best = r.routes.reduce((a, b) => (b.shadeShare > a.shadeShare ? b : a));
          const shortest = r.routes.find((x) => x.kinds.includes('shortest')) ?? r.routes[0]!;
          return { at: iso, mode, shade: best.shadeShare, shortestShade: shortest.shadeShare, minutes: Math.max(1, Math.round(best.durationS / 60)), sunAltitude };
        } catch {
          return { at: iso, mode, shade: null, shortestShade: null, minutes: null, sunAltitude };
        }
      });
      return post({ id: msg.id, type: 'hourly', hours });
    }
    const result = router.routeSync({ ...msg.request, departAt: new Date(msg.request.departAt) });
    post({ id: msg.id, type: 'result', result });
  } catch (err) {
    if (err instanceof RoutingError) post({ id: msg.id, type: 'error', reason: err.reason, message: err.message });
    else post({ id: msg.id, type: 'error', reason: ready ? 'internal' : 'data', message: String((err as Error)?.message ?? err) });
  }
};
