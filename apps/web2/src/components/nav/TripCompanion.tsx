import { useEffect, useRef, useState } from 'react';
import { modeForTime } from '@walkwe/core';
import { checkCompanion, companionStateSchema, type CompanionEvent, type CompanionState } from '../../agentic.ts';
import { stepClosed, type NavSession } from '../../nav/session.ts';
import { useI18n } from '../../store/i18n.tsx';
import { readJson, writeJson } from '../../utils/storage.ts';

const localText = {
  closing: { th: 'ตามเวลาเปิดปิดที่มี ทางช่วงนี้อาจปิดแล้ว ตรวจที่ทางเข้าก่อนเดินต่อ',
    en: 'The opening hours suggest this passage may be closed. Check at the entrance.' },
  nightfall: { th: 'ตอนนี้เข้าสู่ช่วงกลางคืนแล้ว คุณกลับไปเทียบเส้นทางด้วยข้อมูลไฟได้',
    en: 'It is now night. You can return to the planner to compare lighting data.' },
  unknown: { th: 'เส้นทางนี้มีช่วงที่ยังไม่ทราบสถานะไฟ', en: 'Lighting is unverified on parts of this route.' },
  rain: { th: 'มีรายงานฝน ลองตรวจสภาพทางเดินก่อนเดินต่อ', en: 'Rain was reported. Check the path conditions before continuing.' },
};

export function TripCompanion({ session, online, replan }: { session: NavSession; online: boolean; replan: () => void }) {
  const { lang, t } = useI18n();
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [notice, setNotice] = useState<{ event: CompanionEvent; replan: boolean } | null>(null);
  const key = `ww_companion:${session.id}`;
  const [initial] = useState(() => {
    try {
      const saved = companionStateSchema.safeParse(readJson(sessionStorage, key));
      return saved.success ? saved.data : null;
    }
    catch { return null; }
  });
  const state = useRef<CompanionState>(initial ?? { warnings: 0, handled: [] });

  useEffect(() => {
    const timer = setInterval(() => setCheckedAt(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state.current.warnings >= 2) return;
    const step = session.steps[session.index];
    if (!step || step.step.maneuver === 'arrive') return;
    const at = new Date(Math.max(checkedAt, Date.now()));
    const unknown = Math.min(5000, Math.round(session.route.evidence?.reduce((total, segment) =>
      total + (segment.light === 'unknown' ? segment.length : 0), 0) ?? 0));
    const conditions: [CompanionEvent, boolean][] = [
      ['closing', stepClosed(step, at)],
      ['nightfall', session.mode === 'day' && modeForTime(new Date(session.startedAt), session.steps[0]!.at) === 'day'
        && modeForTime(at, step.at) === 'night'],
      ['unknown', session.mode === 'night' && unknown > 0],
    ];
    const event = conditions.find(([name, triggered]) => triggered && !state.current.handled.includes(name))?.[0];
    if (!event) return;
    const controller = new AbortController();
    const before = state.current;
    async function respond(event: CompanionEvent) {
      const fallback = event === 'unknown' ? 'warn' : 'offer_replan';
      let action: 'silent' | 'warn' | 'offer_replan' = fallback;
      if (online) {
        try { action = (await checkCompanion(event, unknown, lang, before, controller.signal)).action; }
        catch { /* Use the local event when the proxy is unavailable. */ }
      }
      if (controller.signal.aborted) return;
      state.current = { warnings: before.warnings + (action === 'silent' ? 0 : 1), handled: [...before.handled, event] };
      try { writeJson(sessionStorage, key, state.current); }
      catch { /* Keep the current walk state in memory if session storage is disabled. */ }
      if (action !== 'silent') setNotice({ event, replan: action === 'offer_replan' });
    }
    void respond(event);
    return () => controller.abort();
  }, [checkedAt, key, lang, online, session]);

  if (!notice) return null;
  return (
    <aside className="why">
      <p role="status">{localText[notice.event][lang]}</p>
      {notice.replan && <button type="button" className="btn btn--ghost" onClick={replan}>
        {lang === 'th' ? 'กลับไปวางแผน' : 'Back to planner'}
      </button>}
      <button type="button" className="btn btn--text" onClick={() => setNotice(null)}>{t('common.close')}</button>
    </aside>
  );
}
