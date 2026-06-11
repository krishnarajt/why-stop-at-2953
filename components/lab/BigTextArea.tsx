"use client";

import { useEffect, useRef } from "react";
import { useLab } from "./LabProvider";
import { formatBytes } from "@/lib/format";

export function BigTextArea() {
  const { sourceKind, sourceBytes, onTextInput, textResetToken } = useLab();
  const ref = useRef<HTMLTextAreaElement>(null);
  const disabled = sourceKind === "file";

  // When a file takes over (or text is cleared elsewhere), wipe the DOM value.
  // The textarea is uncontrolled, so this is how it gets reset.
  useEffect(() => {
    if (ref.current) ref.current.value = "";
  }, [textResetToken]);

  return (
    <div className={`bigtext${disabled ? " disabled" : ""}`}>
      <div className="bigtext-head">
        <span className="panel-title">Text payload</span>
        {sourceKind === "text" && (
          <span className="mono bigtext-size">{formatBytes(sourceBytes)}</span>
        )}
      </div>

      <textarea
        ref={ref}
        className="bigtext-area mono"
        defaultValue=""
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        wrap="off"
        placeholder="Paste anything — no size limit. Large pastes stay smooth: the text never enters React state, only its measured size does."
        onChange={(e) => onTextInput(e.target.value)}
      />

      {disabled && (
        <div className="bigtext-lock">
          A file is selected. Remove it to type here instead.
        </div>
      )}
    </div>
  );
}
