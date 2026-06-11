import { compress, decompress, levelFor } from "./compression";
import { encrypt, decrypt } from "./encryption";
import { buildContainer, parseContainer, type ContainerMeta } from "./container";

/**
 * The shared front of every transmission pipeline:
 *   raw bytes -> Zstd compress -> AES-256-GCM encrypt -> container header.
 * The result is the self-describing byte stream that a mode (pristine, …)
 * then turns into its visual carrier.
 */

export type PipelineStage = "reading" | "compressing" | "encrypting" | "packing";

/** loaded/total present => determinate; absent => indeterminate (one-shot). */
export interface PipelineProgress {
  stage: PipelineStage;
  loaded?: number;
  total?: number;
}

export interface PipelineInput {
  /** Exactly one of these is set. */
  text?: string;
  file?: File | null;
  password: string;
}

export interface PipelineResult {
  stream: Uint8Array;
  rawBytes: number;
  compressedBytes: number;
  streamBytes: number;
  level: number;
  name: string;
  isFile: boolean;
}

/** Let React paint the new stage before we hit a blocking WASM/crypto call. */
const repaint = () => new Promise((r) => setTimeout(r, 0));

/** Read a File into one Uint8Array, reporting bytes as they stream in. */
async function readFileWithProgress(
  file: File,
  onProgress: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const total = file.size;
  const out = new Uint8Array(total);
  const reader = file.stream().getReader();
  let loaded = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, loaded);
    loaded += value.length;
    onProgress(loaded, total);
  }
  return out;
}

export async function buildStream(
  input: PipelineInput,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  let bytes: Uint8Array;
  let name = "";
  let isFile = false;

  if (input.file) {
    isFile = true;
    name = input.file.name;
    bytes = await readFileWithProgress(input.file, (loaded, total) =>
      onProgress?.({ stage: "reading", loaded, total }),
    );
  } else {
    onProgress?.({ stage: "reading" });
    bytes = new TextEncoder().encode(input.text ?? "");
  }
  const rawBytes = bytes.length;
  const level = levelFor(rawBytes);

  onProgress?.({ stage: "compressing" });
  await repaint();
  const compressed = await compress(bytes, level);

  onProgress?.({ stage: "encrypting" });
  await repaint();
  const encrypted = await encrypt(compressed, input.password);

  onProgress?.({ stage: "packing" });
  await repaint();
  const stream = buildContainer(encrypted, { encrypted: true, isFile, name });

  return {
    stream,
    rawBytes,
    compressedBytes: compressed.length,
    streamBytes: stream.length,
    level,
    name,
    isFile,
  };
}

export interface ReconstructResult {
  /** The fully recovered original bytes (text or file contents). */
  bytes: Uint8Array;
  meta: ContainerMeta;
}

/** Distinguishes recoverable user errors (bad password, wrong file) from bugs. */
export class ReconstructError extends Error {}

/**
 * The exact inverse of {@link buildStream}, minus the carrier:
 *   container -> [decrypt] -> decompress -> original bytes.
 * Throws a {@link ReconstructError} with a friendly message when the stream
 * isn't a valid container or the password is wrong.
 */
export async function reconstruct(
  stream: Uint8Array,
  password: string,
): Promise<ReconstructResult> {
  const parsed = parseContainer(stream);
  if (!parsed) {
    throw new ReconstructError(
      "These frames don't form a valid transmission (bad or corrupt header).",
    );
  }

  let payload = parsed.payload;
  if (parsed.meta.encrypted) {
    try {
      payload = await decrypt(payload, password);
    } catch {
      // AES-GCM auth failure is indistinguishable from a wrong password.
      throw new ReconstructError(
        "Wrong password, or the frames were altered after capture.",
      );
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = await decompress(payload);
  } catch {
    throw new ReconstructError(
      "Decompression failed — the recovered stream is incomplete or corrupt.",
    );
  }

  return { bytes, meta: parsed.meta };
}
