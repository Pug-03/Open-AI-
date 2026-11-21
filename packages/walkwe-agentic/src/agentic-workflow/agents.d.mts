import type { ModelClient } from '../integrations/openai.mjs';
import type { RoutingPlace, RoutingResult, RoutingTrip } from '../../../../apps/web2/agentic/routing-core.mjs';

type PlanResult = Exclude<RoutingResult, { status: 'ok' }>
  | { status: 'worker_error' | 'stale_snapshot'; decision: 'ABSTAIN' }
  | (Extract<RoutingResult, { status: 'ok' }> & {
      source: 'worker' | 'verified_planner';
      final?: { text: string };
      trace: { step: string; passed?: boolean; status?: string }[];
    });

export function createWorkflows(options?: {
  model?: ModelClient | null;
  route?: (request: RoutingTrip) => RoutingResult;
  places?: RoutingPlace[];
  departure?: (request: RoutingTrip, routeId: string, delay: number) => unknown;
}): {
  plan(request: RoutingTrip, options?: { useModel?: boolean; signal?: AbortSignal }): Promise<PlanResult>;
  intent(request: { text: string; useModel?: boolean; signal?: AbortSignal }): Promise<{ status: 'invalid' } | {
    status: 'confirm'; source: string;
    draft: { from: string | null; to: string | null; time: string | null;
      mode: 'day' | 'night' | 'auto' | null; noStairs: boolean };
  }>;
  companion(request: {
    event: string; route: { unknown: number }; warnings: number; handled: string[];
    useModel?: boolean; signal?: AbortSignal;
  }): Promise<{ action: 'silent' | 'warn' | 'offer_replan'; warnings: number; handled: string[] }>;
};
