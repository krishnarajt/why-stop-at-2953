"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PristineFrame } from "@/lib/pristine/encode";

/** Fullscreen-able slideshow. Arrow keys (or on-screen controls) navigate. */
export function ImagesView({ frames }: { frames: PristineFrame[] }) {
  const [idx, setIdx] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => setIdx(0), [frames]);

  const go = useCallback(
    (d: number) =>
      setIdx((i) => Math.min(frames.length - 1, Math.max(0, i + d))),
    [frames.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const fullscreen = () => stageRef.current?.requestFullscreen?.();

  return (
    <div className="viewer">
      <div ref={stageRef} className="viewer-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="viewer-img"
          src={frames[idx]?.url}
          alt={`frame ${idx + 1}`}
          draggable={false}
        />
        <div className="viewer-counter mono">
          {idx + 1} / {frames.length}
        </div>
      </div>

      <div className="viewer-controls">
        <button className="btn ghost sm" onClick={() => go(-1)} disabled={idx === 0}>
          ← Prev
        </button>
        <span className="mono viewer-controls-count">
          frame {idx + 1} of {frames.length}
        </span>
        <button
          className="btn ghost sm"
          onClick={() => go(1)}
          disabled={idx === frames.length - 1}
        >
          Next →
        </button>
        <button className="btn sm" onClick={fullscreen}>
          ⤢ Fullscreen
        </button>
      </div>
      <p className="viewer-hint">
        Use ← / → (or ↑ / ↓) to step through frames. Fullscreen for a clean,
        unobstructed capture.
      </p>
    </div>
  );
}
