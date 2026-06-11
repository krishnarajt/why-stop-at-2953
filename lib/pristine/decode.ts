import {
  readPixels,
  type FrameIssue,
  type GatheredImage,
} from "@/lib/frames";
import {
  computeLayout,
  BEACON_BYTES,
  BEACON_CELL,
  BEACON_CELLS,
  BEACON_MAGIC,
  BEACON_X,
  BEACON_Y,
  BYTES_PER_CELL,
  FRAME_H,
  FRAME_W,
} from "./encode";

/**
 * PRISTINE color decoder — the inverse of the encoder's frame painting.
 *
 * For each image we first read the fixed-geometry beacon (top-left corner, a
 * constant cell size) to recover `cell`/`border` and the frame's position in
 * the sequence. From `cell`/`border` we rebuild the exact content grid and
 * sample the centre of every cell back into bytes. The per-frame chunks are
 * then reordered by index and concatenated into the original container stream.
 *
 * This is the lossless path: it assumes pixel-exact PNGs (a clean screen
 * capture or export). It is not resilient to JPEG/scaling round-trips — that's
 * what the future Screenshot/Camera variants are for.
 */

export interface DecodedFrame {
  index: number;
  count: number;
  cell: number;
  border: number;
  chunkLen: number;
  /** The frame's slice of the stream (length === chunkLen). */
  data: Uint8Array;
}

export interface GatherResult {
  frames: DecodedFrame[];
  issues: FrameIssue[];
}

/** Read the RGB triple at the centre of a cell, given the cell's top-left. */
function sampleCell(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  cell: number,
): [number, number, number] {
  const c = cell >> 1;
  const o = ((y + c) * width + (x + c)) * 4;
  return [data[o], data[o + 1], data[o + 2]];
}

/** Decode one image into a frame, or explain why it isn't a PRISTINE frame. */
export async function decodeImage(
  img: GatheredImage,
): Promise<DecodedFrame | FrameIssue> {
  let pixels: Awaited<ReturnType<typeof readPixels>>;
  try {
    pixels = await readPixels(img.blob);
  } catch {
    return { name: img.name, reason: "couldn't be read as an image" };
  }
  const { data, width, height } = pixels;

  if (width !== FRAME_W || height !== FRAME_H) {
    return {
      name: img.name,
      reason: `wrong size (${width}×${height}, expected ${FRAME_W}×${FRAME_H})`,
    };
  }

  // ---- beacon: fixed position, fixed cell size ----
  const beacon = new Uint8Array(BEACON_CELLS * BYTES_PER_CELL);
  for (let i = 0; i < BEACON_CELLS; i++) {
    const [r, g, b] = sampleCell(
      data,
      width,
      BEACON_X + i * BEACON_CELL,
      BEACON_Y,
      BEACON_CELL,
    );
    beacon[i * 3] = r;
    beacon[i * 3 + 1] = g;
    beacon[i * 3 + 2] = b;
  }

  if (beacon[0] !== BEACON_MAGIC) {
    return { name: img.name, reason: "no PRISTINE beacon (not one of our frames)" };
  }

  const dv = new DataView(beacon.buffer, 0, BEACON_BYTES);
  const cell = beacon[2];
  const border = beacon[3];
  const index = dv.getUint16(4, false);
  const count = dv.getUint16(6, false);
  const chunkLen = dv.getUint32(8, false);

  if (cell < 1 || cell > 64 || count < 1 || index >= count) {
    return { name: img.name, reason: "beacon is corrupt (implausible values)" };
  }

  const layout = computeLayout({ cell, border });
  if (layout.dataPerFrame <= 0 || chunkLen > layout.frameCapacityBytes) {
    return { name: img.name, reason: "beacon disagrees with the grid (corrupt)" };
  }

  // ---- content: sample every cell centre back into bytes ----
  const { cols, rows, topInset } = layout;
  const out = new Uint8Array(layout.frameCapacityBytes);
  let bi = 0;
  for (let r = 0; r < rows; r++) {
    const y = topInset + r * cell;
    for (let col = 0; col < cols; col++) {
      const [R, G, B] = sampleCell(data, width, border + col * cell, y, cell);
      out[bi++] = R;
      out[bi++] = G;
      out[bi++] = B;
    }
  }

  return { index, count, cell, border, chunkLen, data: out.slice(0, chunkLen) };
}

function isFrame(x: DecodedFrame | FrameIssue): x is DecodedFrame {
  return "data" in x;
}

/**
 * Decode every gathered image, reporting progress per image. Frames and
 * non-frames (with reasons) are returned separately.
 */
export async function gatherFrames(
  images: GatheredImage[],
  onProgress?: (done: number, total: number) => void,
): Promise<GatherResult> {
  const frames: DecodedFrame[] = [];
  const issues: FrameIssue[] = [];
  for (let i = 0; i < images.length; i++) {
    const res = await decodeImage(images[i]);
    if (isFrame(res)) frames.push(res);
    else issues.push(res);
    onProgress?.(i + 1, images.length);
  }
  return { frames, issues };
}

// Frame assembly + the completeness gate now live in the shared module so the
// screenshot variant reuses them. Re-exported for existing importers.
export {
  assembleFrames,
  summarizeMissing,
  type AssembleResult,
} from "@/lib/frames";
