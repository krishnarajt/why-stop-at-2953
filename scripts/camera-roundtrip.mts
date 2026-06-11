// End-to-end CAMERA validation WITHOUT a browser: render frames with the heavy
// camera error-correction profile, warp them with a real perspective transform
// (simulating a phone photographed off-axis off a screen), then decode them
// with the perspective decoder. Run: npx tsx scripts/camera-roundtrip.mts
import {
  buildFramePlan,
  paintFramePlan,
  frameCountFor,
  type Fill,
} from "@/lib/screenshot/encode";
import { decodePixels } from "@/lib/screenshot/decode";
import { assembleFrames } from "@/lib/frames";
import { CAMERA_BLOCK_ECC } from "@/lib/screenshot/codec";
import { capacity, canvasSize } from "@/lib/screenshot/layout";
import { solveHomography, type Pt } from "@/lib/screenshot/homography";

const SCALE = 9;
const ECC = CAMERA_BLOCK_ECC;

let fail = 0;
const ok = (n: string, c: boolean) => {
  console.log((c ? "✓" : "✗") + " " + n);
  if (!c) fail++;
};
const eq = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function renderFrame(chunk: Uint8Array, index: number, count: number) {
  const { w, h } = canvasSize(SCALE);
  const buf = new Uint8ClampedArray(w * h * 4);
  const fill: Fill = (x, y, fw, fh, r, g, b) => {
    const xs = Math.round(x),
      ys = Math.round(y),
      xe = Math.round(x + fw),
      ye = Math.round(y + fh);
    for (let yy = ys; yy < ye; yy++)
      for (let xx = xs; xx < xe; xx++) {
        const o = (yy * w + xx) * 4;
        buf[o] = r;
        buf[o + 1] = g;
        buf[o + 2] = b;
        buf[o + 3] = 255;
      }
  };
  const plan = buildFramePlan(chunk, index, count, ECC);
  paintFramePlan(plan, SCALE, fill);
  return { buf, w, h };
}

/** Bilinear RGB sample of a source buffer, white outside its bounds. */
function sample(buf: Uint8ClampedArray, w: number, h: number, x: number, y: number) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return [255, 255, 255];
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1),
    y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0,
    fy = y - y0;
  const px = (xx: number, yy: number, c: number) => buf[(yy * w + xx) * 4 + c];
  const out: number[] = [];
  for (let c = 0; c < 3; c++) {
    const top = px(x0, y0, c) * (1 - fx) + px(x1, y0, c) * fx;
    const bot = px(x0, y1, c) * (1 - fx) + px(x1, y1, c) * fx;
    out.push(top * (1 - fy) + bot * fy);
  }
  return out;
}

/**
 * Warp a rendered frame into a larger canvas under a perspective transform with
 * a deliberately asymmetric keystone + tilt — what a hand-held phone aimed at a
 * screen actually produces. Optionally roughen colours (gamma/range/noise).
 */
function photograph(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  rough: boolean,
) {
  const DW = Math.round(w * 1.3);
  const DH = Math.round(h * 1.3);
  const mx = DW * 0.07;
  const my = DH * 0.07;
  // Destination quad (where the screen lands in the photo) — not a rectangle.
  const dstQuad: Pt[] = [
    { x: mx + 0.1 * w, y: my + 0.02 * h }, // TL
    { x: DW - mx, y: my + 0.06 * h }, // TR
    { x: mx, y: DH - my - 0.05 * h }, // BL
    { x: DW - mx - 0.05 * w, y: DH - my }, // BR
  ];
  const srcQuad: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: 0, y: h },
    { x: w, y: h },
  ];
  // Inverse map: dest pixel → source pixel.
  const inv = solveHomography(dstQuad, srcQuad);
  if (!inv) throw new Error("warp homography failed");

  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 1000) / 1000;
  };

  const out = new Uint8ClampedArray(DW * DH * 4);
  for (let dy = 0; dy < DH; dy++) {
    for (let dx = 0; dx < DW; dx++) {
      const o = (dy * DW + dx) * 4;
      const s = inv(dx, dy);
      let rgb = s ? sample(src, w, h, s.x, s.y) : [255, 255, 255];
      if (rough) {
        rgb = rgb.map((v) => {
          const n = v / 255;
          const gamma = Math.pow(n, 1 / 1.2);
          const ranged = 16 + gamma * (235 - 16);
          return Math.max(0, Math.min(255, ranged + (rand() - 0.5) * 16));
        });
      }
      out[o] = rgb[0];
      out[o + 1] = rgb[1];
      out[o + 2] = rgb[2];
      out[o + 3] = 255;
    }
  }
  return { buf: out, w: DW, h: DH };
}

const cap = capacity(ECC);
console.log(
  `camera layout (ecc=${ECC}): ${cap.nBlocks} RS blocks, ${cap.payloadPerFrame} payload bytes/frame, cellsUsed=${cap.cellsUsed}`,
);

// --- clean camera frame decoded with the perspective decoder (near-identity) ---
{
  const chunk = new Uint8Array(cap.payloadPerFrame);
  let s = 12345;
  for (let i = 0; i < chunk.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    chunk[i] = s & 0xff;
  }
  const { buf, w, h } = renderFrame(chunk, 0, 3);
  const res = decodePixels(buf, w, h, true);
  ok("flat camera frame: perspective decoder still decodes", "data" in res);
  if ("data" in res) ok("flat camera frame: bytes exact", eq(res.data, chunk));
  else console.log("   reason:", res.reason);
}

// --- perspective-warped frame (keystone + tilt), clean colours ---
{
  const chunk = new Uint8Array(cap.payloadPerFrame);
  for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 37 + 11) & 0xff;
  const { buf, w, h } = renderFrame(chunk, 1, 3);
  const ph = photograph(buf, w, h, false);
  const res = decodePixels(ph.buf, ph.w, ph.h, true);
  ok("keystoned photo: perspective decoder recovers", "data" in res && eq(res.data, chunk));
  if (!("data" in res)) console.log("   reason:", res.reason);
}

// --- perspective + gamma/range/noise: the full "phone off a screen" channel ---
{
  const chunk = new Uint8Array(cap.payloadPerFrame);
  for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 211 + 17) & 0xff;
  const { buf, w, h } = renderFrame(chunk, 0, 1);
  const ph = photograph(buf, w, h, true);
  const res = decodePixels(ph.buf, ph.w, ph.h, true);
  ok("rough photo (warp+gamma+range+noise): recovers", "data" in res && eq(res.data, chunk));
  if (!("data" in res)) console.log("   reason:", res.reason);
}

// --- multi-frame stream round-trip through the photo channel ---
{
  const total = cap.payloadPerFrame * 2 + 137;
  const stream = new Uint8Array(total);
  let s = 999;
  for (let i = 0; i < total; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    stream[i] = s & 0xff;
  }
  const count = frameCountFor(total, ECC);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const chunk = stream.subarray(i * cap.payloadPerFrame, (i + 1) * cap.payloadPerFrame);
    const { buf, w, h } = renderFrame(chunk, i, count);
    const ph = photograph(buf, w, h, true);
    const res = decodePixels(ph.buf, ph.w, ph.h, true);
    if (!("data" in res)) {
      ok(`stream frame ${i}`, false);
      console.log("   reason:", res.reason);
      continue;
    }
    frames.push(res);
  }
  const asm = assembleFrames(frames);
  ok("stream reassembled exactly through photo channel", asm.ok && eq(asm.stream, stream));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`);
process.exit(fail ? 1 : 0);
