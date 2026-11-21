import { afterEach, expect, it, vi } from 'vitest';
import { installStageScroll } from './stageScroll.ts';

function fixture(start = 0, reduced = false) {
  const scene = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ top: -top, height: 4300 }),
  });
  let top = start;
  let sequence = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const viewport = Object.assign(new EventTarget(), {
    innerHeight: 1000,
    matchMedia: () => ({ matches: reduced }),
    scrollTo: ({ top: value }: ScrollToOptions) => { top = value ?? top; },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: (frame: number) => { frames.delete(frame); },
  });
  Object.defineProperty(viewport, 'scrollY', { get: () => top });
  vi.stubGlobal('window', viewport);
  vi.stubGlobal('Element', class {});
  const settled = vi.fn();
  const controller = installStageScroll(scene as unknown as HTMLElement, settled);

  function frame(time: number) {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  }
  function event(target: EventTarget, type: string, properties: Record<string, unknown>) {
    const input = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(input, key, { value });
    target.dispatchEvent(input);
    return input.defaultPrevented;
  }
  const wheel = (timeStamp: number, deltaY = 80) => event(scene, 'wheel', { deltaX: 0, deltaY, timeStamp });
  const touch = (type: string, x: number, y: number) => event(scene, type, { touches: [{ clientX: x, clientY: y }] });
  const key = (key: string) => event(viewport, 'keydown', { key });

  return { controller, frame, wheel, touch, key, top: () => top, settled };
}

afterEach(() => vi.unstubAllGlobals());

it('finishes one wheel step and ignores the rest of that trackpad gesture', () => {
  const stage = fixture();
  expect(stage.wheel(0)).toBe(true);
  stage.frame(16);
  stage.frame(146);
  const midway = stage.top();
  expect(midway).toBeGreaterThan(0);
  expect(midway).toBeLessThan(825);
  expect(stage.wheel(150)).toBe(true);
  expect(stage.wheel(245)).toBe(true);
  stage.frame(276);
  expect(stage.top()).toBe(825);
  expect(stage.controller.animating).toBe(true);
  stage.frame(292);
  expect(stage.settled).toHaveBeenCalledOnce();
  expect(stage.wheel(300)).toBe(true); // momentum, so no new frame is queued
  expect(stage.controller.animating).toBe(false);
  expect(stage.wheel(425)).toBe(true); // a fresh gesture
  stage.frame(430);
  stage.frame(690);
  stage.frame(706);
  expect(stage.top()).toBe(1650);
});

it('releases ordinary scrolling at the end and animates back into the scene', () => {
  const stage = fixture(3300);
  expect(stage.wheel(0)).toBe(false);
  expect(stage.wheel(200, -80)).toBe(true);
  stage.frame(216);
  stage.frame(476);
  stage.frame(492);
  expect(stage.top()).toBe(2475);
});

it('advances a vertical touch gesture and leaves a horizontal swipe alone', () => {
  const stage = fixture();
  stage.touch('touchstart', 50, 120);
  expect(stage.touch('touchmove', 10, 118)).toBe(false);
  stage.touch('touchstart', 50, 120);
  expect(stage.touch('touchmove', 49, 65)).toBe(true);
  expect(stage.touch('touchmove', 49, 5)).toBe(true);
  stage.frame(20);
  stage.frame(280);
  stage.frame(296);
  expect(stage.top()).toBe(825);
});

it('handles page keys and preserves native scrolling with reduced motion', () => {
  const stage = fixture();
  expect(stage.key('PageDown')).toBe(true);
  expect(stage.key('PageDown')).toBe(true);
  stage.frame(20);
  stage.frame(280);
  stage.frame(296);
  expect(stage.top()).toBe(825);

  const reduced = fixture(0, true);
  expect(reduced.wheel(0)).toBe(false);
  expect(reduced.key('PageDown')).toBe(false);
  expect(reduced.controller.animating).toBe(false);
});
