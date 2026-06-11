/**
 * A 2-D projective transform (homography) fitted from point correspondences.
 *
 * The screenshot decoder maps grid→pixels with two axis-aligned linear fits,
 * which is exact for a flat capture. A photo taken off a screen with a phone,
 * however, carries genuine perspective (keystone) distortion that no affine
 * map can model — so the CAMERA decoder fits a full homography instead, from
 * the anchor QR's four corners plus the three solid corner markers.
 *
 * Fitting uses the normalized DLT: Hartley pre-conditioning (so the linear
 * system stays well-behaved across the wide module→pixel scale range) followed
 * by a least-squares solve of the 8 free parameters (h33 fixed to 1).
 */

export type Pt = { x: number; y: number };

/** Maps a point through the fitted transform. Returns null if it projects to infinity. */
export type Mapper = (x: number, y: number) => Pt | null;

/** A 3x3 matrix as a flat row-major array of 9 numbers. */
type Mat3 = number[];

function matMul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = s;
    }
  }
  return out;
}

function matInv3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    A * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    C * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}

/** Solve the n×n system Ax = b by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Augmented matrix.
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Pivot.
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    // Eliminate.
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) m[r][k] -= factor * m[col][k];
    }
  }
  return m.map((row, i) => row[n] / m[i][i]);
}

/** Hartley normalization: translate to centroid, scale so mean distance is √2. */
function normalizer(pts: Pt[]): Mat3 {
  let mx = 0,
    my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let d = 0;
  for (const p of pts) d += Math.hypot(p.x - mx, p.y - my);
  d /= pts.length;
  const s = d > 1e-9 ? Math.SQRT2 / d : 1;
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

function applyMat3(m: Mat3, x: number, y: number): Pt | null {
  const px = m[0] * x + m[1] * y + m[2];
  const py = m[3] * x + m[4] * y + m[5];
  const pw = m[6] * x + m[7] * y + m[8];
  if (!isFinite(pw) || Math.abs(pw) < 1e-12) return null;
  return { x: px / pw, y: py / pw };
}

/**
 * Fit the homography mapping `src` points to `dst` points (≥4 correspondences).
 * Returns a mapper, or null if the configuration is degenerate.
 */
export function solveHomography(src: Pt[], dst: Pt[]): Mapper | null {
  if (src.length < 4 || src.length !== dst.length) return null;

  const Ts = normalizer(src);
  const Td = normalizer(dst);
  const ns = src.map((p) => applyMat3(Ts, p.x, p.y)!);
  const nd = dst.map((p) => applyMat3(Td, p.x, p.y)!);

  // Least squares for the 8 free parameters (h33 = 1) via normal equations.
  const ata: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const atb: number[] = new Array(8).fill(0);
  const addRow = (row: number[], rhs: number) => {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) ata[i][j] += row[i] * row[j];
      atb[i] += row[i] * rhs;
    }
  };
  for (let k = 0; k < ns.length; k++) {
    const { x: X, y: Y } = ns[k];
    const { x, y } = nd[k];
    addRow([X, Y, 1, 0, 0, 0, -X * x, -Y * x], x);
    addRow([0, 0, 0, X, Y, 1, -X * y, -Y * y], y);
  }
  const h = solveLinear(ata, atb);
  if (!h) return null;

  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const TdInv = matInv3(Td);
  if (!TdInv) return null;
  // H = Td⁻¹ · Hn · Ts  (denormalize back to raw module→pixel coords).
  const H = matMul3(matMul3(TdInv, Hn), Ts);

  return (x: number, y: number) => applyMat3(H, x, y);
}
