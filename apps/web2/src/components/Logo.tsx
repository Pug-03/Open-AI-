/**
 * The Walk We mark: a W drawn as two strokes of a plan. The first stroke is
 * ink (the walker's line in the sun), the second is the blue of shade, and the
 * amber point above is the sun that decides which is which. Same drawing as
 * public/icon.svg. `bare` leaves out the tile so it can sit in running text.
 */
export function LogoMark({ size = 36, title, bare, className }: { size?: number; title?: string; bare?: boolean; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={`logo-mark${bare ? ' logo-mark--bare' : ''}${className ? ` ${className}` : ''}`}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {!bare && <rect className="logo-tile" width="48" height="48" rx="2" />}
      <path className="logo-ink" d="M7 15 L16 38 L24 19" fill="none" strokeWidth="6" strokeLinejoin="miter" strokeMiterlimit="6" />
      <path className="logo-shade" d="M24 19 L32 38 L41 15" fill="none" strokeWidth="6" strokeLinejoin="miter" strokeMiterlimit="6" />
      <circle className="logo-sun" cx="24" cy="8.5" r="3.6" />
    </svg>
  );
}
