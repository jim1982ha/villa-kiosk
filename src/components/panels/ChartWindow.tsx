// src/components/panels/ChartWindow.tsx
// A device's chart, larger, in a window of its own (owner, 2026-10-29: "click on it and increase the chart in full-screen
// (or make it visible in a modal the same size as the Cockpit modal, on Desktop screen) … the extended view shall have
// the line `Last …` and the time aggregation toggle too … and the Y-axis bound filter"): the windows' own frame at the
// Cockpit's width (full screen on a phone, as every window of content), over the device window. What it draws is the
// caller's: the same header, toggle and slider, bound to the same choices, so the two views never disagree.

import { useState, type ReactNode } from "react";
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

/** ⚠️ THE LARGER CHART BELONGS TO THE CHART (architecture review 2026-10-29, #6): every trend chart opens larger the same
 *  way — its button on its unit line, its window with `head` above it (the `Last …` line or the chart's title, and the
 *  period toggle) — instead of each screen building the window per layout. `chart` draws it: small (`height`
 *  undefined: the caller's own) with `onExpand`, or at the window's height without. */
export function ExpandableChart({ title, head, chart }: {
  title: string;
  head: ReactNode;
  chart: (height: number | undefined, onExpand?: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {chart(undefined, () => setOpen(true))}
      {open && (
        <ChartWindow title={title} onClose={() => setOpen(false)}>
          {head}{chart(chartWindowHeight(globalThis.innerHeight ?? 800))}
        </ChartWindow>
      )}
    </>
  );
}
