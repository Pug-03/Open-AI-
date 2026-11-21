import { z } from 'zod/v4';
import { executeVoiceTool, isVoiceTool, screenTools, type SpeechPart, type VoiceActions, type VoiceScreen, type VoiceToolName } from '@walkwe/core/voice';
import type { Lang } from '../i18n.ts';

const resultSchema = z.object({ sdp: z.string().startsWith('v=0').max(60_000) });
const callEvent = z.object({
  type: z.literal('response.event'), delegation_id: z.string().min(1).max(160),
  event: z.object({ type: z.literal('response.output_item.done'), item: z.object({
    type: z.literal('function_call'), name: z.string(), call_id: z.string().min(1).max(160), arguments: z.string().max(1_500),
  }) }),
});

export function createLiveToolHandler({ screen, signal, actions, send, speak, unavailable, working, settled }: {
  screen: VoiceScreen;
  signal: AbortSignal;
  actions: () => VoiceActions;
  send: (event: object) => void;
  speak: (parts: SpeechPart[], name: VoiceToolName) => Promise<void>;
  unavailable: () => void;
  working?: (name: VoiceToolName) => void;
  settled?: () => void;
}) {
  const calls = new Set<string>();
  const delegations = new Set<string>();
  const allowed = new Set<VoiceToolName>(screenTools[screen]);
  let busy = false;
  let pendingContinuation = false;

  function sendResult(callId: string, status: string, parts: SpeechPart[]) {
    send({ type: 'response.item.create', item: {
      type: 'function_call_output', call_id: callId,
      output: JSON.stringify({ status, speak_text: parts.map(({ text }) => text).join(' ') }),
    } });
    pendingContinuation = true;
  }

  function continueResponse() {
    if (!pendingContinuation || signal.aborted) return;
    pendingContinuation = false;
    send({ type: 'response.create' });
  }

  return async (event: unknown) => {
    const parsed = callEvent.safeParse(event);
    if (!parsed.success || signal.aborted) return;
    const { delegation_id: delegation, event: { item } } = parsed.data;
    if (calls.has(item.call_id) || calls.size >= 24) return;
    calls.add(item.call_id);
    const first = !delegations.has(delegation);
    delegations.add(delegation);
    const name = isVoiceTool(item.name) && allowed.has(item.name) ? item.name : null;
    if (busy || !first || !name) {
      sendResult(item.call_id, 'unavailable', []);
      if (!busy) {
        continueResponse();
        if (first) unavailable();
      }
      return;
    }

    busy = true;
    try {
      working?.(name);
      let args: unknown;
      try { args = JSON.parse(item.arguments); } catch { /* schema will reject */ }
      const result = await executeVoiceTool(name, args, actions(), signal);
      if (signal.aborted) return;
      sendResult(item.call_id, result.status, result.parts);
      continueResponse();
      if (result.status === 'ok') await speak(result.parts, name);
      else unavailable();
    } finally {
      busy = false;
      continueResponse();
      settled?.();
    }
  };
}

async function waitForIce(peer: RTCPeerConnection, signal: AbortSignal) {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => finish(false);
    const listener = () => { if (peer.iceGatheringState === 'complete') finish(true); };
    const timer = setTimeout(abort, 7_000);
    function finish(ok: boolean) {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      peer.removeEventListener('icegatheringstatechange', listener);
      if (ok) resolve(); else reject(new Error('ICE gathering failed'));
    }
    signal.addEventListener('abort', abort, { once: true });
    peer.addEventListener('icegatheringstatechange', listener);
    if (signal.aborted) abort(); else listener();
  });
}

const SESSION_LIMIT_MS = 120_000;

export async function runLiveVoice({ proxyUrl, screen, lang, signal, actions, ready, unavailable, speak, working }: {
  proxyUrl: string;
  screen: VoiceScreen;
  lang: Lang;
  signal: AbortSignal;
  actions: () => VoiceActions;
  ready: () => void;
  unavailable: () => void;
  speak: (parts: SpeechPart[], signal: AbortSignal, name: VoiceToolName) => Promise<void>;
  working?: (name: VoiceToolName) => void;
}): Promise<void> {
  const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
  let peer: RTCPeerConnection | undefined;
  let channel: RTCDataChannel | undefined;
  const tracks = microphone.getAudioTracks();
  const listening = (enabled: boolean) => tracks.forEach((track) => { track.enabled = enabled; });
  const stop = () => microphone.getTracks().forEach((track) => track.stop());
  const life = new AbortController();
  const abort = () => { stop(); life.abort(); };
  const timeout = setTimeout(abort, SESSION_LIMIT_MS);
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) return;
    listening(false);
    peer = new RTCPeerConnection();
    for (const track of tracks) peer.addTrack(track, microphone);
    // Provider audio stays off playback. The app speaks tool output after validation.
    const events = peer.createDataChannel('oai-events');
    channel = events;
    const send = (event: object) => { if (events.readyState === 'open') events.send(JSON.stringify(event)); };
    const handle = createLiveToolHandler({
      screen, signal: life.signal, actions, send, unavailable,
      working: name => {
        listening(false);
        working?.(name);
      },
      speak: (parts, name) => speak(parts, life.signal, name),
      settled: () => { if (!life.signal.aborted) listening(true); },
    });
    const ended = new Promise<{ failed: boolean }>((resolve) => {
      let closing: ReturnType<typeof setTimeout>;
      let started = false;
      const close = (failed = false) => {
        clearTimeout(closing);
        resolve({ failed });
      };
      life.signal.addEventListener('abort', () => {
        if (events.readyState !== 'open') return close();
        send({ type: 'session.close' });
        closing = setTimeout(close, 2_000);
      }, { once: true });
      events.addEventListener('close', () => close(!life.signal.aborted), { once: true });
      events.addEventListener('error', () => close(true), { once: true });
      events.addEventListener('message', (message) => {
        if (typeof message.data !== 'string' || message.data.length > 32_768) return;
        let event;
        try { event = JSON.parse(message.data); } catch { return; }
        if (event?.type === 'session.closed') close(!life.signal.aborted);
        else if (event?.type === 'error' || event?.type === 'response.event' && event.event?.type === 'response.failed') close(true);
        else if (event?.type === 'session.started' && !started && !life.signal.aborted) {
          started = true;
          listening(true);
          ready();
        } else if (started) void handle(event).catch(() => close(true));
      });
    });
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIce(peer, life.signal);
    const res = await fetch(`${proxyUrl}/voice/live`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit',
      body: JSON.stringify({ sdp: peer.localDescription?.sdp, screen, lang }), signal: life.signal,
    });
    if (!res.ok) throw new Error('Voice session unavailable');
    const { sdp } = resultSchema.parse(await res.json());
    await peer.setRemoteDescription({ type: 'answer', sdp });
    if ((await ended).failed) throw new Error('Voice session disconnected');
  } finally {
    life.abort();
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    stop();
    channel?.close();
    peer?.close();
  }
}
