import QRCode from "qrcode";
import { PALETTE } from "./palette";
import {
  BLOCK_ECC,
  blockPlan,
  bytesToSymbols,
  crc32,
  encodeCodewords,
} from "./codec";
import {
  CONTENT_W,
  MARKERS,
  QR_ECC,
  QR_MOD,
  QR_VERSION,
  SWATCHES,
  canvasSize,
  capacity,
  contentOrigin,
  freeCells,
} from "./layout";

/**
 * SCREENSHOT encoder — turns the container stream into a sequence of robust
 * 8-colour frames designed to survive a lossy capture (Teams / VDI / recording).
 *
 * Per frame: a chunk of the stream is RS-encoded + interleaved, packed into
 * 3-bit colour cells, and painted alongside an anchor QR (metadata + a
 * registration handle), three corner markers, and a calibration swatch strip.
 */

export const FRAME_FORMAT_VERSION = 1;

export interface QrMatrix {
  size: number;
  /** Row-major, 1 === dark module. */
  data: Uint8Array;
}

export interface FramePlan {
  index: number;
  count: number;
  chunkLen: number;
  crc: number;
  /** One symbol (0..7) per used data cell, in freeCells() order. */
  symbols: Uint8Array;
  qr: QrMatrix;
}

/** A flat painter so the same routine drives a browser canvas and a test buffer. */
export type Fill = (
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
) => void;

export function buildMetadata(
  index: number,
  count: number,
  chunkLen: number,
  crc: number,
  ecc: number = BLOCK_ECC,
): string {
  return JSON.stringify({
    v: FRAME_FORMAT_VERSION,
    i: index,
    n: count,
    len: chunkLen,
    c: crc,
    // Error-correction strength — lets the decoder split codewords correctly
    // regardless of which profile (screenshot/camera) produced the frame.
    e: ecc,
  });
}

export function makeQrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, {
    errorCorrectionLevel: QR_ECC,
    version: QR_VERSION,
  });
  const size = qr.modules.size;
  const src = qr.modules.data as unknown as ArrayLike<number>;
  const data = new Uint8Array(size * size);
  for (let i = 0; i < data.length; i++) data[i] = src[i] ? 1 : 0;
  return { size, data };
}

/** Plan one frame from its stream chunk (chunk length may be < payloadPerFrame). */
export function buildFramePlan(
  chunk: Uint8Array,
  index: number,
  count: number,
  ecc: number = BLOCK_ECC,
): FramePlan {
  const cap = capacity(ecc);
  const payload = new Uint8Array(cap.payloadPerFrame);
  payload.set(chunk.subarray(0, cap.payloadPerFrame), 0); // zero-padded tail
  const codewords = encodeCodewords(payload, cap.nBlocks, ecc);
  const symbols = bytesToSymbols(codewords); // length === cap.cellsUsed
  const crc = crc32(chunk);
  const qr = makeQrMatrix(buildMetadata(index, count, chunk.length, crc, ecc));
  return { index, count, chunkLen: chunk.length, crc, symbols, qr };
}

/** Paint a planned frame using the supplied fill primitive. */
export function paintFramePlan(plan: FramePlan, scale: number, fill: Fill) {
  const { w, h } = canvasSize(scale);
  // White background (also the quiet zone and every unused cell).
  fill(0, 0, w, h, 255, 255, 255);

  const origin = contentOrigin(scale);
  const px = (col: number) => origin.x + col * scale;
  const py = (row: number) => origin.y + row * scale;

  // Anchor QR at content (0,0); paint only dark modules.
  const { size, data } = plan.qr;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (data[r * size + c]) fill(px(c), py(r), scale, scale, 0, 0, 0);
    }
  }

  // Calibration swatches.
  for (let i = 0; i < SWATCHES.length; i++) {
    const { rect } = SWATCHES[i];
    const [cr, cg, cb] = PALETTE[i];
    fill(px(rect.x), py(rect.y), rect.w * scale, rect.h * scale, cr, cg, cb);
  }

  // Corner markers (solid black).
  for (const m of MARKERS) {
    fill(px(m.rect.x), py(m.rect.y), m.rect.w * scale, m.rect.h * scale, 0, 0, 0);
  }

  // Data cells.
  const cells = freeCells();
  const sym = plan.symbols;
  for (let k = 0; k < sym.length; k++) {
    const col = cells[2 * k];
    const row = cells[2 * k + 1];
    const [cr, cg, cb] = PALETTE[sym[k]];
    fill(px(col), py(row), scale, scale, cr, cg, cb);
  }
}

export interface ScreenshotFrame {
  index: number;
  url: string;
  blob: Blob;
}

export interface ScreenshotResult {
  frames: ScreenshotFrame[];
  frameCount: number;
  streamBytes: number;
  payloadPerFrame: number;
  scale: number;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}

export function frameCountFor(
  streamBytes: number,
  ecc: number = BLOCK_ECC,
): number {
  return Math.max(1, Math.ceil(streamBytes / capacity(ecc).payloadPerFrame));
}

/** Encode a stream into screenshot-robust PNG frames (browser only). */
export async function encodeScreenshot(
  stream: Uint8Array,
  scale: number,
  onProgress?: (done: number, total: number) => void,
  ecc: number = BLOCK_ECC,
): Promise<ScreenshotResult> {
  const cap = capacity(ecc);
  const count = frameCountFor(stream.length, ecc);
  const { w, h } = canvasSize(scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const fill: Fill = (x, y, fw, fh, r, g, b) => {
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, fw, fh);
  };

  const frames: ScreenshotFrame[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = stream.subarray(
      i * cap.payloadPerFrame,
      i * cap.payloadPerFrame + cap.payloadPerFrame,
    );
    const plan = buildFramePlan(chunk, i, count, ecc);
    paintFramePlan(plan, scale, fill);
    const blob = await canvasToPng(canvas);
    frames.push({ index: i, url: URL.createObjectURL(blob), blob });
    onProgress?.(i + 1, count);
    await new Promise((r) => setTimeout(r, 0));
  }

  return {
    frames,
    frameCount: count,
    streamBytes: stream.length,
    payloadPerFrame: cap.payloadPerFrame,
    scale,
  };
}

/** Used by the UI for pre-flight estimates. */
export function estimateFrames(sourceBytes: number, ecc: number = BLOCK_ECC) {
  const cap = capacity(ecc);
  // Worst case: assume the stream is ~ sourceBytes (compression gain unknown).
  const framesMax = Math.max(1, Math.ceil((sourceBytes + 64) / cap.payloadPerFrame));
  return {
    framesMax,
    payloadPerFrame: cap.payloadPerFrame,
    nBlocks: cap.nBlocks,
    eccPerBlock: ecc,
  };
}
