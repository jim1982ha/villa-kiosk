// src/components/common/Window.tsx
// THE frame of every window that opens over the villa (architecture review O, 2026-10-27): the layer it is drawn in
// (DialogLayer), its backdrop (a tap on it closes), the card that keeps a tap inside it, its dialog role and name, and
// Escape / Back with the focus kept in (useModalA11y). Its HEIGHT is its kind's, one rule each in 04-modals and
// 05-layout:
//   * "content": a window of content (the Cockpit, Settings, a device list, a form) — the ONE height of every window
//     (owner, 2026-10-20: "all the modal to keep the same height whatever the content is");
//   * "device": a window about ONE device (its own window, "Open a ticket") — as tall as what it shows (owner, same
//     day: "keep an adjusted height");
//   * "question": a question box or the colour picker — its own size;
//   * "screen": the whole screen, over every other window (an announcement the owner picked for full screen, ticket 16
//     of "One inbox").
//
// ⚠️ EACH WINDOW BUILT ITS FRAME BY HAND (to 2.496.548): the same five lines in eleven files, and a height chosen by a
// list of exceptions each new window had to remember to join — "every window drawn over the whole screen" was the same
// edit in twelve files. A window says what it is; what that means is decided here.

import type { CSSProperties, ReactNode } from "react";
import DialogLayer from "./DialogLayer";
import { useModalA11y } from "@/hooks/useModalA11y";

export type WindowKind = "content" | "device" | "question" | "screen";

export default function Window({ kind, label, onClose, onEscape, className, layer, zIndex, style, frameKey, outside, children }: {
  kind: WindowKind;
  /** Its name, as a screen reader says it. */
  label: string;
  /** A tap on the backdrop; and Escape / Back unless `onEscape` says otherwise. */
  onClose: () => void;
  /** Escape / Back, when it is not `onClose` (a device window opened from another goes back to it). */
  onEscape?: () => void;
  /** The card's own classes besides `modal` and its kind ("settings-modal cockpit-modal"). */
  className?: string;
  /** The backdrop's own classes besides `modal-backdrop` ("panel-modal-backdrop"). */
  layer?: string;
  /** Over another window (a question over a device window). */
  zIndex?: number;
  style?: CSSProperties;
  /** Remounts the card when it changes (the Legend redraws on a theme change). */
  frameKey?: string;
  /** Drawn in the same layer, beside the card (a picker the window opens). */
  outside?: ReactNode;
  children: ReactNode;
}) {
  const ref = useModalA11y(onEscape ?? onClose);
  return (
    <DialogLayer className={`modal-backdrop${kind === "screen" ? " backdrop-screen" : ""}${layer ? ` ${layer}` : ""}`} onClick={onClose}
      style={zIndex !== undefined ? { zIndex } : undefined}>
      <div key={frameKey} ref={ref} className={`modal window-${kind}${className ? ` ${className}` : ""}`} style={style}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
      {outside}
    </DialogLayer>
  );
}
