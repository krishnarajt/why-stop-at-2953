// Pure-JS verification of the PRISTINE encode<->decode GEOMETRY.
// It mirrors the canvas paint (white bg + nearest-neighbor scaled content +
// fixed beacon) and the decoder's center-sampling, on a plain RGBA buffer.
// Catches index/ordering bugs without a browser. Run: node scripts/roundtrip-check.mjs

const FRAME_W = 1920,
  FRAME_H = 1080,
  BYTES_PER_CELL = 3,
  LABEL_BAND = 44;
const BEACON_MAGIC = 0xb1,
  BEACON_VERSION = 1,
  BEACON_BYTES = 12,
  BEACON_CELL = 8,
  BEACON_X = 8,
  BEACON_Y = 8;
const BEACON_CELLS = Math.ceil(BEACON_BYTES / BYTES_PER_CELL);

function computeLayout(cell, border) {
  const topInset = Math.max(border, LABEL_BAND);
  const cols = Math.max(0, Math.floor((FRAME_W - border * 2) / cell));
  const rows = Math.max(0, Math.floor((FRAME_H - topInset - border) / cell));
  const cellsPerFrame = cols * rows;
  const frameCapacityBytes = cellsPerFrame * BYTES_PER_CELL;
  return { cell, border, topInset, cols, rows, frameCapacityBytes, dataPerFrame: frameCapacityBytes };
}

function makeBeaconBytes(index, count, chunkLen, cell, border) {
  const h = new Uint8Array(BEACON_BYTES);
  const dv = new DataView(h.buffer);
  h[0] = BEACON_MAGIC; h[1] = BEACON_VERSION; h[2] = cell; h[3] = Math.min(255, border);
  dv.setUint16(4, index, false); dv.setUint16(6, count, false); dv.setUint32(8, chunkLen, false);
  return h;
}

// --- paint (mirror of encode.ts paintFrame) ---
function paint(chunk, layout, index, count) {
  const { cols, rows, cell, border, topInset } = layout;
  const px = new Uint8ClampedArray(FRAME_W * FRAME_H * 4).fill(255); // white, opaque
  const set = (x, y, r, g, b) => { const o = (y * FRAME_W + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; };

  // content: each source cell -> cell x cell nearest-neighbor block
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const b = (r * cols + c) * BYTES_PER_CELL;
      const R = b < chunk.length ? chunk[b] : 255;
      const G = b + 1 < chunk.length ? chunk[b + 1] : 255;
      const B = b + 2 < chunk.length ? chunk[b + 2] : 255;
      for (let dy = 0; dy < cell; dy++)
        for (let dx = 0; dx < cell; dx++)
          set(border + c * cell + dx, topInset + r * cell + dy, R, G, B);
    }
  }
  // beacon
  const beacon = makeBeaconBytes(index, count, chunk.length, cell, border);
  for (let i = 0; i < BEACON_CELLS; i++) {
    const b = i * BYTES_PER_CELL;
    for (let dy = 0; dy < BEACON_CELL; dy++)
      for (let dx = 0; dx < BEACON_CELL; dx++)
        set(BEACON_X + i * BEACON_CELL + dx, BEACON_Y + dy, beacon[b] ?? 0, beacon[b + 1] ?? 0, beacon[b + 2] ?? 0);
  }
  return px;
}

// --- decode (mirror of decode.ts) ---
function sample(px, x, y, cell) {
  const c = cell >> 1;
  const o = ((y + c) * FRAME_W + (x + c)) * 4;
  return [px[o], px[o + 1], px[o + 2]];
}
function decode(px) {
  const beacon = new Uint8Array(BEACON_CELLS * BYTES_PER_CELL);
  for (let i = 0; i < BEACON_CELLS; i++) {
    const [r, g, b] = sample(px, BEACON_X + i * BEACON_CELL, BEACON_Y, BEACON_CELL);
    beacon[i * 3] = r; beacon[i * 3 + 1] = g; beacon[i * 3 + 2] = b;
  }
  if (beacon[0] !== BEACON_MAGIC) throw new Error("no beacon");
  const dv = new DataView(beacon.buffer, 0, BEACON_BYTES);
  const cell = beacon[2], border = beacon[3];
  const index = dv.getUint16(4, false), count = dv.getUint16(6, false), chunkLen = dv.getUint32(8, false);
  const layout = computeLayout(cell, border);
  const out = new Uint8Array(layout.frameCapacityBytes);
  let bi = 0;
  for (let r = 0; r < layout.rows; r++)
    for (let c = 0; c < layout.cols; c++) {
      const [R, G, B] = sample(px, border + c * cell, layout.topInset + r * cell, cell);
      out[bi++] = R; out[bi++] = G; out[bi++] = B;
    }
  return { index, count, cell, border, chunkLen, data: out.slice(0, chunkLen) };
}

function eq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

let failures = 0;
function check(name, cond) { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) failures++; }

// Test across several cell/border configs and a multi-frame stream.
for (const [cell, border] of [[1, 0], [5, 48], [5, 0], [16, 160], [3, 4], [8, 100]]) {
  const layout = computeLayout(cell, border);
  const cap = layout.dataPerFrame;
  // a stream of 2.5 frames of pseudo-random bytes
  const total = Math.floor(cap * 2.5) + 7;
  const stream = new Uint8Array(total);
  let s = 12345;
  for (let i = 0; i < total; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; stream[i] = s & 0xff; }

  const count = Math.max(1, Math.ceil(total / cap));
  const frames = [];
  for (let i = 0; i < count; i++) {
    const chunk = stream.subarray(i * cap, i * cap + cap);
    const px = paint(chunk, layout, i, count);
    const f = decode(px);
    frames.push(f);
    check(`cell=${cell} border=${border} frame ${i}: index/count/chunkLen`,
      f.index === i && f.count === count && f.chunkLen === chunk.length && f.cell === cell && f.border === border);
    check(`cell=${cell} border=${border} frame ${i}: chunk bytes exact`, eq(f.data, chunk));
  }
  // reassemble
  frames.sort((a, b) => a.index - b.index);
  const reassembled = new Uint8Array(frames.reduce((n, f) => n + f.data.length, 0));
  let off = 0; for (const f of frames) { reassembled.set(f.data, off); off += f.data.length; }
  check(`cell=${cell} border=${border}: full stream reassembled`, eq(reassembled, stream));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
