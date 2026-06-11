import { zip } from "fflate";
import type { PristineFrame } from "./encode";

/**
 * Bundle the pristine PNG frames into a single ZIP and trigger a download.
 * PNGs are already compressed, so frames are STORED (level 0) — fast and no
 * wasted CPU. Frame names are zero-padded so they sort correctly.
 */
export async function downloadFramesZip(
  frames: PristineFrame[],
  baseName = "pristine",
): Promise<void> {
  const pad = String(frames.length).length;
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};

  for (const f of frames) {
    const buf = new Uint8Array(await f.blob.arrayBuffer());
    const name = `frame-${String(f.index + 1).padStart(pad, "0")}.png`;
    entries[name] = [buf, { level: 0 }];
  }

  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, (err, data) => (err ? reject(err) : resolve(data)));
  });

  const blobParts: BlobPart[] = [archive.slice().buffer as ArrayBuffer];
  const blob = new Blob(blobParts, { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName || "pristine"}-frames.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
