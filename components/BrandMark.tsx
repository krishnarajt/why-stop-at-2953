/** The three QR finder patterns, distilled into a mark. */
export function BrandMark({ className }: { className?: string }) {
  const eye = (x: number, y: number) => (
    <g transform={`translate(${x} ${y})`}>
      <rect width="11" height="11" fill="currentColor" />
      <rect x="2" y="2" width="7" height="7" fill="var(--paper, #fff)" />
      <rect x="3.5" y="3.5" width="4" height="4" fill="currentColor" />
    </g>
  );
  return (
    <svg
      className={className}
      viewBox="0 0 30 30"
      role="img"
      aria-label="QR mark"
    >
      {eye(0, 0)}
      {eye(19, 0)}
      {eye(0, 19)}
      {/* a few stray data modules */}
      <rect x="15" y="15" width="3" height="3" fill="currentColor" />
      <rect x="22" y="22" width="3" height="3" fill="currentColor" />
      <rect x="27" y="15" width="3" height="3" fill="currentColor" />
      <rect x="15" y="27" width="3" height="3" fill="currentColor" />
    </svg>
  );
}
