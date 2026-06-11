/**
 * QR capacity reference.
 *
 * A single QR symbol tops out at Version 40 (177x177 modules). The absolute
 * ceiling for raw byte data is reached at error-correction level L (~7%):
 *
 *   L: 2953 bytes   M: 2331 bytes   Q: 1663 bytes   H: 1273 bytes
 *
 * This module is intentionally the single source of truth for those limits so
 * the rest of the app (and whatever lives behind the hidden tab) can reason
 * about "the wall" in one place.
 */

export type EccLevel = "L" | "M" | "Q" | "H";

/** Max raw bytes encodable in one Version 40 symbol, per ECC level. */
export const MAX_BYTES: Record<EccLevel, number> = {
  L: 2953,
  M: 2331,
  Q: 1663,
  H: 1273,
};

/** The headline number. The wall everybody stops at. */
export const SINGLE_QR_CEILING = MAX_BYTES.L; // 2953

export const ECC_LABELS: Record<EccLevel, string> = {
  L: "L · ~7% recovery",
  M: "M · ~15% recovery",
  Q: "Q · ~25% recovery",
  H: "H · ~30% recovery",
};

const encoder = new TextEncoder();

/** UTF-8 byte length of a string — what actually matters for capacity. */
export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** Fraction [0,1] of the ceiling consumed by `bytes` at the given ECC level. */
export function fillRatio(bytes: number, ecc: EccLevel): number {
  return Math.min(bytes / MAX_BYTES[ecc], 1);
}
