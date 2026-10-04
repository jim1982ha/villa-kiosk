// src/pages/surfaces.ts
// WHICH WINDOWS ARE OPEN over the map, and the two decisions the page made
// inline about them. Pure — tests/oracles/surfaces.mjs drives it by value.
//
// ⚠️ THE WINDOWS HAD NO OWNER (until 2.496.268). The Cockpit was opened and
// mounted inside the top bar while Facility, the VESTA Agent, Settings and the
// Rooms list lived in the Dashboard, each a flag of its own: the top bar took
// onOpenFacility, onOpenAgent, onOpenEntity and the doors just to hand clicks
// across, "close this window, then open that device" was written out four
// times, and "may this profile open it?" was checked at some openers and not
// others. One state now, one rule for what may open, one hand-over.

import type { Doors } from "@/auth/doors";
import type { TeleportPoint } from "@/types/scene.types";
import { roomKey } from "@/config/roomKey";
import { roomLook } from "@/babylon/summaryLook";
import type { DeviceLook } from "@/utils/deviceActivity";

/** A window over the map. Several may be open at once: Advanced Settings
 *  opens over Settings, the VESTA Agent over the Cockpit. */
export type Surface = "rooms" | "cockpit" | "facility" | "agent" | "settings" | "configEditor";

export type Surfaces = Readonly<Record<Surface, boolean>>;

/** What a window is called on a "Back to …" button. */
export const SURFACE_LABEL: Readonly<Record<Surface, string>> = {
  rooms: "Rooms", cockpit: "Cockpit", facility: "Facility", agent: "VESTA Agent", settings: "Settings",
  configEditor: "Advanced Settings",
};

/** One step back from a panel opened from another window (PanelActions.back). */
export interface CameFrom { label: string; go: () => void }

export const NO_SURFACES: Surfaces = {
  rooms: false, cockpit: false, facility: false, agent: false, settings: false, configEditor: false,
};

/** May this profile open `s`? The doors (auth/doors) say, once — every
 *  opener asks here, so a window a profile may not see never opens. */
export function mayOpen(s: Surface, doors: Doors): boolean {
  switch (s) {
    case "facility": return doors.facility;
    case "agent": return doors.agent;
    case "settings":
    case "configEditor": return doors.settings;
    default: return true;
  }
}

/** Whether `s` is on screen: open AND still allowed — a profile switched
 *  while a window was open loses that window at once, by the same rule. */
export function shown(state: Surfaces, s: Surface, doors: Doors): boolean {
  return state[s] && mayOpen(s, doors);
}

export type SurfaceAction =
  | { type: "open"; surface: Surface; doors: Doors }
  | { type: "close"; surface: Surface };

export function surfacesReducer(state: Surfaces, a: SurfaceAction): Surfaces {
  if (a.type === "open") {
    return state[a.surface] || !mayOpen(a.surface, a.doors) ? state : { ...state, [a.surface]: true };
  }
  return state[a.surface] ? { ...state, [a.surface]: false } : state;
}

/** The rooms a chip stands for: its distinct names, or the chip's own room
 *  when it carries none. A chip that swallowed others names several. */
export function chipRooms(roomNames: readonly string[], room: string): string[] {
  const names = [...new Set(roomNames)].filter(Boolean);
  return names.length > 0 ? names : [room];
}

/** One row of "Which room?": the room, its device count, and the frame and
 *  pill its own chip wears on the map (summaryLook.roomLook). */
export interface RoomChoiceRow extends ReturnType<typeof roomLook> { room: string; count: number }

/** The rows of a merged chip's "Which room?" list: each room's own devices
 *  among the chip's (`roomOf`: where a device resolved), and how its chip
 *  would look alone. `lookOf`: a device's look, undefined while HA has not
 *  reported it — it rings nothing, as on the map. */
export function roomChoicesFor(
  rooms: readonly string[], entityIds: readonly string[],
  roomOf: (id: string) => string | undefined, lookOf: (id: string) => DeviceLook | undefined,
): RoomChoiceRow[] {
  return rooms.map((r) => {
    // The FIXED side normalised once, outside the filter (roomKey.ts's convention).
    const key = roomKey(r);
    const ids = entityIds.filter((id) => roomKey(roomOf(id) ?? "") === key);
    return { room: r, count: ids.length, ...roomLook(ids.map(lookOf)) };
  });
}

/**
 * The rooms after the model re-fitted them: every fitted room refreshed, and
 * every OTHER saved room kept — one the owner added with "Add room here" has no
 * fitted counterpart to refresh from (a staircase landing), and dropping it
 * would delete the owner's work. Null when nothing moved: the caller then
 * writes nothing (a write re-persists the whole config and re-runs everything
 * downstream of the rooms; the fit is quantised at its source, so equal
 * geometry compares equal).
 */
export function mergeTeleportPoints(
  fitted: readonly TeleportPoint[], saved: readonly TeleportPoint[],
): TeleportPoint[] | null {
  const fittedNames = new Set(fitted.map((p) => p.name));
  const next = [...fitted, ...saved.filter((p) => !fittedNames.has(p.name))];
  return JSON.stringify(next) === JSON.stringify(saved) ? null : next;
}
