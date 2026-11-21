import { useEffect, useRef, useState } from 'react';
import { copy, type CopyKey } from '../../landingCopy.ts';
import type { DatasetMeta } from '../../routing/protocol.ts';
import { routing } from '../../services.ts';
import { useI18n } from '../../store/i18n.tsx';
import { useSeen, useViewProgress } from '../../utils/useViewProgress.ts';
import { TRIPS } from '../plan-view/demo.ts';
import { PlanCanvas, type PlanCanvasHandle } from '../plan-view/PlanCanvas.tsx';
import { frameCamera, toPlanPoint, toPlanRoute, type PlanRoute, type PreparedScene } from '../plan-view/planDraw.ts';
import { Plot } from './Plot.tsx';

// The same plan after dark: the real camera positions come up as the section
// scrolls in, then the safer route is plotted along its length.

const HOUR = 3_600_000;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function NightSection({ prepared, meta, trip }: { prepared: PreparedScene | null; meta: DatasetMeta | null; trip: number }) {
  const { lang } = useI18n();
  const c = (k: CopyKey, v?: Record<string, string | number>) => copy(lang, k, v);
  const [ref, seen] = useSeen<HTMLElement>();
  const canvas = useRef<PlanCanvasHandle>(null);
  const p = useViewProgress(ref);
  const [routes, setRoutes] = useState<{ main: PlanRoute; alt: PlanRoute | null } | null>(null);
  const info = TRIPS[trip]!;

  useEffect(() => {
    if (!seen || !prepared) return;
    let live = true;
    setRoutes(null);
    // 21:00 today, Bangkok.
    const bkk = new Date(Date.now() + 7 * HOUR);
    const at = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), 21 - 7));
    routing.route({ from: info.from, to: info.to, departAt: at, mode: 'night' }).then(
      (res) => {
        if (!live) return;
        const shortest = res.routes.find((r) => r.kinds.includes('shortest')) ?? res.routes[0]!;
        const best = res.routes.reduce((a, b) => ((b.safetyScore ?? 0) > (a.safetyScore ?? 0) ? b : a));
        setRoutes({
          main: toPlanRoute(best, prepared.scene, (run) => (run.safety ?? 0) >= 0.5),
          alt: best === shortest ? null : toPlanRoute(shortest, prepared.scene, () => true),
        });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [seen, prepared, trip]); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = () => {
    const h = canvas.current;
    if (!seen || !h || !prepared) return;
    const { w, h: hh } = h.size();
    if (!w) return;
    const a = toPlanPoint(info.from, prepared.scene);
    const b = toPlanPoint(info.to, prepared.scene);
    const cam = frameCamera(a, b, w, hh, 0.46);
    // A slow drift across the plan as the section passes.
    cam.cy += (p - 0.5) * 90;
    cam.scale *= 0.94 + p * 0.14;
    h.draw({
      cam,
      sun: { altitude: -30, azimuth: 300 },
      night: 1,
      points: clamp01((p - 0.12) / 0.25),
      main: routes?.main ?? null,
      alt: routes?.alt ?? null,
      progress: clamp01((p - 0.28) / 0.3),
      from: { ...a, label: info.from[lang] },
      to: { ...b, label: info.to[lang] },
    });
  };
  useEffect(draw); // every render: p, routes, language

  const count = (id: 'cctv' | 'pois') => (meta?.layers.find((l) => l.id === id)?.count ?? 0).toLocaleString();
  const rows: Array<[CopyKey, string]> = [
    ['night.f1', c('night.f1d', { n: count('pois') })],
    ['night.f2', c('night.f2d', { n: count('cctv') })],
    ['night.f3', c('night.f3d', { p: Math.round((meta?.litKnownShare ?? 0) * 100) })],
    ['night.f4', meta && meta.incidents.placeholders > 0 ? `${c('night.f4d')} ${c('night.sample', { n: meta.incidents.placeholders })}` : c('night.f4d')],
  ];

  return (
    <section ref={ref} id="night" className="lp-night" data-theme="night" aria-labelledby="night-title">
      <div className="lp-night-plan">
        <PlanCanvas ref={canvas} scene={prepared} className="lp-night-canvas" label={c('night.planLabel')} onResize={draw} />
        <p className="lp-night-legend">
          <i className="key key--cctv" aria-hidden="true" />
          {c('night.legend')}
        </p>
      </div>
      <div className="lp-night-text">
        <Plot as="h2" className="lp-h2">
          <span id="night-title">{c('night.title')}</span>
          <small>{c('night.qualifier')}</small>
        </Plot>
        <Plot as="p" className="lp-p" delay={80}>
          {c('night.p')}
        </Plot>
        <dl className="lp-defs">
          {rows.map(([k, d], i) => (
            <Plot key={k} className="lp-def" delay={120 + i * 70}>
              <dt>{c(k)}</dt>
              <dd>{meta || k === 'night.f4' ? d : c('data.loading')}</dd>
            </Plot>
          ))}
        </dl>
      </div>
    </section>
  );
}
