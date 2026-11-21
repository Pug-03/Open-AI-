import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { sunPosition, type LatLng, type Route, type WalkMode } from '@walkwe/core';
import { PlanCanvas, type PlanCanvasHandle } from '../plan-view/PlanCanvas.tsx';
import { nightFor, toPlanPoint, toPlanRoute, type PreparedScene } from '../plan-view/planDraw.ts';

/**
 * A step with no photo: the shadow plan around the turn instead, with the
 * route through it and the sun where it is now. The manoeuvre icon sits in
 * the corner.
 */
export function StepPlan({ prepared, at, route, mode, label, icon }: { prepared: PreparedScene | null; at: LatLng; route: Route; mode: WalkMode; label: string; icon: ReactNode }) {
  const canvas = useRef<PlanCanvasHandle>(null);
  const planRoute = useMemo(
    () => (prepared ? toPlanRoute(route, prepared.scene, (run) => (mode === 'day' ? run.shade >= 0.5 : (run.safety ?? 0) >= 0.5)) : null),
    [prepared, route, mode],
  );
  const draw = () => {
    const h = canvas.current;
    if (!h || !prepared || !planRoute) return;
    const { w } = h.size();
    if (!w) return;
    const p = toPlanPoint(at, prepared.scene);
    const sun = sunPosition(new Date(), at);
    h.draw({
      cam: { cx: p.x, cy: p.y, scale: Math.max(1.1, w / 300) },
      sun: mode === 'night' ? { altitude: -30, azimuth: 0 } : sun,
      night: mode === 'night' ? 1 : nightFor(sun.altitude),
      main: planRoute,
      from: { ...p, label: '' },
    });
  };
  useEffect(draw); // each render: scene, step or size may have changed
  return (
    <div className="step-plan" data-theme={mode === 'night' ? 'night' : undefined}>
      <PlanCanvas ref={canvas} scene={prepared} className="step-plan-canvas" label={label} onResize={draw} />
      <span className="step-plan-ic" aria-hidden="true">
        {icon}
      </span>
    </div>
  );
}
