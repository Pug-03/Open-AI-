import { useEffect, useId, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { speechParts, type VoiceActions, type VoiceScreen, type VoiceToolName } from '@walkwe/core/voice';
import mascot from '../assets/walk-we-voice-mascot.webp';
import { env } from '../env.ts';
import { setAccess } from '../store/access.ts';
import { useI18n } from '../store/i18n.tsx';
import { useTheme } from '../store/theme.tsx';
import { OPEN_SOS_VOICE } from '../sos/controller.ts';
import { speakSequence, stopSpeaking } from '../utils/speak.ts';
import './live-voice.css';

const preferences = { avoid_stairs: 'stepFree', haptics: 'haptics', big_text: 'bigText', read_aloud: 'voice' } as const;
type Status = 'idle' | 'starting' | 'ready' | 'working' | 'drafting' | 'routing' | 'reviewing' | 'speaking' | 'failed' | 'unavailable';
const actionStatuses: Partial<Record<VoiceToolName, Status>> = {
  plan_trip: 'drafting', find_routes: 'routing', review_route: 'reviewing', answer_route_review: 'reviewing',
};

export function LiveVoice({ screen, actions, routeReady, awaitingReviewChoice }: {
  screen: VoiceScreen;
  actions: VoiceActions;
  routeReady?: boolean;
  awaitingReviewChoice?: boolean;
}) {
  const { t, lang } = useI18n();
  const { setPref } = useTheme();
  const [status, setStatus] = useState<Status>('idle');
  const statusId = useId();
  const [companion, setCompanion] = useState(false);
  const endAfterReply = useRef(false);
  const run = useRef<AbortController | null>(null);
  const actionsRef = useRef<VoiceActions>({});
  actionsRef.current = {
    ...actions,
    set_theme: ({ language, theme }) => {
      setPref(theme === 'light' ? 'day' : theme === 'dark' ? 'night' : 'auto');
      return speechParts(language, (locale) => locale === 'th' ? 'เปลี่ยนธีมแล้วครับ' : 'I changed the theme.');
    },
    set_preference: ({ language, preference, value }) => {
      setAccess({ [preferences[preference]]: value === 'on' });
      return speechParts(language, (locale) => locale === 'th' ? 'เปลี่ยนการตั้งค่าแล้วครับ การเลี่ยงบันไดจะใช้เมื่อวางแผนครั้งถัดไป' : 'I updated your settings. Stair preferences apply when you next plan a route.');
    },
    open_sos_sheet: ({ language }) => {
      const request = { opened: false };
      window.dispatchEvent(new CustomEvent(OPEN_SOS_VOICE, { detail: request }));
      if (!request.opened) return [];
      return speechParts(language, (locale) => locale === 'th' ? 'เปิดหน้าช่วยเหลือแล้วครับ กดเลือกการติดต่อที่ต้องการได้เลย' : 'The help screen is open. Choose how you want to get help.');
    },
  };
  if (screen === 'navigate') actionsRef.current.companion_call = ({ language, state }) => {
    setCompanion(state === 'start');
    endAfterReply.current = state === 'stop';
    return speechParts(language, (locale) => state === 'start'
      ? (locale === 'th' ? 'อยู่เป็นเพื่อนในแอปได้ครับ ระหว่างเปิดไมค์ถามเรื่องทางเดินได้เลย' : 'I can keep you company here. Ask about your walk while the microphone is on.')
      : (locale === 'th' ? 'ปิดไมค์ให้แล้วครับ' : 'I am turning off the microphone.'));
  };
  useEffect(() => () => run.current?.abort(), []);

  if (env.voiceProvider !== 'openai' || !env.voiceProxyUrl || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return null;
  const proxyUrl = env.voiceProxyUrl;
  const isActive = status !== 'idle' && status !== 'failed';
  const isWorking = status === 'drafting' || status === 'routing' || status === 'reviewing' || status === 'working';
  const awaiting = status === 'ready' && awaitingReviewChoice;
  const phase = isWorking ? 'working' : awaiting ? 'awaiting' : status;
  const description = awaiting ? 'awaiting' : status === 'ready' && companion ? 'companion' : status;
  const showExample = status === 'idle' || status === 'ready' || status === 'unavailable';
  const prompt = awaitingReviewChoice && showExample
    ? 'answer' : screen === 'plan' && routeReady ? 'results' : screen;

  const toggle = async () => {
    if (run.current) return run.current.abort();
    const ctl = new AbortController();
    run.current = ctl;
    setStatus('starting');
    stopSpeaking();
    try {
      const { runLiveVoice } = await import('../voice/live.ts');
      if (ctl.signal.aborted) return;
      await runLiveVoice({ proxyUrl, screen, lang, signal: ctl.signal, actions: () => actionsRef.current,
        ready: () => setStatus('ready'),
        working: (name) => setStatus(actionStatuses[name] ?? 'working'),
        unavailable: () => setStatus('unavailable'),
        speak: async (parts, signal, name) => {
          setStatus('speaking');
          await speakSequence(parts, { signal });
          if (endAfterReply.current || name === 'open_sos_sheet' || name === 'start_live_share') ctl.abort();
          if (!signal.aborted && !ctl.signal.aborted) setStatus('ready');
        },
      });
      setStatus('idle');
    } catch {
      setStatus(ctl.signal.aborted ? 'idle' : 'failed');
    } finally {
      endAfterReply.current = false;
      setCompanion(false);
      run.current = null;
    }
  };

  return (
    <section className="live-voice" data-testid="live-voice" data-voice-phase={phase} aria-label={t('voice.live.title')}>
      <span className="live-voice-avatar" aria-hidden="true">
        <img src={mascot} alt="" width={240} height={240} decoding="async" />
      </span>
      <div className="live-voice-copy">
        <p className="live-voice-title">{t('voice.live.title')}</p>
        <p className="small live-voice-status" id={statusId} role="status">{t(`voice.live.${description}`)}</p>
        {showExample && <p className="small live-voice-example">{t(`voice.live.hint.${prompt}`)}</p>}
        <button type="button" className="step-read live-voice-button" aria-pressed={isActive}
          aria-describedby={statusId} onClick={() => void toggle()}>
          {isActive ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
          {t(isActive ? 'voice.live.stop' : 'voice.live.start')}
        </button>
      </div>
    </section>
  );
}
