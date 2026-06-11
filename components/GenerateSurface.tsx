"use client";

import { useState } from "react";
import { QRStudio } from "./QRStudio";
import { HiddenLab } from "./lab/HiddenLab";
import type { HiddenView } from "@/lib/secret";

/**
 * The generator and the hidden lab share one page so the address bar never
 * changes. The QR studio reveals the lab in-place via a callback; the lab is a
 * full-viewport overlay rendered on top, dismissed back to the generator. Which
 * side opens (encode/decode) depends on the trigger phrase used.
 */
export function GenerateSurface() {
  const [view, setView] = useState<HiddenView | null>(null);
  return (
    <>
      <QRStudio onReveal={setView} />
      {view && <HiddenLab initialView={view} onClose={() => setView(null)} />}
    </>
  );
}
