/** The same mark used for the browser favicon. */
export function LogoMark({ size = 36, title, className }: { size?: number; title?: string; className?: string }) {
  return (
    <img
      src="/icon.svg"
      width={size}
      height={size}
      className={className ? `logo-mark ${className}` : 'logo-mark'}
      alt={title ?? ''}
    />
  );
}
