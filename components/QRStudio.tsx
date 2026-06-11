"use client";

import { useEffect, useMemo, useState } from "react";
import {
  byteLength,
  fillRatio,
  MAX_BYTES,
  ECC_LABELS,
  type EccLevel,
} from "@/lib/qr/capacity";
import { encodeToSvg, encodeToPng } from "@/lib/qr/encode";
import { triggerFor, type HiddenView } from "@/lib/secret";

const ECC_ORDER: EccLevel[] = ["L", "M", "Q", "H"];
const DEFAULT_TEXT = "https://why-stop-at-2953.app";

/** Truncate `text` to at most `maxBytes` UTF-8 bytes without splitting a glyph. */
function clampToBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  // Walk back by code points until it fits.
  const chars = Array.from(text);
  let out = "";
  for (const ch of chars) {
    if (byteLength(out + ch) > maxBytes) break;
    out += ch;
  }
  return out;
}

export function QRStudio({
  onReveal,
}: {
  onReveal: (view: HiddenView) => void;
}) {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [ecc, setEcc] = useState<EccLevel>("L");
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  // The hidden door: triple-click a QR built from a trigger phrase. We reveal
  // the lab in-place (no navigation) so the URL never betrays the secret. The
  // phrase decides which side opens — encode or decode.
  function onSymbolClick(e: React.MouseEvent) {
    if (e.detail >= 3) {
      const view = triggerFor(text);
      if (view) onReveal(view);
    }
  }

  const ceiling = MAX_BYTES[ecc];
  const bytes = byteLength(text);
  const ratio = fillRatio(bytes, ecc);
  const remaining = ceiling - bytes;

  // Keep payload within the active ceiling whenever the level tightens.
  function onText(next: string) {
    setText(clampToBytes(next, ceiling));
  }
  function onEcc(next: EccLevel) {
    setEcc(next);
    setText((t) => clampToBytes(t, MAX_BYTES[next]));
  }

  // Re-encode whenever payload or level changes (debounced for smoothness).
  useEffect(() => {
    let cancelled = false;
    if (!text) {
      setSvg("");
      setError("");
      return;
    }
    const id = setTimeout(async () => {
      try {
        const out = await encodeToSvg(text, { ecc });
        if (!cancelled) {
          setSvg(out);
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setSvg("");
          setError(e instanceof Error ? e.message : "Failed to encode.");
        }
      }
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [text, ecc]);

  async function download(kind: "svg" | "png") {
    if (!text) return;
    let href: string;
    let name: string;
    if (kind === "svg") {
      const data = await encodeToSvg(text, { ecc });
      href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
      name = "qr.svg";
    } else {
      href = await encodeToPng(text, { ecc, scale: 12 });
      name = "qr.png";
    }
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
  }

  const fillPct = useMemo(() => `${(ratio * 100).toFixed(1)}%`, [ratio]);
  const near = ratio > 0.85;
  const full = remaining <= 0;

  return (
    <div className="studio">
      {/* ---- left: input ---- */}
      <section className="panel input-panel">
        <header className="panel-head">
          <h2 className="panel-title">Payload</h2>
          <div className="ecc">
            {ECC_ORDER.map((lvl) => (
              <button
                key={lvl}
                className={`ecc-pill${lvl === ecc ? " on" : ""}`}
                onClick={() => onEcc(lvl)}
                title={ECC_LABELS[lvl]}
              >
                {lvl}
              </button>
            ))}
          </div>
        </header>

        <textarea
          className="payload mono"
          value={text}
          onChange={(e) => onText(e.target.value)}
          spellCheck={false}
          placeholder="Type or paste anything — a URL, a note, a key…"
          aria-label="QR payload"
        />

        <div className="meter">
          <div className="meter-row">
            <span className="mono meter-count">
              <strong className={full ? "danger" : near ? "warn" : ""}>
                {bytes.toLocaleString()}
              </strong>
              <span className="meter-sep"> / </span>
              {ceiling.toLocaleString()} bytes
            </span>
            <span className="mono meter-remain">
              {full ? "ceiling reached" : `${remaining.toLocaleString()} left`}
            </span>
          </div>
          <div className="meter-track" aria-hidden="true">
            <div
              className={`meter-fill${full ? " danger" : near ? " warn" : ""}`}
              style={{ width: fillPct }}
            />
          </div>
          <p className="meter-note">
            Level <strong>{ecc}</strong> · {ECC_LABELS[ecc]} · a single QR
            symbol stops at {MAX_BYTES.L.toLocaleString()} bytes.
          </p>
        </div>
      </section>

      {/* ---- right: preview ---- */}
      <section className="panel preview-panel">
        <header className="panel-head">
          <h2 className="panel-title">Symbol</h2>
        </header>

        <div className="qr-stage">
          {svg ? (
            <div
              className="qr-frame"
              onClick={onSymbolClick}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="qr-empty">
              <span className="mono">{error || "awaiting payload"}</span>
            </div>
          )}
        </div>

        <div className="export">
          <button
            className="btn"
            onClick={() => download("png")}
            disabled={!svg}
          >
            Download PNG
          </button>
          <button
            className="btn ghost"
            onClick={() => download("svg")}
            disabled={!svg}
          >
            Download SVG
          </button>
        </div>
      </section>
    </div>
  );
}
