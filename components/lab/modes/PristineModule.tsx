"use client";

import { useEffect, useRef, useState } from "react";
import { useLab } from "../LabProvider";
import { buildStream, type PipelineStage } from "@/lib/pipeline";
import {
  encodePristine,
  computeLayout,
  THEORETICAL_MAX_PER_FRAME,
  DEFAULT_CELL,
  DEFAULT_BORDER,
  type PristineResult,
} from "@/lib/pristine/encode";
import { formatBytes } from "@/lib/format";
import { downloadFramesZip } from "@/lib/pristine/zip";
import { estimatePristine, formatDuration } from "@/lib/pristine/estimate";
import { ImagesView } from "./ImagesView";
import { VideoView } from "./VideoView";

type Phase = "idle" | "running" | "ready" | "error";

/** Framerate used for the pre-flight video-length estimate. */
const ESTIMATE_FPS = 8;

const STAGE_LABEL: Record<PipelineStage | "rendering", string> = {
  reading: "Reading source",
  compressing: "Compressing (Zstd)",
  encrypting: "Encrypting (AES-256-GCM)",
  packing: "Packing container",
  rendering: "Rendering frames",
};

type Progress =
  | { kind: "bytes" | "frames"; value: number; max: number }
  | { kind: "indeterminate" }
  | null;

export function PristineModule() {
  const { sourceKind, file, sourceBytes, getText, password, transmitNonce } =
    useLab();

  const [cell, setCell] = useState(DEFAULT_CELL);
  const [border, setBorder] = useState(DEFAULT_BORDER);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState<Progress>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<
    (PristineResult & { rawBytes: number; compressedBytes: number; name: string }) | null
  >(null);
  const [view, setView] = useState<"images" | "video">("images");
  const [zipping, setZipping] = useState(false);

  const lastNonce = useRef(0);
  const framesRef = useRef<PristineResult["frames"]>([]);

  const layout = computeLayout({ cell, border });
  const estimate = estimatePristine(sourceBytes, layout, ESTIMATE_FPS);

  function revoke() {
    framesRef.current.forEach((f) => URL.revokeObjectURL(f.url));
    framesRef.current = [];
  }

  // Run the pipeline whenever the user fires a transmission.
  useEffect(() => {
    if (transmitNonce === 0 || transmitNonce === lastNonce.current) return;
    lastNonce.current = transmitNonce;

    let cancelled = false;
    (async () => {
      revoke();
      setResult(null);
      setError("");
      setPhase("running");
      setProgress(null);
      const startedAt = performance.now();
      try {
        const built = await buildStream(
          {
            text: sourceKind === "text" ? getText() : undefined,
            file: sourceKind === "file" ? file : undefined,
            password,
          },
          (p) => {
            setStage(STAGE_LABEL[p.stage]);
            if (p.stage === "reading" && p.total) {
              setProgress({ kind: "bytes", value: p.loaded ?? 0, max: p.total });
            } else {
              setProgress({ kind: "indeterminate" });
            }
          },
        );

        setStage(STAGE_LABEL.rendering);
        setProgress({ kind: "frames", value: 0, max: 0 });
        const enc = await encodePristine(
          built.stream,
          { cell, border },
          (done, total) =>
            setProgress({ kind: "frames", value: done, max: total }),
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

  // Release object URLs on unmount.
  useEffect(() => () => revoke(), []);

  const busy = phase === "running";

  return (
    <div className="pmod">
      {/* options */}
      <div className="pmod-options">
        <div className="pmod-opt">
          <label className="pmod-opt-label">
            Cell size <span className="mono">{cell}px</span>
          </label>
          <input
            type="range"
            min={1}
            max={16}
            value={cell}
            disabled={busy}
            onChange={(e) => setCell(Number(e.target.value))}
          />
        </div>
        <div className="pmod-opt">
          <label className="pmod-opt-label">
            Border <span className="mono">{border}px</span>
          </label>
          <input
            type="range"
            min={0}
            max={160}
            step={4}
            value={border}
            disabled={busy}
            onChange={(e) => setBorder(Number(e.target.value))}
          />
        </div>
        <div className="pmod-cap">
          <span className="pmod-cap-v mono">{formatBytes(layout.dataPerFrame)}</span>
          <span className="pmod-cap-k">/ frame ({layout.cols}×{layout.rows} cells)</span>
        </div>
      </div>

      {/* state */}
      {phase === "idle" && (
        <div className="pmod-idle">
          {estimate ? (
            <>
              <div className="pmod-est">
                <Est k="≤ frames" v={estimate.framesMax.toLocaleString()} />
                <Est k="~ encode time" v={formatDuration(estimate.encodeSec)} />
                <Est
                  k={`video @ ${ESTIMATE_FPS} fps`}
                  v={formatDuration(estimate.videoSec)}
                />
                <Est k="zstd level" v={String(estimate.level)} />
              </div>
              <p className="pmod-est-note">
                Estimates from {formatBytes(sourceBytes)} of source (worst-case,
                assuming it doesn&apos;t compress). Compressible data yields fewer
                frames and runs faster. Hit <strong>transmit</strong> to begin.
              </p>
            </>
          ) : (
            <p>
              Choose a source and password, configure the grid, then hit{" "}
              <strong>transmit</strong>. Your source becomes a sequence of
              lossless color frames.
            </p>
          )}
        </div>
      )}

      {busy && (
        <div className="pmod-progress">
          <span className="mono pmod-stage">{stage}</span>
          {progress?.kind === "indeterminate" && (
            <div className="pmod-bar indet">
              <div className="pmod-bar-indet" />
            </div>
          )}
          {progress?.kind === "bytes" && (
            <>
              <div className="pmod-bar">
                <div
                  className="pmod-bar-fill"
                  style={{ width: `${(progress.value / progress.max) * 100}%` }}
                />
              </div>
              <span className="mono pmod-count">
                {formatBytes(progress.value)} / {formatBytes(progress.max)}
              </span>
            </>
          )}
          {progress?.kind === "frames" && (
            <>
              <div className="pmod-bar">
                <div
                  className="pmod-bar-fill"
                  style={{
                    width: progress.max
                      ? `${(progress.value / progress.max) * 100}%`
                      : "0%",
                  }}
                />
              </div>
              <span className="mono pmod-count">
                {progress.value} / {progress.max || "?"} frames
              </span>
            </>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="pmod-error mono">⚠ {error}</div>
      )}

      {phase === "ready" && result && (
        <>
          <div className="pmod-stats">
            <Stat k="source" v={result.name || "text payload"} />
            <Stat k="raw" v={formatBytes(result.rawBytes)} />
            <Stat k="compressed" v={formatBytes(result.compressedBytes)} />
            <Stat k="stream" v={formatBytes(result.streamBytes)} />
            <Stat k="frames" v={String(result.frameCount)} />
            <Stat k="encoded in" v={formatDuration(elapsed)} />
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
                    result.name || "pristine",
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
            <VideoView frames={result.frames} />
          )}
        </>
      )}

      <PristineDescription
        layout={layout}
        view={phase === "ready" ? view : null}
      />
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

function PristineDescription({
  layout,
  view,
}: {
  layout: ReturnType<typeof computeLayout>;
  view: "images" | "video" | null;
}) {
  return (
    <div className="pmod-desc">
      <h4>What pristine does</h4>
      <ol>
        <li>
          <strong>Compress.</strong> Your text or file is squeezed with Zstandard
          (WASM) — fully in your browser. The level adapts to size (19 for small
          payloads, lighter levels for hundreds of MB so it stays fast).
        </li>
        <li>
          <strong>Encrypt.</strong> The compressed bytes are sealed with
          AES-256-GCM, keyed from your password via PBKDF2. Nothing leaves the
          page.
        </li>
        <li>
          <strong>Colorize.</strong> Each pixel carries 3 bytes — one per R, G,
          B channel — the lossless theoretical limit (
          <span className="mono">{formatBytes(THEORETICAL_MAX_PER_FRAME)}</span>{" "}
          per 1080p frame at 1&nbsp;px cells). Here cells are{" "}
          <span className="mono">{layout.cell}px</span> blocks inside a{" "}
          <span className="mono">{layout.border}px</span> white quiet-zone, so a
          frame holds <span className="mono">{formatBytes(layout.dataPerFrame)}</span>.
          When the stream is larger, it's split across as many frames as needed.
        </li>
        <li>
          <strong>Order.</strong> Every frame carries its position and grid
          layout in a fixed-geometry <em>beacon</em> tucked into the top-left
          quiet-zone <em>and</em> as a visible{" "}
          <span className="mono">i / n · cell · border</span> label printed in
          the top margin — so the sequence is obvious at a glance, and a decoder
          fed a single frame can locate the cells and report the full count
          (e.g. &ldquo;had 300, got 1&rdquo;).
        </li>
        <li>
          <strong>Export.</strong> Frames are PNG — lossless, so every channel
          value survives a clean screen capture byte-for-byte.
        </li>
      </ol>

      {view === "images" && (
        <p className="pmod-desc-live">
          <strong>Images view:</strong> a slideshow of the frames. Step with the
          arrow keys or controls, and go fullscreen for an unobstructed grab of
          each frame.
        </p>
      )}
      {view === "video" && (
        <p className="pmod-desc-live">
          <strong>Video view:</strong> the frames flash at your chosen framerate.
          Play enters fullscreen and autoplays; Space pauses, Esc exits. The
          white margins keep edge controls off the encoded area.
        </p>
      )}
    </div>
  );
}
