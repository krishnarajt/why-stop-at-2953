/**
 * A decorative, QR-shaped glyph for the hero. Deterministic (no random at
 * render) so server and client markup match. Modules fade in with a gentle
 * diagonal shimmer driven purely by CSS.
 */
const SIZE = 21; // Version-1 module count
const CELL = 12;
const PAD = 8;

// Finder-pattern footprints (top-left, top-right, bottom-left).
const finders = [
  [0, 0],
  [SIZE - 7, 0],
  [0, SIZE - 7],
];

function inFinder(x: number, y: number) {
  return finders.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
}

// Stable pseudo-random fill from a simple integer hash.
function lit(x: number, y: number) {
  const h = (x * 73856093) ^ (y * 19349663);
  return ((h >>> 3) & 7) > 3;
}

export function HeroGlyph() {
  const dim = SIZE * CELL + PAD * 2;
  const cells: React.ReactNode[] = [];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inFinder(x, y) || !lit(x, y)) continue;
      const delay = ((x + y) / (SIZE * 2)) * 1.2;
      cells.push(
        <rect
          key={`${x}-${y}`}
          x={PAD + x * CELL}
          y={PAD + y * CELL}
          width={CELL - 1.5}
          height={CELL - 1.5}
          rx={1.5}
          fill="currentColor"
          className="glyph-cell"
          style={{ animationDelay: `${delay}s` }}
        />,
      );
    }
  }

  const finderEye = (fx: number, fy: number) => (
    <g key={`f-${fx}-${fy}`} transform={`translate(${PAD + fx * CELL} ${PAD + fy * CELL})`}>
      <rect width={7 * CELL - 1.5} height={7 * CELL - 1.5} rx={6} fill="currentColor" />
      <rect
        x={CELL}
        y={CELL}
        width={5 * CELL - 1.5}
        height={5 * CELL - 1.5}
        rx={4}
        fill="var(--paper)"
      />
      <rect
        x={2 * CELL}
        y={2 * CELL}
        width={3 * CELL - 1.5}
        height={3 * CELL - 1.5}
        rx={3}
        fill="currentColor"
      />
    </g>
  );

  return (
    <svg viewBox={`0 0 ${dim} ${dim}`} className="hero-glyph">
      {cells}
      {finders.map(([fx, fy]) => finderEye(fx, fy))}
    </svg>
  );
}
