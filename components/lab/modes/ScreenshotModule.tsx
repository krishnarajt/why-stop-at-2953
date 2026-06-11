"use client";

import { BLOCK_ECC } from "@/lib/screenshot/codec";
import { DEFAULT_SCALE } from "@/lib/screenshot/layout";
import { RobustModule, type RobustProfile } from "./RobustModule";

const SCREENSHOT: RobustProfile = {
  ecc: BLOCK_ECC,
  defaultScale: DEFAULT_SCALE,
  videoDefaultFps: 8,
  renderingLabel: "Rendering robust frames",
  zipBaseName: "screenshot",
  capCaption: "px / frame · 8 colours · RS-protected",
  idleNote: (
    <>
      Each frame is a colour grid wrapped in registration markers, a calibration
      strip, and Reed–Solomon error correction — built to be re-read after a
      lossy screenshot (Teams, a VDI, a re-encode). Larger modules survive
      heavier compression at the cost of a bigger image — the data per frame and
      frame count are unchanged. Hit <strong>transmit</strong> to begin.
    </>
  ),
  idleEmptyHint: (
    <>
      Choose a source and password, then hit <strong>transmit</strong>. Your
      source becomes compression-resistant colour frames.
    </>
  ),
  description: (
    <>
      <h4>What screenshot mode does</h4>
      <ol>
        <li>
          <strong>Compress &amp; encrypt.</strong> Same front end as pristine —
          Zstd then AES-256-GCM, all in your browser.
        </li>
        <li>
          <strong>Spend density on survival.</strong> Instead of 3 bytes per
          pixel, each cell — a <em>module</em> — carries one of 8 well-separated
          colours (3 bits), painted as large blocks so it survives chroma
          subsampling and DCT blur. The <em>Module size</em> control only sets
          how many pixels wide each module is painted; it trades image size for
          robustness and never changes the data (or frame count) a transmission
          needs.
        </li>
        <li>
          <strong>Anchor &amp; calibrate.</strong> A corner QR (frame metadata +
          a registration handle), three corner markers, and a calibration strip
          of all 8 colours let a decoder find the grid and read colours{" "}
          <em>as they actually arrived</em> — surviving scaling and gamma shifts.
        </li>
        <li>
          <strong>Error-correct.</strong> Reed–Solomon parity is interleaved
          across the frame, so a decoder repairs the cells the channel mangled.
        </li>
        <li>
          <strong>Re-read.</strong> Take a screenshot of each frame (through
          Teams, a VDI, anything) and decode it back on the receive page.
        </li>
      </ol>
    </>
  ),
};

export function ScreenshotModule() {
  return <RobustModule profile={SCREENSHOT} />;
}
