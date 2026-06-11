import { rsDecode, rsEncode } from "./gf256";
import { BITS_PER_CELL } from "./palette";

/**
 * SCREENSHOT channel coding: Reed–Solomon error correction + block
 * interleaving + 3-bit symbol packing.
 *
 * Pipeline (encode):
 *   payload bytes -> split into fixed RS blocks -> RS parity per block
 *   -> interleave codewords across blocks -> pack to 3-bit symbols (cells)
 * Decode is the exact inverse, with RS repairing cells the channel mangled.
 *
 * Interleaving spreads each block's codewords across the whole frame, so a
 * localised smudge corrupts only a few codewords per block rather than wiping
 * one block out entirely.
 */

export const BLOCK_TOTAL = 255;
/** Screenshot profile: corrects up to 34 byte-errors per block (~13% of cells). */
export const BLOCK_ECC = 68;
export const BLOCK_DATA = BLOCK_TOTAL - BLOCK_ECC; // 187
/**
 * Camera profile: a phone photographed off a screen is a far harsher channel
 * (perspective, glare, focus, moiré), so we spend much more of each block on
 * parity — corrects up to 70 byte-errors per block (~27% of cells), at the
 * cost of carrying fewer payload bytes per frame.
 */
export const CAMERA_BLOCK_ECC = 140;

/** Data/codeword byte budget for a frame holding `nBlocks` RS blocks. */
export function blockPlan(nBlocks: number, ecc: number = BLOCK_ECC) {
  return {
    nBlocks,
    ecc,
    dataBytes: nBlocks * (BLOCK_TOTAL - ecc),
    codewordBytes: nBlocks * BLOCK_TOTAL,
    cells: Math.ceil((nBlocks * BLOCK_TOTAL * 8) / BITS_PER_CELL),
  };
}

/**
 * RS-encode a payload (already padded to nBlocks*BLOCK_DATA) and interleave the
 * resulting codewords across blocks. Returns nBlocks*BLOCK_TOTAL bytes.
 */
export function encodeCodewords(
  payload: Uint8Array,
  nBlocks: number,
  ecc: number = BLOCK_ECC,
): Uint8Array {
  const blockData = BLOCK_TOTAL - ecc;
  if (payload.length !== nBlocks * blockData) {
    throw new Error("payload length must equal nBlocks * (BLOCK_TOTAL - ecc)");
  }
  const blocks: Uint8Array[] = [];
  for (let b = 0; b < nBlocks; b++) {
    const dataBlock = payload.subarray(b * blockData, (b + 1) * blockData);
    blocks.push(rsEncode(dataBlock, ecc)); // BLOCK_TOTAL bytes
  }
  // Interleave: out[j*nBlocks + b] = block b, codeword j.
  const out = new Uint8Array(nBlocks * BLOCK_TOTAL);
  for (let j = 0; j < BLOCK_TOTAL; j++) {
    for (let b = 0; b < nBlocks; b++) {
      out[j * nBlocks + b] = blocks[b][j];
    }
  }
  return out;
}

/**
 * De-interleave and RS-decode. Returns the recovered payload
 * (nBlocks*BLOCK_DATA bytes). Throws if any block exceeds RS correction.
 */
export function decodeCodewords(
  codewords: Uint8Array,
  nBlocks: number,
  ecc: number = BLOCK_ECC,
): Uint8Array {
  if (codewords.length !== nBlocks * BLOCK_TOTAL) {
    throw new Error("codewords length must equal nBlocks * BLOCK_TOTAL");
  }
  const blockData = BLOCK_TOTAL - ecc;
  const payload = new Uint8Array(nBlocks * blockData);
  for (let b = 0; b < nBlocks; b++) {
    const block = new Uint8Array(BLOCK_TOTAL);
    for (let j = 0; j < BLOCK_TOTAL; j++) block[j] = codewords[j * nBlocks + b];
    const data = rsDecode(block, ecc); // corrects; throws if hopeless
    payload.set(data, b * blockData);
  }
  return payload;
}

/** Bytes -> 3-bit symbols (MSB-first). Length === ceil(bytes*8/3). */
export function bytesToSymbols(bytes: Uint8Array): Uint8Array {
  const totalBits = bytes.length * 8;
  const count = Math.ceil(totalBits / BITS_PER_CELL);
  const out = new Uint8Array(count);
  for (let s = 0; s < count; s++) {
    let v = 0;
    for (let k = 0; k < BITS_PER_CELL; k++) {
      const bit = s * BITS_PER_CELL + k;
      let val = 0;
      if (bit < totalBits) {
        const byte = bytes[bit >> 3];
        val = (byte >> (7 - (bit & 7))) & 1;
      }
      v = (v << 1) | val;
    }
    out[s] = v;
  }
  return out;
}

/** 3-bit symbols -> `byteLen` bytes (MSB-first). Inverse of bytesToSymbols. */
export function symbolsToBytes(symbols: Uint8Array, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  const totalBits = byteLen * 8;
  for (let s = 0; s < symbols.length; s++) {
    const v = symbols[s];
    for (let k = 0; k < BITS_PER_CELL; k++) {
      const bit = s * BITS_PER_CELL + k;
      if (bit >= totalBits) break;
      const val = (v >> (BITS_PER_CELL - 1 - k)) & 1;
      if (val) out[bit >> 3] |= 1 << (7 - (bit & 7));
    }
  }
  return out;
}

/** CRC-32 (IEEE) over a byte array — frame integrity check. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
