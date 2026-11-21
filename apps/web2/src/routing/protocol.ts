import type { RouteRequest, RouteResult } from '@walkwe/core';

// Messages between the UI thread and the routing worker. Dates cross as ISO
// strings (structured clone keeps Date, but this keeps the protocol plain
// JSON for a future server endpoint).

export type WireRequest = Omit<RouteRequest, 'departAt'> & { departAt: string };

export type ToWorker =
  | { id: number; type: 'warm' }
  | { id: number; type: 'route'; request: WireRequest }
  | { id: number; type: 'scene'; bbox: readonly [number, number, number, number] }
  | { id: number; type: 'hourly'; request: WireRequest; times: string[] };

export type FromWorker =
  | { id: number; type: 'ready'; meta: DatasetMeta }
  | { id: number; type: 'result'; result: RouteResult }
  | { id: number; type: 'scene'; scene: PlanScene }
  | { id: number; type: 'hourly'; hours: HourShade[] }
  | { id: number; type: 'error'; reason: 'outside-coverage' | 'no-path' | 'data' | 'internal'; message: string };

export interface LayerInfo {
  id: 'walkways' | 'buildings' | 'trees' | 'elevated' | 'malls' | 'cctv' | 'lamps' | 'pois' | 'incidents';
  sources: Array<{ name: string; url: string; license: string; notes?: string | undefined }>;
  updatedAt: string;
  count: number;
}

export interface DatasetMeta {
  updatedAt: string;
  osmUpdatedAt: string;
  /** Share of buildings whose height is an estimate, 0..1. */
  estimatedHeightShare: number;
  /** Day-mode sources (walkways + shade casters). */
  sources: Array<{ name: string; license: string }>;
  /** Every layer, for the data-limitations page. */
  layers: LayerInfo[];
  /** Share of walkway length with lighting from data (tag/lamp), 0..1. */
  litKnownShare: number;
  malls: { total: number; withHours: number };
  incidents: { total: number; placeholders: number };
}

/**
 * The drawing data for one piece of the pilot area (the shadow plan on the
 * welcome and data pages), in metres east/north of `origin`. Flat arrays keep
 * the message small.
 */
export interface PlanScene {
  origin: { lat: number; lng: number };
  /** [west, south, east, north] in metres. */
  box: [number, number, number, number];
  buildings: Array<{ ring: number[]; h: number; minH: number; estimated: boolean }>;
  /** Elevated decks (rail, road, footbridge): centre line and width. */
  decks: Array<{ line: number[]; w: number; h: number; kind: 'rail' | 'road' | 'foot' }>;
  /** Centre lines of the named roads, for the street grid. */
  roads: number[][];
  /** [x, y, crownRadius, …] */
  trees: number[];
  /** [x, y, …] */
  cctv: number[];
  lamps: number[];
}

/** One departure time on the "best time to leave" chart. */
export interface HourShade {
  at: string;
  mode: 'day' | 'night';
  /** Shadiest route found for that departure (day), 0..1; null at night or when no route exists. */
  shade: number | null;
  /** The shortest route's shade at that time, 0..1. */
  shortestShade: number | null;
  minutes: number | null;
  sunAltitude: number;
}
