import type { CSSProperties } from 'react';
import { Share2 } from 'lucide-react';
import { copy, type CopyKey } from '../../landingCopy.ts';
import type { NavSession } from '../../nav/session.ts';
import { useI18n } from '../../store/i18n.tsx';
import { formatDistance } from '../../utils/format.ts';
import { useToast } from '../ui.tsx';

/**
 * What the walk came to, shown on arrival: distance, time taken, the share in
 * shade (day) or the night score, and how that compares with the shortest
 * way. Figures come from the planned route; only the time is measured.
 */
export function WalkSummary({ session, arrivedAt }: { session: NavSession; arrivedAt: number }) {
  const { lang } = useI18n();
  const toast = useToast();
  const c = (k: CopyKey, v?: Record<string, string | number>) => copy(lang, k, v);
  const { route, baseline } = session;
  const night = session.mode === 'night';
  const minutes = Math.max(1, Math.round((arrivedAt - session.startedAt) / 60_000));
  const planned = Math.max(1, Math.round(route.durationS / 60));
  const shade = Math.round(route.shadeShare * 100);
  const score = route.safetyScore ?? 0;
  const extra = baseline ? route.lengthM - baseline.lengthM : 0;
  const gain = baseline ? (night ? Math.round((score - (baseline.safetyScore ?? 0)) * 10) / 10 : shade - Math.round(baseline.shadeShare * 100)) : 0;
  const versus = !baseline
    ? null
    : extra < 10 && gain <= 0
      ? c('sum.vsSame')
      : night
        ? c('sum.vsScore', { s: gain.toFixed(1), d: formatDistance(Math.max(0, extra), lang) })
        : c('sum.vsShade', { p: gain, d: formatDistance(Math.max(0, extra), lang) });

  const share = async () => {
    const text = c(night ? 'sum.shareTextNight' : 'sum.shareText', {
      to: session.destinationName ? (lang === 'th' ? session.destinationName : session.destinationName) : '',
      d: formatDistance(route.lengthM, lang),
      n: minutes,
      p: shade,
    });
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast(c('sum.copied'));
      }
    } catch {
      /* the share sheet was closed: nothing to do */
    }
  };

  return (
    <section className="summary" aria-labelledby="summary-title" data-testid="walk-summary">
      <h2 className="h3" id="summary-title">
        {c('sum.title')}
      </h2>
      <dl className="summary-rows">
        <div>
          <dt>{c('sum.dist')}</dt>
          <dd className="fig">{formatDistance(route.lengthM, lang)}</dd>
        </div>
        <div>
          <dt>
            {c('sum.time')}
            <span className="summary-sub">{c('sum.plan', { n: planned })}</span>
          </dt>
          <dd className="fig">{c('sum.min', { n: minutes })}</dd>
        </div>
        <div className="summary-score">
          <dt>{c(night ? 'sum.score' : 'sum.shade')}</dt>
          <dd className="fig">{night ? `${score.toFixed(1)}/10` : `${shade}%`}</dd>
          <span className="summary-meter" aria-hidden="true" style={{ '--v': night ? score / 10 : route.shadeShare } as CSSProperties}>
            <i />
          </span>
        </div>
        {versus && (
          <div className="summary-vs">
            <dt>{c('sum.vs')}</dt>
            <dd>{versus}</dd>
          </div>
        )}
      </dl>
      {!night && <p className="small">{c('sum.estimate')}</p>}
      <button type="button" className="btn btn--ghost" onClick={() => void share()} data-testid="summary-share">
        <Share2 size={20} aria-hidden="true" />
        {c('sum.share')}
      </button>
    </section>
  );
}
