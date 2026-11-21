import { useEffect, useRef, useState } from 'react';
import type { RouteEvidenceSegment } from '@walkwe/core';
import { createResearchClientTool } from '../../../../../packages/voice-research/src/browser.mjs';
import { useI18n } from '../../store/i18n.tsx';
import { formatDistance } from '../../utils/format.ts';

export function ResearchSegment({ proxyUrl, datasetVersion, segments }: {
  proxyUrl: string;
  datasetVersion: string;
  segments: readonly RouteEvidenceSegment[];
}) {
  const { lang, t } = useI18n();
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const capability = useRef('');
  useEffect(() => () => active.current?.abort(), []);

  const options: { id: string; name: string; offset: number }[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const segment of segments) {
    if (segment.light === 'unknown' && segment.name && segment.id.startsWith('edge:') && !seen.has(segment.id)) {
      options.push({ id: segment.id, name: segment.name, offset });
      seen.add(segment.id);
    }
    offset += segment.length;
  }
  if (!options.length) return null;

  const search = async () => {
    if (!options.some(option => option.id === selected) || busy) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    capability.current ||= crypto.randomUUID();
    setStatus('');
    setBusy(true);
    const researchSegment = createResearchClientTool({
      getSelectedSegmentId: () => selected,
      getDatasetVersion: () => datasetVersion,
      announce(text) {
        if (controller.signal.aborted) return;
        setStatus(text);
        setBusy(false);
      },
      signal: controller.signal,
      language: lang,
      async proxyFetch(path, init) {
        const headers = new Headers(init?.headers);
        headers.set('x-walkwe-research-session', capability.current);
        return fetch(`${proxyUrl}${String(path)}`, { ...init, headers, credentials: 'omit' });
      },
    });
    const result: { status: string; speak_text: string } = JSON.parse(await researchSegment());
    if (controller.signal.aborted) return;
    setStatus(result.speak_text);
    if (result.status !== 'started') setBusy(false);
  };

  return (
    <div className="field" data-testid="research-segment">
      <label>
        {t('research.segment')}
        <select value={selected} onChange={(event) => {
          active.current?.abort();
          setSelected(event.target.value);
          setStatus('');
          setBusy(false);
        }}>
          <option value="">{t('research.choose')}</option>
          {options.map(({ id, name, offset }) => (
            <option key={id} value={id}>{t('research.option', { name, distance: formatDistance(offset, lang) })}</option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn--ghost" onClick={() => void search()} disabled={!selected || busy}>
        {t('research.start')}
      </button>
      <p className="small" role="status">{status}</p>
    </div>
  );
}
