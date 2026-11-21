import type { RouteEvidenceSegment } from '@walkwe/core';

export interface RoutingPlace { id: string; name: string; en: string; aliases: string[] }
export interface RoutingTrip {
  from: string;
  to: string;
  date: string;
  time: string;
  mode: 'day' | 'night';
  language: 'th' | 'en';
  noStairs: boolean;
  preference?: 'direct' | 'prefer_evidence';
}

export interface RoutingCandidate {
  id: string;
  meters: number;
  minutes: number;
  shade: number | null;
  sunMinutes: number | null;
  lit: number;
  dark: number;
  unknown: number;
  segments: RouteEvidenceSegment[];
}

export type RoutingResult =
  | { status: 'invalid' | 'out_of_coverage' | 'no_path'; decision: 'ABSTAIN' }
  | { status: 'ok'; decision: 'ACT' | 'VERIFY'; mode: 'day' | 'night'; date: string; time: string;
      datasetVersion: string; recommendedId: string; shortestId: string; routes: RoutingCandidate[];
      stress: { flipped: false } | { flipped: true; optimisticId: string; pessimisticId: string; evidenceIds: string[] } };

export interface Web2Routing {
  version: string;
  referenceDate: string;
  segmentKnown(id: string): boolean;
  evidence(id: string): RouteEvidenceSegment | null;
  segmentName(id: string): string | null;
  workflowOptions: { route(request: RoutingTrip): RoutingResult; places: RoutingPlace[];
    departure(request: RoutingTrip, routeId: string, maxDelay: number): unknown };
}

export const publicWeb2Places: RoutingPlace[];
export function isWeb2Place(id: string): boolean;
export function createWeb2Routing(area: unknown, incidents: unknown): Web2Routing;
export function applyApprovedLighting(
  result: RoutingResult,
  approved: ReadonlyMap<string, { value: 'lit' | 'dim' | 'dark'; observedAt: string }>,
  preference: RoutingTrip['preference'],
): RoutingResult;
