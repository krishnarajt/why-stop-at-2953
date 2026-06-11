"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodePixels, type DecodedFrame } from "@/lib/screenshot/decode";
import { summarizeMissing } from "@/lib/frames";

/**
 * Live camera intake for the Camera variant: open the rear camera, point it at
 * the screen playing the frames, and decode the video stream in place. Decoded
 * frames are de-duplicated by index and accumulated until the full set is in
 * hand, at which point the capture is handed back for decryption.
 *
 * Decoding reuses the same perspective-correcting decoder as the upload path,
 * so an off-axis hand-held shot is un-warped before the cells are read. The
 * loop is throttled — the heavy work is the QR find + Reed–Solomon repair, and
 * the <video> preview keeps compositing smoothly regardless.
 */

type Status = "idle" | "starting" | "scanning" | "error";

const SCAN_INTERVAL_MS = 130;

export function CameraCapture({
  canStart,
  onCapture,
}: {
  /** Password present — required before a completed set can be reconstructed. */
  canStart: boolean;
  onCapture: (frames: DecodedFrame[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const byIndexRef = useRef<Map<number, DecodedFrame>>(new Map());
  const handedOffRef = useRef(false);
  // The scan timer chain keeps calling the closures from the render where
  // scanning started; read the latest onCapture through a ref so a password
  // edited mid-scan isn't lost to a stale closure upstream.
  const onCaptureRef = useRef(onCapture);
  useEffect(() => {
    onCaptureRef.current = onCapture;
  }, [onCapture]);

  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [expected, setExpected] = useState<number | null>(null);
  const [present, setPresent] = useState<number[]>([]);
  const [lastHit, setLastHit] = useState<number | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const stopStream = useCallback(() => {
    scanningRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  // Always release the camera on unmount.
  useEffect(() => () => stopStream(), [stopStream]);

  const hand = useCallback(
    (frames: DecodedFrame[]) => {
      if (handedOffRef.current) return;
      handedOffRef.current = true;
      stopStream();
      setStatus("idle");
      onCaptureRef.current(frames);
    },
    [stopStream],
  );

  const scanOnce = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    const w = v.videoWidth;
    const h = v.videoHeight;
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvasRef.current = canvas;
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);

    const res = decodePixels(img.data, w, h, true);
    if ("data" in res) {
      const map = byIndexRef.current;
      setExpected(res.count);
      if (!map.has(res.index)) {
        map.set(res.index, res);
        setPresent([...map.keys()].sort((a, b) => a - b));
      }
      setLastHit(res.index);
      if (map.size >= res.count) {
        hand([...map.values()]);
      }
    }
  }, [hand]);

  const loop = useCallback(() => {
    if (!scanningRef.current) return;
    try {
      scanOnce();
    } catch {
      /* a single bad sample never stops the scan */
    }
    if (scanningRef.current) {
      timerRef.current = setTimeout(loop, SCAN_INTERVAL_MS);
    }
  }, [scanOnce]);

  async function start() {
    setErrorMsg("");
    byIndexRef.current = new Map();
    handedOffRef.current = false;
    setExpected(null);
    setPresent([]);
    setLastHit(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setStatus("error");
      setErrorMsg(
        "This browser can't open a camera here. Live capture needs a secure (https) page and camera support — try uploading photos or a clip instead.",
      );
      return;
    }

    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      v.srcObject = stream;
      await v.play().catch(() => {});

      const track = stream.getVideoTracks()[0];
      // `torch` is widely supported but not in the standard DOM typings.
      const caps = (track.getCapabilities?.() ?? {}) as unknown as {
        torch?: boolean;
      };
      setTorchSupported(!!caps.torch);
      setTorchOn(false);

      setStatus("scanning");
      scanningRef.current = true;
      loop();
    } catch (e) {
      setStatus("error");
      const name = e instanceof DOMException ? e.name : "";
      setErrorMsg(
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access, or upload photos instead."
          : name === "NotFoundError"
            ? "No camera was found on this device."
            : "Couldn't open the camera. Upload photos or a clip instead.",
      );
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  const scanning = status === "scanning";
  const captured = present.length;
  const missing =
    expected != null
      ? Array.from({ length: expected }, (_, i) => i).filter(
          (i) => !present.includes(i),
        )
      : [];
  const pct = expected ? Math.min(100, (captured / expected) * 100) : 0;

  return (
    <div className="cam">
      <div className={`cam-stage${scanning ? " live" : ""}`}>
        <video
          ref={videoRef}
          className="cam-video"
          playsInline
          muted
          autoPlay
        />
        {!scanning && status !== "starting" && (
          <div className="cam-overlay">
            <span className="mono">camera off</span>
          </div>
        )}
        {status === "starting" && (
          <div className="cam-overlay">
            <span className="mono">opening camera…</span>
          </div>
        )}
        {scanning && (
          <div className="cam-hud">
            <span className="mono">
              {expected != null
                ? `captured ${captured} / ${expected}`
                : `searching… (${captured} found)`}
            </span>
            {lastHit != null && (
              <span className="cam-hud-hit mono">#{lastHit + 1}</span>
            )}
          </div>
        )}
      </div>

      {scanning && expected != null && (
        <div className="cam-prog">
          <div className="pmod-bar">
            <div className="pmod-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          {missing.length > 0 ? (
            <span className="mono cam-missing">
              still need {summarizeMissing(missing)}
            </span>
          ) : (
            <span className="mono">complete — reconstructing…</span>
          )}
        </div>
      )}

      <div className="cam-controls">
        {!scanning ? (
          <button
            className="btn"
            onClick={start}
            disabled={!canStart || status === "starting"}
          >
            {status === "starting" ? "Opening…" : "Start camera"}
          </button>
        ) : (
          <>
            <button
              className="btn ghost sm"
              onClick={() => {
                stopStream();
                setStatus("idle");
              }}
            >
              Stop
            </button>
            {torchSupported && (
              <button className="btn ghost sm" onClick={toggleTorch}>
                {torchOn ? "Torch off" : "Torch on"}
              </button>
            )}
            <button
              className="btn ghost sm"
              disabled={captured === 0}
              onClick={() => hand([...byIndexRef.current.values()])}
              title="Reconstruct with the frames captured so far"
            >
              Use {captured} frame{captured === 1 ? "" : "s"}
            </button>
          </>
        )}
      </div>

      {!canStart && status !== "scanning" && (
        <p className="cam-note mono">enter the password first</p>
      )}
      {status === "error" && <p className="cam-error mono">⚠ {errorMsg}</p>}

      <p className="cam-hint">
        Point the rear camera at the screen playing the frames and fill the view
        with one frame at a time. Each frame is decoded, de-duplicated, and kept;
        once the whole set is captured it reconstructs automatically. Hold steady
        and let it lock focus — perspective and angle are corrected for you.
      </p>
    </div>
  );
}
