// src/auth/doors.ts
// Which DOORS a profile has — the windows it may open from the top bar and the
// Cockpit — said ONCE, computed once by the Dashboard and handed down.
//
// ⚠️ IT WAS SAID BY WHETHER A CALLBACK EXISTED (to 2.496.244). Dashboard passed
// `onOpenFacility={canManageFacility ? … : undefined}` and
// `onOpenAgent={agentVisible ? … : undefined}`; HUD then turned the Cockpit
// button into the robot by testing `onOpenAgent ?`, CockpitModal drew its
// footer's agent button the same way and asked roleCan itself for the updates
// count, and Dashboard re-asked canOpenSettings / canManageFacility /
// agentVisible again beside each window it mounts. A callback's absence is an
// omission that looks exactly like "this profile may not" — the defect this
// repo keeps paying for. The answer is a value now, and the callbacks are
// always there.
//
// Pure: tests/oracles/doors.mjs.

import type { Role } from "./roles";
import { roleCan } from "./permissions";

export interface Doors {
  /** The Settings window (and Advanced Settings over it). */
  settings: boolean;
  /** The Facility workspace. */
  facility: boolean;
  /** The VESTA Agent's presence: the robot on the Cockpit button, its dot online / offline. (Its own window was
   *  removed, 2.496.443: the agent sends the Kiosk no messages — people talk to it on Telegram.) */
  agent: boolean;
  /** The Cockpit's count of firmware / add-on updates waiting. */
  updates: boolean;
  /** Report a problem: a device panel's wrench, Messages' "Report a problem" / "Open a ticket". Every profile
   *  holds it today (guests included); said here so no screen asks the role again. */
  reportFault: boolean;
  /** Change a device's set-up: a device panel's Edit and its badge colour. */
  editDevices: boolean;
}

/**
 * The doors this profile has. `agentVisible` is AgentContext's `visible`:
 * the profile holds viewAgent AND an agent is configured (PLAN A8) — the one
 * door that depends on more than the role.
 */
export function doorsFor(role: Role | null | undefined, agentVisible: boolean): Doors {
  return {
    settings: roleCan(role, "openSettings"),
    facility: roleCan(role, "manageFacility"),
    agent: roleCan(role, "viewAgent") && agentVisible,
    updates: roleCan(role, "seeUpdates"),
    reportFault: roleCan(role, "reportFault"),
    editDevices: roleCan(role, "editConfig"),
  };
}
