const STEPS = 4;
const DURATION = 260;
const WHEEL_GAP = 110;
const EDGE_PX = 2;

type Direction = -1 | 1;

/** Play one part of the shadow study before accepting another scroll gesture. */
export function installStageScroll(section: HTMLElement, onSettled: () => void) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let lastWheelTime = -Infinity;
  let ownsWheel = false;
  let touch: { x: number; y: number; consumed: boolean } | null = null;

  function stop() {
    if (!frame) return;
    window.cancelAnimationFrame(frame);
    frame = 0;
    onSettled();
  }

  function advance(direction: Direction): boolean {
    if (reduceMotion.matches) return false;
    if (frame) return true;
    const from = window.scrollY;
    const bounds = section.getBoundingClientRect();
    const length = bounds.height - window.innerHeight;
    const offset = -bounds.top;
    if (length <= 0 || offset < -EDGE_PX || offset > length + EDGE_PX) return false;
    if (direction > 0 ? offset >= length - EDGE_PX : offset <= EDGE_PX) return false;

    const step = length / STEPS;
    const point = direction > 0 ? Math.floor((offset + EDGE_PX) / step) + 1 : Math.ceil((offset - EDGE_PX) / step) - 1;
    const to = from - offset + Math.min(STEPS, Math.max(0, point)) * step;
    let started: number | undefined;
    let lastTop = from;

    function tick(time: number) {
      // A direct jump from a link, the scrollbar, or the time ruler wins.
      if (reduceMotion.matches || Math.abs(window.scrollY - lastTop) > EDGE_PX) {
        stop();
        return;
      }
      started ??= time;
      const progress = Math.min(1, (time - started) / DURATION);
      lastTop = Math.round(from + (to - from) * (1 - (1 - progress) ** 3));
      window.scrollTo({ top: lastTop, behavior: 'instant' });
      // Keep the last pose on screen for a frame before releasing input.
      frame = window.requestAnimationFrame(progress < 1 ? tick : stop);
    }

    frame = window.requestAnimationFrame(tick);
    return true;
  }

  function onWheel(event: WheelEvent) {
    if (reduceMotion.matches || !event.cancelable || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const sameGesture = event.timeStamp - lastWheelTime < WHEEL_GAP;
    lastWheelTime = event.timeStamp;
    // Trackpad momentum still belongs to the previous transition.
    ownsWheel = (ownsWheel && sameGesture) || advance(event.deltaY > 0 ? 1 : -1);
    if (ownsWheel) event.preventDefault();
  }

  function onTouchStart(event: TouchEvent) {
    const first = event.touches.length === 1 ? event.touches[0] : undefined;
    const overRuler = event.target instanceof Element && !!event.target.closest('[role="slider"]');
    touch = first && !overRuler && !reduceMotion.matches ? { x: first.clientX, y: first.clientY, consumed: false } : null;
  }

  function onTouchMove(event: TouchEvent) {
    const current = event.touches.length === 1 ? event.touches[0] : undefined;
    if (!touch || !current || !event.cancelable || reduceMotion.matches) return;
    if (touch.consumed) {
      event.preventDefault();
      return;
    }
    const dx = current.clientX - touch.x;
    const dy = touch.y - current.clientY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
    if (Math.abs(dx) >= Math.abs(dy) || !advance(dy > 0 ? 1 : -1)) {
      touch = null;
      return;
    }
    touch.consumed = true;
    event.preventDefault();
  }

  function endTouch() {
    touch = null;
  }

  function onKey(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="slider"], [contenteditable]')) return;
    const direction = event.key === 'PageDown' || event.key === 'ArrowDown' || (event.key === ' ' && !event.shiftKey) ? 1
      : event.key === 'PageUp' || event.key === 'ArrowUp' || (event.key === ' ' && event.shiftKey) ? -1 : 0;
    if (direction && advance(direction)) event.preventDefault();
  }

  section.addEventListener('wheel', onWheel, { passive: false });
  section.addEventListener('touchstart', onTouchStart, { passive: true });
  section.addEventListener('touchmove', onTouchMove, { passive: false });
  section.addEventListener('touchend', endTouch);
  section.addEventListener('touchcancel', endTouch);
  window.addEventListener('keydown', onKey);

  return {
    get animating() { return frame !== 0; },
    advance,
    stop,
    dispose() {
      window.cancelAnimationFrame(frame);
      frame = 0;
      section.removeEventListener('wheel', onWheel);
      section.removeEventListener('touchstart', onTouchStart);
      section.removeEventListener('touchmove', onTouchMove);
      section.removeEventListener('touchend', endTouch);
      section.removeEventListener('touchcancel', endTouch);
      window.removeEventListener('keydown', onKey);
    },
  };
}
