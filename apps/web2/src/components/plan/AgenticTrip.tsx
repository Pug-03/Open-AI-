import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AgenticIntent, AgenticPlan, AgenticRequest, RoutePreference } from '../../agentic.ts';
import { receiveIntent, reviewRoute } from '../../agentic.ts';
import { env } from '../../env.ts';
import { useI18n } from '../../store/i18n.tsx';

export function AgenticAsk({ onDraft }: { onDraft: (draft: AgenticIntent) => void }) {
  const { lang } = useI18n();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'ready' | 'failed' | 'unknown'>('idle');
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
    try {
      const draft = await receiveIntent(request, lang, controller.signal);
      if (controller.signal.aborted) return;
      if (draft.from || draft.to) {
        onDraft(draft);
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
    </form>
  );
}

export function AgenticReview({ request }: { request: AgenticRequest }) {
  const th = request.language === 'th';
  const [result, setResult] = useState<AgenticPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [answered, setAnswered] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  if (!env.voiceProxyUrl) return null;

  async function analyse(preference?: RoutePreference) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      const assessed = await reviewRoute({ ...request, preference }, controller.signal);
      if (controller.signal.aborted) return;
      setResult(assessed);
      if (preference) setAnswered(true);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="why" aria-labelledby="agentic-review-title" data-testid="agentic-review">
      <h3 id="agentic-review-title" className="section-label">{th ? 'ตรวจหลักฐานของทริป' : 'Review trip evidence'}</h3>
      <p className="small">{th
        ? 'คำนวณจากกราฟของสถานที่สาธารณะตามเวลาออกเดินที่เลือก โดยคงเส้นทางที่คุณเลือกไว้บนแผนที่'
        : 'Uses the public landmark graph at your chosen departure time. Your map selection stays in place.'}</p>
      {!result && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void analyse()}>
        {th ? 'ตรวจหลักฐาน' : 'Review evidence'}
      </button>}
      {busy && <p className="small" role="status">{th ? 'กำลังตรวจหลักฐาน…' : 'Checking route evidence…'}</p>}
      {failed && <p className="small" role="status">{th ? 'ตรวจไม่สำเร็จ ยังใช้เส้นทางบนแผนที่ได้' : 'Review unavailable. You can still use the routes on the map.'}</p>}
      {result && (result.status === 'ok' ? (
        <>
          <p className="why-text" aria-live="polite">{result.text}</p>
          <p className="small">{result.source === 'verified_planner'
            ? (th ? 'ข้อเสนอ AI ผ่านการตรวจหลักฐาน' : 'AI proposal checked against route evidence')
            : (th ? 'ผลจากตัวคำนวณเส้นทาง' : 'Result from the routing engine')}</p>
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
          {(result.evidenceIds.length > 0 || !!result.trace?.length) && (
            <details>
              <summary>{th ? 'หลักฐานและขั้นตอนตรวจ' : 'Evidence and checks'}</summary>
              {result.evidenceIds.length > 0 && <p className="small">{result.evidenceIds.join(', ')}</p>}
              {result.trace?.length ? <ol>
                {result.trace.map(({ step, status, passed }, index) =>
                  <li key={index}>{step}{status ? ` · ${status}` : ''}{passed == null ? '' : passed ? ' ✓' : ' ✕'}</li>)}
              </ol> : null}
            </details>
          )}
        </>
      ) : <p className="small" role="status">{th ? 'ข้อมูลไม่พอสำหรับตรวจทริปนี้' : 'There is too little evidence to review this trip.'}</p>)}
    </section>
  );
}
