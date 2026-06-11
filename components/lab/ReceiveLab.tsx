"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { reconstruct, ReconstructError } from "@/lib/pipeline";
import {
  assembleFrames,
  collectImages,
  collectVideos,
  summarizeMissing,
  type FrameIssue,
} from "@/lib/frames";
import { CameraCapture } from "./CameraCapture";
import { gatherFrames as gatherPristine } from "@/lib/pristine/decode";
import {
  gatherFrames as gatherScreenshot,
  gatherFramesFromVideo,
} from "@/lib/screenshot/decode";
import type { DecodedFrame } from "@/lib/screenshot/decode";

type Variant = "pristine" | "screenshot" | "camera";

const VARIANTS: { id: Variant; label: string; ready: boolean; blurb: string }[] =
  [
    {
      id: "pristine",
      label: "Pristine",
      ready: true,
      blurb:
        "Lossless frames captured byte-for-byte (a clean screenshot or the exported PNGs).",
    },
    {
      id: "screenshot",
      label: "Screenshot",
      ready: true,
      blurb:
        "8-colour frames that survived a lossy round-trip — a screenshot through Teams, a VDI, a re-encode, or a screen recording.",
    },
    {
      id: "camera",
      label: "Camera",
      ready: true,
      blurb:
        "Frames photographed or filmed off a screen with a phone — perspective and angle are corrected automatically.",
    },
  ];

type Phase = "idle" | "working" | "done" | "failed";

interface DecodeOutput {
  kind: "text" | "file";
  name: string;
  rawBytes: number;
  frames: number;
  text?: string;
  /** Object URL for file downloads. */
  url?: string;
  truncated?: boolean;
}

interface DecodeFailure {
  reason: string;
  detail?: string;
}

const PREVIEW_CAP = 20_000;

export function ReceiveLab({
  onTransmit,
  onClose,
}: {
  onTransmit: () => void;
  onClose: () => void;
}) {
  const [variant, setVariant] = useState<Variant>("pristine");
  const [intake, setIntake] = useState<"upload" | "live">("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState<{ value: number; max: number } | null>(
    null,
  );
  const [output, setOutput] = useState<DecodeOutput | null>(null);
  const [failure, setFailure] = useState<DecodeFailure | null>(null);
  const [issues, setIssues] = useState<FrameIssue[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);

  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);
  useEffect(() => () => revoke(), [revoke]);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    setFiles((prev) => {
      // De-duplicate by name+size so re-dropping the same set is harmless.
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}:${f.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      return merged;
    });
    resetResult();
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
    resetResult();
  }

  function clearAll() {
    setFiles([]);
    resetResult();
  }

  function resetResult() {
    revoke();
    setPhase("idle");
    setOutput(null);
    setFailure(null);
    setIssues([]);
    setProgress(null);
    setStage("");
  }

  const busy = phase === "working";
  const current = VARIANTS.find((v) => v.id === variant)!;
  const live = variant === "camera" && intake === "live";
  const canDecode = files.length > 0 && password.length > 0 && current.ready && !busy;

  async function decode() {
    if (!canDecode) return;
    resetResult();
    setPhase("working");

    try {
      setStage("Reading upload");
      const images = await collectImages(files);
      const videos = collectVideos(files);
      if (images.length === 0 && videos.length === 0) {
        setPhase("failed");
        setFailure({
          reason: "No images or video found in the upload.",
          detail:
            "Drop the exported frames, the frames ZIP, or a screen recording of them.",
        });
        return;
      }

      const frames: DecodedFrame[] = [];
      const found: FrameIssue[] = [];

      // Screenshot and Camera share the colour-cell decoder; Camera additionally
      // corrects perspective (a photo off a screen isn't axis-aligned).
      const usesColourCells = variant === "screenshot" || variant === "camera";
      const perspective = variant === "camera";

      if (images.length > 0) {
        setStage("Decoding frames");
        setProgress({ value: 0, max: images.length });
        const r = usesColourCells
          ? await gatherScreenshot(
              images,
              (done, total) => setProgress({ value: done, max: total }),
              perspective,
            )
          : await gatherPristine(images, (done, total) =>
              setProgress({ value: done, max: total }),
            );
        frames.push(...r.frames);
        found.push(...r.issues);
      }

      if (videos.length > 0) {
        if (!usesColourCells) {
          for (const v of videos) {
            found.push({
              name: v.name,
              reason:
                "video input is only supported by the Screenshot and Camera variants",
            });
          }
        } else {
          for (const v of videos) {
            setStage(`Scanning video — ${v.name}`);
            setProgress({ value: 0, max: 1 });
            const r = await gatherFramesFromVideo(
              v,
              (done, total) => setProgress({ value: done, max: total }),
              perspective,
            );
            frames.push(...r.frames);
            found.push(...r.issues);
          }
        }
      }

      await finalize(frames, found);
    } catch (e) {
      setPhase("failed");
      setFailure({
        reason:
          e instanceof ReconstructError
            ? e.message
            : "Decoding failed unexpectedly.",
      });
    }
  }

  /**
   * Shared tail for every intake (upload, video, live camera): gate on a
   * complete sequence, then decrypt + decompress with the password.
   */
  async function finalize(frames: DecodedFrame[], found: FrameIssue[]) {
    setIssues(found);

    // Completeness gate — give up before touching crypto if frames are short.
    setStage("Checking sequence");
    const assembled = assembleFrames(frames);
    if (!assembled.ok) {
      setPhase("failed");
      setFailure({
        reason: assembled.reason,
        detail:
          assembled.missing.length > 0
            ? `Missing frames: ${summarizeMissing(assembled.missing)}.`
            : undefined,
      });
      return;
    }

    try {
      setStage("Decrypting & decompressing");
      setProgress(null);
      const { bytes, meta } = await reconstruct(assembled.stream, password);

      if (meta.isFile) {
        revoke();
        const blob = new Blob([bytes.slice().buffer as ArrayBuffer]);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setOutput({
          kind: "file",
          name: meta.name || "recovered.bin",
          rawBytes: bytes.length,
          frames: assembled.frameCount,
          url,
        });
      } else {
        const full = new TextDecoder().decode(bytes);
        setOutput({
          kind: "text",
          name: "text payload",
          rawBytes: bytes.length,
          frames: assembled.frameCount,
          text: full.slice(0, PREVIEW_CAP),
          truncated: full.length > PREVIEW_CAP,
        });
      }
      setPhase("done");
    } catch (e) {
      setPhase("failed");
      setFailure({
        reason:
          e instanceof ReconstructError
            ? e.message
            : "Decoding failed unexpectedly.",
      });
    }
  }

  /** Live camera captured a (hopefully complete) set of frames. */
  async function onLiveCapture(captured: DecodedFrame[]) {
    resetResult();
    setPhase("working");
    await finalize(captured, []);
  }

  function copyText() {
    if (output?.kind === "text" && output.text) {
      navigator.clipboard?.writeText(output.text);
    }
  }

  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  return (
    <div className="lab">
      <header className="lab-bar">
        <button type="button" className="lab-back" onClick={onTransmit}>
          <span aria-hidden="true">←</span> Back to transmit
        </button>
        <div className="lab-id">
          <span className="lab-id-name mono">visual receive lab</span>
          <span className="lab-id-sub">reassemble what was sent</span>
        </div>
        <button type="button" className="lab-cross" onClick={onClose}>
          Exit <span aria-hidden="true">✕</span>
        </button>
      </header>

      <div className="lab-body container">
        {/* variant */}
        <section className="modes">
          <div className="modes-bar" role="tablist" aria-label="Source variant">
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={v.id === variant}
                className={`mode-tab${v.id === variant ? " on" : ""}`}
                onClick={() => {
                  setVariant(v.id);
                  if (v.id !== "camera") setIntake("upload");
                  resetResult();
                }}
              >
                {v.label}
                {!v.ready && <span className="rl-soon">soon</span>}
              </button>
            ))}
          </div>
          <p className="rl-variant-blurb">
            {current.blurb} Pick the variant these frames were encoded with so we
            decode them correctly.
          </p>
        </section>

        {/* intake */}
        <section className="rl-intake">
          {variant === "camera" && (
            <div className="rl-intakeswitch" role="tablist" aria-label="Intake">
              <button
                role="tab"
                aria-selected={intake === "upload"}
                className={`rl-intaketab${intake === "upload" ? " on" : ""}`}
                onClick={() => {
                  setIntake("upload");
                  resetResult();
                }}
              >
                Upload photos / clip
              </button>
              <button
                role="tab"
                aria-selected={intake === "live"}
                className={`rl-intaketab${intake === "live" ? " on" : ""}`}
                onClick={() => {
                  setIntake("live");
                  resetResult();
                }}
              >
                Live camera
              </button>
            </div>
          )}

          {!live && (
            <div
              className={`filedrop rl-drop${dragging ? " drag" : ""}${
                files.length ? " has" : ""
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                hidden
                multiple
                accept="image/*,video/*,.zip,application/zip"
                onChange={(e) => addFiles(e.target.files)}
              />
              <button className="btn" onClick={() => inputRef.current?.click()}>
                Choose images, a ZIP, or a video
              </button>
              <p className="filedrop-hint">
                or drop them here — frames, the frames ZIP, or a screen recording
              </p>
            </div>
          )}

          {!live && files.length > 0 && (
            <div className="rl-files">
              <div className="rl-files-head">
                <span className="mono">
                  {files.length} item{files.length === 1 ? "" : "s"} ·{" "}
                  {formatBytes(totalBytes)}
                </span>
                <button className="btn ghost sm" onClick={clearAll} disabled={busy}>
                  Clear all
                </button>
              </div>
              <ul className="rl-files-list">
                {files.map((f, i) => (
                  <li key={`${f.name}:${f.size}:${i}`} className="rl-file">
                    <span className="rl-file-name mono">{f.name}</span>
                    <span className="rl-file-size mono">
                      {formatBytes(f.size)}
                    </span>
                    <button
                      className="rl-file-x"
                      onClick={() => removeFile(i)}
                      disabled={busy}
                      aria-label={`Remove ${f.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* password */}
          <div className="pw rl-pw">
            <label className="pw-label" htmlFor="rl-pw">
              Password <span className="req">required</span>
            </label>
            <div className="pw-box">
              <input
                id="rl-pw"
                className="pw-input mono"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="the password used to encode"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="pw-toggle"
                type="button"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "hide" : "show"}
              </button>
            </div>
          </div>

          {live ? (
            <CameraCapture
              canStart={password.length > 0 && !busy}
              onCapture={onLiveCapture}
            />
          ) : (
            <button className="btn rl-go" onClick={decode} disabled={!canDecode}>
              {busy ? "Decoding…" : "Decode & reconstruct"}
            </button>
          )}

          <p className="assurance">
            <span className="assurance-lock" aria-hidden="true">
              ▣
            </span>
            Everything is decoded in this browser. Nothing is uploaded.
          </p>
        </section>

        {/* progress */}
        {busy && (
          <section className="pmod-progress rl-progress">
            <span className="mono pmod-stage">{stage}</span>
            {progress ? (
              <>
                <div className="pmod-bar">
                  <div
                    className="pmod-bar-fill"
                    style={{
                      width: `${(progress.value / progress.max) * 100}%`,
                    }}
                  />
                </div>
                <span className="mono pmod-count">
                  {progress.value} / {progress.max} frames
                </span>
              </>
            ) : (
              <div className="pmod-bar indet">
                <div className="pmod-bar-indet" />
              </div>
            )}
          </section>
        )}

        {/* failure (incl. "give up — insufficient frames") */}
        {phase === "failed" && failure && (
          <section className="rl-fail">
            <span className="rl-fail-icon" aria-hidden="true">
              ⚠
            </span>
            <div>
              <p className="rl-fail-reason">{failure.reason}</p>
              {failure.detail && (
                <p className="rl-fail-detail mono">{failure.detail}</p>
              )}
            </div>
          </section>
        )}

        {/* skipped images (informational) */}
        {issues.length > 0 && phase !== "working" && (
          <section className="rl-issues">
            <span className="mono rl-issues-head">
              {issues.length} item{issues.length === 1 ? "" : "s"} skipped
            </span>
            <ul>
              {issues.slice(0, 8).map((it, i) => (
                <li key={i} className="mono">
                  <span className="rl-issue-name">{it.name}</span> — {it.reason}
                </li>
              ))}
              {issues.length > 8 && (
                <li className="mono">… (+{issues.length - 8} more)</li>
              )}
            </ul>
          </section>
        )}

        {/* success */}
        {phase === "done" && output && (
          <section className="rl-result">
            <div className="pmod-stats rl-result-stats">
              <Stat k="recovered" v={output.name} />
              <Stat k="size" v={formatBytes(output.rawBytes)} />
              <Stat k="from frames" v={String(output.frames)} />
              <Stat k="kind" v={output.kind === "file" ? "file" : "text"} />
            </div>

            {output.kind === "file" ? (
              <a className="btn rl-download" href={output.url} download={output.name}>
                ⤓ Download {output.name}
              </a>
            ) : (
              <div className="rl-text">
                <div className="rl-text-bar">
                  <span className="mono">recovered text</span>
                  <button className="btn ghost sm" onClick={copyText}>
                    Copy
                  </button>
                </div>
                <pre className="rl-text-body mono">{output.text}</pre>
                {output.truncated && (
                  <p className="rl-text-note">
                    Preview truncated to {PREVIEW_CAP.toLocaleString()} characters.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <ReceiveDescription />
      </div>
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

function ReceiveDescription() {
  return (
    <div className="pmod-desc rl-desc">
      <h4>How reception works</h4>
      <ol>
        <li>
          <strong>Read the beacon.</strong> Each frame carries a fixed-geometry
          beacon in its top-left corner — read first, it reveals the grid
          (cell &amp; border) and the frame&apos;s place in the sequence
          (<span className="mono">i / n</span>), regardless of the settings used.
        </li>
        <li>
          <strong>Sample the cells.</strong> With the grid known, every cell
          centre is read back into its three R/G/B bytes — the exact inverse of
          the encoder.
        </li>
        <li>
          <strong>Check the set.</strong> Frames are reordered by index. If any
          are missing, reconstruction stops here — a partial set can&apos;t be
          stitched into a valid file.
        </li>
        <li>
          <strong>Unseal.</strong> The reassembled stream is decrypted with your
          password (AES-256-GCM) and decompressed (Zstd) back to the original
          text or file.
        </li>
      </ol>
    </div>
  );
}
