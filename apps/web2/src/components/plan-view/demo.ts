import type { LatLng, Route, RouteResult, WalkMode } from '@walkwe/core';
import type { PlanScene } from '../../routing/protocol.ts';
import { routing } from '../../services.ts';
import { DAY_END_U, timeAt, type DayCycle } from './dayCycle.ts';
import { toPlanRoute, type PlanRoute } from './planDraw.ts';

// The welcome page's live demo: three real trips in the pilot area, routed by
// the same worker the planner uses, at the time selected on the demo.

export const SIAM: LatLng = { lat: 13.7462, lng: 100.5347 };
/** The piece of the pilot area the plan draws: [west, south, east, north]. */
export const PLAN_BBOX = [100.5235, 13.7375, 100.5485, 13.7555] as const;

export interface DemoTrip {
  id: string;
  from: { th: string; en: string } & LatLng;
  to: { th: string; en: string } & LatLng;
}

// Chosen because the shadier route and the shortest one are different paths
// for most of the day here (checked against the router), so the plan shows
// the choice the app exists to make.
export const TRIPS: DemoTrip[] = [
  {
    id: 'siam-platinum',
    from: { th: 'BTS สยาม', en: 'BTS Siam', lat: 13.74563, lng: 100.53412 },
    to: { th: 'แพลทินัม', en: 'Platinum', lat: 13.74987, lng: 100.54013 },
  },
  {
    id: 'paragon-bigc',
    from: { th: 'สยามพารากอน', en: 'Siam Paragon', lat: 13.74656, lng: 100.53471 },
    to: { th: 'บิ๊กซี ราชดำริ', en: 'Big C Ratchadamri', lat: 13.74699, lng: 100.54162 },
  },
  {
    id: 'chitlom-ratchadamri',
    from: { th: 'BTS ชิดลม', en: 'BTS Chit Lom', lat: 13.74414, lng: 100.54305 },
    to: { th: 'BTS ราชดำริ', en: 'BTS Ratchadamri', lat: 13.73938, lng: 100.53937 },
  },
];

export interface RouteFigures {
  minutes: number;
  metres: number;
  /** Day: share in shade, 0..1. Night: the 0-10 score from the data on hand. */
  score: number;
}

export interface DemoRoutes {
  mode: WalkMode;
  main: PlanRoute;
  /** The shortest path, when the recommended one is a different path. */
  alt: PlanRoute | null;
  mainFigures: RouteFigures;
  altFigures: RouteFigures | null;
}

const DAY_SLOTS = 30;
/** Which route sample covers a position on the day loop. */
export function slotFor(u: number): number {
  const v = ((u % 1) + 1) % 1;
  return v < DAY_END_U ? Math.min(DAY_SLOTS - 1, Math.floor((v / DAY_END_U) * DAY_SLOTS)) : DAY_SLOTS;
}
export const SLOT_COUNT = DAY_SLOTS + 1;

const figures = (r: Route, mode: WalkMode): RouteFigures => ({
  minutes: Math.max(1, Math.round(r.durationS / 60)),
  metres: Math.round(r.lengthM),
  score: mode === 'day' ? r.shadeShare : (r.safetyScore ?? 0),
});

function pick(result: RouteResult, mode: WalkMode, scene: PlanScene): DemoRoutes {
  const shortest = result.routes.find((r) => r.kinds.includes('shortest')) ?? result.routes[0]!;
  const best = result.routes.reduce((a, b) =>
    (mode === 'day' ? b.shadeShare > a.shadeShare : (b.safetyScore ?? 0) > (a.safetyScore ?? 0)) ? b : a,
  );
  const good = (run: Route['runs'][number]) => (mode === 'day' ? run.shade >= 0.5 : (run.safety ?? 0) >= 0.5);
  return {
    mode,
    main: toPlanRoute(best, scene, good),
    alt: best === shortest ? null : toPlanRoute(shortest, scene, () => true),
    mainFigures: figures(best, mode),
    altFigures: best === shortest ? null : figures(shortest, mode),
  };
}

/** Routes cached as the visitor explores one trip. */
export class DemoCache {
  private readonly slots: Array<DemoRoutes | null> = Array.from({ length: SLOT_COUNT }, () => null);
  private readonly requested = new Set<number>();
  private queued: number | null = null;
  private loading = false;
  private stopped = false;

  constructor(
    private readonly trip: DemoTrip,
    private readonly scene: PlanScene,
    private readonly cycle: DayCycle,
    private readonly onSlot: () => void,
  ) {}

  request(slot: number): void {
    if (this.stopped) return;
    // Keep one request in flight and replace intermediate times during scrubbing.
    this.queued = this.requested.has(slot) ? null : slot;
    if (!this.loading && this.queued !== null) void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    while (!this.stopped && this.queued !== null) {
      const slot = this.queued;
      this.queued = null;
      this.requested.add(slot);
      const night = slot === DAY_SLOTS;
      const u = night ? DAY_END_U + 0.06 : ((slot + 0.5) / DAY_SLOTS) * DAY_END_U;
      const mode: WalkMode = night ? 'night' : 'day';
      try {
        const result = await routing.route({ from: this.trip.from, to: this.trip.to, departAt: timeAt(this.cycle, u), mode });
        if (this.stopped) return;
        this.slots[slot] = pick(result, mode, this.scene);
        this.onSlot();
      } catch {
        // One slot failing leaves its cached neighbours to stand in for it.
      }
    }
    this.loading = false;
  }

  /** The slot's routes, or the nearest slot already computed. */
  at(slot: number): DemoRoutes | null {
    if (this.slots[slot]) return this.slots[slot]!;
    if (slot === DAY_SLOTS) return null;
    for (let d = 1; d < DAY_SLOTS; d++) {
      const a = this.slots[slot - d], b = this.slots[slot + d];
      if (slot - d >= 0 && a) return a;
      if (slot + d < DAY_SLOTS && b) return b;
    }
    return null;
  }

  stop(): void {
    this.stopped = true;
  }
}
