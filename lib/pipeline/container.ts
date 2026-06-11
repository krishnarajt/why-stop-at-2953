/**
 * Self-describing container that wraps the (compressed + optionally encrypted)
 * payload with just enough metadata to reconstruct it later.
 *
 * Layout (big-endian):
 *   0   4   magic "WS29"
 *   4   1   version (1)
 *   5   1   flags  (bit0 = encrypted, bit1 = isFile)
 *   6   1   nameLen (0..255, UTF-8 bytes)
 *   7   1   reserved
 *   8   4   payloadLen (uint32)
 *   12  nL  name (UTF-8)
 *   ..  pL  payload
 */

export const MAGIC = [0x57, 0x53, 0x32, 0x39]; // "WS29"
export const VERSION = 1;
export const FLAG_ENCRYPTED = 0x01;
export const FLAG_IS_FILE = 0x02;
export const HEADER_LEN = 12;

export interface ContainerMeta {
  encrypted: boolean;
  isFile: boolean;
  name: string;
}

export function buildContainer(
  payload: Uint8Array,
  meta: ContainerMeta,
): Uint8Array {
  const nameBytes = new TextEncoder().encode(meta.name).slice(0, 255);
  const out = new Uint8Array(HEADER_LEN + nameBytes.length + payload.length);
  const dv = new DataView(out.buffer);

  MAGIC.forEach((b, i) => (out[i] = b));
  out[4] = VERSION;
  out[5] =
    (meta.encrypted ? FLAG_ENCRYPTED : 0) | (meta.isFile ? FLAG_IS_FILE : 0);
  out[6] = nameBytes.length;
  out[7] = 0;
  dv.setUint32(8, payload.length, false);

  out.set(nameBytes, HEADER_LEN);
  out.set(payload, HEADER_LEN + nameBytes.length);
  return out;
}

export function parseContainer(
  stream: Uint8Array,
): { meta: ContainerMeta; payload: Uint8Array } | null {
  if (stream.length < HEADER_LEN) return null;
  if (!MAGIC.every((b, i) => stream[i] === b)) return null;

  const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const flags = stream[5];
  const nameLen = stream[6];
  const payloadLen = dv.getUint32(8, false);
  const name = new TextDecoder().decode(
    stream.subarray(HEADER_LEN, HEADER_LEN + nameLen),
  );
  const payload = stream.subarray(
    HEADER_LEN + nameLen,
    HEADER_LEN + nameLen + payloadLen,
  );

  return {
    meta: {
      encrypted: (flags & FLAG_ENCRYPTED) !== 0,
      isFile: (flags & FLAG_IS_FILE) !== 0,
      name,
    },
    payload,
  };
}
