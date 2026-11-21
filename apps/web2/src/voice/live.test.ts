import { expect, it, vi } from 'vitest';
import { speechParts, type SpeechPart } from '@walkwe/core/voice';
import { createLiveToolHandler } from './live.ts';

const call = (name: string, args: object, id = '1', delegation = '1') => ({
  type: 'response.event', delegation_id: delegation, event: { type: 'response.output_item.done',
    item: { type: 'function_call', name, arguments: JSON.stringify(args), call_id: id } },
});

it('checks the direct tool result, rejects supplied distances, and dispatches help only once', async () => {
  const repeat = vi.fn(() => speechParts('both', (lang) => lang === 'th' ? 'เดินต่อ 10 เมตร' : 'Walk 10 metres'));
  const help = vi.fn(() => speechParts('en', () => 'The help sheet is open.'));
  const send = vi.fn(), speak = vi.fn(async () => {}), unavailable = vi.fn();
  const ctl = new AbortController();
  const handle = createLiveToolHandler({ screen: 'navigate', signal: ctl.signal, actions: () => ({ repeat_instruction: repeat, open_sos_sheet: help }), send, speak, unavailable });
  await handle(call('repeat_instruction', { language: 'en', which: 'last_instruction', distance_m: 999 }));
  expect(repeat).not.toHaveBeenCalled();
  expect(unavailable).toHaveBeenCalledOnce();
  await handle(call('repeat_instruction', { language: 'both', which: 'last_instruction' }, '2', '2'));
  expect(speak).toHaveBeenCalledWith([{ lang: 'th', text: 'เดินต่อ 10 เมตร' }, { lang: 'en', text: 'Walk 10 metres' }], 'repeat_instruction');
  expect(send).toHaveBeenCalledWith({ type: 'response.item.create', item: { type: 'function_call_output', call_id: '2', output: '{"status":"ok","speak_text":"เดินต่อ 10 เมตร Walk 10 metres"}' } });
  const requested = call('open_sos_sheet', { language: 'en', reason: 'user_asked' }, '3', '3');
  await handle(requested);
  await handle(requested);
  await handle(call('open_sos_sheet', { language: 'en', reason: 'user_asked' }, '4', '3'));
  expect(help).toHaveBeenCalledOnce();
  ctl.abort();
  await handle(call('open_sos_sheet', { language: 'en', reason: 'user_asked' }, '5', '5'));
  expect(help).toHaveBeenCalledOnce();
});

it('relays review and explicit follow-up in separate turns of one session', async () => {
  const question = 'Lighting information is incomplete. Which lighting assumption should I use?';
  const checked = 'The checked route is 316 metres.';
  let finishReview!: (parts: SpeechPart[]) => void;
  let finishQuestion!: () => void;
  const review = vi.fn(() => new Promise<SpeechPart[]>(resolve => { finishReview = resolve; }));
  const answer = vi.fn(() => speechParts('en', () => checked));
  const send = vi.fn();
  const speak = vi.fn((parts: SpeechPart[]) => parts[0]?.text === question
    ? new Promise<void>(resolve => { finishQuestion = resolve; }) : Promise.resolve());
  const unavailable = vi.fn();
  const working = vi.fn();
  const settled = vi.fn();
  const handle = createLiveToolHandler({
    screen: 'plan', signal: new AbortController().signal, actions: () => ({
      review_route: review, answer_route_review: answer,
    }), send, speak, unavailable, working, settled,
  });

  const first = call('review_route', { language: 'en' }, 'review', 'turn-1');
  const pending = handle(first);
  expect(working).toHaveBeenCalledWith('review_route');
  await handle(first);
  await handle(call('answer_route_review', { language: 'en', preference: 'direct' }, 'while-review', 'overlap-1'));
  expect(review).toHaveBeenCalledOnce();
  expect(answer).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalledWith({ type: 'response.create' });

  finishReview(speechParts('en', () => question));
  await vi.waitFor(() => expect(speak).toHaveBeenCalledWith([{ lang: 'en', text: question }], 'review_route'));
  await handle(call('answer_route_review', { language: 'en', preference: 'direct' }, 'while-speaking', 'overlap-2'));
  expect(settled).not.toHaveBeenCalled();
  expect(answer).not.toHaveBeenCalled();
  finishQuestion();
  await pending;
  expect(settled).toHaveBeenCalledOnce();

  await handle(call('answer_route_review', { language: 'en', preference: 'direct' }, 'same-turn', 'turn-1'));
  await handle(call('answer_route_review', { language: 'en', preference: 'guess' }, 'invalid-answer', 'turn-2'));
  expect(answer).not.toHaveBeenCalled();
  await handle(call('answer_route_review', { language: 'en', preference: 'prefer_evidence' }, 'explicit-answer', 'turn-3'));
  expect(answer).toHaveBeenCalledOnce();
  expect(answer).toHaveBeenCalledWith({ language: 'en', preference: 'prefer_evidence' }, expect.any(AbortSignal));
  expect(speak).toHaveBeenLastCalledWith([{ lang: 'en', text: checked }], 'answer_route_review');
  expect(send).toHaveBeenCalledWith({
    type: 'response.item.create',
    item: { type: 'function_call_output', call_id: 'explicit-answer',
      output: JSON.stringify({ status: 'ok', speak_text: checked }) },
  });
});
