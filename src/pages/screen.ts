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
import type { SettingsTab } from "@/components/settings/SettingsModal";
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
  /** Settings' tab: General from the profile button, Messages from the Cockpit's gear (ticket 16 of "One inbox"). */
  settingsTab: SettingsTab;
  /** The device Messages' "Open a ticket" form should start with (a
   *  device panel's wrench); cleared once the form has opened. */
  faultFor: string | null;
  /** The record whose ticket the Tickets tab should open for editing (an
   *  open issue's "Edit ticket"); cleared once the form has it. */
  ticketFor: string | null;
  /** The devices whose open issue Messages opens (a device window's warning, "openFaults");
   *  null otherwise. Kept while the Cockpit hands a device over and is reopened by Back; cleared when the Cockpit is
   *  closed or opened anew. */
  faultsFocus: string[] | null;
  /** A guest's problem report: the device it is about, "" for none (the
   *  Messages' "Report a problem"); null when no report is open. */
  guestReportFor: string | null;
  /** The device Advanced Settings was opened for (its table filtered to it);
   *  null when opened from Settings. */
  editorFocus: string | null;
  /** The device panel a window was opened FROM (its wrench: Advanced Settings, the Cockpit's fault form, the guest's
   *  report), with its own Back: closing that window opens it again. null when the window was opened otherwise. */
  panelReturn: { to: Surface | "guestReport"; nav: PanelNav } | null;
}

export const START: Screen = {
  nav: NO_PANEL, windows: NO_SURFACES, list: null,
  cockpitTab: "messages", settingsTab: "general", faultFor: null, ticketFor: null, faultsFocus: null, guestReportFor: null,
  editorFocus: null, panelReturn: null,
};

export type ScreenAction =
  /** Open a window (the Cockpit on `tab`, when given; Settings on `settingsTab`, General when not). */
  | { type: "openWindow"; window: Surface; tab?: CockpitTab; settingsTab?: SettingsTab }
  | { type: "settingsTab"; tab: SettingsTab }
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
  /** The open device's fault: Messages' "Open a ticket" with the device
   *  filled in for a profile that manages faults, the guest's one-screen report for
   *  any other. */
  | { type: "reportFault" }
  | { type: "faultFormOpened" }
  /** A device window's warning: the Cockpit's Messages with the open issue of `ids` (the device, its linked entity)
   *  marked; closing it gives the device back. */
  | { type: "openFaults"; ids: string[] }
  /** An open issue's "Edit ticket": the Tickets tab, that record's form open. */
  | { type: "editTicket"; id: string }
  | { type: "ticketEditOpened" }
  /** A guest's "Report a problem" from Messages: the report, on no device. */
  | { type: "reportProblem" }
  | { type: "closeGuestReport" };

/** The screen after `a`, for a profile with these `doors`. */
export function screenReducer(s: Screen, a: ScreenAction, doors: Doors): Screen {
  const win = (windows: Surfaces, w: Surface, open: boolean) =>
    surfacesReducer(windows, open ? { type: "open", surface: w, doors } : { type: "close", surface: w });
  const panel = (act: Parameters<typeof panelNavReducer>[1]) => panelNavReducer(s.nav, act);
  // closing a window a device panel opened gives that panel back, with its own Back (Screen.panelReturn)
  const returned = (w: Surface | "guestReport"): Partial<Screen> =>
    s.panelReturn?.to === w ? { nav: s.panelReturn.nav, panelReturn: null } : {};
  switch (a.type) {
    case "openWindow": {
      if (!mayOpen(a.window, doors)) return s;
      return { ...s, windows: win(s.windows, a.window, true), cockpitTab: a.tab ?? s.cockpitTab,
        settingsTab: a.window === "settings" ? a.settingsTab ?? "general" : s.settingsTab,
        faultsFocus: a.window === "cockpit" ? null : s.faultsFocus,
        editorFocus: a.window === "configEditor" ? null : s.editorFocus };
    }
    case "closeWindow":
      return { ...s, windows: win(s.windows, a.window, false), ...returned(a.window),
        faultFor: a.window === "cockpit" ? null : s.faultFor,
        ticketFor: a.window === "cockpit" ? null : s.ticketFor,
        faultsFocus: a.window === "cockpit" ? null : s.faultsFocus,
        editorFocus: a.window === "configEditor" ? null : s.editorFocus };
    case "cockpitTab": return { ...s, cockpitTab: a.tab };
    case "settingsTab": return { ...s, settingsTab: a.tab };
    case "openDevice": return { ...s, nav: panel({ type: "open", panel: a.panel }), panelReturn: a.panel ? null : s.panelReturn };
    case "handOver":
      // ⚠️ THE ORDER IS THE RULE: nothing changes unless a panel opens.
      if (!a.panel) return s;
      return { ...s, windows: win(s.windows, a.from, false), panelReturn: null,
        nav: panel({ type: "openFrom", panel: a.panel, from: { kind: "surface", surface: a.from } }) };
    case "openReading": return { ...s, nav: panel({ type: "drill", panel: a.panel }) };
    case "switchPanel": return { ...s, nav: panel({ type: "switch", panel: a.panel }) };
    case "closePanel": {
      // ⚠️ CLOSE RETURNS TO WHERE THE DEVICE CAME FROM (owner, 2026-10-20: a device opened from the Cockpit closed the
      // Cockpit with it): its first step — a window or a list — opens again, every panel since closes
      const origin = s.nav.back[0];
      const next = { ...s, nav: panel({ type: "close" }), panelReturn: null };
      if (origin?.kind === "surface") return { ...next, windows: win(next.windows, origin.surface, true) };
      if (origin?.kind === "list") return { ...next, list: origin.list };
      return next;
    }
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
      return { ...s, nav: NO_PANEL, editorFocus: id, windows: win(s.windows, "configEditor", true),
        panelReturn: { to: "configEditor", nav: s.nav } };
    }
    case "reportFault": {
      const id = s.nav.panel?.entityId;
      if (!id) return s;
      // raising a fault is beside the open issues (owner, 2026-10-14; Messages since ticket 17): its form opens there, pointed at the device
      if (doors.facility) return { ...s, nav: NO_PANEL, faultFor: id, cockpitTab: "messages", windows: win(s.windows, "cockpit", true),
        panelReturn: { to: "cockpit", nav: s.nav } };
      return { ...s, nav: NO_PANEL, guestReportFor: id, panelReturn: { to: "guestReport", nav: s.nav } };
    }
    case "faultFormOpened": return s.faultFor === null ? s : { ...s, faultFor: null };
    case "openFaults":
      // Messages, where a device's faults are its open issue (owner, 2026-10-24); the device comes back on close
      if (!doors.facility || a.ids.length === 0) return s;
      return { ...s, nav: NO_PANEL, faultsFocus: a.ids, cockpitTab: "messages", windows: win(s.windows, "cockpit", true),
        panelReturn: { to: "cockpit", nav: s.nav } };
    case "editTicket": return doors.facility ? { ...s, ticketFor: a.id, cockpitTab: "tickets" } : s;
    case "ticketEditOpened": return s.ticketFor === null ? s : { ...s, ticketFor: null };
    case "reportProblem": return { ...s, guestReportFor: "" };
    case "closeGuestReport": return s.guestReportFor === null ? s : { ...s, guestReportFor: null, ...returned("guestReport") };
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
