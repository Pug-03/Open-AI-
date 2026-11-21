import type { Route, WalkMode } from '@walkwe/core';
import { useI18n } from '../../store/i18n.tsx';

export function RouteWhy({ route, shortest, mode }: { route: Route; shortest: Route; mode: WalkMode }) {
  const { t } = useI18n();
  const isShortest = route === shortest;
  const extra = Math.max(0, Math.round(route.lengthM) - Math.round(shortest.lengthM));
  const shade = Math.round(route.shadeShare * 100);
  const safety = (route.safetyScore ?? 0).toFixed(1);
  const summary =
    mode === 'day'
      ? isShortest
        ? t('route.why.dayShortest', { p: shade })
        : t('route.why.day', { p: shade, q: Math.round(shortest.shadeShare * 100), d: extra })
      : isShortest
        ? t('route.why.nightShortest', { s: safety })
        : t('route.why.night', { s: safety, b: (shortest.safetyScore ?? 0).toFixed(1), d: extra });

  return (
    <section className="why" aria-label={t('route.why.title')} data-testid="route-why">
      <h3 className="section-label">{t('route.why.title')}</h3>
      <p className="why-text">{summary}</p>
      <p className="small">{t('route.why.byRule')}</p>
    </section>
  );
}
