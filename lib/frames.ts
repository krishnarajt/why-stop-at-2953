import { unzipSync } from "fflate";

/**
 * Shared frame-sequence assembly + the completeness gate, used by every
 * decode variant (pristine, screenshot, …). A variant decodes images into
 * {index, count, data} frames; this reorders them and refuses to reconstruct
 * unless the full set is present.
 */

const IMAGE_EXT = /\.(png|apng|gif|bmp|webp|jpe?g)$/i;
const ZIP_EXT = /\.zip$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogg|ogv|mkv|avi)$/i;

export interface GatheredImage {
  name: string;
  blob: Blob;
}

export interface GatheredVideo {
  name: string;
  blob: Blob;
}

/** An uploaded image that wasn't a usable frame, with the reason why. */
export interface FrameIssue {
  name: string;
  reason: string;
}

function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name);
}

/**
 * Flatten an upload (loose images and/or ZIP archives) into a list of image
 * blobs. ZIP entries are unpacked in-browser; non-image entries are dropped.
 */
export async function collectImages(files: File[]): Promise<GatheredImage[]> {
  const out: GatheredImage[] = [];
  for (const file of files) {
    const looksZip = ZIP_EXT.test(file.name) || file.type === "application/zip";
    if (looksZip) {
      const buf = new Uint8Array(await file.arrayBuffer());
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(buf);
      } catch {
        continue; // unreadable archive — skip it
      }
      for (const [name, bytes] of Object.entries(entries)) {
        if (!isImageName(name)) continue;
        const owned = bytes.slice();
        out.push({ name, blob: new Blob([owned], { type: "image/png" }) });
      }
    } else if (isImageName(file.name) || file.type.startsWith("image/")) {
      out.push({ name: file.name, blob: file });
    }
  }
  return out;
}

/** Pull video files (e.g. a screen recording) out of an upload. */
export function collectVideos(files: File[]): GatheredVideo[] {
  return files
    .filter((f) => VIDEO_EXT.test(f.name) || f.type.startsWith("video/"))
    .map((f) => ({ name: f.name, blob: f }));
}

/** Read an image blob into raw RGBA pixels via a canvas (browser only). */
export async function readPixels(
  blob: Blob,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { data: img.data, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export interface SeqFrame {
  index: number;
  count: number;
  /** This frame's slice of the original stream. */
  data: Uint8Array;
}

export interface AssembleSuccess {
  ok: true;
  stream: Uint8Array;
  frameCount: number;
}
export interface AssembleFailure {
  ok: false;
  reason: string;
  frameCount: number | null;
  present: number[];
  missing: number[];
}
export type AssembleResult = AssembleSuccess | AssembleFailure;

export function assembleFrames(frames: SeqFrame[]): AssembleResult {
  if (frames.length === 0) {
    return {
      ok: false,
      reason: "No decodable frames were found in the upload.",
      frameCount: null,
      present: [],
      missing: [],
    };
  }

  const counts = new Set(frames.map((f) => f.count));
  if (counts.size > 1) {
    return {
      ok: false,
      reason:
        "These images come from different transmissions (they disagree on the total frame count).",
      frameCount: null,
      present: [...new Set(frames.map((f) => f.index))].sort((a, b) => a - b),
      missing: [],
    };
  }

  const frameCount = frames[0].count;

  const byIndex = new Map<number, SeqFrame>();
  for (const f of frames) if (!byIndex.has(f.index)) byIndex.set(f.index, f);

  const present = [...byIndex.keys()].sort((a, b) => a - b);
  const missing: number[] = [];
  for (let i = 0; i < frameCount; i++) if (!byIndex.has(i)) missing.push(i);

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Insufficient frames to reconstruct: have ${present.length} of ${frameCount}.`,
      frameCount,
      present,
      missing,
    };
  }

  const total = present.reduce((n, i) => n + byIndex.get(i)!.data.length, 0);
  const stream = new Uint8Array(total);
  let off = 0;
  for (let i = 0; i < frameCount; i++) {
    const chunk = byIndex.get(i)!.data;
    stream.set(chunk, off);
    off += chunk.length;
  }

  return { ok: true, stream, frameCount };
}

/** Compact "missing #3, #7, #8" summary, capped so it never runs away. */
export function summarizeMissing(missing: number[], cap = 12): string {
  if (missing.length === 0) return "";
  const shown = missing.slice(0, cap).map((i) => `#${i + 1}`);
  const more = missing.length - shown.length;
  return more > 0 ? `${shown.join(", ")} … (+${more} more)` : shown.join(", ");
}
