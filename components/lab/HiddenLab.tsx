"use client";

import { useEffect, useState } from "react";
import { TransmitLab } from "./TransmitLab";
import { ReceiveLab } from "./ReceiveLab";
import type { HiddenView } from "@/lib/secret";

/**
 * The hidden surface: a full-viewport overlay that hosts the transmit and
 * receive labs as swappable client-side views. Nothing here is a route, so the
 * URL stays on the innocuous generator the whole time. `initialView` is chosen
 * by the trigger phrase that opened it.
 */
export function HiddenLab({
  initialView,
  onClose,
}: {
  initialView: HiddenView;
  onClose: () => void;
}) {
  const [view, setView] = useState<HiddenView>(initialView);

  // Esc backs out of the whole surface — unless a viewer is fullscreen, where
  // Esc means "exit fullscreen" and must not also tear down the lab (and its
  // freshly encoded frames) in the same keypress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="hidden-surface" role="dialog" aria-modal="true">
      {view === "transmit" ? (
        <TransmitLab onClose={onClose} onDecode={() => setView("receive")} />
      ) : (
        <ReceiveLab onTransmit={() => setView("transmit")} onClose={onClose} />
      )}
    </div>
  );
}
