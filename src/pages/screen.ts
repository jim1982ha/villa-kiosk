// src/pages/screen.ts
// WHAT IS ON SCREEN over the map, and every move between them — one module
// (2.496.305). Pure: tests/oracles/screen.mjs drives it by value.
//
// The windows (pages/surfaces) and the open device panel with its Back steps
// (pages/panelNav) each had an owner, but the rules JOINING them lived in the
// Dashboard as callbacks and six loose states — the open room or category
// list, the Cockpit's tab, the fault to prefill, the guest's report, the
// Advanced Settings focus. A hand-over closed a window before asking whether
// the device could open (2.496.274), and nineteen tests could only check that
// layer by matching the page's source text. Every move is an action here now;
// the page sends actions and mounts what this says is open.

import type { ActivePanel } from "@/types/panel.types";
import type { Category } from "@/types/scene.types";
import type { CockpitTab } from "@/components/cockpit/CockpitModal";
import type { Doors } from "@/auth/doors";
import { NO_PANEL, panelNavReducer, reopenOf, type ListRef, type PanelNav } from "./panelNav";
import { NO_SURFACES, SURFACE_LABEL, mayOpen, surfacesReducer, type Surface, type Surfaces } from "./surfaces";

export interface Screen {
  /** The open device panel and where its Back goes (panelNav). */
  nav: PanelNav;
  /** The windows open over the map (surfaces). */
  windows: Surfaces;
  /** A room's or a category's device list, when one is open. */
  list: ListRef | null;
  /** The Cockpit's tab — kept while it is closed, so Back from a device it
   *  handed over returns to the tab it left. */
  cockpitTab: CockpitTab;
  /** The device whose fault the Cockpit's Faults tab should start a report
   *  for; cleared once the form has opened. */
  faultFor: string | null;
  /** The device a guest is reporting a problem with. */
  guestReportFor: string | null;
  /** The device Advanced Settings was opened for (its table filtered to it);
   *  null when opened from Settings. */
  editorFocus: string | null;
}

export const START: Screen = {
  nav: NO_PANEL, windows: NO_SURFACES, list: null,
  cockpitTab: "overview", faultFor: null, guestReportFor: null, editorFocus: null,
};

export type ScreenAction =
  /** Open a window (the Cockpit on `tab`, when given). */
  | { type: "openWindow"; window: Surface; tab?: CockpitTab }
  | { type: "closeWindow"; window: Surface }
  | { type: "cockpitTab"; tab: CockpitTab }
  /** A device from the map or the bottom bar: a fresh open, no Back. */
  | { type: "openDevice"; panel: ActivePanel | null }
  /** A window hands a device over: the device opens and the window closes —
   *  ONLY if there is a panel to open (the profile may not see it). */
  | { type: "handOver"; from: Surface; panel: ActivePanel | null }
  /** A reading of the open device: Back returns to the device. */
  | { type: "openReading"; panel: ActivePanel | null }
  /** A sideways move (a camera's next/previous): the same Back. */
  | { type: "switchPanel"; panel: ActivePanel | null }
  | { type: "closePanel" }
  | { type: "openList"; list: ListRef }
  | { type: "closeList" }
  /** A device from the open list: the list closes, Back reopens it — only if
   *  there is a panel to open. */
  | { type: "openFromList"; panel: ActivePanel | null }
  /** One step back: a panel, a window or a list. */
  | { type: "back" }
  /** The open device's row in Advanced Settings. */
  | { type: "editDevice" }
  /** The open device's fault: the Cockpit's Faults tab with the device filled
   *  in for a profile that manages faults, the guest's one-screen report for
   *  any other. */
  | { type: "reportFault" }
  | { type: "faultFormOpened" }
  | { type: "closeGuestReport" };

/** The screen after `a`, for a profile with these `doors`. */
export function screenReducer(s: Screen, a: ScreenAction, doors: Doors): Screen {
  const win = (windows: Surfaces, w: Surface, open: boolean) =>
    surfacesReducer(windows, open ? { type: "open", surface: w, doors } : { type: "close", surface: w });
  const panel = (act: Parameters<typeof panelNavReducer>[1]) => panelNavReducer(s.nav, act);
  switch (a.type) {
    case "openWindow": {
      if (!mayOpen(a.window, doors)) return s;
      return { ...s, windows: win(s.windows, a.window, true), cockpitTab: a.tab ?? s.cockpitTab,
        editorFocus: a.window === "configEditor" ? null : s.editorFocus };
    }
    case "closeWindow":
      return { ...s, windows: win(s.windows, a.window, false),
        faultFor: a.window === "cockpit" ? null : s.faultFor,
        editorFocus: a.window === "configEditor" ? null : s.editorFocus };
    case "cockpitTab": return { ...s, cockpitTab: a.tab };
    case "openDevice": return { ...s, nav: panel({ type: "open", panel: a.panel }) };
    case "handOver":
      // ⚠️ THE ORDER IS THE RULE: nothing changes unless a panel opens.
      if (!a.panel) return s;
      return { ...s, windows: win(s.windows, a.from, false),
        nav: panel({ type: "openFrom", panel: a.panel, from: { kind: "surface", surface: a.from } }) };
    case "openReading": return { ...s, nav: panel({ type: "drill", panel: a.panel }) };
    case "switchPanel": return { ...s, nav: panel({ type: "switch", panel: a.panel }) };
    case "closePanel": return { ...s, nav: panel({ type: "close" }) };
    case "openList": return { ...s, list: a.list };
    case "closeList": return s.list ? { ...s, list: null } : s;
    case "openFromList":
      if (!a.panel || !s.list) return s;
      return { ...s, list: null, nav: panel({ type: "openFrom", panel: a.panel, from: { kind: "list", list: s.list } }) };
    case "back": {
      const step = reopenOf(s.nav);
      const next = { ...s, nav: panel({ type: "back" }) };
      if (step?.kind === "surface") return { ...next, windows: win(next.windows, step.surface, true) };
      if (step?.kind === "list") return { ...next, list: step.list };
      return next;
    }
    case "editDevice": {
      const id = s.nav.panel?.entityId;
      if (!id || !mayOpen("configEditor", doors)) return s;
      return { ...s, nav: NO_PANEL, editorFocus: id, windows: win(s.windows, "configEditor", true) };
    }
    case "reportFault": {
      const id = s.nav.panel?.entityId;
      if (!id) return s;
      if (doors.facility) return { ...s, nav: NO_PANEL, faultFor: id, cockpitTab: "faults", windows: win(s.windows, "cockpit", true) };
      return { ...s, nav: NO_PANEL, guestReportFor: id };
    }
    case "faultFormOpened": return s.faultFor === null ? s : { ...s, faultFor: null };
    case "closeGuestReport": return s.guestReportFor === null ? s : { ...s, guestReportFor: null };
  }
}

/** What the open panel's Back button says — the window, list or device it
 *  returns to — or null when there is no step back (Close is offered). */
export function backLabel(
  s: Screen, deviceLabel: (entityId: string) => string, categoryLabel: (c: Category) => string,
): string | null {
  const step = s.nav.back[s.nav.back.length - 1];
  if (!step) return null;
  if (step.kind === "surface") return SURFACE_LABEL[step.surface];
  if (step.kind === "panel") return deviceLabel(step.panel.entityId);
  return step.list.kind === "room" ? step.list.room : categoryLabel(step.list.category);
}
