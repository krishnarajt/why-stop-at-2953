import { levelFor, throughputForLevel } from "@/lib/pipeline/compression";
import type { PristineLayout } from "./encode";

/**
 * Pre-flight estimates for a pristine transmission. These are deliberately
 * conservative: we can't know the compressed size without compressing, so the
 * frame count assumes NO compression gain (worst case) — actual runs are often
 * far fewer frames for compressible data. Times are rough, order-of-magnitude.
 */

/** Wall-clock per frame for render + PNG encode + event-loop yield. */
const PER_FRAME_SEC = 0.05;
/** AES-GCM is typically hardware-accelerated. */
const ENCRYPT_THROUGHPUT = 400 * 1024 * 1024;
/** Container header + AES salt/iv/tag overhead. */
const OVERHEAD = 64;

export interface PristineEstimate {
  level: number;
  /** Upper bound on frames (assumes incompressible input). */
  framesMax: number;
  /** Seconds to encode (compress + encrypt + render), rough. */
  encodeSec: number;
  /** Seconds of video at the given framerate. */
  videoSec: number;
}

export function estimatePristine(
  sourceBytes: number,
  layout: PristineLayout,
  fps: number,
): PristineEstimate | null {
  if (sourceBytes <= 0 || layout.dataPerFrame <= 0) return null;

  const level = levelFor(sourceBytes);
  const streamMax = sourceBytes + OVERHEAD;
  const framesMax = Math.max(1, Math.ceil(streamMax / layout.dataPerFrame));

  const compressSec = sourceBytes / throughputForLevel(level);
  const encryptSec = sourceBytes / ENCRYPT_THROUGHPUT;
  const renderSec = framesMax * PER_FRAME_SEC;
  const encodeSec = compressSec + encryptSec + renderSec;

  const videoSec = framesMax / Math.max(1, fps);

  return { level, framesMax, encodeSec, videoSec };
}

/** "1.2s", "3m 04s", "1h 12m". */
export function formatDuration(sec: number): string {
  if (sec < 1) return "<1s";
  if (sec < 10) return `${sec.toFixed(1)}s`;
  // Round once up front so 59.7s carries into "1m 00s", not "60s"/"1m 60s".
  const total = Math.round(sec);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}
