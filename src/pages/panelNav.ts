// src/pages/panelNav.ts
// WHICH DEVICE PANEL IS OPEN, AND WHERE ITS "BACK" GOES — one owner. Pure:
// tests/oracles/panel_back.mjs drives it by value.
//
// ⚠️ BACK WAS A STACK OF CLOSURES (2.496.270–273). Each opener in the
// Dashboard pushed a `go: () => …` it wrote itself, so what Back did could
// only be read by running it, and two openers got the ORDER wrong: they
// recorded the Back step (and the Cockpit/Agent hand-over closed its window)
// BEFORE asking whether the device could open at all. A device the profile
// may not see therefore closed the window for nothing and left a Back step
// pointing at it. A step is now DATA, an open is refused unless there is a
// panel to open, and the window closes only on an open that happened.

import type { ActivePanel } from "@/types/panel.types";
import type { Category } from "@/types/scene.types";
import type { Surface } from "./surfaces";

/** A list a device was opened from: a room's chip group or a category. */
export type ListRef =
  | { kind: "room"; room: string; entityIds: readonly string[] }
  | { kind: "category"; category: Category };

/** One step back from the open panel. */
export type BackStep =
  | { kind: "surface"; surface: Surface }
  | { kind: "list"; list: ListRef }
  | { kind: "panel"; panel: ActivePanel };

export interface PanelNav {
  panel: ActivePanel | null;
  /** Innermost last. Empty: Back is not offered, Close is. */
  back: readonly BackStep[];
}

export const NO_PANEL: PanelNav = { panel: null, back: [] };

export type PanelNavAction =
  /** A fresh open (the map, the bottom bar, a top-bar list): no Back. */
  | { type: "open"; panel: ActivePanel | null }
  /** A window or a list hands a device over: Back reopens it. */
  | { type: "openFrom"; panel: ActivePanel | null; from: BackStep }
  /** A reading of the open device: Back returns to the device. */
  | { type: "drill"; panel: ActivePanel | null }
  /** A sideways move (a camera's next/previous): the same Back. */
  | { type: "switch"; panel: ActivePanel | null }
  | { type: "close" }
  /** One step back: a panel step reopens that panel; any other step closes
   *  the panel — the caller reopens the window or list (`reopenOf`). */
  | { type: "back" };

export function panelNavReducer(s: PanelNav, a: PanelNavAction): PanelNav {
  switch (a.type) {
    case "close": return s.panel || s.back.length ? NO_PANEL : s;
    case "back": {
      const top = s.back[s.back.length - 1];
      if (!top) return NO_PANEL;
      return top.kind === "panel" ? { panel: top.panel, back: s.back.slice(0, -1) } : NO_PANEL;
    }
    default:
      // Nothing to open (the profile may not see it): nothing changes at all.
      if (!a.panel) return s;
      if (a.type === "open") return { panel: a.panel, back: [] };
      if (a.type === "openFrom") return { panel: a.panel, back: [a.from] };
      if (a.type === "switch") return { panel: a.panel, back: s.back };
      return s.panel ? { panel: a.panel, back: [...s.back, { kind: "panel", panel: s.panel }] } : { panel: a.panel, back: [] };
  }
}

/** The window or list Back must reopen after a "back" (null: none — a panel
 *  step stays inside the panel, or there was no step). */
export function reopenOf(s: PanelNav): Exclude<BackStep, { kind: "panel" }> | null {
  const top = s.back[s.back.length - 1];
  return top && top.kind !== "panel" ? top : null;
}
