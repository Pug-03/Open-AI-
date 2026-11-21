import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AgenticIntent, AgenticPlan, AgenticRequest, RoutePreference } from '../../agentic.ts';
import { receiveIntent, reviewRoute } from '../../agentic.ts';
import { env } from '../../env.ts';
import { useI18n } from '../../store/i18n.tsx';
import { AgenticProgress, type AgenticProgressStages } from './AgenticProgress.tsx';

export function AgenticAsk({ onDraft }: { onDraft: (draft: AgenticIntent) => void }) {
  const { lang } = useI18n();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'ready' | 'failed' | 'unknown'>('idle');
  const [source, setSource] = useState<AgenticIntent['source']>();
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  if (!env.voiceProxyUrl) return null;
  const th = lang === 'th';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = text.trim();
    if (request.length < 2 || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setStatus('busy');
    setSource(undefined);
    try {
      const draft = await receiveIntent(request, lang, controller.signal);
      if (controller.signal.aborted) return;
      if (draft.from || draft.to) {
        onDraft(draft);
        setSource(draft.source);
        setStatus('ready');
      } else setStatus('unknown');
    } catch {
      if (!controller.signal.aborted) setStatus('failed');
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }

  return (
    <form className="why" onSubmit={submit} data-testid="agentic-ask">
      <label className="section-label" htmlFor="agentic-trip-text">{th ? 'บอกเส้นทางเป็นประโยค' : 'Describe your walk'}</label>
      <textarea id="agentic-trip-text" className="input" rows={2} maxLength={300} value={text}
        disabled={status === 'busy'} onChange={event => { setText(event.target.value); setStatus('idle'); }}
        placeholder={th ? 'เช่น จาก BTS สยาม ไปเซ็นทรัลเวิลด์ ตอนสองทุ่ม' : 'e.g. BTS Siam to CentralWorld at 8 pm'} />
      <button className="btn btn--ghost" type="submit" disabled={status === 'busy' || text.trim().length < 2}>
        {th ? 'เติมข้อมูลทริป' : 'Fill trip details'}
      </button>
      {status !== 'idle' && <p className="small" role="status">
        {status === 'busy' ? (th ? 'กำลังอ่านคำขอ…' : 'Reading your request…')
          : status === 'ready' ? (th ? 'ตรวจสถานที่และเวลา แล้วกดดูเส้นทาง' : 'Check the places and time, then tap See routes.')
          : status === 'unknown' ? (th ? 'ลองใช้ชื่อสถานที่ในพื้นที่สยาม หรือเลือกบนแผนที่' : 'Try a public landmark in Siam or pick a place on the map.')
          : (th ? 'อ่านคำขอไม่ได้ตอนนี้ เลือกสถานที่เองได้เลย' : 'Trip parsing is unavailable. Pick your places on the map.')}
      </p>}
      {status === 'ready' && source && <p className="small">
        {source === 'system' ? (th ? 'แอปจับชื่อสถานที่จากข้อความ' : 'Walk We matched places from your text.')
          : (th ? 'AI ช่วยแยกสถานที่ เวลา และข้อจำกัดจากคำขอ' : 'AI extracted places, time and constraints from your request.')}
      </p>}
    </form>
  );
}

export function AgenticReview({ request }: { request: AgenticRequest }) {
  const th = request.language === 'th';
  const [result, setResult] = useState<AgenticPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [change, setChange] = useState<{ previousUnknown?: number } | null>(null);
  const [stages, setStages] = useState<AgenticProgressStages>({});
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  if (!env.voiceProxyUrl) return null;

  async function analyse(preference?: RoutePreference) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFailed(false);
    setStages({});
    try {
      const assessed = await reviewRoute({ ...request, preference }, controller.signal, ({ stage, state }) => {
        if (!controller.signal.aborted) setStages(previous => ({ ...previous, [stage]: state }));
      });
      if (controller.signal.aborted) return;
      setResult(assessed);
      if (assessed.status === 'ok') {
        const critic = assessed.trace?.filter(entry => entry.step === 'critic').at(-1);
        setStages(previous => ({
          ...previous,
          routes: 'done',
          evidence: 'done',
          review: assessed.source === 'verified_planner' ? 'done' : 'fallback',
          ...(critic?.passed != null ? { critique: critic.passed ? 'done' : 'fallback' } : {}),
        }));
      }
      if (preference && result?.status === 'ok' && assessed.status === 'ok'
        && result.datasetVersion === assessed.datasetVersion && result.recommendedId !== assessed.recommendedId) {
        const priorRoute = result.routes?.find(candidate => candidate.id === result.recommendedId);
        setChange({ previousUnknown: priorRoute?.unknown });
      } else setChange(null);
      if (preference) setAnswered(true);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const route = result?.status === 'ok' ? result.routes?.find(candidate => candidate.id === result.recommendedId) : undefined;
  const lang = request.language;
  const meters = (value: number) => `${Math.round(value).toLocaleString(lang)} ${th ? 'ม.' : 'm'}`;
  return (
    <section className="why" aria-labelledby="agentic-review-title" data-testid="agentic-review">
      <h3 id="agentic-review-title" className="section-label">{th ? 'ตรวจหลักฐานของทริป' : 'Review trip evidence'}</h3>
      <p className="small">{th
        ? 'Walk We เทียบทางตามเวลาออกเดิน AI ช่วยอ่านหลักฐานเมื่อเปิดใช้งาน คุณยังเป็นคนเลือกทางบนแผนที่'
        : 'Walk We compares routes at your departure time. When enabled, AI helps review the evidence. You choose the route on the map.'}</p>
      {!result && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void analyse()}>
        {th ? 'ตรวจหลักฐาน' : 'Review evidence'}
      </button>}
      {(busy || failed || result) && <AgenticProgress lang={lang} stages={stages} busy={busy}
        source={!failed && result?.status === 'ok' ? result.source : undefined}
        failed={failed || (!!result && result.status !== 'ok')} />}
      {busy && !Object.keys(stages).length && <p className="small" role="status">
        {th ? 'กำลังขอข้อมูลเส้นทาง…' : 'Requesting route data…'}
      </p>}
      {failed && <p className="small" role="status">{th ? 'ตรวจไม่สำเร็จ ยังใช้เส้นทางบนแผนที่ได้' : 'Review unavailable. You can still use the routes on the map.'}</p>}
      {!busy && result && (result.status === 'ok' ? (
        <>
          {change && <p className="small" role="status">{th
            ? 'ข้อเสนอเปลี่ยนตามสมมติฐานเรื่องไฟที่คุณเลือก'
            : 'The suggestion changed with your choice about unverified lighting.'}</p>}
          <p className="why-text" aria-live="polite">{result.text}</p>
          <p className="small">{result.source === 'verified_planner'
            ? (th ? 'ข้อเสนอ AI ผ่านการตรวจหลักฐาน' : 'AI proposal checked against route evidence')
            : (th ? 'ผลจากตัวคำนวณเส้นทาง' : 'Result from the routing engine')}</p>
          {route && <dl className="agentic-route-metrics">
            <div><dt>{th ? 'ระยะประมาณ' : 'Approx. distance'}</dt><dd>{meters(route.meters)}</dd></div>
            {request.mode === 'night' ? <>
              <div><dt>{th ? 'มีข้อมูลว่ามีไฟ' : 'Mapped as lit'}</dt><dd>{meters(route.lit)}</dd></div>
              <div>
                <dt>{th ? 'ไฟยังไม่ทราบ' : 'Lighting unverified'}</dt>
                <dd>{meters(route.unknown)}</dd>
                {change?.previousUnknown != null && <dd className="agentic-route-previous">
                  {th ? 'ทางก่อนหน้า ' : 'Previously '}{meters(change.previousUnknown)}
                </dd>}
              </div>
            </> : route.sunMinutes != null && <div><dt>{th ? 'คาดว่าโดนแดด' : 'Estimated sun'}</dt>
              <dd>{route.sunMinutes} {th ? 'นาที' : 'min'}</dd></div>}
          </dl>}
          {result.clarification && !answered && (
            <>
              <p className="small">{result.clarification.text}</p>
              {result.clarification.options.map(option => (
                <button key={option.value} className="btn btn--ghost" type="button" disabled={busy} onClick={() => void analyse(option.value)}>
                  {option.label}
                </button>
              ))}
            </>
          )}
          {result.evidenceIds.length > 0 && (
            <details>
              <summary>{th ? 'รหัสช่วงทางที่ใช้ตรวจ' : 'Evidence segment IDs'}</summary>
              <p className="small">{result.evidenceIds.join(', ')}</p>
            </details>
          )}
        </>
      ) : <p className="small" role="status">{th ? 'ข้อมูลไม่พอสำหรับตรวจทริปนี้' : 'There is too little evidence to review this trip.'}</p>)}
    </section>
  );
}
