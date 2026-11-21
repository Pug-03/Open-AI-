import { useEffect, useRef, useState, type RefObject } from 'react';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * How far an element has travelled through the viewport: 0 as its top comes
 * in at the bottom edge, 1 as its bottom leaves at the top. The value eases
 * toward the real one each frame, so the drawing it drives follows the scroll
 * smoothly instead of stepping with the wheel. Jumps straight there when the
 * user asks for reduced motion.
 */
export function useViewProgress(ref: RefObject<HTMLElement | null>): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let frame = 0;
    let shown = -1;
    const target = () => {
      const el = ref.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return clamp01((window.innerHeight - r.top) / (window.innerHeight + r.height));
    };
    const tick = () => {
      const goal = target();
      shown = shown < 0 || still ? goal : shown + (goal - shown) * 0.12;
      if (Math.abs(goal - shown) < 0.0008) shown = goal;
      setP(shown);
      frame = shown === goal ? 0 : requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    wake();
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('resize', wake);
    return () => {
      window.removeEventListener('scroll', wake);
      window.removeEventListener('resize', wake);
      cancelAnimationFrame(frame);
    };
  }, [ref]);
  return p;
}

// One scroll listener checks every element still waiting to be seen. (Not an
// IntersectionObserver: these elements start clipped away by their own
// clip-path, and a fully clipped element never reports as intersecting.)
const waiting = new Map<Element, { edge: number; done: () => void }>();
let checking = 0;
function check() {
  checking = 0;
  for (const [el, w] of waiting) {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * w.edge && r.bottom > 0) {
      waiting.delete(el);
      w.done();
    }
  }
  if (!waiting.size) {
    document.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
  }
}
function schedule() {
  if (!checking) checking = requestAnimationFrame(check);
}

/**
 * True once the element has scrolled into view (and stays true). `edge` is how
 * far up the viewport its top must come, as a share of the viewport height.
 */
export function useSeen<T extends HTMLElement>(edge = 0.88): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (!waiting.size) {
      // Capturing, so scrolling inside a panel (the planner sheet) counts too.
      document.addEventListener('scroll', schedule, { passive: true, capture: true });
      window.addEventListener('resize', schedule);
    }
    waiting.set(el, { edge, done: () => setSeen(true) });
    schedule();
    return () => {
      waiting.delete(el);
    };
  }, [edge, seen]);
  return [ref, seen];
}
