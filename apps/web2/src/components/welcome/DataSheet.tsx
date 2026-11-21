import { ArrowRight } from 'lucide-react';
import type { StringKey } from '../../i18n.ts';
import { copy, type CopyKey } from '../../landingCopy.ts';
import type { DatasetMeta } from '../../routing/protocol.ts';
import { useI18n } from '../../store/i18n.tsx';
import { TLink } from '../TLink.tsx';
import { Plot } from './Plot.tsx';

/** Thai names for the dataset's sources (the data file names them in English). */
const SOURCE_TH: Array<[RegExp, string]> = [
  [/^Walk We height rules/, 'กฎประมาณความสูงของ Walk We'],
  [/^Bangkok Metropolitan Administration GIS portal/, 'พอร์ทัล GIS กรุงเทพมหานคร (ชั้นข้อมูลกล้อง CCTV)'],
  [/^Walk We incident register/, 'ทะเบียนเหตุการณ์ของ Walk We'],
];

/** The dataset the app runs on, as a schedule: layer, count, source, date. */
export function DataSheet({ meta }: { meta: DatasetMeta | null }) {
  const { lang, t } = useI18n();
  const c = (k: CopyKey, v?: Record<string, string | number>) => copy(lang, k, v);
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const pct = (x: number) => Math.round(x * 100);
  const sourceName = (name: string) => {
    const th = lang === 'th' ? SOURCE_TH.find(([re]) => re.test(name))?.[1] : undefined;
    return th ?? name.split(' (')[0]!.replace(' contributors', '');
  };
  return (
    <section id="data" className="lp-section lp-data" aria-labelledby="data-title">
      <div className="lp-text">
        <Plot as="h2" className="lp-h2">
          <span id="data-title">{c('data.title')}</span>
        </Plot>
        <Plot as="p" className="lp-p" delay={80}>
          {c('data.p')}
        </Plot>
        {meta && (
          <ul className="lp-limits">
            <Plot as="li" delay={120}>
              {c('data.limit1', { p: pct(meta.estimatedHeightShare) })}
            </Plot>
            <Plot as="li" delay={180}>
              {c('data.limit2', { p: pct(meta.litKnownShare) })}
            </Plot>
            <Plot as="li" delay={240}>
              {c('data.limit3')}
            </Plot>
          </ul>
        )}
        <TLink to="/data" className="btn btn--ghost lp-more" data-testid="landing-data">
          {c('data.more')}
          <ArrowRight size={20} aria-hidden="true" className="btn-arrow" />
        </TLink>
      </div>
      <div className="lp-table-wrap">
        <table className="lp-table">
          <thead>
            <tr>
              <th scope="col">{c('data.layer')}</th>
              <th scope="col" className="num">
                {c('data.count')}
              </th>
              <th scope="col">{c('data.source')}</th>
              <th scope="col">{c('data.updated')}</th>
            </tr>
          </thead>
          <tbody>
            {meta ? (
              meta.layers.filter((l) => l.id !== 'incidents').map((l, i) => (
                <Plot as="tr" key={l.id} delay={i * 50}>
                  <th scope="row">
                    {t(`data.layer.${l.id}` as StringKey)}
                  </th>
                  <td className="num fig">{l.count.toLocaleString()}</td>
                  <td>{[...new Set(l.sources.map((s) => sourceName(s.name)))].join(', ')}</td>
                  <td className="nowrap">{date(l.updatedAt)}</td>
                </Plot>
              ))
            ) : (
              <tr>
                <td colSpan={4}>{c('data.loading')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
