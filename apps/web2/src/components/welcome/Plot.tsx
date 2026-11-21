import type { CSSProperties, ReactNode } from 'react';
import { useSeen } from '../../utils/useViewProgress.ts';

/**
 * Content that is "plotted" the first time it scrolls into view: wiped in
 * along the reading direction (landing.css `.plot`). Visible by default when
 * scripting or the observer is missing.
 */
export function Plot({ as: Tag = 'div', className = '', delay = 0, children }: { as?: 'div' | 'li' | 'tr' | 'p' | 'h2'; className?: string; delay?: number; children?: ReactNode }) {
  const [ref, seen] = useSeen<HTMLElement>();
  return (
    <Tag ref={ref as never} className={`plot${seen ? ' is-in' : ''} ${className}`} style={delay ? ({ '--plot-delay': `${delay}ms` } as CSSProperties) : undefined}>
      {children}
    </Tag>
  );
}
