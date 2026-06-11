"use client";

import { useRef, useState } from "react";
import { useLab } from "./LabProvider";
import { formatBytes } from "@/lib/format";

export function FileDrop() {
  const { file, sourceKind, selectFile, clearFile } = useLab();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const active = sourceKind === "file" && file;

  function pick(files: FileList | null) {
    const f = files?.[0];
    if (f) selectFile(f);
  }

  return (
    <div className="filedrop-wrap">
      <div
        className={`filedrop${dragging ? " drag" : ""}${active ? " has" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => pick(e.target.files)}
        />

        {active ? (
          <div className="filedrop-file">
            <span className="filedrop-name mono">{file!.name}</span>
            <span className="filedrop-size mono">{formatBytes(file!.size)}</span>
            <button className="btn ghost sm" onClick={clearFile}>
              Remove
            </button>
          </div>
        ) : (
          <>
            <button className="btn" onClick={() => inputRef.current?.click()}>
              Choose a file
            </button>
            <p className="filedrop-hint">or drop it here</p>
          </>
        )}
      </div>

      <p className="assurance">
        <span className="assurance-lock" aria-hidden="true">
          ▣
        </span>
        Your file is read in this browser for processing only. It is{" "}
        <strong>never uploaded</strong> — no network requests are made.
      </p>
    </div>
  );
}
