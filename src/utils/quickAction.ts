// src/utils/quickAction.ts
// Decides whether a TAP on an entity should act instantly (an in-world on/off
// toggle) instead of opening its bottom-sheet control panel. The per-entity
// "Confirm" flag (Config Editor → Confirm) then gates that instant action behind
// a yes/no dialog. Entities whose only real interaction is a rich control
// (covers, climate, media, cameras, sensors) always open their panel on tap.
//
// Richer controls (brightness/colour for a dimmable light, fan speed, …) are
// reached with a LONG-PRESS, which always opens the panel regardless of type —
// so a single tap stays a fast on/off and the panel is one press-and-hold away.

import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";

// Domains whose primary interaction is a plain on/off toggle. A tap toggles them
// directly (gated by the Confirm flag); a long-press opens their full panel.
const TOGGLEABLE = new Set(["light", "switch", "input_boolean", "fan"]);

/**
 * True when a tap should act directly (on/off toggle) rather than open the panel.
 * Requires a live entity — an unmapped or not-yet-loaded entity falls through to
 * the panel (which surfaces its status and avoids a silent no-op toggle on
 * something HA doesn't currently expose). Dimmable lights are included: a tap
 * toggles them, and their brightness/colour panel is reached via long-press.
 */
export function isQuickToggle(mapping: EntityMapping, entity: HassEntity | undefined): boolean {
  if (!entity) return false; // unmapped / not yet loaded → show the panel
  return TOGGLEABLE.has(mapping.type);
}
