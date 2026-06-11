import jsQR from "jsqr";
import {
  readPixels,
  type FrameIssue,
  type GatheredImage,
  type GatheredVideo,
} from "@/lib/frames";
import type { SeqFrame } from "@/lib/frames";
import { classify, type Rgb } from "./palette";
import {
  BLOCK_ECC,
  BLOCK_TOTAL,
  crc32,
  decodeCodewords,
  symbolsToBytes,
} from "./codec";
import {
  CONTENT_H,
  CONTENT_W,
  MARKER,
  MARKER_GUARD,
  MARKERS,
  QR_MOD,
  SWATCHES,
  capacity,
  freeCells,
} from "./layout";
import { solveHomography, type Pt } from "./homography";

/**
 * SCREENSHOT decoder — recovers a frame from a (possibly lossy) capture.
 *
 *   1. jsQR finds the anchor QR → frame metadata + four pixel-accurate corners.
 *   2. A coarse scale+translate fit from those corners predicts the three
 *      corner markers; each is refined to its dark centroid.
 *   3. A final least-squares fit over QR corners + markers maps any module
 *      coordinate to a pixel — robust across the whole frame.
 *   4. The calibration swatches are sampled to learn the palette *as captured*;
 *      every data cell is classified against those measured colours.
 *   5. Symbols → codewords → Reed–Solomon repair → payload → CRC check.
 */

export interface DecodedFrame extends SeqFrame {
  chunkLen: number;
}

export interface GatherResult {
  frames: DecodedFrame[];
  issues: FrameIssue[];
}

interface LinFit {
  slope: number;
  intercept: number;
}

/** Least-squares y = slope*x + intercept. */
function linreg(xs: number[], ys: number[]): LinFit {
  const n = xs.length;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

const luma = (r: number, g: number, b: number) =>
  0.299 * r + 0.587 * g + 0.114 * b;

/** Average RGB over a square window, clamped to the image. */
function sampleAvg(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
): Rgb {
  const x0 = Math.max(0, Math.round(cx - radius));
  const x1 = Math.min(width - 1, Math.round(cx + radius));
  const y0 = Math.max(0, Math.round(cy - radius));
  const y1 = Math.min(height - 1, Math.round(cy + radius));
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * width + x) * 4;
      r += data[o];
      g += data[o + 1];
      b += data[o + 2];
      n++;
    }
  }
  if (n === 0) return [0, 0, 0];
  return [r / n, g / n, b / n];
}

/** Refine a marker to its dark centroid within a tight window around (px,py). */
function refineMarker(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  px: number,
  py: number,
  moduleSize: number,
): { x: number; y: number } | null {
  // Window stays inside the marker's white guard so no data cells leak in.
  const rad = (MARKER / 2 + MARKER_GUARD - 0.5) * moduleSize;
  const x0 = Math.max(0, Math.floor(px - rad));
  const x1 = Math.min(width - 1, Math.ceil(px + rad));
  const y0 = Math.max(0, Math.floor(py - rad));
  const y1 = Math.min(height - 1, Math.ceil(py + rad));
  if (x1 <= x0 || y1 <= y0) return null;

  let min = 255,
    max = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * width + x) * 4;
      const l = luma(data[o], data[o + 1], data[o + 2]);
      if (l < min) min = l;
      if (l > max) max = l;
    }
  }
  if (max - min < 40) return null; // no clear marker (cropped away?)
  const thresh = (min + max) / 2;

  let sx = 0,
    sy = 0,
    n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * width + x) * 4;
      if (luma(data[o], data[o + 1], data[o + 2]) < thresh) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (n < 4) return null;
  return { x: sx / n, y: sy / n };
}

/** Decode one captured image into a frame, or explain why it isn't usable. */
export async function decodeImage(
  img: GatheredImage,
  perspective = false,
): Promise<DecodedFrame | FrameIssue> {
  let pixels: Awaited<ReturnType<typeof readPixels>>;
  try {
    pixels = await readPixels(img.blob);
  } catch {
    return { name: img.name, reason: "couldn't be read as an image" };
  }
  const res = decodePixels(pixels.data, pixels.width, pixels.height, perspective);
  return "data" in res ? res : { name: img.name, reason: res.reason };
}

/**
 * Pure pixel → frame decode (no Blob/canvas), so it runs identically in the
 * browser and in headless tests. Returns a frame or the reason it failed.
 */
export function decodePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  perspective = false,
): DecodedFrame | { reason: string } {
  const code = jsQR(data, width, height);
  if (!code) {
    return { reason: "no anchor QR found (not a screenshot frame, or too degraded)" };
  }

  let meta: {
    v?: number;
    i?: number;
    n?: number;
    len?: number;
    c?: number;
    e?: number;
  };
  try {
    meta = JSON.parse(code.data);
  } catch {
    return { reason: "anchor QR did not contain frame metadata" };
  }
  if (
    meta.v !== 1 ||
    typeof meta.i !== "number" ||
    typeof meta.n !== "number" ||
    typeof meta.len !== "number" ||
    typeof meta.c !== "number"
  ) {
    return { reason: "anchor QR metadata is malformed" };
  }
  // Error-correction strength is carried in-band; older frames omit it (= screenshot).
  const ecc =
    typeof meta.e === "number" && meta.e > 0 && meta.e < BLOCK_TOTAL
      ? meta.e
      : BLOCK_ECC;

  const loc = code.location;
  const qrDst: Pt[] = [
    loc.topLeftCorner,
    loc.topRightCorner,
    loc.bottomLeftCorner,
    loc.bottomRightCorner,
  ];
  const qrSrc: Pt[] = [
    { x: 0, y: 0 },
    { x: QR_MOD, y: 0 },
    { x: 0, y: QR_MOD },
    { x: QR_MOD, y: QR_MOD },
  ];

  // Map any module (col,row) → pixel. The two variants differ only here: a flat
  // capture is an axis-aligned scale+translate; a photo needs a full homography.
  let project: (col: number, row: number) => Pt;
  let msX: number;
  let msY: number;

  if (perspective) {
    const h0 = solveHomography(qrSrc, qrDst);
    if (!h0) {
      return { reason: "could not establish the grid (anchor QR corners degenerate)" };
    }
    // Coarse module size from the QR's mean edge length in pixels.
    const edge =
      (Math.hypot(qrDst[1].x - qrDst[0].x, qrDst[1].y - qrDst[0].y) +
        Math.hypot(qrDst[3].x - qrDst[2].x, qrDst[3].y - qrDst[2].y) +
        Math.hypot(qrDst[2].x - qrDst[0].x, qrDst[2].y - qrDst[0].y) +
        Math.hypot(qrDst[3].x - qrDst[1].x, qrDst[3].y - qrDst[1].y)) /
      4;
    const coarseModule = edge / QR_MOD;
    if (!isFinite(coarseModule) || coarseModule <= 0) {
      return { reason: "could not establish the grid scale" };
    }
    // Refine the three corner markers (predicted via the QR-only fit) and add
    // them as correspondences for a frame-wide homography.
    const src = [...qrSrc];
    const dst = [...qrDst];
    for (const m of MARKERS) {
      const p = h0(m.center[0], m.center[1]);
      if (!p) continue;
      const found = refineMarker(data, width, height, p.x, p.y, coarseModule);
      if (found) {
        src.push({ x: m.center[0], y: m.center[1] });
        dst.push(found);
      }
    }
    const h = solveHomography(src, dst) ?? h0;
    project = (col, row) => h(col, row) ?? { x: -1, y: -1 };
    // Local module size at the content centre, for sample-window radii.
    const c0 = h(CONTENT_W / 2, CONTENT_H / 2);
    const cX = h(CONTENT_W / 2 + 1, CONTENT_H / 2);
    const cY = h(CONTENT_W / 2, CONTENT_H / 2 + 1);
    msX = c0 && cX ? Math.hypot(cX.x - c0.x, cX.y - c0.y) : coarseModule;
    msY = c0 && cY ? Math.hypot(cY.x - c0.x, cY.y - c0.y) : coarseModule;
  } else {
    // Coarse fit from the QR's four corners (all near the top-left).
    const cx = linreg([0, QR_MOD, 0, QR_MOD], qrDst.map((p) => p.x));
    const cy = linreg([0, 0, QR_MOD, QR_MOD], qrDst.map((p) => p.y));
    const coarseModule = (Math.abs(cx.slope) + Math.abs(cy.slope)) / 2;
    if (!isFinite(coarseModule) || coarseModule <= 0) {
      return { reason: "could not establish the grid scale" };
    }
    // Refine using the three corner markers for a full-frame fit.
    const refCols = [0, QR_MOD, 0, QR_MOD];
    const refXs = qrDst.map((p) => p.x);
    const refRows = [0, 0, QR_MOD, QR_MOD];
    const refYs = qrDst.map((p) => p.y);
    for (const m of MARKERS) {
      const px = cx.intercept + cx.slope * m.center[0];
      const py = cy.intercept + cy.slope * m.center[1];
      const found = refineMarker(data, width, height, px, py, coarseModule);
      if (found) {
        refCols.push(m.center[0]);
        refXs.push(found.x);
        refRows.push(m.center[1]);
        refYs.push(found.y);
      }
    }
    const fx = linreg(refCols, refXs);
    const fy = linreg(refRows, refYs);
    msX = Math.abs(fx.slope);
    msY = Math.abs(fy.slope);
    project = (col, row) => ({
      x: fx.intercept + fx.slope * col,
      y: fy.intercept + fy.slope * row,
    });
  }

  // Measure the palette as captured.
  const swatchRad = Math.max(1, Math.floor(Math.min(msX, msY) * 2));
  const centroids: Rgb[] = SWATCHES.map((s) => {
    const p = project(s.center[0], s.center[1]);
    return sampleAvg(data, width, height, p.x, p.y, swatchRad);
  });

  // Classify every data cell.
  const cap = capacity(ecc);
  const cells = freeCells();
  const dataRad = Math.max(1, Math.floor(Math.min(msX, msY) * 0.3));
  const symbols = new Uint8Array(cap.cellsUsed);
  for (let k = 0; k < cap.cellsUsed; k++) {
    const col = cells[2 * k] + 0.5;
    const row = cells[2 * k + 1] + 0.5;
    const p = project(col, row);
    const [r, g, b] = sampleAvg(data, width, height, p.x, p.y, dataRad);
    symbols[k] = classify(centroids, r, g, b);
  }

  // Symbols → codewords → RS repair → payload.
  const codewordBytes = cap.nBlocks * BLOCK_TOTAL;
  const codewords = symbolsToBytes(symbols, codewordBytes);
  let payload: Uint8Array;
  try {
    payload = decodeCodewords(codewords, cap.nBlocks, ecc);
  } catch {
    return { reason: "too many cell errors — beyond error-correction capacity" };
  }

  const chunkLen = meta.len;
  if (chunkLen < 0 || chunkLen > payload.length) {
    return { reason: "frame length is implausible (corrupt metadata)" };
  }
  const chunk = payload.slice(0, chunkLen);
  if (crc32(chunk) !== (meta.c >>> 0)) {
    return { reason: "checksum mismatch after correction" };
  }

  return { index: meta.i!, count: meta.n!, chunkLen, data: chunk };
}

function isFrame(x: DecodedFrame | FrameIssue): x is DecodedFrame {
  return "data" in x;
}

export async function gatherFrames(
  images: GatheredImage[],
  onProgress?: (done: number, total: number) => void,
  perspective = false,
): Promise<GatherResult> {
  const frames: DecodedFrame[] = [];
  const issues: FrameIssue[] = [];
  for (let i = 0; i < images.length; i++) {
    const res = await decodeImage(images[i], perspective);
    if (isFrame(res)) frames.push(res);
    else issues.push(res);
    onProgress?.(i + 1, images.length);
  }
  return { frames, issues };
}

// --- video input (e.g. a screen recording of the flashing frames) ---

const VIDEO_SAMPLE_FPS = 12; // sample densely enough to catch each shown frame
const VIDEO_MAX_SAMPLES = 1800; // cap the work for long clips

function videoEvent(el: HTMLVideoElement, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error("video load failed"));
    };
    const cleanup = () => {
      el.removeEventListener(name, ok);
      el.removeEventListener("error", bad);
    };
    el.addEventListener(name, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

function seekTo(el: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(el.currentTime - t) < 1e-3) {
      resolve();
      return;
    }
    const ok = () => {
      el.removeEventListener("seeked", ok);
      resolve();
    };
    el.addEventListener("seeked", ok, { once: true });
    el.currentTime = t;
  });
}

/**
 * Decode frames out of a video by stepping through it, sampling well above the
 * likely display rate. Each sampled frame is decoded independently; frames are
 * de-duplicated by index, and we stop early once a full set is in hand. Torn or
 * mid-transition frames simply fail the CRC and are ignored.
 */
export async function gatherFramesFromVideo(
  video: GatheredVideo,
  onProgress?: (done: number, total: number) => void,
  perspective = false,
): Promise<GatherResult> {
  const issues: FrameIssue[] = [];
  const url = URL.createObjectURL(video.blob);
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  el.src = url;

  try {
    await videoEvent(el, "loadedmetadata");
    const w = el.videoWidth;
    const h = el.videoHeight;
    const dur = el.duration;
    if (!w || !h) {
      return { frames: [], issues: [{ name: video.name, reason: "video has no readable frames" }] };
    }
    if (!isFinite(dur) || dur <= 0) {
      return {
        frames: [],
        issues: [{ name: video.name, reason: "video duration is unknown — export it as a file first" }],
      };
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    let step = 1 / VIDEO_SAMPLE_FPS;
    let total = Math.ceil(dur / step);
    if (total > VIDEO_MAX_SAMPLES) {
      step = dur / VIDEO_MAX_SAMPLES;
      total = VIDEO_MAX_SAMPLES;
    }

    const byIndex = new Map<number, DecodedFrame>();
    let expected: number | null = null;
    let done = 0;
    for (let t = 0; t < dur; t += step) {
      await seekTo(el, Math.min(t, dur - 1e-3));
      ctx.drawImage(el, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const res = decodePixels(img.data, w, h, perspective);
      if ("data" in res) {
        expected = res.count;
        if (!byIndex.has(res.index)) byIndex.set(res.index, res);
      }
      onProgress?.(++done, total);
      if (expected != null && byIndex.size >= expected) break;
    }

    const frames = [...byIndex.values()];
    if (frames.length === 0) {
      issues.push({ name: video.name, reason: "no decodable frames found in the video" });
    }
    return { frames, issues };
  } catch {
    return { frames: [], issues: [{ name: video.name, reason: "couldn't be read as a video" }] };
  } finally {
    URL.revokeObjectURL(url);
  }
}
