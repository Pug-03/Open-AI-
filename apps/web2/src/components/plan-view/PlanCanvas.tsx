import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { drawPlan, type PlanFrame, type PreparedScene } from './planDraw.ts';

export interface PlanCanvasHandle {
  /** Draw one frame now. */
  draw: (frame: PlanFrame) => void;
  /** Current size in CSS pixels. */
  size: () => { w: number; h: number };
}

/**
 * The plan drawing surface. It only draws when told to (`draw`), so the page
 * decides when a frame is needed; on resize it redraws the last frame.
 */
export const PlanCanvas = forwardRef<PlanCanvasHandle, { scene: PreparedScene | null; className?: string; label: string; onResize?: () => void }>(
  function PlanCanvas({ scene, className, label, onResize }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const last = useRef<PlanFrame | null>(null);
    const dims = useRef({ w: 0, h: 0, dpr: 1 });
    const sceneRef = useRef(scene);
    sceneRef.current = scene;
    const resized = useRef(onResize);
    resized.current = onResize;

    const paint = (frame: PlanFrame) => {
      last.current = frame;
      const el = canvas.current;
      const P = sceneRef.current;
      if (!el || !P || !dims.current.w) return;
      const ctx = el.getContext('2d');
      if (!ctx) return;
      const { w, h, dpr } = dims.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPlan(ctx, P, frame, w, h);
    };

    useImperativeHandle(ref, () => ({ draw: paint, size: () => ({ w: dims.current.w, h: dims.current.h }) }), []);

    useEffect(() => {
      const el = canvas.current;
      if (!el) return;
      const fit = () => {
        const r = el.getBoundingClientRect();
        // Cap the backing store: a 3x phone gains nothing visible past 2x here.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        dims.current = { w: r.width, h: r.height, dpr };
        el.width = Math.max(1, Math.round(r.width * dpr));
        el.height = Math.max(1, Math.round(r.height * dpr));
        resized.current?.();
        if (last.current) paint(last.current);
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    useEffect(() => {
      if (scene && last.current) paint(last.current);
    }, [scene]);

    return <canvas ref={canvas} className={className} role="img" aria-label={label} />;
  },
);
