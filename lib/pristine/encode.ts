/**
 * PRISTINE color encoder.
 *
 * Maps a byte stream onto 1080p images at the lossless theoretical limit:
 * every pixel carries 3 bytes (one per RGB channel), so 1 cell = 3 bytes.
 * Cells are square blocks of `cell` pixels; a white `border` frames the
 * content as a quiet zone. Output is PNG — lossless, so the channel values
 * survive a clean screen capture or export byte-for-byte.
 *
 * Self-description lives in a fixed-geometry BEACON painted into the top-left
 * quiet zone (see BEACON_* below). Because the beacon's position and cell size
 * are constant — independent of the chosen content grid — a decoder can read
 * it first to recover `cell`/`border`, then locate the content cells. The same
 * facts are also printed human-readably in the top label band. The content
 * cells therefore carry pure payload, with no in-band header.
 */

export const FRAME_W = 1920;
export const FRAME_H = 1080;
export const BYTES_PER_CELL = 3;

/**
 * Fixed-geometry beacon — the bootstrap a decoder reads before it knows the
 * content grid. It sits in the top-left corner (inside the quiet zone / label
 * band, never overlapping content) at a constant cell size, so it is always
 * found at the same pixels regardless of the chosen `cell`/`border`.
 *
 * Byte layout (12 bytes => 4 cells of 3 bytes):
 *   0   magic (0xB1)
 *   1   version (1)
 *   2   cell        (1..16)
 *   3   border      (0..255)
 *   4   frameIndex  u16
 *   6   frameCount  u16
 *   8   chunkLen    u32
 */
export const BEACON_MAGIC = 0xb1;
export const BEACON_VERSION = 1;
export const BEACON_BYTES = 12;
export const BEACON_CELL = 8;
export const BEACON_X = 8;
export const BEACON_Y = 8;
export const BEACON_CELLS = Math.ceil(BEACON_BYTES / BYTES_PER_CELL);

export const DEFAULT_CELL = 5;
export const DEFAULT_BORDER = 48;
/** Minimum top quiet-zone reserved for the human-readable "i / n" label. */
export const LABEL_BAND = 44;

/** Absolute ceiling: 1 px = 3 bytes, no border, no header. */
export const THEORETICAL_MAX_PER_FRAME = FRAME_W * FRAME_H * BYTES_PER_CELL;

export interface PristineOptions {
  cell: number;
  border: number;
}

export interface PristineLayout {
  cell: number;
  border: number;
  /** Top inset for content — max(border, LABEL_BAND) so the label always fits. */
  topInset: number;
  cols: number;
  rows: number;
  cellsPerFrame: number;
  /** Raw bytes a frame's content cells can hold. */
  frameCapacityBytes: number;
  /** Payload bytes per frame. Metadata lives in the beacon, so this equals
   *  frameCapacityBytes — the full content grid is available for payload. */
  dataPerFrame: number;
}

export interface PristineFrame {
  index: number;
  url: string;
  blob: Blob;
}

export interface PristineResult {
  frames: PristineFrame[];
  layout: PristineLayout;
  streamBytes: number;
  frameCount: number;
}

export function computeLayout(opts: PristineOptions): PristineLayout {
  const cell = Math.max(1, Math.floor(opts.cell));
  const border = Math.max(0, Math.floor(opts.border));
  // Reserve a top band for the visible label; never let it overlap data.
  const topInset = Math.max(border, LABEL_BAND);
  const contentW = FRAME_W - border * 2;
  const contentH = FRAME_H - topInset - border;
  const cols = Math.max(0, Math.floor(contentW / cell));
  const rows = Math.max(0, Math.floor(contentH / cell));
  const cellsPerFrame = cols * rows;
  const frameCapacityBytes = cellsPerFrame * BYTES_PER_CELL;
  const dataPerFrame = frameCapacityBytes;
  return {
    cell,
    border,
    topInset,
    cols,
    rows,
    cellsPerFrame,
    frameCapacityBytes,
    dataPerFrame,
  };
}

export function frameCountFor(streamBytes: number, layout: PristineLayout) {
  if (layout.dataPerFrame <= 0) return Infinity;
  return Math.max(1, Math.ceil(streamBytes / layout.dataPerFrame));
}

/** Pack the fixed-geometry beacon metadata into its 12 bytes. */
export function makeBeaconBytes(
  index: number,
  count: number,
  chunkLen: number,
  cell: number,
  border: number,
) {
  const h = new Uint8Array(BEACON_BYTES);
  const dv = new DataView(h.buffer);
  h[0] = BEACON_MAGIC;
  h[1] = BEACON_VERSION;
  h[2] = cell;
  h[3] = Math.min(255, border);
  dv.setUint16(4, index, false);
  dv.setUint16(6, count, false);
  dv.setUint32(8, chunkLen, false);
  return h;
}

/** Paint the beacon as fixed-size color cells in the top-left corner. */
function paintBeacon(ctx: CanvasRenderingContext2D, beacon: Uint8Array) {
  for (let i = 0; i < BEACON_CELLS; i++) {
    const b = i * BYTES_PER_CELL;
    const r = beacon[b] ?? 0;
    const g = beacon[b + 1] ?? 0;
    const bl = beacon[b + 2] ?? 0;
    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    ctx.fillRect(
      BEACON_X + i * BEACON_CELL,
      BEACON_Y,
      BEACON_CELL,
      BEACON_CELL,
    );
  }
}

/** Paint one frame's bytes into a 1080p canvas (white quiet-zone + color cells). */
function paintFrame(
  canvas: HTMLCanvasElement,
  cellCanvas: HTMLCanvasElement,
  chunk: Uint8Array,
  layout: PristineLayout,
  index: number,
  count: number,
) {
  const { cols, rows, cell, border, topInset } = layout;

  // Build the low-res cell grid (1px == 1 cell) then scale up crisply.
  const cctx = cellCanvas.getContext("2d")!;
  const img = cctx.createImageData(cols, rows);
  const data = img.data;
  for (let i = 0; i < cols * rows; i++) {
    const o = i * 4;
    const b = i * BYTES_PER_CELL;
    if (b < chunk.length) {
      data[o] = chunk[b] ?? 255;
      data[o + 1] = chunk[b + 1] ?? 255;
      data[o + 2] = chunk[b + 2] ?? 255;
    } else {
      data[o] = data[o + 1] = data[o + 2] = 255; // white padding
    }
    data[o + 3] = 255;
  }
  cctx.putImageData(img, 0, 0);

  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  ctx.imageSmoothingEnabled = false;
  // Content sits below the reserved top label band.
  ctx.drawImage(
    cellCanvas,
    0,
    0,
    cols,
    rows,
    border,
    topInset,
    cols * cell,
    rows * cell,
  );

  // Human-readable order + layout label, centred in the top quiet-zone.
  const pad = String(count).length;
  const label = `${String(index + 1).padStart(pad, "0")} / ${count}  ·  cell ${cell} · border ${border}`;
  const fontSize = Math.max(14, Math.min(26, Math.floor(topInset * 0.5)));
  ctx.fillStyle = "#000000";
  ctx.font = `700 ${fontSize}px ui-monospace, "Courier New", monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(label, FRAME_W / 2, topInset / 2);

  // Fixed-geometry beacon (machine-readable bootstrap), painted last so it
  // always lands on clean white in the top-left corner.
  paintBeacon(ctx, makeBeaconBytes(index, count, chunk.length, cell, border));
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}

/**
 * Encode a byte stream into pristine PNG frames.
 * `onProgress(done, total)` fires per frame so the UI can show progress.
 */
export async function encodePristine(
  stream: Uint8Array,
  opts: PristineOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<PristineResult> {
  const layout = computeLayout(opts);
  if (layout.dataPerFrame <= 0) {
    throw new Error("Cell/border leave no room for data. Reduce them.");
  }

  const count = frameCountFor(stream.length, layout);

  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const cellCanvas = document.createElement("canvas");
  cellCanvas.width = layout.cols;
  cellCanvas.height = layout.rows;

  const frames: PristineFrame[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * layout.dataPerFrame;
    const chunk = stream.subarray(start, start + layout.dataPerFrame);

    paintFrame(canvas, cellCanvas, chunk, layout, i, count);
    const blob = await canvasToPng(canvas);
    frames.push({ index: i, url: URL.createObjectURL(blob), blob });
    onProgress?.(i + 1, count);
    // Yield to the event loop so the UI stays responsive on big payloads.
    await new Promise((r) => setTimeout(r, 0));
  }

  return { frames, layout, streamBytes: stream.length, frameCount: count };
}
