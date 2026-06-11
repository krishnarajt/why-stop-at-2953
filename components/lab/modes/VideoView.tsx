"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PristineFrame } from "@/lib/pristine/encode";

/**
 * Flashes the frames at a chosen framerate, fullscreen. Frames are predecoded
 * and drawn onto a canvas (contain-fit on white) so playback is flicker-free
 * and the baked-in white border keeps the payload clear of the edge controls.
 *
 * Play  -> enters fullscreen and autoplays
 * Space -> pause / resume
 * Esc   -> exit (handled by the browser; we clean up on fullscreenchange)
 */
export function VideoView({
  frames,
  defaultFps = 8,
}: {
  frames: PristineFrame[];
  defaultFps?: number;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgsRef = useRef<HTMLImageElement[]>([]);
  const idxRef = useRef(0);
  const rafRef = useRef<number>(0);

  const [fps, setFps] = useState(defaultFps);
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);

  // Predecode frames.
  useEffect(() => {
    imgsRef.current = frames.map((f) => {
      const im = new Image();
      im.src = f.url;
      return im;
    });
  }, [frames]);

  const draw = useCallback((i: number) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    const img = imgsRef.current[i];
    if (img && img.complete && img.naturalWidth) {
      const scale = Math.min(c.width / img.naturalWidth, c.height / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    }
  }, []);

  // Size the canvas to the screen while a fullscreen session is active.
  useEffect(() => {
    if (!active) return;
    const resize = () => {
      const c = canvasRef.current;
      if (!c) return;
      c.width = window.innerWidth;
      c.height = window.innerHeight;
      draw(idxRef.current);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [active, draw]);

  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    const interval = 1000 / Math.max(1, fps);
    let last = performance.now();
    const tick = (t: number) => {
      if (t - last >= interval) {
        last = t - ((t - last) % interval);
        idxRef.current = (idxRef.current + 1) % frames.length;
        setCur(idxRef.current);
        draw(idxRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, fps, frames.length, draw]);

  // Clean up when the user leaves fullscreen (Esc or otherwise).
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) {
        setActive(false);
        setPlaying(false);
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Space toggles play/pause during a session.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const play = async () => {
    idxRef.current = 0;
    setCur(0);
    setActive(true);
    try {
      await stageRef.current?.requestFullscreen?.();
    } catch {
      /* fullscreen denied — play inline instead */
    }
    setPlaying(true);
  };

  return (
    <div className="vview">
      <div className="vview-setup">
        <label className="vview-fps">
          Framerate
          <input
            type="number"
            min={1}
            max={60}
            value={fps}
            onChange={(e) =>
              setFps(Math.min(60, Math.max(1, Number(e.target.value) || 1)))
            }
            className="mono"
          />
          <span className="mono">fps</span>
        </label>
        <button className="btn" onClick={play}>
          ▶ Play video
        </button>
        <span className="vview-eta mono">
          {frames.length} frames · ~{(frames.length / Math.max(1, fps)).toFixed(1)}s
          loop
        </span>
      </div>

      <div ref={stageRef} className={`vview-stage${active ? " active" : ""}`}>
        <canvas ref={canvasRef} className="vview-canvas" />

        {active ? (
          <>
            <div className="vbar top">
              <span className="mono">
                {cur + 1} / {frames.length} · {fps} fps
              </span>
              <button
                className="vbar-btn"
                onClick={() => document.exitFullscreen?.()}
              >
                Esc · exit
              </button>
            </div>
            <div className="vbar bottom">
              <button
                className="vbar-btn"
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? "❚❚ pause" : "▶ play"}{" "}
                <span className="vbar-key">space</span>
              </button>
              <div className="vbar-track">
                <div
                  className="vbar-fill"
                  style={{ width: `${((cur + 1) / frames.length) * 100}%` }}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="vview-idle">
            <span className="mono">press play to flash {frames.length} frames fullscreen</span>
          </div>
        )}
      </div>

      <p className="viewer-hint">
        Point a capture device at the screen during playback. Space pauses, Esc
        exits. Controls sit on the white margins so the encoded area stays clear.
      </p>
    </div>
  );
}
