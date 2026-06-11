"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLab } from "../LabProvider";
import { buildStream, type PipelineStage } from "@/lib/pipeline";
import {
  encodeScreenshot,
  estimateFrames,
  type ScreenshotResult,
} from "@/lib/screenshot/encode";
import { MAX_SCALE, MIN_SCALE, canvasSize } from "@/lib/screenshot/layout";
import { formatBytes } from "@/lib/format";
import { downloadFramesZip } from "@/lib/pristine/zip";
import { ImagesView } from "./ImagesView";
import { VideoView } from "./VideoView";

type Phase = "idle" | "running" | "ready" | "error";

/**
 * A robust colour-cell transmit module. Pristine aside, both shipping
 * profiles — Screenshot and Camera — are this same encoder; they differ only
 * in error-correction strength, default module size, and copy. The heavier
 * the channel (a camera off a screen vs. a clean screenshot), the more parity
 * each frame spends, which is exactly what `profile.ecc` selects.
 */
export interface RobustProfile {
  /** Reed–Solomon parity bytes per 255-byte block. */
  ecc: number;
  /** Starting module size (px per cell). */
  defaultScale: number;
  /** Starting framerate for the video view. */
  videoDefaultFps: number;
  /** Progress label while frames render. */
  renderingLabel: string;
  /** Base filename for the frames ZIP. */
  zipBaseName: string;
  /** Caption under the frame-size readout. */
  capCaption: string;
  /** Prose shown alongside the pre-flight estimate. */
  idleNote: ReactNode;
  /** Prose shown when there's no source yet. */
  idleEmptyHint: ReactNode;
  /** The "how it works" description block. */
  description: ReactNode;
}

const STAGE_LABEL: Record<PipelineStage, string> = {
  reading: "Reading source",
  compressing: "Compressing (Zstd)",
  encrypting: "Encrypting (AES-256-GCM)",
  packing: "Packing container",
};

export function RobustModule({ profile }: { profile: RobustProfile }) {
  const { sourceKind, file, sourceBytes, getText, password, transmitNonce } =
    useLab();

  const [scale, setScale] = useState(profile.defaultScale);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState("");
  const [frameProg, setFrameProg] = useState<{ v: number; max: number } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<
    (ScreenshotResult & { rawBytes: number; compressedBytes: number; name: string }) | null
  >(null);
  const [zipping, setZipping] = useState(false);
  const [view, setView] = useState<"images" | "video">("images");

  const lastNonce = useRef(0);
  const framesRef = useRef<ScreenshotResult["frames"]>([]);

  const est = sourceBytes > 0 ? estimateFrames(sourceBytes, profile.ecc) : null;
  const frame = canvasSize(scale); // depends on module size — updates live

  function revoke() {
    framesRef.current.forEach((f) => URL.revokeObjectURL(f.url));
    framesRef.current = [];
  }

  useEffect(() => {
    if (transmitNonce === 0 || transmitNonce === lastNonce.current) return;
    lastNonce.current = transmitNonce;

    let cancelled = false;
    (async () => {
      revoke();
      setResult(null);
      setError("");
      setPhase("running");
      setFrameProg(null);
      const startedAt = performance.now();
      try {
        const built = await buildStream(
          {
            text: sourceKind === "text" ? getText() : undefined,
            file: sourceKind === "file" ? file : undefined,
            password,
          },
          (p) => setStage(STAGE_LABEL[p.stage]),
        );

        setStage(profile.renderingLabel);
        setFrameProg({ v: 0, max: 0 });
        const enc = await encodeScreenshot(
          built.stream,
          scale,
          (done, total) => setFrameProg({ v: done, max: total }),
          profile.ecc,
        );
        if (cancelled) {
          enc.frames.forEach((f) => URL.revokeObjectURL(f.url));
          return;
        }
        framesRef.current = enc.frames;
        setElapsed((performance.now() - startedAt) / 1000);
        setResult({
          ...enc,
          rawBytes: built.rawBytes,
          compressedBytes: built.compressedBytes,
          name: built.name,
        });
        setView("images");
        setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Encoding failed.");
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transmitNonce]);

  useEffect(() => () => revoke(), []);

  const busy = phase === "running";

  return (
    <div className="pmod">
      <div className="pmod-options">
        <div className="pmod-opt">
          <label className="pmod-opt-label">
            Module size <span className="mono">{scale}px</span>
          </label>
          <input
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            value={scale}
            disabled={busy}
            onChange={(e) => setScale(Number(e.target.value))}
          />
          <p className="pmod-opt-hint">
            A <strong>module</strong> is one colour cell — the smallest square in
            the grid. This sets how many screen pixels each module is painted as:
            bigger modules survive heavier compression but make a larger image.
            It doesn&apos;t change how much data a frame carries, so the frame
            count stays the same.
          </p>
        </div>
        <div className="pmod-cap">
          <span className="pmod-cap-v mono">
            {frame.w}×{frame.h}
          </span>
          <span className="pmod-cap-k">{profile.capCaption}</span>
        </div>
      </div>

      {phase === "idle" && (
        <div className="pmod-idle">
          {est ? (
            <>
              <div className="pmod-est">
                <Est k="≤ frames" v={est.framesMax.toLocaleString()} />
                <Est k="bytes / frame" v={formatBytes(est.payloadPerFrame)} />
                <Est k="frame size" v={`${frame.w}×${frame.h}`} />
                <Est k="ecc / block" v={`${est.eccPerBlock} B`} />
              </div>
              <p className="pmod-est-note">{profile.idleNote}</p>
            </>
          ) : (
            <p>{profile.idleEmptyHint}</p>
          )}
        </div>
      )}

      {busy && (
        <div className="pmod-progress">
          <span className="mono pmod-stage">{stage}</span>
          {frameProg && frameProg.max > 0 ? (
            <>
              <div className="pmod-bar">
                <div
                  className="pmod-bar-fill"
                  style={{ width: `${(frameProg.v / frameProg.max) * 100}%` }}
                />
              </div>
              <span className="mono pmod-count">
                {frameProg.v} / {frameProg.max} frames
              </span>
            </>
          ) : (
            <div className="pmod-bar indet">
              <div className="pmod-bar-indet" />
            </div>
          )}
        </div>
      )}

      {phase === "error" && <div className="pmod-error mono">⚠ {error}</div>}

      {phase === "ready" && result && (
        <>
          <div className="pmod-stats">
            <Stat k="source" v={result.name || "text payload"} />
            <Stat k="raw" v={formatBytes(result.rawBytes)} />
            <Stat k="compressed" v={formatBytes(result.compressedBytes)} />
            <Stat k="stream" v={formatBytes(result.streamBytes)} />
            <Stat k="frames" v={String(result.frameCount)} />
            <Stat k="encoded in" v={`${elapsed.toFixed(1)}s`} />
          </div>

          <div className="pmod-viewrow">
            <div className="pmod-viewtabs">
              <button
                className={`pmod-viewtab${view === "images" ? " on" : ""}`}
                onClick={() => setView("images")}
              >
                Images
              </button>
              <button
                className={`pmod-viewtab${view === "video" ? " on" : ""}`}
                onClick={() => setView("video")}
              >
                Video
              </button>
            </div>
            <button
              className="btn ghost sm"
              disabled={zipping}
              onClick={async () => {
                setZipping(true);
                try {
                  await downloadFramesZip(
                    result.frames,
                    result.name || profile.zipBaseName,
                  );
                } finally {
                  setZipping(false);
                }
              }}
            >
              {zipping ? "Zipping…" : `⤓ Download all (${result.frameCount})`}
            </button>
          </div>

          {view === "images" ? (
            <ImagesView frames={result.frames} />
          ) : (
            <VideoView frames={result.frames} defaultFps={profile.videoDefaultFps} />
          )}
        </>
      )}

      <div className="pmod-desc">{profile.description}</div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="pmod-stat">
      <span className="pmod-stat-v mono">{v}</span>
      <span className="pmod-stat-k">{k}</span>
    </div>
  );
}
function Est({ k, v }: { k: string; v: string }) {
  return (
    <div className="pmod-est-item">
      <span className="pmod-est-v mono">{v}</span>
      <span className="pmod-est-k">{k}</span>
    </div>
  );
}
