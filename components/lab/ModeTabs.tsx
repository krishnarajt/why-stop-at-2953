"use client";

import { useLab, type Mode } from "./LabProvider";
import { PristineModule } from "./modes/PristineModule";
import { ScreenshotModule } from "./modes/ScreenshotModule";
import { CameraModule } from "./modes/CameraModule";

const TABS: { id: Mode; label: string; ready: boolean; blurb: string }[] = [
  {
    id: "pristine",
    label: "Pristine",
    ready: true,
    blurb:
      "Lossless channel — symbols meant to be decoded straight from the screen or a clean export.",
  },
  {
    id: "screenshot",
    label: "Screenshot",
    ready: true,
    blurb:
      "Tuned for capture-and-share: resilient to compression and scaling round-trips.",
  },
  {
    id: "camera",
    label: "Camera",
    ready: true,
    blurb:
      "Built for a phone pointed at a screen — heavy error correction and paced playback.",
  },
];

export function ModeTabs() {
  const { mode, setMode } = useLab();

  return (
    <section className="modes">
      <div className="modes-bar" role="tablist" aria-label="Transmission mode">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === mode}
            className={`mode-tab${t.id === mode ? " on" : ""}`}
            onClick={() => setMode(t.id)}
          >
            {t.label}
            {!t.ready && <span className="rl-soon">soon</span>}
          </button>
        ))}
      </div>

      <div className="mode-panel" role="tabpanel">
        {mode === "pristine" ? (
          <PristineModule />
        ) : mode === "screenshot" ? (
          <ScreenshotModule />
        ) : (
          <CameraModule />
        )}
      </div>
    </section>
  );
}
