import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { LatLng } from '@walkwe/core';
import { copy, type CopyKey } from '../landingCopy.ts';
import type { HourShade } from '../routing/protocol.ts';
import { routing } from '../services.ts';
import { useI18n } from '../store/i18n.tsx';
import { useSeen } from '../utils/useViewProgress.ts';

// "When is this walk shadiest?": the same trip planned again for every hour
// of today by the routing worker, drawn as one bar per hour. Used on the
// welcome page (sample trip) and in the planner (the user's own trip).

const HOUR = 3_600_000;
const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

/** Each listed hour of today in Bangkok (UTC+7, no DST) as an instant. */
function todayHours(): Date[] {
  const bkk = new Date(Date.now() + 7 * HOUR);
  return HOURS.map((h) => new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), h - 7)));
}

interface Props {
  from: LatLng;
  to: LatLng;
  stepFree?: boolean;
  /** Tapping a bar (planner: leave at that hour). */
  onPick?: (at: Date) => void;
}

export function BestTime({ from, to, stepFree, onPick }: Props) {
  const { lang } = useI18n();
  const c = (k: CopyKey, v?: Record<string, string | number>) => copy(lang, k, v);
  const [hours, setHours] = useState<HourShade[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [ref, seen] = useSeen<HTMLDivElement>(0.9);
  const [done, setDone] = useState(false);
  const key = `${from.lat},${from.lng},${to.lat},${to.lng},${stepFree ? 1 : 0}`;

  useEffect(() => {
    let live = true;
    setHours(null);
    setFailed(false);
    setDone(false);
    // Thirteen routes are only worth computing once the chart is on screen.
    if (!seen) return;
    const times = todayHours();
    // One hour per request, so a route the user asks for meanwhile is never
    // stuck behind the whole chart, and the bars appear as they are computed.
    void (async () => {
      const got: HourShade[] = [];
      for (const at of times) {
        try {
          const [h] = await routing.hourly({ from, to, departAt: at, mode: 'day', ...(stepFree ? { stepFree } : {}) }, [at]);
          if (!live) return;
          if (h) got.push(h);
          setHours([...got]);
        } catch {
          if (live) setFailed(true);
          return;
        }
      }
      if (live) setDone(true);
    })();
    return () => {
      live = false;
    };
  }, [key, seen]); // eslint-disable-line react-hooks/exhaustive-deps

  const { best, worst } = useMemo(() => {
    const lit = (hours ?? []).filter((h) => h.shade != null && h.sunAltitude > 3);
    if (!lit.length) return { best: null, worst: null };
    return {
      best: lit.reduce((a, b) => (b.shade! > a.shade! ? b : a)),
      worst: lit.reduce((a, b) => (b.shade! < a.shade! ? b : a)),
    };
  }, [hours]);

  const hh = (iso: string) => String((new Date(iso).getUTCHours() + 7) % 24).padStart(2, '0');
  const pct = (x: number | null) => Math.round((x ?? 0) * 100);

  if (failed) return <p className="small">{c('best.failed')}</p>;

  return (
    <div ref={ref} className={`best${seen ? ' is-in' : ''}`}>
      <div className="best-chart" role={onPick ? 'group' : 'img'} aria-label={c('best.chart')}>
        <div className="best-axis" aria-hidden="true">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <ol className="best-bars">
          {HOURS.map((h, i) => {
            const d = hours?.[i];
            const has = d?.shade != null;
            const isBest = done && !!best && d === best;
            const label = has ? c('best.bar', { t: `${String(h).padStart(2, '0')}:00`, p: pct(d!.shade), q: pct(d!.shortestShade) }) : `${String(h).padStart(2, '0')}:00`;
            const style = { '--v': has ? d!.shade : 0, '--alt': has ? (d!.shortestShade ?? 0) : 0 } as CSSProperties;
            const inner = (
              <>
                <span className="best-col" aria-hidden="true">
                  <i className="best-bar" />
                  {has && <i className="best-alt" />}
                </span>
                <span className="best-hour" aria-hidden="true">
                  {String(h).padStart(2, '0')}
                </span>
              </>
            );
            return (
              <li key={h} className={`${isBest ? 'is-best' : ''}${d && !has ? ' is-empty' : ''}${has ? ' has-bar' : ''}`} style={style}>
                {onPick && has ? (
                  <button type="button" onClick={() => onPick(new Date(d!.at))} aria-label={label} data-testid={`best-${h}`}>
                    {inner}
                  </button>
                ) : (
                  <span title={label}>{inner}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="best-legend">
        <span>
          <i className="key key--good" aria-hidden="true" />
          {c('best.legendMain')}
        </span>
        <span>
          <i className="key key--tick" aria-hidden="true" />
          {c('best.legendAlt')}
        </span>
      </p>
      <p className="best-result" role="status">
        {!done ? (
          c('best.loading')
        ) : best && worst ? (
          <>
            <strong>{c('best.best', { t: `${hh(best.at)}:00`, p: pct(best.shade) })}</strong>
            {worst !== best && <span>{c('best.worst', { t: `${hh(worst.at)}:00`, p: pct(worst.shade) })}</span>}
          </>
        ) : null}
      </p>
    </div>
  );
}
