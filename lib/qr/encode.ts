import QRCode from "qrcode";
import type { EccLevel } from "./capacity";

/**
 * QR encoding boundary.
 *
 * Everything that turns payload -> visual QR goes through here. Keeping it
 * isolated means the UI never touches the codec directly, and alternative
 * encoders (multi-symbol, custom payload framing, ...) can slot in later
 * without the components knowing.
 */

export interface EncodeOptions {
  ecc?: EccLevel;
  /** Quiet-zone width in modules. */
  margin?: number;
  /** Pixel size of the rendered raster (for PNG export). */
  scale?: number;
}

const DEFAULTS: Required<EncodeOptions> = {
  ecc: "L",
  margin: 2,
  scale: 8,
};

/** Render payload to a crisp, scalable SVG string. */
export async function encodeToSvg(
  payload: string,
  opts: EncodeOptions = {},
): Promise<string> {
  const { ecc, margin } = { ...DEFAULTS, ...opts };
  return QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: ecc,
    margin,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/** Render payload to a PNG data URL — used for downloads. */
export async function encodeToPng(
  payload: string,
  opts: EncodeOptions = {},
): Promise<string> {
  const { ecc, margin, scale } = { ...DEFAULTS, ...opts };
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: ecc,
    margin,
    scale,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
