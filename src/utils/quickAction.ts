// src/utils/quickAction.ts
// Decides whether a tapped entity should act instantly (an in-world on/off toggle)
// instead of opening its bottom-sheet control panel. The per-entity "Confirm" flag
// (Config Editor → Confirm) then gates that instant action behind a yes/no dialog.
// Entities with richer controls (sliders, streams, info) always open their panel.

import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";

const DIMMABLE_MODES = ["brightness", "color_temp", "hs", "rgb", "rgbw", "xy"];

function lightIsDimmable(entity: HassEntity): boolean {
  const modes = (entity.attributes?.supported_color_modes ?? []) as string[];
  return modes.some((m) => DIMMABLE_MODES.includes(m));
}

/**
 * True when the entity's only meaningful control is an on/off toggle, so tapping
 * it can act directly without the panel. Requires a live entity — an unmapped or
 * not-yet-loaded entity falls through to the panel (which surfaces its status and
 * avoids a silent no-op toggle on something HA doesn't currently expose).
 */
export function isQuickToggle(mapping: EntityMapping, entity: HassEntity | undefined): boolean {
  if (!entity) return false; // unmapped / not yet loaded → show the panel
  switch (mapping.type) {
    case "switch":
    case "input_boolean":
      return true;
    case "light":
      return !lightIsDimmable(entity); // on/off-only lights (e.g. wall switches)
    default:
      // covers, fans, climate, media, locks, cameras, sensors keep their panel:
      // they expose positions/speeds/streams/info that a bare toggle can't reach.
      return false;
  }
}
