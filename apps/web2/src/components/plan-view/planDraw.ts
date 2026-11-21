import { shadowDirection, shadowLength, type Route, type SunPosition } from '@walkwe/core';
import type { PlanScene } from '../../routing/protocol.ts';

// The shadow plan: the pilot area's real building footprints drawn as an
// architect's site plan, with the shadows the engine's own geometry gives
// for one sun position (shadow = footprint swept along the sun's bearing by
// h / tan(altitude), the same rule ShadeScene routes with). Canvas 2D: a few
// thousand polygons redraw comfortably every frame while the time is dragged.

export interface Camera {
  /** Centre of the view, metres east/north of the scene origin. */
  cx: number;
  cy: number;
  /** CSS pixels per metre. */
  scale: number;
}

export interface PlanRoute {
  /** Stretches of the path: flat [x, y, …] in metres, and whether it is the "good" kind (shade by day, safer by night). */
  runs: Array<{ pts: Float32Array; good: boolean }>;
  lengthM: number;
}

export interface PlanFrame {
  cam: Camera;
  sun: SunPosition;
  /** 0 = day sheet, 1 = night sheet. */
  night: number;
  main?: PlanRoute | null;
  /** The shortest route, when it is a different path. */
  alt?: PlanRoute | null;
  /** 0..1 of the routes drawn (they are plotted along their length). */
  progress?: number;
  from?: { x: number; y: number; label: string } | null;
  to?: { x: number; y: number; label: string } | null;
  /** 0..1: how much of the night point layers (cameras, lamps) to show. */
  points?: number;
}

/** What the canvas keeps per scene so a frame allocates nothing. */
export interface PreparedScene {
  scene: PlanScene;
  rings: Float32Array[];
  /** +1 when the ring runs counter-clockwise, -1 clockwise. */
  turn: Int8Array;
  /** [x0, y0, x1, y1] per building. */
  boxes: Float32Array;
  h: Float32Array;
  minH: Float32Array;
  decks: Array<{ line: Float32Array; w: number; kind: 'rail' | 'road' | 'foot' }>;
  roads: Float32Array[];
}

export function prepareScene(scene: PlanScene): PreparedScene {
  const n = scene.buildings.length;
  const rings: Float32Array[] = [];
  const turn = new Int8Array(n);
  const boxes = new Float32Array(n * 4);
  const h = new Float32Array(n);
  const minH = new Float32Array(n);
  scene.buildings.forEach((b, i) => {
    const r = Float32Array.from(b.ring);
    let area = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j + 3 < r.length; j += 2) area += r[j]! * r[j + 3]! - r[j + 2]! * r[j + 1]!;
    for (let j = 0; j < r.length; j += 2) {
      x0 = Math.min(x0, r[j]!); x1 = Math.max(x1, r[j]!);
      y0 = Math.min(y0, r[j + 1]!); y1 = Math.max(y1, r[j + 1]!);
    }
    rings.push(r);
    turn[i] = area >= 0 ? 1 : -1;
    boxes.set([x0, y0, x1, y1], i * 4);
    h[i] = b.h;
    minH[i] = b.minH;
  });
  return {
    scene,
    rings,
    turn,
    boxes,
    h,
    minH,
    decks: scene.decks.map((d) => ({ line: Float32Array.from(d.line), w: d.w, kind: d.kind })),
    roads: scene.roads.map((r) => Float32Array.from(r)),
  };
}

/** Route from the router (lat/lng) to plan metres. */
export function toPlanRoute(route: Route, scene: PlanScene, good: (run: Route['runs'][number]) => boolean): PlanRoute {
  const kx = 111_320 * Math.cos((scene.origin.lat * Math.PI) / 180);
  const ky = 110_574;
  return {
    lengthM: route.lengthM,
    runs: route.runs.map((run) => {
      const pts = new Float32Array(run.coordinates.length * 2);
      run.coordinates.forEach((c, i) => {
        pts[i * 2] = (c.lng - scene.origin.lng) * kx;
        pts[i * 2 + 1] = (c.lat - scene.origin.lat) * ky;
      });
      return { pts, good: good(run) };
    }),
  };
}

export function toPlanPoint(p: { lat: number; lng: number }, scene: PlanScene): { x: number; y: number } {
  return {
    x: (p.lng - scene.origin.lng) * 111_320 * Math.cos((scene.origin.lat * Math.PI) / 180),
    y: (p.lat - scene.origin.lat) * 110_574,
  };
}

// ---------- Colour: the day sheet blends into the night sheet ----------
type RGB = readonly [number, number, number];
const DAY = {
  ground: [230, 240, 253], building: [255, 255, 255], line: [11, 31, 58], shadow: [11, 31, 58],
  deck: [30, 79, 168], good: [30, 79, 168], bad: [217, 130, 0], ink: [11, 31, 58], halo: [238, 246, 255],
} satisfies Record<string, RGB>;
const NIGHT = {
  ground: [13, 36, 66], building: [18, 48, 90], line: [214, 232, 251], shadow: [3, 10, 22],
  deck: [124, 196, 245], good: [124, 196, 245], bad: [245, 165, 36], ink: [238, 246, 255], halo: [13, 36, 66],
} satisfies Record<string, RGB>;
const mix = (a: RGB, b: RGB, t: number, alpha = 1) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)} ${Math.round(a[1] + (b[1] - a[1]) * t)} ${Math.round(a[2] + (b[2] - a[2]) * t)} / ${alpha})`;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** How dark the sheet is for a sun altitude: 0 by day, 1 once the sun is well down. */
export const nightFor = (altitude: number) => 1 - smooth(-6, 3, altitude);

function trace(ctx: CanvasRenderingContext2D, pts: ArrayLike<number>, X: (x: number) => number, Y: (y: number) => number) {
  ctx.moveTo(X(pts[0]!), Y(pts[1]!));
  for (let j = 2; j < pts.length; j += 2) ctx.lineTo(X(pts[j]!), Y(pts[j + 1]!));
}

/** Draw one frame. `w`/`h` are CSS pixels; the context is already scaled for the device. */
export function drawPlan(ctx: CanvasRenderingContext2D, P: PreparedScene, f: PlanFrame, w: number, h: number): void {
  const { cam, sun } = f;
  const n = clamp01(f.night);
  const s = cam.scale;
  const X = (x: number) => w / 2 + (x - cam.cx) * s;
  const Y = (y: number) => h / 2 - (y - cam.cy) * s;
  // The part of the world in view.
  const vx0 = cam.cx - w / 2 / s, vx1 = cam.cx + w / 2 / s;
  const vy0 = cam.cy - h / 2 / s, vy1 = cam.cy + h / 2 / s;

  ctx.fillStyle = mix(DAY.ground, NIGHT.ground, n);
  ctx.fillRect(0, 0, w, h);

  // Street centre lines, as a surveyor draws them: long dash, dot.
  ctx.lineWidth = 1;
  ctx.strokeStyle = mix(DAY.line, NIGHT.line, n, 0.3);
  ctx.setLineDash([14, 5, 2, 5]);
  ctx.beginPath();
  for (const r of P.roads) trace(ctx, r, X, Y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Shadows: every swept footprint in one path, filled once, so overlapping
  // shadows do not add up to a darker patch. All pieces wind the same way.
  if (sun.altitude > 0.5) {
    const d = shadowDirection(sun);
    const fade = smooth(0.5, 7, sun.altitude);
    ctx.fillStyle = mix(DAY.shadow, NIGHT.shadow, n, 0.3 * fade * (1 - n * 0.6));
    ctx.beginPath();
    const count = P.rings.length;
    for (let i = 0; i < count; i++) {
      const l1 = shadowLength(P.h[i]!, sun.altitude);
      const ox = d.x * l1, oy = d.y * l1;
      const b = i * 4;
      // Skip buildings whose shadow cannot reach the view.
      if (Math.max(P.boxes[b + 2]!, P.boxes[b + 2]! + ox) < vx0 || Math.min(P.boxes[b]!, P.boxes[b]! + ox) > vx1) continue;
      if (Math.max(P.boxes[b + 3]!, P.boxes[b + 3]! + oy) < vy0 || Math.min(P.boxes[b + 1]!, P.boxes[b + 1]! + oy) > vy1) continue;
      const l0 = P.minH[i]! > 0 ? shadowLength(P.minH[i]!, sun.altitude) : 0;
      const nx = d.x * l0, ny = d.y * l0;
      const r = P.rings[i]!;
      const ccw = P.turn[i]! > 0;
      // The far footprint, counter-clockwise.
      if (ccw) {
        ctx.moveTo(X(r[0]! + ox), Y(r[1]! + oy));
        for (let j = 2; j < r.length; j += 2) ctx.lineTo(X(r[j]! + ox), Y(r[j + 1]! + oy));
      } else {
        const last = r.length - 2;
        ctx.moveTo(X(r[last]! + ox), Y(r[last + 1]! + oy));
        for (let j = last - 2; j >= 0; j -= 2) ctx.lineTo(X(r[j]! + ox), Y(r[j + 1]! + oy));
      }
      ctx.closePath();
      // One quad per wall, turned counter-clockwise too.
      const vx = ox - nx, vy = oy - ny;
      for (let j = 0; j + 3 < r.length; j += 2) {
        const ax = r[j]! + nx, ay = r[j + 1]! + ny, bx = r[j + 2]! + nx, by = r[j + 3]! + ny;
        const cross = (bx - ax) * vy - (by - ay) * vx;
        if (cross === 0) continue;
        if (cross > 0) {
          ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx), Y(by)); ctx.lineTo(X(bx + vx), Y(by + vy)); ctx.lineTo(X(ax + vx), Y(ay + vy));
        } else {
          ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(ax + vx), Y(ay + vy)); ctx.lineTo(X(bx + vx), Y(by + vy)); ctx.lineTo(X(bx), Y(by));
        }
        ctx.closePath();
      }
    }
    ctx.fill('nonzero');
  }

  // Elevated decks (BTS, skywalks): permanent shade, drawn as tinted bands.
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  for (const dk of P.decks) {
    ctx.strokeStyle = mix(DAY.deck, NIGHT.deck, n, dk.kind === 'foot' ? 0.26 : 0.16);
    ctx.lineWidth = Math.max(2, dk.w * s);
    ctx.beginPath();
    trace(ctx, dk.line, X, Y);
    ctx.stroke();
  }

  // Tree crowns.
  const T = P.scene.trees;
  ctx.fillStyle = mix(DAY.deck, NIGHT.deck, n, 0.14);
  ctx.beginPath();
  for (let i = 0; i < T.length; i += 3) {
    const x = T[i]!, y = T[i + 1]!;
    if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
    const r = Math.max(1.2, T[i + 2]! * s);
    ctx.moveTo(X(x) + r, Y(y));
    ctx.arc(X(x), Y(y), r, 0, Math.PI * 2);
  }
  ctx.fill();

  // Buildings: white footprints, hairline outlines.
  ctx.fillStyle = mix(DAY.building, NIGHT.building, n);
  ctx.strokeStyle = mix(DAY.line, NIGHT.line, n, 0.55 - n * 0.2);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < P.rings.length; i++) {
    const b = i * 4;
    if (P.boxes[b + 2]! < vx0 || P.boxes[b]! > vx1 || P.boxes[b + 3]! < vy0 || P.boxes[b + 1]! > vy1) continue;
    trace(ctx, P.rings[i]!, X, Y);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();

  // Night layers: cameras as small squares, lamps as amber points.
  const show = clamp01(f.points ?? n) * n;
  if (show > 0.02) {
    const C = P.scene.cctv;
    ctx.fillStyle = mix(NIGHT.good, NIGHT.good, 0, 0.85 * show);
    const half = Math.max(1.2, Math.min(2.4, s * 2.2));
    for (let i = 0; i < C.length; i += 2) {
      const x = C[i]!, y = C[i + 1]!;
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      ctx.fillRect(X(x) - half, Y(y) - half, half * 2, half * 2);
    }
    const Lp = P.scene.lamps;
    ctx.fillStyle = mix(NIGHT.bad, NIGHT.bad, 0, show);
    ctx.beginPath();
    for (let i = 0; i < Lp.length; i += 2) {
      ctx.moveTo(X(Lp[i]!) + 3, Y(Lp[i + 1]!));
      ctx.arc(X(Lp[i]!), Y(Lp[i + 1]!), 3, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // Routes, plotted along their length.
  const progress = clamp01(f.progress ?? 1);
  const halo = mix(DAY.halo, NIGHT.halo, n);
  if (f.alt && progress > 0) {
    ctx.lineCap = 'butt';
    ctx.setLineDash([7, 6]);
    strokeRoute(ctx, f.alt, progress, X, Y, () => mix(DAY.ink, NIGHT.ink, n, 0.75), 2.2, halo, 5);
    ctx.setLineDash([]);
  }
  if (f.main && progress > 0) {
    ctx.lineCap = 'round';
    // By day the other stretches are sunlit (amber). At night they are the
    // lower-scoring ones: dashed pale ink, because amber belongs to the sun.
    const lowNight = n > 0.5 && f.sun.altitude <= 0;
    strokeRoute(ctx, f.main, progress, X, Y, (good) => (good ? mix(DAY.good, NIGHT.good, n) : lowNight ? mix(NIGHT.ink, NIGHT.ink, 0, 0.8) : mix(DAY.bad, NIGHT.bad, n)), 5, halo, 9, lowNight);
  }

  // End points with their names, as drawing annotations.
  ctx.font = `600 13px 'Bai Jamjuree', 'Noto Sans Thai', sans-serif`;
  ctx.textBaseline = 'middle';
  const ink = mix(DAY.ink, NIGHT.ink, n);
  for (const [pt, kind] of [[f.from, 'from'], [f.to, 'to']] as const) {
    if (!pt) continue;
    const x = X(pt.x), y = Y(pt.y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    ctx.fillStyle = kind === 'from' ? halo : ink;
    ctx.beginPath();
    if (kind === 'from') ctx.arc(x, y, 6, 0, Math.PI * 2);
    else ctx.rect(x - 6, y - 6, 12, 12);
    ctx.fill();
    ctx.stroke();
    if (!pt.label) continue;
    // A leader line up to the label; the label goes to the left when it
    // would run off the right edge of the sheet.
    const tw = ctx.measureText(pt.label).width;
    const flip = x + 34 + tw > w - 8;
    const dir = flip ? -1 : 1;
    const lx = x + 14 * dir, ly = y - 26;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 5 * dir, y - 6);
    ctx.lineTo(lx, ly);
    ctx.lineTo(lx + 8 * dir, ly);
    ctx.stroke();
    const tx = flip ? lx - 12 - tw : lx + 12;
    ctx.lineWidth = 4;
    ctx.strokeStyle = halo;
    ctx.lineJoin = 'round';
    ctx.strokeText(pt.label, tx, ly);
    ctx.fillStyle = ink;
    ctx.fillText(pt.label, tx, ly);
  }
}

function strokeRoute(
  ctx: CanvasRenderingContext2D,
  route: PlanRoute,
  progress: number,
  X: (x: number) => number,
  Y: (y: number) => number,
  colour: (good: boolean) => string,
  width: number,
  halo: string,
  haloWidth: number,
  dashOther = false,
) {
  const limit = route.lengthM * progress;
  // Two passes: the paper-coloured casing first, then the line itself.
  for (const pass of [0, 1] as const) {
    let walked = 0;
    for (const run of route.runs) {
      if (walked >= limit) break;
      const p = run.pts;
      ctx.beginPath();
      ctx.moveTo(X(p[0]!), Y(p[1]!));
      for (let j = 2; j < p.length; j += 2) {
        const seg = Math.hypot(p[j]! - p[j - 2]!, p[j + 1]! - p[j - 1]!);
        if (walked + seg > limit) {
          const t = seg > 0 ? (limit - walked) / seg : 0;
          ctx.lineTo(X(p[j - 2]! + (p[j]! - p[j - 2]!) * t), Y(p[j - 1]! + (p[j + 1]! - p[j - 1]!) * t));
          walked = limit;
          break;
        }
        ctx.lineTo(X(p[j]!), Y(p[j + 1]!));
        walked += seg;
      }
      ctx.lineWidth = pass ? width : haloWidth;
      ctx.strokeStyle = pass ? colour(run.good) : halo;
      const dashed = dashOther && pass === 1 && !run.good;
      if (dashed) {
        ctx.lineCap = 'butt';
        ctx.setLineDash([7, 6]);
        ctx.lineWidth = width - 1.5;
      }
      ctx.stroke();
      if (dashed) {
        ctx.setLineDash([]);
        ctx.lineCap = 'round';
      }
    }
  }
}

/** A camera that frames two points with room around them. */
export function frameCamera(a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number, fill = 0.5): Camera {
  const bw = Math.max(Math.abs(a.x - b.x), 160);
  const bh = Math.max(Math.abs(a.y - b.y), 160);
  const scale = Math.min(Math.max(Math.min((w * fill) / bw, (h * fill) / bh), 0.42), 1.5);
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, scale };
}
