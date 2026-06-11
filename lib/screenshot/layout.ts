import { BLOCK_ECC, blockPlan } from "./codec";

/**
 * SCREENSHOT frame geometry — shared verbatim by encoder and decoder.
 *
 * Everything is expressed in *modules* (grid cells). The encoder paints each
 * module as a `scale`×`scale` pixel block; the decoder recovers the real
 * pixel mapping from the anchor QR + corner markers, so it never assumes a
 * resolution. Region coordinates are module (col,row) within the content grid
 * whose top-left module is (0,0).
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ ░ QR anchor ░   [swatch swatch …×8]      ▓ TR │
 *   │ ░ (metadata)░                                 │
 *   │ ░░░░░░░░░░░░░                                  │
 *   │                  data cells (8 colours)       │
 *   │ ▓ BL                                     ▓ BR │
 *   └──────────────────────────────────────────────┘
 * The QR keeps a white guard so jsQR sees a valid quiet zone; markers keep a
 * guard so neighbouring data never touches them.
 */

export const DEFAULT_SCALE = 10; // px per module
export const MIN_SCALE = 6;
export const MAX_SCALE = 16;

export const QUIET = 4; // outer white quiet zone, in modules
export const CONTENT_W = 150;
export const CONTENT_H = 86;

// Anchor QR: fixed version so its module count is constant and positionable.
export const QR_VERSION = 6;
export const QR_MOD = 17 + 4 * QR_VERSION; // 41
export const QR_ECC = "Q" as const;
export const QR_GUARD = 4; // white quiet around the QR (right & bottom)

// Solid corner markers for full-frame registration.
export const MARKER = 9; // module side
export const MARKER_GUARD = 2;

// Calibration swatches (one per palette colour).
export const SWATCH = 8; // module side
export const SWATCH_COL0 = QR_MOD + QR_GUARD + 1; // first swatch column
export const SWATCH_ROW0 = 0;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Marked {
  rect: Rect;
  /** Module-space centre, used as a registration reference. */
  center: [number, number];
}

/** The three solid corner markers (TR, BL, BR), flush to the content corners. */
export const MARKERS: Marked[] = [
  {
    rect: { x: CONTENT_W - MARKER, y: 0, w: MARKER, h: MARKER },
    center: [CONTENT_W - MARKER / 2, MARKER / 2],
  },
  {
    rect: { x: 0, y: CONTENT_H - MARKER, w: MARKER, h: MARKER },
    center: [MARKER / 2, CONTENT_H - MARKER / 2],
  },
  {
    rect: { x: CONTENT_W - MARKER, y: CONTENT_H - MARKER, w: MARKER, h: MARKER },
    center: [CONTENT_W - MARKER / 2, CONTENT_H - MARKER / 2],
  },
];

/** The eight calibration swatches, left→right, matching PALETTE order. */
export const SWATCHES: Marked[] = Array.from({ length: 8 }, (_, i) => ({
  rect: { x: SWATCH_COL0 + i * SWATCH, y: SWATCH_ROW0, w: SWATCH, h: SWATCH },
  center: [SWATCH_COL0 + i * SWATCH + SWATCH / 2, SWATCH_ROW0 + SWATCH / 2],
}));

/** QR's four corners, in module coordinates (for the affine reference fit). */
export const QR_CORNERS = {
  topLeft: [0, 0] as [number, number],
  topRight: [QR_MOD, 0] as [number, number],
  bottomLeft: [0, QR_MOD] as [number, number],
  bottomRight: [QR_MOD, QR_MOD] as [number, number],
};

/** Rectangles excluded from the data field (kept white or painted specially). */
function reservedRects(): Rect[] {
  const rects: Rect[] = [
    // QR + its white guard.
    { x: 0, y: 0, w: QR_MOD + QR_GUARD, h: QR_MOD + QR_GUARD },
    // Swatch strip + a one-module guard below.
    { x: SWATCH_COL0, y: SWATCH_ROW0, w: 8 * SWATCH, h: SWATCH + 1 },
  ];
  for (const m of MARKERS) {
    rects.push({
      x: Math.max(0, m.rect.x - MARKER_GUARD),
      y: Math.max(0, m.rect.y - MARKER_GUARD),
      w: m.rect.w + MARKER_GUARD,
      h: m.rect.h + MARKER_GUARD,
    });
  }
  return rects;
}

function inRect(col: number, row: number, r: Rect): boolean {
  return col >= r.x && col < r.x + r.w && row >= r.y && row < r.y + r.h;
}

let freeCellsCache: Int16Array | null = null;

/**
 * Ordered list of data-cell coordinates (row-major, reserved cells skipped),
 * as a flat [col0,row0, col1,row1, …]. The single source of truth for which
 * cell carries which symbol — encoder and decoder both walk it in order.
 */
export function freeCells(): Int16Array {
  if (freeCellsCache) return freeCellsCache;
  const reserved = reservedRects();
  const out: number[] = [];
  for (let row = 0; row < CONTENT_H; row++) {
    for (let col = 0; col < CONTENT_W; col++) {
      if (reserved.some((r) => inRect(col, row, r))) continue;
      out.push(col, row);
    }
  }
  freeCellsCache = Int16Array.from(out);
  return freeCellsCache;
}

export interface Capacity {
  freeCellCount: number;
  nBlocks: number;
  /** Payload (pre-RS) bytes carried per frame. */
  payloadPerFrame: number;
  /** Data cells actually used (the rest are padded). */
  cellsUsed: number;
}

const capacityCache = new Map<number, Capacity>();

/**
 * How many RS blocks (and thus payload bytes) fit in one frame at a given
 * error-correction strength. The cell geometry (block count, cells used) is
 * fixed by the layout — only the payload-vs-parity split changes with `ecc`,
 * so a heavier profile (camera) simply carries fewer payload bytes per frame.
 */
export function capacity(ecc: number = BLOCK_ECC): Capacity {
  const cached = capacityCache.get(ecc);
  if (cached) return cached;
  const freeCellCount = freeCells().length / 2;
  const cellsPerBlock = blockPlan(1).cells; // 680 — independent of ecc
  const nBlocks = Math.max(1, Math.floor(freeCellCount / cellsPerBlock));
  const plan = blockPlan(nBlocks, ecc);
  const cap: Capacity = {
    freeCellCount,
    nBlocks,
    payloadPerFrame: plan.dataBytes,
    cellsUsed: plan.cells,
  };
  capacityCache.set(ecc, cap);
  return cap;
}

export function canvasSize(scale: number) {
  return {
    w: (CONTENT_W + 2 * QUIET) * scale,
    h: (CONTENT_H + 2 * QUIET) * scale,
  };
}

/** Pixel offset of content module (0,0)'s top-left corner. */
export function contentOrigin(scale: number) {
  return { x: QUIET * scale, y: QUIET * scale };
}
