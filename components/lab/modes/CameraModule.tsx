"use client";

import { CAMERA_BLOCK_ECC } from "@/lib/screenshot/codec";
import { RobustModule, type RobustProfile } from "./RobustModule";

/**
 * CAMERA transmit profile — the same colour-cell encoder as Screenshot, but
 * tuned for the harsher job of being photographed off a screen: much heavier
 * Reed–Solomon parity, larger default modules, and slower default playback so
 * a phone has time to lock focus on each frame. The receive page's Camera
 * variant corrects the perspective these captures inevitably carry.
 */
const CAMERA: RobustProfile = {
  ecc: CAMERA_BLOCK_ECC,
  defaultScale: 14,
  videoDefaultFps: 4,
  renderingLabel: "Rendering camera frames",
  zipBaseName: "camera",
  capCaption: "px / frame · 8 colours · heavy RS",
  idleNote: (
    <>
      A camera off a screen is a far harsher channel than a screenshot —
      perspective, glare, focus and moiré all corrupt cells — so each frame
      spends much more of itself on Reed–Solomon parity (and therefore carries
      fewer payload bytes, needing more frames). Bigger default modules and a
      slower playback give the camera a clean lock on every frame. Hit{" "}
      <strong>transmit</strong> to begin.
    </>
  ),
  idleEmptyHint: (
    <>
      Choose a source and password, then hit <strong>transmit</strong>. Your
      source becomes heavily error-corrected colour frames a phone can read off
      a screen.
    </>
  ),
  description: (
    <>
      <h4>What camera mode does</h4>
      <ol>
        <li>
          <strong>Compress &amp; encrypt.</strong> Same front end as the other
          modes — Zstd then AES-256-GCM, all in your browser.
        </li>
        <li>
          <strong>Over-protect every frame.</strong> Each cell — a{" "}
          <em>module</em> — still carries one of 8 colours, but a much larger
          share of the frame is Reed–Solomon parity, so a decoder can repair the
          many cells a camera mangles. That trades payload per frame for
          survival, so a transmission uses more frames than Screenshot mode.
        </li>
        <li>
          <strong>Anchor, calibrate, pace.</strong> The corner QR, three corner
          markers, and the 8-colour calibration strip stay — and frames default
          to larger modules and slower playback so a hand-held phone can lock
          focus and capture each one cleanly.
        </li>
        <li>
          <strong>Photograph or film the screen.</strong> Snap each frame, or
          record the video loop, with a phone.
        </li>
        <li>
          <strong>Re-read with perspective correction.</strong> Upload those
          photos or the clip on the receive page under the <em>Camera</em>{" "}
          variant — it fits a full perspective transform from the QR and markers,
          so the keystone and angle of an off-axis shot are undone before the
          cells are read.
        </li>
      </ol>
    </>
  ),
};

export function CameraModule() {
  return <RobustModule profile={CAMERA} />;
}
