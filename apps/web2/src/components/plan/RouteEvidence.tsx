import { useEffect, useRef, useState } from 'react';
import type { Route, WalkMode } from '@walkwe/core';
import { env } from '../../env.ts';
import { ResearchSegment } from './ResearchSegment.tsx';
import { useI18n } from '../../store/i18n.tsx';
import { evidenceKinds, groupEvidence, type EvidenceRow } from './routeEvidence.ts';

export function RouteEvidence({ route, shortest, mode, datasetVersion }: { route: Route; shortest: Route; mode: WalkMode; datasetVersion?: string | undefined }) {
  const { t } = useI18n();
  const selected = route.evidence ?? [];
  const rows = groupEvidence(selected, shortest === route ? [] : shortest.evidence ?? [], mode);
  const candidates = evidenceKinds.flatMap(kind => rows
    .filter(row => row.kind === kind)
    .sort((a, b) => b.length - a.length)
    .slice(0, 4));
  const defaults = evidenceKinds.flatMap(kind => candidates.find(row => row.kind === kind) ?? []);
  const [picked, setPicked] = useState<number[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'fallback'>('idle');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  if (!rows.length) return null;
  const unknown = Math.round(selected.reduce((sum, edge) => sum + (edge.light === 'unknown' ? edge.length : 0), 0));
  const tagged = Math.round(selected.reduce((sum, edge) => sum + (edge.light === 'lit' ? edge.length : 0), 0));

  const analyse = async () => {
    if (!env.voiceProxyUrl || pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setStatus('pending');
    try {
      const response = await fetch(`${env.voiceProxyUrl}/route-evidence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, candidates: candidates.map(({ kind, reason, length }, id) => ({
          id, kind, reason, meters: Math.max(1, Math.min(5000, Math.round(length))),
        })) }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) throw new Error('route evidence unavailable');
      const { ids } = await response.json();
      if (!Array.isArray(ids) || ids.length !== defaults.length || !ids.every(id => Number.isInteger(id) && candidates[id])
        || new Set(ids.map(id => candidates[id]!.kind)).size !== defaults.length) {
        throw new Error('invalid evidence selection');
      }
      if (!request.signal.aborted) setPicked(ids);
    } catch {
      if (!request.signal.aborted) setStatus('fallback');
    } finally {
      pending.current = null;
      if (!request.signal.aborted) setStatus(current => current === 'pending' ? 'idle' : current);
    }
  };

  const list = (items: EvidenceRow[]) => (
    <ul className="route-evidence-list">
      {items.map(row => (
        <li key={`${row.kind}:${row.offset}`}>
          <strong>{t(`evidence.kind.${row.kind}`)}</strong>
          {' · '}{row.name || t('evidence.unnamed')} {' · '}
          {t(`evidence.reason.${row.reason}`, { m: Math.round(row.length) })}
          {row.offset >= 10 && <span className="small"> {t('evidence.offset', { m: Math.round(row.offset) })}</span>}
        </li>
      ))}
    </ul>
  );

  return (
    <section className="why" data-testid="route-evidence" aria-label={t('evidence.title')}>
      <h3 className="section-label">{t('evidence.title')}</h3>
      {mode === 'night' && <p className="why-text">{t('evidence.lightSummary', { tagged, unknown })}</p>}
      {list(picked ? picked.map(id => candidates[id]!) : defaults)}
      <details>
        <summary>{t('evidence.details')}</summary>
        {list(rows)}
      </details>
      <p className="small">{t(mode === 'night' ? 'evidence.nightSource' : 'evidence.daySource')}</p>
      {env.voiceProxyUrl && (
        <button type="button" className="btn btn--ghost" onClick={() => void analyse()} disabled={status === 'pending' || picked !== null}>
          {t(status === 'pending' ? 'evidence.ranking' : picked ? 'evidence.ranked' : 'evidence.rank')}
        </button>
      )}
      {status === 'fallback' && <p className="small" role="status">{t('evidence.fallback')}</p>}
      {mode === 'night' && env.voiceProxyUrl && datasetVersion && (
        <ResearchSegment key={datasetVersion} proxyUrl={env.voiceProxyUrl} datasetVersion={datasetVersion} segments={selected} />
      )}
    </section>
  );
}
