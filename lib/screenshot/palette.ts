/**
 * SCREENSHOT variant — the 8-colour palette (3 bits per cell).
 *
 * The colours are the eight corners of the RGB cube: maximally separated, so
 * they stay distinguishable after the chroma-subsampling and DCT quantisation
 * that a screenshot picks up travelling through Teams / a VDI / a recording.
 *
 * We never trust the nominal values at decode time — the encoder paints a
 * calibration swatch of all eight, and the decoder classifies each data cell
 * against the colours *as they actually arrived* (see classify). That absorbs
 * gamma, contrast and limited-range (16–235) shifts.
 */

export type Rgb = [number, number, number];

/** Index === the 3-bit symbol value. Order is arbitrary but must be stable. */
export const PALETTE: Rgb[] = [
  [0, 0, 0], // 0 black
  [255, 255, 255], // 1 white
  [255, 0, 0], // 2 red
  [0, 255, 0], // 3 green
  [0, 0, 255], // 4 blue
  [0, 255, 255], // 5 cyan
  [255, 0, 255], // 6 magenta
  [255, 255, 0], // 7 yellow
];

export const PALETTE_SIZE = PALETTE.length; // 8
export const BITS_PER_CELL = 3;

/** Nearest palette index to `rgb`, measured against `centroids`. */
export function classify(centroids: Rgb[], r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    const c = centroids[i];
    const dr = r - c[0];
    const dg = g - c[1];
    const db = b - c[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
