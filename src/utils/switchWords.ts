// src/utils/switchWords.ts
// What a device's inline switch says (SwitchFace draws it): on hover, what a tap does; to assistive tech, its state.
// A lock says its bolt and its action, Lock / Unlock… (owner, 2026-11-22: a lock is a padlock, never an on/off
// switch); every other device Turn on / Turn off. One place, so the row, the window and the camera's rail agree.

import { domainOf } from "@/utils/entityDomain";

export const isLockSwitch = (entityId: string): boolean => domainOf(entityId) === "lock";

/** What a tap on its switch does: "Lock" / "Unlock…" for a lock (an unlock is asked first), else "Turn off" / "Turn on". */
export function switchTip(entityId: string, isOn: boolean): string {
  if (isLockSwitch(entityId)) return isOn ? "Lock" : "Unlock…";
  return isOn ? "Turn off" : "Turn on";
}

/** What it says to assistive tech: a switch for a toggle; a lock is a button naming its bolt and what a tap does.
 *  `words`: its state as the caller says it (Unavailable / Unknown for a linked device it cannot read). */
export function switchA11y(entityId: string, label: string, isOn: boolean, words?: string) {
  if (isLockSwitch(entityId)) {
    const said = (words ?? (isOn ? "unlocked" : "locked")).toLowerCase();
    return { "aria-label": `${label}: ${said}, ${switchTip(entityId, isOn).toLowerCase()}` };
  }
  return { role: "switch" as const, "aria-checked": isOn, "aria-label": `${label}: ${(words ?? (isOn ? "on" : "off")).toLowerCase()}` };
}
