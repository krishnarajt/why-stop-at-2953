/**
 * Reed–Solomon over GF(256) — vendored, dependency-free.
 *
 * Field: primitive polynomial 0x11D, generator α=2, first-consonant-root 0
 * (the classic QR-code setting). Faithful BCH-view RS codec (syndromes →
 * Berlekamp–Massey → Chien search → Forney), correcting up to floor(nsym/2)
 * symbol errors per block. Verified against the `reedsolomon` package's output
 * and known vectors in the screenshot test scripts.
 *
 * We vendor rather than depend on a package because the available `reedsolomon`
 * build exports via top-level `this`, which the bundler can't statically read.
 */

const PRIM = 0x11d;
const GENERATOR = 2;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIM;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}
function div(a: number, b: number): number {
  if (b === 0) throw new Error("GF divide by zero");
  if (a === 0) return 0;
  return EXP[(LOG[a] + 255 - LOG[b]) % 255];
}
function pow(a: number, n: number): number {
  const e = ((LOG[a] * n) % 255 + 255) % 255;
  return EXP[e];
}
function inverse(a: number): number {
  return EXP[255 - LOG[a]];
}

// --- polynomials: coefficient arrays, highest degree first ---

function polyMul(p: number[], q: number[]): number[] {
  const r = new Array(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++)
    for (let i = 0; i < p.length; i++) r[i + j] ^= mul(p[i], q[j]);
  return r;
}
function polyScale(p: number[], x: number): number[] {
  return p.map((c) => mul(c, x));
}
/** XOR-add, aligned at the low-order (right) end. */
function polyAdd(p: number[], q: number[]): number[] {
  const r = new Array(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i];
  return r;
}
function polyEval(p: number[], x: number): number {
  let y = p[0];
  for (let i = 1; i < p.length; i++) y = mul(y, x) ^ p[i];
  return y;
}

function generatorPoly(nsym: number): number[] {
  let g = [1];
  for (let i = 0; i < nsym; i++) g = polyMul(g, [1, pow(GENERATOR, i)]);
  return g;
}

/** Append `nsym` parity bytes to `data`. Returns data.length + nsym bytes. */
export function rsEncode(data: Uint8Array, nsym: number): Uint8Array {
  const gen = generatorPoly(nsym);
  const out = new Uint8Array(data.length + nsym);
  out.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = out[i];
    if (coef !== 0) {
      for (let j = 1; j < gen.length; j++) out[i + j] ^= mul(gen[j], coef);
    }
  }
  out.set(data, 0); // division clobbered the message head; restore it
  return out;
}

/** synd[0] is a leading 0 (Forney convenience); synd[1..nsym] are real. */
function calcSyndromes(msg: Uint8Array, nsym: number): number[] {
  const m = Array.from(msg);
  const synd = new Array(nsym + 1).fill(0);
  for (let i = 0; i < nsym; i++) synd[i + 1] = polyEval(m, pow(GENERATOR, i));
  return synd;
}

/** Berlekamp–Massey: error-locator polynomial Λ(x) from the syndromes. */
function errorLocator(synd: number[], nsym: number): number[] {
  let errLoc = [1];
  let oldLoc = [1];
  for (let i = 0; i < nsym; i++) {
    const K = i + 1;
    let delta = synd[K];
    for (let j = 1; j < errLoc.length; j++) {
      delta ^= mul(errLoc[errLoc.length - 1 - j], synd[K - j]);
    }
    oldLoc = oldLoc.concat([0]);
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, inverse(delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }
  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  return errLoc;
}

/**
 * Chien search: message positions in error. Λ's roots are α^(−deg) where deg is
 * the error term's polynomial degree (msg[p] is the coefficient of x^(n-1-p)).
 * We scan every nonzero field element and map each root back to its position,
 * which is correct for both full-length (255) and shortened blocks.
 */
function findErrors(errLoc: number[], nmess: number): number[] {
  const errs = errLoc.length - 1;
  const positions: number[] = [];
  for (let i = 0; i < 255; i++) {
    if (polyEval(errLoc, pow(GENERATOR, i)) === 0) {
      const deg = (255 - i) % 255; // X_k = α^deg, so deg = −i (mod 255)
      const pos = nmess - 1 - deg;
      if (pos >= 0 && pos < nmess) positions.push(pos);
    }
  }
  if (positions.length !== errs) {
    throw new Error("error locations could not be resolved");
  }
  return positions;
}

/** Forney: compute and apply error magnitudes in place. */
function correctErrata(
  msg: Uint8Array,
  synd: number[],
  positions: number[],
): void {
  const coefPos = positions.map((p) => msg.length - 1 - p);

  // Errata locator Λ(x).
  let errLoc = [1];
  for (const p of coefPos) errLoc = polyMul(errLoc, polyAdd([1], [pow(GENERATOR, p), 0]));

  // Error evaluator Ω(x) = (S(x)·Λ(x)) truncated.
  const syndRev = synd.slice().reverse();
  const prod = polyMul(syndRev, errLoc);
  const errEval = prod.slice(prod.length - errLoc.length);

  const X = coefPos.map((p) => pow(GENERATOR, p));
  for (let i = 0; i < X.length; i++) {
    const Xi = X[i];
    const XiInv = inverse(Xi);
    // Formal derivative denominator.
    let denom = 1;
    for (let j = 0; j < X.length; j++) {
      if (j !== i) denom = mul(denom, 1 ^ mul(XiInv, X[j]));
    }
    if (denom === 0) throw new Error("Forney denominator zero");
    let y = polyEval(errEval, XiInv);
    y = mul(Xi, y); // (1 - fcr) factor with fcr = 0
    msg[positions[i]] ^= div(y, denom);
  }
}

/**
 * Correct `msg` (data+parity, `nsym` parity bytes) and return the recovered
 * data bytes (length msg.length - nsym). Throws if uncorrectable.
 */
export function rsDecode(msg: Uint8Array, nsym: number): Uint8Array {
  const work = Uint8Array.from(msg);
  const synd = calcSyndromes(work, nsym);

  let clean = true;
  for (let i = 1; i < synd.length; i++) if (synd[i] !== 0) clean = false;

  if (!clean) {
    const errLoc = errorLocator(synd, nsym);
    if ((errLoc.length - 1) * 2 > nsym) throw new Error("too many errors");
    const positions = findErrors(errLoc, work.length);
    correctErrata(work, synd, positions);
    const check = calcSyndromes(work, nsym);
    for (let i = 1; i < check.length; i++) {
      if (check[i] !== 0) throw new Error("decode failed verification");
    }
  }
  return work.subarray(0, work.length - nsym);
}
