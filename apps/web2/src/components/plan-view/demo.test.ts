import { expect, it, vi } from 'vitest';
import type { RouteResult } from '@walkwe/core';
import type { PlanScene } from '../../routing/protocol.ts';
import { routing } from '../../services.ts';
import { cycleFor, DAY_END_U, timeAt } from './dayCycle.ts';
import { DemoCache, SIAM, SLOT_COUNT, TRIPS } from './demo.ts';

vi.mock('../../services.ts', () => ({ routing: { route: vi.fn() } }));

it('only queues the latest time and reuses route samples already requested', async () => {
  const scene: PlanScene = {
    origin: SIAM, box: [0, 0, 1, 1],
    buildings: [], decks: [], roads: [], trees: [], cctv: [], lamps: [],
  };
  const response: RouteResult = {
    routes: [{
      kinds: ['shortest'], metric: 'shade', runs: [], lengthM: 450, durationS: 360,
      shadeShare: 0.4, estimatedShadeShare: 0, mallsUsed: [], steps: [], safetyScore: null,
      litKnownShare: null, incidentsOnRoute: 0, stairsM: 0,
    }],
    sun: { altitude: 40, azimuth: 90 }, closedMalls: [], incidentsActive: 0, snapM: { from: 0, to: 0 },
  };
  let finishFirst!: (result: RouteResult) => void;
  const firstRoute = new Promise<RouteResult>((resolve) => { finishFirst = resolve; });
  const route = vi.mocked(routing.route).mockReturnValueOnce(firstRoute).mockResolvedValue(response);
  const cycle = cycleFor(new Date('2026-11-21T12:00:00+07:00'), SIAM);
  const onSlot = vi.fn();
  const cache = new DemoCache(TRIPS[0]!, scene, cycle, onSlot);

  cache.request(4);
  cache.request(5);
  cache.request(6);
  expect(route).toHaveBeenCalledTimes(1);
  finishFirst(response);
  await vi.waitFor(() => expect(onSlot).toHaveBeenCalledTimes(2));
  expect(route).toHaveBeenCalledTimes(2);
  const sampleTime = timeAt(cycle, ((6 + 0.5) / (SLOT_COUNT - 1)) * DAY_END_U);
  expect(route.mock.calls[1]?.[0].departAt).toEqual(sampleTime);
  cache.request(4);
  cache.request(6);
  expect(route).toHaveBeenCalledTimes(2);
});
