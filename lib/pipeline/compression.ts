import {
  init as zstdInit,
  compress as zstdCompress,
  decompress as zstdDecompress,
} from "@bokuweb/zstd-wasm";

/**
 * Zstandard compression (level 19) via WASM, lazy-initialised.
 * The .wasm binary is served from /public/zstd.wasm.
 *
 * Reused from the why-stop-at-64 stego pipeline so payloads compress
 * identically across the two projects.
 */

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await (zstdInit as (path?: string) => Promise<void>)("/zstd.wasm");
    initialized = true;
  }
}

const MB = 1024 * 1024;

/**
 * Pick a Zstd level that trades ratio for speed as inputs grow. Level 19 is
 * great for a few MB but crawls on hundreds of MB (it's a synchronous WASM
 * call that blocks the main thread). Decompression is level-agnostic, so this
 * has no effect on the decode path.
 */
export function levelFor(bytes: number): number {
  if (bytes < 5 * MB) return 19;
  if (bytes < 50 * MB) return 12;
  if (bytes < 250 * MB) return 7;
  return 3;
}

/** Rough throughput (bytes/sec) per level — used only for time estimates. */
export function throughputForLevel(level: number): number {
  if (level >= 19) return 6 * MB;
  if (level >= 12) return 25 * MB;
  if (level >= 7) return 60 * MB;
  return 120 * MB;
}

export async function compress(
  data: Uint8Array,
  level?: number,
): Promise<Uint8Array> {
  await ensureInit();
  return zstdCompress(data, level ?? levelFor(data.length));
}

export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  await ensureInit();
  return zstdDecompress(data);
}
