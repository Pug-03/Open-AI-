import { useRef } from 'react';
import { copy, type CopyKey } from '../../landingCopy.ts';
import { useI18n } from '../../store/i18n.tsx';
import { useViewProgress } from '../../utils/useViewProgress.ts';
import { Plot } from './Plot.tsx';

// The rule behind every shadow on the plan, as a section drawing. Scrolling
// raises the sun; the shadow shortens by h / tan(altitude) and the walker on
// the far pavement steps out of the shade when it no longer reaches.

const H_M = 30; // building height
const PX = 7; // drawing scale, px per metre
const GROUND = 350;
const WALL = 470;
const WALKER_M = 18; // distance from the wall to the walker
const RAD = Math.PI / 180;

export function SunSection() {
  const { lang } = useI18n();
  const c = (k: CopyKey, v?: Record<string, string | number>) => copy(lang, k, v);
  const ref = useRef<HTMLElement>(null);
  const p = useViewProgress(ref);
  const t = Math.min(1, Math.max(0, (p - 0.22) / 0.5));
  const alt = 16 + (t * t * (3 - 2 * t)) * 60;
  const lenM = H_M / Math.tan(alt * RAD);
  const top = GROUND - H_M * PX;
  const tip = WALL - lenM * PX;
  const tipX = Math.max(tip, 24);
  const shaded = lenM >= WALKER_M;
  const walkerX = WALL - WALKER_M * PX;
  const R = 200;
  const sun = { x: WALL + R * Math.cos(alt * RAD), y: top - R * Math.sin(alt * RAD) };
  // Angle arc at the shadow's tip (only while the tip is on the sheet).
  const arcR = 44;
  const arc = `M${tipX + arcR} ${GROUND} A${arcR} ${arcR} 0 0 0 ${tipX + arcR * Math.cos(alt * RAD)} ${GROUND - arcR * Math.sin(alt * RAD)}`;

  return (
    <section ref={ref} id="method" className="lp-section lp-method" aria-labelledby="method-title">
      <div className="lp-text">
        <Plot as="h2" className="lp-h2">
          <span id="method-title">{c('method.title')}</span>
        </Plot>
        <Plot as="p" className="lp-p" delay={80}>
          {c('method.p1')}
        </Plot>
        <Plot as="p" className="lp-p" delay={140}>
          {c('method.p2')}
        </Plot>
        <Plot as="p" className="lp-formula" delay={200}>
          {c('method.formula')}
        </Plot>
      </div>
      <figure className="lp-diagram">
        <svg viewBox="0 -90 720 520" role="img" aria-label={c('method.diagram')}>
          {/* Sun and its limiting ray over the roof edge. */}
          <line x1={sun.x} y1={sun.y} x2={tipX} y2={tip < 24 ? GROUND - (24 - tip) * Math.tan(alt * RAD) : GROUND} className="dg-ray" />
          <g transform={`translate(${sun.x} ${sun.y})`} className="dg-sun">
            <circle r="15" />
            {Array.from({ length: 8 }, (_, i) => (
              <line key={i} x1="0" y1="-21" x2="0" y2="-28" transform={`rotate(${i * 45})`} />
            ))}
          </g>
          {/* The shaded volume and the shadow on the ground. */}
          <polygon points={`${WALL},${top} ${WALL},${GROUND} ${tipX},${GROUND} ${tipX},${tip < 24 ? GROUND - (24 - tip) * Math.tan(alt * RAD) : GROUND}`} className="dg-volume" />
          <rect x={tipX} y={GROUND} width={WALL - tipX} height="12" className="dg-shadow" />
          {/* Ground, kerbs, building. */}
          <line x1="24" y1={GROUND} x2="696" y2={GROUND} className="dg-ground" />
          <rect x={WALL} y={top} width="130" height={H_M * PX} className="dg-building" />
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} x1={WALL} y1={top + 23 * (i + 1)} x2={WALL + 130} y2={top + 23 * (i + 1)} className="dg-floor" />
          ))}
          {/* Height dimension. */}
          <g className="dg-dim">
            <line x1="632" y1={top} x2="632" y2={GROUND} />
            <line x1="624" y1={top} x2="640" y2={top} />
            <line x1="624" y1={GROUND} x2="640" y2={GROUND} />
            <text x="700" y={top - 16} textAnchor="end">
              {c('method.h', { h: H_M })}
            </text>
          </g>
          {/* Shadow length dimension. */}
          <g className="dg-dim">
            <line x1={tipX} y1="388" x2={WALL} y2="388" />
            <line x1={tipX} y1="380" x2={tipX} y2="396" />
            <line x1={WALL} y1="380" x2={WALL} y2="396" />
            <text x={Math.max((tipX + WALL) / 2, 130)} y="420" textAnchor="middle" className="dg-strong">
              {c('method.len', { l: lenM.toFixed(1) })}
            </text>
          </g>
          {tip >= 24 && (
            <g className="dg-dim">
              <path d={arc} fill="none" />
              <text x={tipX + arcR + 8} y={GROUND - 12}>{c('method.angle', { a: Math.round(alt) })}</text>
            </g>
          )}
          {tip < 24 && (
            <text x="30" y={GROUND - 12} className="dg-dim dg-text">
              {c('method.angle', { a: Math.round(alt) })}
            </text>
          )}
          {/* The walker on the far pavement. */}
          <g transform={`translate(${walkerX} ${GROUND})`} className={`dg-walker${shaded ? ' is-shaded' : ''}`}>
            <circle cx="0" cy="-44" r="6.5" />
            <path d="M0 -37 L0 -17 M0 -17 L-7 0 M0 -17 L7 0 M-8 -27 L0 -32 L8 -25" />
            <text x="0" y="-62" textAnchor="middle">
              {c(shaded ? 'method.inShade' : 'method.inSun')}
            </text>
          </g>
        </svg>
        <figcaption>{c('method.hint')}</figcaption>
      </figure>
    </section>
  );
}
