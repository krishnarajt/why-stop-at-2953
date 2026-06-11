/**
 * The hidden door.
 *
 * If the payload typed into the generator matches one of these phrases AND the
 * user triple-clicks the rendered QR symbol, the lab is revealed in-place — no
 * navigation, so the URL stays on the innocuous generator and never betrays the
 * secret. There is no visible hint anywhere; the QR for a trigger phrase looks
 * like any other.
 *
 * There are two knocks: one opens straight onto the transmit (encode) side,
 * the other onto the receive (decode) side. Edit these lists to change them.
 */
export const TRIGGER_PHRASES = [
  "pablo escobar",
  "sam altman",
];

/** Phrases that open the lab on the decode side instead. */
export const DECODE_PHRASES = [
  "robin hood",
  "sonu sood",
];

/** Which side of the lab a knock opens onto. */
export type HiddenView = "transmit" | "receive";

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const TRANSMIT_SET = new Set(TRIGGER_PHRASES.map(normalize));
const RECEIVE_SET = new Set(DECODE_PHRASES.map(normalize));

/** The view a phrase unlocks, or null if it's not a trigger at all. */
export function triggerFor(text: string): HiddenView | null {
  const n = normalize(text);
  if (TRANSMIT_SET.has(n)) return "transmit";
  if (RECEIVE_SET.has(n)) return "receive";
  return null;
}
