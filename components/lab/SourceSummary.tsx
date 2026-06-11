"use client";

import { useLab } from "./LabProvider";
import { formatBytes } from "@/lib/format";

const SOURCE_LABEL: Record<string, string> = {
  none: "no source yet",
  text: "text payload",
  file: "file",
};

export function SourceSummary() {
  const { sourceKind, sourceBytes, password, ready, mode, transmit } = useLab();

  const rows: [string, string][] = [
    ["source", SOURCE_LABEL[sourceKind]],
    ["size", sourceKind === "none" ? "—" : formatBytes(sourceBytes)],
    ["password", password.length ? `${password.length} chars set` : "missing"],
    ["mode", mode],
  ];

  return (
    <aside className="summary">
      <span className="panel-title">Status</span>
      <dl className="summary-list">
        {rows.map(([k, v]) => (
          <div key={k} className="summary-row">
            <dt className="mono">{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <button
        className={`summary-badge${ready ? " on" : ""}`}
        onClick={transmit}
        disabled={!ready}
      >
        {ready ? "transmit ▸" : "incomplete"}
      </button>
      <p className="summary-note">
        Exactly one source is used at a time — choosing a file disables the text
        box, and vice versa.
      </p>
    </aside>
  );
}
