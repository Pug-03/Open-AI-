import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { solarNoon, sunPosition } from '@walkwe/core';
import { copy, type CopyKey } from '../../landingCopy.ts';
import { useI18n } from '../../store/i18n.tsx';
import { LogoMark } from '../Logo.tsx';
import { cycleFor, DAY_END_U, timeAt, uAt } from '../plan-view/dayCycle.ts';
import { DemoCache, SIAM, slotFor, TRIPS, type DemoRoutes } from '../plan-view/demo.ts';
import { PlanCanvas, type PlanCanvasHandle } from '../plan-view/PlanCanvas.tsx';
import { frameCamera, nightFor, toPlanPoint, type Camera, type PreparedScene } from '../plan-view/planDraw.ts';

// The first screen: the shadow plan held in place while the page scrolls.
// Scrolling turns the clock through one whole day (the time bar is the same
// control, draggable); the drawing follows the scroll with a little lag so it
// glides. Past sunset the sheet turns to navy and the night layers come up.

type Phase = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night';
interface View {
  clock: string;
  alt: number;
  az: number;
  night: boolean;
  phase: Phase;
  routes: DemoRoutes | null;
  /** Position on the day loop, 0..1. */
  u: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const HOUR = 3_600_000;
const TICK_HOURS = [6, 9, 12, 15, 18, 21, 0, 3];

function sceneProgress(el: HTMLElement | null): number {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  const run = r.height - window.innerHeight;
  return run > 0 ? clamp01(-r.top / run) : 0;
}

/** Where the route should sit: the part of the stage the panels leave free. */
function cameraFor(w: number, h: number, hero: number, a: { x: number; y: number }, b: { x: number; y: number }): Camera {
  const desktop = w >= 960;
  const l = desktop ? 48 : 16;
  const t = desktop ? 104 : 124;
  const r = desktop ? w - 400 : w - 16;
  const bottomPanel = desktop ? 150 + (Math.min(520, h * 0.58) - 150) * hero : 270 + (Math.max(270, Math.min(h * 0.46, 380)) - 270) * hero;
  const bm = h - bottomPanel;
  const cam = frameCamera(a, b, r - l, Math.max(120, bm - t), desktop ? 0.56 + 0.2 * hero : 0.7);
  cam.cx -= ((l + r) / 2 - w / 2) / cam.scale;
  cam.cy += ((t + bm) / 2 - h / 2) / cam.scale;
  return cam;
}

interface Props {
  prepared: PreparedScene | null;
  failed: boolean;
  trip: number;
  onTrip: (i: number) => void;
  onStart: () => void;
  /** Tells the page when the sheet turns to night (its top strip follows). */
  onNight?: (night: boolean) => void;
}

export function ShadowStage({ prepared, failed, trip, onTrip, onStart, onNight }: Props) {
  const { lang } = useI18n();
  const c = (k: CopyKey, v?: Record<string, string | number>) => copy(lang, k, v);
  const sceneEl = useRef<HTMLElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const handleEl = useRef<HTMLDivElement>(null);
  const canvas = useRef<PlanCanvasHandle>(null);
  const cycle = useMemo(() => cycleFor(new Date(), SIAM), []);
  const u0 = useMemo(() => uAt(cycle, new Date()), [cycle]);
  const clock = useMemo(
    () => new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }),
    [lang],
  );
  const noon = useMemo(() => solarNoon(new Date(), SIAM).getTime(), []);
  const [view, setView] = useState<View>(() => {
    const sun = sunPosition(new Date(), SIAM);
    return { clock: '', alt: sun.altitude, az: sun.azimuth, night: nightFor(sun.altitude) > 0.5, phase: 'morning', routes: null, u: u0 };
  });
  const [dragging, setDragging] = useState(false);
  useEffect(() => onNight?.(view.night), [view.night]); // eslint-disable-line react-hooks/exhaustive-deps
  const wake = useRef<() => void>(() => {});
  const tripInfo = TRIPS[trip]!;

  useEffect(() => {
    const P = prepared;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const a = P ? toPlanPoint(tripInfo.from, P.scene) : { x: 0, y: 0 };
    const b = P ? toPlanPoint(tripInfo.to, P.scene) : { x: 0, y: 0 };
    // The clock sweeps in from a little earlier, so the first thing seen is shadows moving.
    const s = { cur: still ? u0 : u0 - 0.07, cam: null as Camera | null, progress: still ? 1 : 0, key: '' };
    let frame = 0;
    const cache = P ? new DemoCache(tripInfo, P.scene, cycle, () => wake.current()) : null;
    void cache?.fill(slotFor(u0));

    const tick = () => {
      frame = 0;
      const p = sceneProgress(sceneEl.current);
      const target = u0 + p * 0.985;
      s.cur += (target - s.cur) * (still ? 1 : 0.085);
      if (Math.abs(target - s.cur) < 0.0002) s.cur = target;
      const at = timeAt(cycle, s.cur);
      const sun = sunPosition(at, SIAM);
      const night = nightFor(sun.altitude);
      const routes = cache?.at(slotFor(s.cur)) ?? null;
      const hero = 1 - clamp01(p * 7);
      const size = canvas.current?.size() ?? { w: 0, h: 0 };
      let moving = false;
      if (P && size.w) {
        const goal = cameraFor(size.w, size.h, hero, a, b);
        if (!s.cam) s.cam = goal;
        else {
          const k = still ? 1 : 0.1;
          s.cam.cx += (goal.cx - s.cam.cx) * k;
          s.cam.cy += (goal.cy - s.cam.cy) * k;
          s.cam.scale += (goal.scale - s.cam.scale) * k;
          moving = Math.abs(goal.cx - s.cam.cx) + Math.abs(goal.cy - s.cam.cy) > 0.3 || Math.abs(goal.scale - s.cam.scale) > 0.002;
        }
        if (routes && s.progress < 1) s.progress = still ? 1 : Math.min(1, s.progress + 0.022);
        canvas.current?.draw({
          cam: s.cam,
          sun,
          night,
          main: routes?.main ?? null,
          alt: routes?.alt ?? null,
          progress: 1 - (1 - s.progress) ** 3,
          from: { ...a, label: tripInfo.from[lang] },
          to: { ...b, label: tripInfo.to[lang] },
        });
        stageEl.current?.style.setProperty('--scale-px', `${(100 * s.cam.scale).toFixed(1)}px`);
      }
      stageEl.current?.style.setProperty('--hero', hero.toFixed(3));
      stageEl.current?.classList.toggle('is-past', hero < 0.4);
      const v = ((s.cur % 1) + 1) % 1;
      if (handleEl.current) handleEl.current.style.left = `${(v * 100).toFixed(2)}%`;

      // Hours from solar noon, -12..12.
      const fromNoon = ((((at.getTime() - noon) / HOUR) % 24) + 36) % 24 - 12;
      const phase: Phase =
        night > 0.5 ? 'night'
        : sun.altitude < 9 ? (fromNoon < 0 ? 'dawn' : 'dusk')
        : Math.abs(fromNoon) < 0.9 ? 'noon'
        : fromNoon < 0 ? 'morning' : 'afternoon';
      const text = clock.format(at);
      const key = `${text}|${phase}|${night > 0.5}|${routes ? `${routes.mode}${routes.mainFigures.metres}${routes.mainFigures.score.toFixed(3)}${routes.altFigures?.metres ?? ''}` : ''}`;
      if (key !== s.key) {
        s.key = key;
        setView({ clock: text, alt: sun.altitude, az: sun.azimuth, night: night > 0.5, phase, routes, u: v });
      }
      if (s.cur !== target || moving || (routes && s.progress < 1)) frame = requestAnimationFrame(tick);
    };
    wake.current = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    wake.current();
    window.addEventListener('scroll', wake.current, { passive: true });
    window.addEventListener('resize', wake.current);
    return () => {
      cache?.stop();
      window.removeEventListener('scroll', wake.current);
      window.removeEventListener('resize', wake.current);
      cancelAnimationFrame(frame);
      wake.current = () => {};
    };
  }, [prepared, trip, lang, cycle, u0, clock, noon]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- The time bar: the same control as scrolling ----------
  const scrollToU = (u: number, smooth = false) => {
    const el = sceneEl.current;
    if (!el) return;
    const p = ((((u - u0) % 1) + 1) % 1) / 0.985;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + Math.min(1, p) * (el.offsetHeight - window.innerHeight), behavior: smooth ? 'smooth' : 'auto' });
  };
  const uFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return clamp01((e.clientX - r.left) / r.width);
  };
  const onBarDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    scrollToU(uFromPointer(e));
  };
  const onBarMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) scrollToU(uFromPointer(e));
  };
  const onBarKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const el = sceneEl.current;
    if (el) window.scrollBy({ top: (step * (el.offsetHeight - window.innerHeight)) / 34 });
  };

  const ticks = useMemo(() => {
    const bkk = new Date(Date.now() + 7 * HOUR);
    return TICK_HOURS.map((h) => {
      const at = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), h - 7));
      return { h, u: uAt(cycle, at) };
    });
  }, [cycle]);

  const r = view.routes;
  const nightRoutes = r?.mode === 'night';
  const score = (x: number) => (nightRoutes ? `${x.toFixed(1)}/10` : `${Math.round(x * 100)}%`);
  const buildingCount = prepared?.scene.buildings.length ?? 0;

  return (
    <section ref={sceneEl} className="stage-scene" aria-label={c('hero.sheet')}>
      <div ref={stageEl} className={`stage${prepared ? ' is-ready' : ''}`} data-theme={view.night ? 'night' : 'day'}>
        <PlanCanvas ref={canvas} scene={prepared} className="stage-canvas" label={c('hero.planLabel')} onResize={() => wake.current()} />
        <div className="stage-grid" aria-hidden="true" />

        <svg className="stage-north" viewBox="0 0 40 56" role="img" aria-label={c('hero.north')}>
          <path d="M20 4 L31 40 L20 33 L9 40 Z" className="north-arrow" />
          <path d="M20 4 L20 33" className="north-line" />
          <text x="20" y="54" textAnchor="middle">
            N
          </text>
        </svg>

        {/* Where the light comes from now: an arrow on the sun's bearing. */}
        {view.alt > 0 && (
          <svg className="stage-sun" viewBox="-30 -30 60 60" role="img" aria-label={`${c('sun.dir')}: ${c('sun.az', { a: Math.round(view.az) })}`}>
            <g transform={`rotate(${view.az.toFixed(1)})`}>
              <circle cx="0" cy="-18" r="6" className="sun-disc" />
              <path d="M0 -10 L0 16 M-5 9 L0 17 L5 9" className="sun-ray" />
            </g>
          </svg>
        )}

        <div className="stage-trips" role="group" aria-label={c('read.trip')}>
          {TRIPS.map((t, i) => (
            <button key={t.id} type="button" aria-pressed={i === trip} onClick={() => onTrip(i)} data-testid={`trip-${t.id}`}>
              <span>{t.from[lang]}</span>
              <ArrowRight size={14} aria-hidden="true" />
              <span>{t.to[lang]}</span>
            </button>
          ))}
        </div>

        <aside className="readout" aria-label={c('read.title')}>
          <table>
            <thead>
              <tr>
                <th scope="col">{c('read.route')}</th>
                <th scope="col">{c('read.time')}</th>
                <th scope="col">{c('read.dist')}</th>
                <th scope="col">{nightRoutes ? c('read.score') : c('read.shade')}</th>
              </tr>
            </thead>
            <tbody>
              {r ? (
                <>
                  <tr className="is-main">
                    <th scope="row">
                      <i className="key key--good" aria-hidden="true" />
                      {nightRoutes ? c('read.safer') : c('read.shadiest')}
                    </th>
                    <td>{c('read.min', { n: r.mainFigures.minutes })}</td>
                    <td>{c('read.m', { n: r.mainFigures.metres.toLocaleString() })}</td>
                    <td className="fig">{score(r.mainFigures.score)}</td>
                  </tr>
                  {r.altFigures && (
                    <tr>
                      <th scope="row">
                        <i className="key key--alt" aria-hidden="true" />
                        {c('read.shortest')}
                      </th>
                      <td>{c('read.min', { n: r.altFigures.minutes })}</td>
                      <td>{c('read.m', { n: r.altFigures.metres.toLocaleString() })}</td>
                      <td className="fig">{score(r.altFigures.score)}</td>
                    </tr>
                  )}
                </>
              ) : (
                <tr>
                  <td colSpan={4} className="readout-wait">
                    {failed ? c('hero.failed') : c('read.computing')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {r && !r.altFigures && <p className="readout-note">{c('read.same')}</p>}
          {nightRoutes && <p className="readout-note">{c('read.nightNote')}</p>}
          <p className="readout-legend">
            <span>
              <i className="key key--good" aria-hidden="true" />
              {c(nightRoutes ? 'read.legendGoodNight' : 'read.legendGood')}
            </span>
            <span>
              <i className={`key ${nightRoutes ? 'key--low' : 'key--bad'}`} aria-hidden="true" />
              {c(nightRoutes ? 'read.legendBadNight' : 'read.legendBad')}
            </span>
          </p>
        </aside>

        {/* Title block: what a drawing carries in its corner, and the way in. */}
        <div className="titleblock">
          <div className="tb-row tb-brand">
            <span className="tb-mark">
              <LogoMark size={30} />
              <span className="tb-name">Walk We</span>
            </span>
            <span className="tb-sheet">{c('hero.sheet')}</span>
          </div>
          <div className="tb-row tb-main">
            <h1 className="tb-title">
              <span>{c('hero.title1')}</span> <span>{c('hero.title2')}</span> <small>{c('hero.qualifier')}</small>
            </h1>
            <p className="tb-sub">{prepared ? c('hero.sub', { n: buildingCount.toLocaleString() }) : failed ? c('hero.failed') : c('hero.subLoading')}</p>
            <div className="tb-actions">
              <button type="button" className="btn btn--primary" onClick={onStart} data-testid="landing-start">
                {c('hero.start')}
                <ArrowRight size={20} aria-hidden="true" className="btn-arrow" />
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  const el = sceneEl.current;
                  if (el) window.scrollBy({ top: (el.offsetHeight - window.innerHeight) * 0.3, behavior: 'smooth' });
                }}
                data-testid="landing-how"
              >
                <ArrowDown size={20} aria-hidden="true" />
                {c('hero.scrub')}
              </button>
            </div>
          </div>
          {/* Phones: the route's figures in one line, since the schedule is under this block. */}
          <p className="tb-row tb-figs">
            {r ? (
              <>
                <i className="key key--good" aria-hidden="true" />
                <span className="fig">
                  {nightRoutes ? c('read.safer') : c('read.shadiest')} {c('read.min', { n: r.mainFigures.minutes })} · {score(r.mainFigures.score)}
                </span>
                {r.altFigures && (
                  <>
                    <i className="key key--alt" aria-hidden="true" />
                    <span>
                      {c('read.shortest')} {c('read.min', { n: r.altFigures.minutes })} · {score(r.altFigures.score)}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span>{failed ? c('hero.failed') : c('read.computing')}</span>
            )}
          </p>
          <div className="tb-row tb-cells">
            <span>{c('hero.free')}</span>
            <span>{c('hero.pilot')}</span>
          </div>
        </div>

        {/* Once the title block has gone: the time and what the shadows are doing. */}
        <div className="caption" aria-hidden="true">
          <p className="caption-clock">
            <span className="fig">{view.clock}</span>
            <span className="caption-sun">
              {view.alt > 0 ? `${c('sun.alt', { a: Math.round(view.alt) })} · ${c('sun.az', { a: Math.round(view.az) })}` : c('sun.down')}
            </span>
          </p>
          <p className="caption-phase" key={view.phase}>
            {c(`phase.${view.phase}`)}
          </p>
        </div>

        <div className="stage-scale" aria-hidden="true">
          <i />
          <span>{c('hero.scale', { m: 100 })}</span>
        </div>

        <div
          className={`timebar${dragging ? ' is-dragging' : ''}`}
          role="slider"
          tabIndex={0}
          aria-label={c('time.bar')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.u * 100)}
          aria-valuetext={c('time.clock', { t: view.clock })}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onKeyDown={onBarKey}
        >
          <div className="timebar-track" style={{ '--day-end': `${DAY_END_U * 100}%` } as CSSProperties}>
            {ticks.map((t) => (
              <span key={t.h} className="timebar-tick" style={{ left: `${t.u * 100}%` }}>
                {String(t.h).padStart(2, '0')}
              </span>
            ))}
            {([['time.sunrise', cycle.sunrise], ['time.sunset', cycle.sunset]] as const).map(([k, at]) => (
              <span key={k} className="timebar-sun" style={{ left: `${uAt(cycle, at) * 100}%` }} title={`${c(k)} ${clock.format(at)}`} />
            ))}
            <span className="timebar-now" style={{ left: `${u0 * 100}%` }}>
              {c('time.now')}
            </span>
            <div ref={handleEl} className="timebar-handle" style={{ left: `${u0 * 100}%` }}>
              <span className="fig">{view.clock}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
