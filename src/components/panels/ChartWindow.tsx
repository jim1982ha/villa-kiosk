// src/components/panels/ChartWindow.tsx
// A device's chart, larger, in a window of its own (owner, 2026-10-29: "click on it and increase the chart in full-screen
// (or make it visible in a modal the same size as the Cockpit modal, on Desktop screen) … the extended view shall have
// the line `Last …` and the time aggregation toggle too … and the Y-axis bound filter"): the windows' own frame at the
// Cockpit's width (full screen on a phone, as every window of content), over the device window. What it draws is the
// caller's: the same header, toggle and slider, bound to the same choices, so the two views never disagree.

import type { ReactNode } from "react";
import Window from "@/components/common/Window";
import ModalFooter from "@/components/common/ModalFooter";

/** The plot's height in the window: what the screen leaves under the header, toggle and footer, within bounds. */
export function chartWindowHeight(screenPx: number): number {
  return Math.round(Math.min(560, Math.max(220, screenPx - 360)));
}

export default function ChartWindow({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Window kind="content" label={title} onClose={onClose} className="settings-modal cockpit-modal chart-modal"
      layer="panel-modal-backdrop" zIndex={80}>
      <div className="modal-header"><h2>{title}</h2></div>
      <div className="modal-body">{children}</div>
      <ModalFooter onClose={onClose} />
    </Window>
  );
}
