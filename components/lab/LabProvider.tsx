"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Shared state for the transmit lab.
 *
 * The mode tabs (Pristine / Screenshot / Camera) will all read the chosen
 * source + password from here, so the orchestration lives in one place.
 *
 * Big-text safety: the payload string is intentionally kept OUT of React
 * state (in `textRef`). The textarea is uncontrolled, so pasting tens of MB
 * never triggers a React re-render of that giant value. Only its byte size —
 * a single number, computed via Blob and debounced — lives in state.
 */

export type SourceKind = "none" | "text" | "file";
export type Mode = "pristine" | "screenshot" | "camera";

interface LabValue {
  sourceKind: SourceKind;
  file: File | null;
  /** UTF-8 byte size of the active source (text or file). */
  sourceBytes: number;
  /** Read the current text payload on demand (not reactive). */
  getText: () => string;
  password: string;
  mode: Mode;
  /** Source chosen AND a password provided. */
  ready: boolean;
  /** Bumped when the textarea DOM should reset itself (e.g. file took over). */
  textResetToken: number;
  /** Bumped each time the user fires a transmission; the active module runs. */
  transmitNonce: number;

  onTextInput: (value: string) => void;
  clearText: () => void;
  selectFile: (file: File) => void;
  clearFile: () => void;
  setPassword: (pw: string) => void;
  setMode: (m: Mode) => void;
  /** Kick off the active module (no-op unless ready). */
  transmit: () => void;
}

const LabContext = createContext<LabValue | null>(null);

const BYTE_DEBOUNCE_MS = 120;

function blobBytes(s: string): number {
  return new Blob([s]).size;
}

export function LabProvider({ children }: { children: React.ReactNode }) {
  const textRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sourceKind, setSourceKind] = useState<SourceKind>("none");
  const [file, setFile] = useState<File | null>(null);
  const [textBytes, setTextBytes] = useState(0);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("pristine");
  const [textResetToken, setTextResetToken] = useState(0);
  const [transmitNonce, setTransmitNonce] = useState(0);

  const getText = useCallback(() => textRef.current, []);

  const onTextInput = useCallback(
    (value: string) => {
      textRef.current = value;
      const hasText = value.length > 0;

      // Text and file are mutually exclusive — typing supersedes a file.
      setFile((f) => (hasText && f ? null : f));
      setSourceKind(hasText ? "text" : file ? "file" : "none");

      // Debounce the (potentially large) byte measurement.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setTextBytes(blobBytes(value));
      }, BYTE_DEBOUNCE_MS);
    },
    [file],
  );

  const clearText = useCallback(() => {
    textRef.current = "";
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setTextBytes(0);
    setTextResetToken((t) => t + 1);
    setSourceKind((k) => (k === "text" ? "none" : k));
  }, []);

  const selectFile = useCallback((f: File) => {
    // File supersedes any typed text.
    textRef.current = "";
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setTextBytes(0);
    setTextResetToken((t) => t + 1);
    setFile(f);
    setSourceKind("file");
  }, []);

  const clearFile = useCallback(() => {
    setFile(null);
    setSourceKind(textRef.current ? "text" : "none");
  }, []);

  const sourceBytes = sourceKind === "file" ? (file?.size ?? 0) : textBytes;
  const ready = sourceKind !== "none" && password.length > 0;

  const transmit = useCallback(() => {
    if (sourceKind !== "none" && password.length > 0) {
      setTransmitNonce((n) => n + 1);
    }
  }, [sourceKind, password]);

  const value = useMemo<LabValue>(
    () => ({
      sourceKind,
      file,
      sourceBytes,
      getText,
      password,
      mode,
      ready,
      textResetToken,
      transmitNonce,
      onTextInput,
      clearText,
      selectFile,
      clearFile,
      setPassword,
      setMode,
      transmit,
    }),
    [
      sourceKind,
      file,
      sourceBytes,
      getText,
      password,
      mode,
      ready,
      textResetToken,
      transmitNonce,
      onTextInput,
      clearText,
      selectFile,
      clearFile,
      transmit,
    ],
  );

  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLab(): LabValue {
  const ctx = useContext(LabContext);
  if (!ctx) throw new Error("useLab must be used within <LabProvider>");
  return ctx;
}
