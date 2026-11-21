import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { sosAlertId, updateSosRelay } from '../../sos/relay.ts';
import { useI18n } from '../../store/i18n.tsx';

type State = 'loading' | 'ready' | 'busy' | 'acknowledged' | 'unavailable';

export function SosRelayReceipt() {
  const { lang } = useI18n();
  const [params] = useSearchParams();
  const id = sosAlertId.safeParse(params.get('id')).data;
  const th = lang === 'th';
  const [state, setState] = useState<State>('loading');
  const submitting = useRef(false);
  useEffect(() => {
    let active = true;
    if (!id) {
      setState('unavailable');
      return;
    }
    setState('loading');
    void updateSosRelay({ action: 'status', id }).then(({ status, canAcknowledge }) => {
      if (!active) return;
      if (status === 'acknowledged' && canAcknowledge) setState('acknowledged');
      else if (canAcknowledge && ['sending', 'provider_accepted', 'delivery_unknown'].includes(status)) setState('ready');
      else setState('unavailable');
    });
    return () => { active = false; };
  }, [id]);

  const acknowledge = async () => {
    if (!id || state !== 'ready' || submitting.current) return;
    submitting.current = true;
    setState('busy');
    const { status } = await updateSosRelay({ action: 'acknowledge', id });
    setState(status === 'acknowledged' ? 'acknowledged' : 'unavailable');
    submitting.current = false;
  };
  return (
    <main className="sos-overlay sos-overlay--send" aria-labelledby="sos-relay-title">
      <h1 className="h2 sos-send-title" id="sos-relay-title">{th ? 'คำขอช่วยเหลือจาก Walk We' : 'Walk We help request'}</h1>
      {(state === 'loading' || state === 'busy') && <p role="status">{th ? 'กำลังตรวจสอบ' : 'Checking…'}</p>}
      {state === 'ready' && (
        <button type="button" className="btn sos-action" onClick={(event) => {
          if (event.isTrusted) void acknowledge();
        }}>
          {th ? 'ยืนยันว่าได้รับข้อความ' : 'Confirm I received this message'}
        </button>
      )}
      {state === 'acknowledged' && <p role="status">{th ? 'ส่งการยืนยันให้ผู้ขอความช่วยเหลือแล้ว' : 'Your receipt was confirmed to the sender.'}</p>}
      {state === 'unavailable' && <p role="status">{th ? 'เปิดคำขอนี้ไม่ได้ กรุณาใช้บัญชีที่ได้รับข้อความ' : 'This request is unavailable. Use the account that received the message.'}</p>}
      <Link className="btn btn--ghost" to="/plan">{th ? 'เปิด Walk We' : 'Open Walk We'}</Link>
    </main>
  );
}
