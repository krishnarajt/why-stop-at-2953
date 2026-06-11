// End-to-end SCREENSHOT validation WITHOUT a browser: render frames to an RGBA
// buffer using the real encoder, then decode them with the real decoder
// (jsQR + registration + classification + Reed–Solomon). Also injects cell
// errors to confirm RS recovers them. Run: npx tsx scripts/screenshot-roundtrip.mts
import { buildFramePlan, paintFramePlan, frameCountFor, type Fill } from "@/lib/screenshot/encode";
import { decodePixels } from "@/lib/screenshot/decode";
import { assembleFrames } from "@/lib/frames";
import { capacity, canvasSize, contentOrigin, freeCells } from "@/lib/screenshot/layout";
import { PALETTE } from "@/lib/screenshot/palette";

const SCALE = 10;

let fail = 0;
const ok = (n: string, c: boolean) => { console.log((c ? "✓" : "✗") + " " + n); if (!c) fail++; };
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

function renderFrame(chunk: Uint8Array, index: number, count: number) {
  const { w, h } = canvasSize(SCALE);
  const buf = new Uint8ClampedArray(w * h * 4);
  const fill: Fill = (x, y, fw, fh, r, g, b) => {
    const xs = Math.round(x), ys = Math.round(y), xe = Math.round(x + fw), ye = Math.round(y + fh);
    for (let yy = ys; yy < ye; yy++) for (let xx = xs; xx < xe; xx++) {
      const o = (yy * w + xx) * 4; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
    }
  };
  const plan = buildFramePlan(chunk, index, count);
  paintFramePlan(plan, SCALE, fill);
  return { buf, w, h };
}

/** Repaint `n` data cells with a deliberately wrong palette colour. */
function corruptCells(buf: Uint8ClampedArray, w: number, n: number) {
  const cells = freeCells();
  const origin = contentOrigin(SCALE);
  const used = capacity().cellsUsed;
  for (let e = 0; e < n; e++) {
    const k = Math.floor((e * 7919) % used); // spread-out deterministic indices
    const col = cells[2 * k], row = cells[2 * k + 1];
    const wrong = PALETTE[(e + 3) % PALETTE.length];
    const xs = origin.x + col * SCALE, ys = origin.y + row * SCALE;
    for (let yy = ys; yy < ys + SCALE; yy++) for (let xx = xs; xx < xs + SCALE; xx++) {
      const o = (yy * w + xx) * 4; buf[o] = wrong[0]; buf[o + 1] = wrong[1]; buf[o + 2] = wrong[2];
    }
  }
}

const cap = capacity();
console.log(`layout: ${cap.freeCellCount} free cells, ${cap.nBlocks} RS blocks, ${cap.payloadPerFrame} payload bytes/frame, cellsUsed=${cap.cellsUsed}`);

// --- single clean frame ---
{
  const chunk = new Uint8Array(cap.payloadPerFrame);
  let s = 12345; for (let i = 0; i < chunk.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; chunk[i] = s & 0xff; }
  const { buf, w, h } = renderFrame(chunk, 0, 3);
  const res = decodePixels(buf, w, h);
  ok("clean frame: decodes", "data" in res);
  if ("data" in res) {
    ok("clean frame: index/count", res.index === 0 && res.count === 3);
    ok("clean frame: bytes exact", eq(res.data, chunk));
  } else console.log("   reason:", res.reason);
}

// --- frame with injected cell errors (within RS capacity) ---
{
  const chunk = new Uint8Array(cap.payloadPerFrame);
  for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 37 + 11) & 0xff;
  const { buf, w, h } = renderFrame(chunk, 1, 3);
  // 34 errors/block * nBlocks is the ceiling; interleaving means ~ that many
  // scattered cells are tolerable. Inject a healthy fraction below that.
  corruptCells(buf, w, 20 * cap.nBlocks);
  const res = decodePixels(buf, w, h);
  ok(`frame w/ ${20 * cap.nBlocks} bad cells: RS recovers`, "data" in res && eq(res.data, chunk));
  if (!("data" in res)) console.log("   reason:", res.reason);
}

// --- multi-frame stream round-trip + assembly ---
{
  const total = cap.payloadPerFrame * 2 + 137;
  const stream = new Uint8Array(total);
  let s = 999; for (let i = 0; i < total; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; stream[i] = s & 0xff; }
  const count = frameCountFor(total);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const chunk = stream.subarray(i * cap.payloadPerFrame, i * cap.payloadPerFrame + cap.payloadPerFrame);
    const { buf, w, h } = renderFrame(chunk, i, count);
    const res = decodePixels(buf, w, h);
    if (!("data" in res)) { ok(`stream frame ${i}`, false); console.log("   reason:", res.reason); continue; }
    ok(`stream frame ${i} decodes (len ${res.chunkLen})`, true);
    frames.push(res);
  }
  const asm = assembleFrames(frames);
  ok("stream reassembled exactly", asm.ok && eq(asm.stream, stream));
}

// --- colour distortion: limited range (16–235) + gamma + noise + a few bad cells ---
// This is what a lossy pipeline does to colours; the decoder must lean on the
// measured calibration swatches (not nominal values) to survive it.
{
  const chunk = new Uint8Array(cap.payloadPerFrame);
  for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 211 + 17) & 0xff;
  const { buf, w, h } = renderFrame(chunk, 0, 1);
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 1000) / 1000; };
  for (let i = 0; i < buf.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = buf[i + c] / 255;
      const gamma = Math.pow(v, 1 / 1.25);
      const ranged = 16 + gamma * (235 - 16);
      const noisy = ranged + (rand() - 0.5) * 14;
      buf[i + c] = Math.max(0, Math.min(255, Math.round(noisy)));
    }
  }
  corruptCells(buf, w, 8 * cap.nBlocks);
  const res = decodePixels(buf, w, h);
  ok("distorted frame (range+gamma+noise+bad cells): recovers", "data" in res && eq(res.data, chunk));
  if (!("data" in res)) console.log("   reason:", res.reason);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`);
process.exit(fail ? 1 : 0);
