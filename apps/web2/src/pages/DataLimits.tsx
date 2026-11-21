import { useGo } from '../utils/transition.ts';
import { useEffect, useState } from 'react';
import { ArrowLeft, Phone } from 'lucide-react';
import { activeCity } from '@walkwe/config';
import { SkeletonRows } from '../components/ui.tsx';
import type { StringKey } from '../i18n.ts';
import type { DatasetMeta, LayerInfo } from '../routing/protocol.ts';
import { routing } from '../services.ts';
import { LangToggle } from '../components/LangToggle.tsx';
import { useI18n } from '../store/i18n.tsx';
import { copy } from '../landingCopy.ts';

/** "ODbL-1.0 Attribution …" → code "ODbL-1.0" + the rest; free text stays whole. */
function splitLicense(license: string): { code: string; rest: string } {
  const m = /^([A-Za-z]+(?:-[A-Za-z]+)*-\d[\d.]*)\s*(.*)$/s.exec(license);
  return m ? { code: m[1]!, rest: m[2]! } : { code: license, rest: '' };
}

/**
 * "Data limitations" (brief §7): every layer with its source, license, update
 * date and what it can't tell you. Reachable from the planner and results.
 */
export default function DataLimits() {
  const { t, lang } = useI18n();
  const nav = useGo();
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  useEffect(() => {
    routing.warm().then(setMeta, () => {});
  }, []);

  const pct = (x: number) => Math.round(x * 100);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  const limit = (l: LayerInfo, m: DatasetMeta) => {
    const key = `data.limit.${l.id}` as StringKey;
    if (l.id === 'buildings') return t(key, { p: pct(m.estimatedHeightShare) });
    if (l.id === 'malls') return t(key, { a: m.malls.withHours, b: m.malls.total });
    if (l.id === 'lamps') return t(key, { p: pct(1 - m.litKnownShare) });
    return t(key);
  };
  // Which layer shows a source's full terms: the first one that lists it.
  const firstSeen = new Map<string, string>();
  for (const l of meta?.layers ?? []) for (const src of l.sources) if (!firstSeen.has(src.name)) firstSeen.set(src.name, l.id);
  const police = activeCity.emergencyNumbers.find((n) => n.id === 'police');

  return (
    <main className="data-page page-enter">
      <div className="page-side">
        <header className="data-head">
          <button
            type="button"
            className="icon-btn"
            onClick={() => (history.length > 1 ? nav(-1) : nav('/plan'))}
            aria-label={t('common.back')}
          >
            <ArrowLeft size={22} aria-hidden="true" />
          </button>
          <h1 className="h2">{t('data.title')}</h1>
          <LangToggle />
        </header>
        <p className="sub">{t('data.intro')}</p>
        {police && (
          <a className="btn btn--ghost btn--fit call-chip" href={`tel:${police.number}`}>
            <Phone size={20} aria-hidden="true" />
            {police.label[lang]} {police.number}
          </a>
        )}
      </div>
      <div className="page-body">
        {/* How the routes are worked out, before the list of what the data cannot say. */}
        <section className="method" aria-labelledby="method-title">
          <h2 className="h2" id="method-title">
            {copy(lang, 'method.pageTitle')}
          </h2>
          <h3 className="h3">{copy(lang, 'method.day')}</h3>
          <p className="sub">{copy(lang, 'method.p1')}</p>
          <p className="sub">{copy(lang, 'method.p2')}</p>
          <p className="method-formula">{copy(lang, 'method.formula')}</p>
          <h3 className="h3">{copy(lang, 'method.night')}</h3>
          <p className="sub">{copy(lang, 'method.nightP')}</p>
          <h2 className="h2 method-next">{copy(lang, 'method.layers')}</h2>
        </section>
        {!meta ? (
          <div className="data-list">
            <SkeletonRows count={5} label={t('data.loading')} />
          </div>
        ) : (
          <ul className="list data-list data-sheet">
            {meta.layers.map((l) => (
              <li key={l.id} className="data-item" data-testid={`layer-${l.id}`}>
                <h2 className="h3">{t(`data.layer.${l.id}` as StringKey)}</h2>
                <p className="small">{limit(l, meta)}</p>
                {l.id === 'incidents' && meta.incidents.placeholders > 0 && (
                  <p className="small route-warn">{t('data.placeholders', { n: meta.incidents.placeholders })}</p>
                )}
                <p className="small data-meta">
                  {t('data.count', {
                    n: Math.round(l.count).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB'),
                  })}{' '}
                  · {t('data.updated', { date: date(l.updatedAt) })}
                </p>
                <ul className="data-sources">
                  {/* Licence code on every layer; the long attribution text and
                      notes only the first time a source appears, so OSM's terms
                      aren't repeated eight times. Notes carry caveats (BMA CCTV). */}
                  {l.sources.map((s) => {
                    const { code, rest } = splitLicense(s.license);
                    const first = firstSeen.get(s.name) === l.id;
                    // Licence caveats (the BMA's "permission required") always show. The team's
                    // own to-do notes in the data file ("re-check before launch", "placeholder") do not.
                    const note = !s.notes || /placeholder|todo/i.test(s.notes) ? '' : s.notes.replace(/;?\s*re-?check before launch\.?/i, '.');
                    const extra = first ? [rest, note].filter(Boolean).join(' ') : '';
                    return (
                      <li key={s.name} className="small">
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.name}
                        </a>{' '}
                        — {code}
                        {extra && <span className="data-notes"> {extra}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
