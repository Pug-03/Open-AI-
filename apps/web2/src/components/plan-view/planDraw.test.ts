import { pointInRing, shadowPieces } from '@walkwe/core';
import { expect, it } from 'vitest';
import type { PlanScene } from '../../routing/protocol.ts';
import { drawPlan, prepareScene } from './planDraw.ts';

it.each([false, true])('keeps the full shadow of a raised concave footprint when reversed=%s', (reverse) => {
  const corners = [[0, 0], [8, 0], [8, 3], [3, 3], [3, 8], [0, 8], [0, 0]];
  const ring = (reverse ? corners.reverse() : corners).flat();
  const scene: PlanScene = {
    origin: { lat: 0, lng: 0 }, box: [-15, -15, 30, 30],
    buildings: [{ ring, h: 12, minH: 4, estimated: false }],
    decks: [], roads: [], trees: [], cctv: [], lamps: [],
  };
  const sun = { altitude: 37, azimuth: 315 };
  const cam = { cx: 0, cy: 0, scale: 1 };
  const size = 80;
  let path: number[][] = [];
  let shadow: number[][] = [];
  const ctx = {
    beginPath: () => { path = []; },
    moveTo: (x: number, y: number) => { path.push([x, y]); },
    lineTo: (x: number, y: number) => { path.at(-1)!.push(x, y); },
    closePath: () => {},
    fill: (rule?: string) => { if (rule === 'nonzero') shadow = path; },
    stroke: () => {},
    fillRect: () => {},
    setLineDash: () => {},
  } as unknown as CanvasRenderingContext2D;

  drawPlan(ctx, prepareScene(scene), { cam, sun, night: 0 }, size, size);

  const expected = shadowPieces(ring, 12, 4, sun);
  expect(shadow.length).toBeLessThan(expected.length - 1);
  const mismatches: Array<[number, number]> = [];
  for (let x = -1.85; x < 22; x += 0.5) {
    for (let y = -17.35; y < 10; y += 0.5) {
      const before = expected.some((piece) => pointInRing(x, y, piece));
      const after = shadow.some((piece) => pointInRing(size / 2 + x, size / 2 - y, piece));
      if (after !== before) mismatches.push([x, y]);
    }
  }
  expect(mismatches).toEqual([]);
});
