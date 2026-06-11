"use client";

import { LabProvider } from "./LabProvider";
import { FileDrop } from "./FileDrop";
import { PasswordField } from "./PasswordField";
import { BigTextArea } from "./BigTextArea";
import { SourceSummary } from "./SourceSummary";
import { ModeTabs } from "./ModeTabs";

export function TransmitLab({
  onClose,
  onDecode,
}: {
  onClose: () => void;
  onDecode: () => void;
}) {
  return (
    <LabProvider>
      <div className="lab">
        <header className="lab-bar">
          <button type="button" className="lab-back" onClick={onClose}>
            <span aria-hidden="true">←</span> Back to site
          </button>
          <div className="lab-id">
            <span className="lab-id-name mono">visual transfer lab</span>
            <span className="lab-id-sub">beyond a single symbol</span>
          </div>
          <button type="button" className="lab-cross" onClick={onDecode}>
            Decode <span aria-hidden="true">→</span>
          </button>
        </header>

        <div className="lab-body container">
          <section className="lab-intake">
            <FileDrop />
            <PasswordField />
          </section>

          <section className="lab-source">
            <BigTextArea />
            <SourceSummary />
          </section>

          <ModeTabs />
        </div>
      </div>
    </LabProvider>
  );
}
