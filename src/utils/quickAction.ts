// src/utils/quickAction.ts
// Decides whether a TAP on an entity should act instantly (an in-world on/off
// toggle) instead of opening its bottom-sheet control panel. Entities whose
// only real interaction is a rich control (covers, climate, media, cameras,
// sensors) always open their panel on tap.
//
// Richer controls (brightness/colour for a dimmable light, fan speed, …) — and
// the more deliberate, harder-to-trigger action a "confirm before acting" gate
// would otherwise provide — are reached with a LONG-PRESS, which always opens
// the panel regardless of type. So a single tap stays a fast on/off and the
// panel is one press-and-hold away.

import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";

/**
 * Domains whose primary interaction is a plain on/off toggle. A tap toggles
 * them directly; a long-press opens their full panel.
 *
 * Exported because the device lists ask the same question about the same set
 * (SummaryGroupPanel decides which rows get an inline switch) and had their own
 * copy of it. One list, so "what counts as a toggle" cannot drift between where
 * a tap is handled and where a switch is drawn.
 */
export const TOGGLEABLE_DOMAINS: ReadonlySet<string> =
  new Set(["light", "switch", "input_boolean", "fan"]);

/**
 * Types for which "Confirm before toggling" is worth offering at all — the
 * ones a tap would otherwise act on instantly (see isQuickToggle below), plus
 * media_player, whose panel toggle is equally immediate.
 *
 * Lives here rather than in the settings rows because it is the same rule
 * `requireConfirm` overrides, and both Advanced Settings tables had their own
 * copy: a type added to one and not the other would silently offer the option
 * in one table and hide it in the other.
 */
export const CONFIRM_GATE_TYPES: ReadonlySet<string> =
  new Set([...TOGGLEABLE_DOMAINS, "media_player"]);

/**
 * True when a tap should act directly (on/off toggle) rather than open the panel.
 * Requires a live entity — an unmapped or not-yet-loaded entity falls through to
 * the panel (which surfaces its status and avoids a silent no-op toggle on
 * something HA doesn't currently expose). Dimmable lights are included: a tap
 * toggles them, and their brightness/colour panel is reached via long-press.
 *
 * mapping.requireConfirm always wins over the type check: a device the owner
 * has explicitly flagged as needing confirmation (a door relay modelled as a
 * plain switch, say) opens its panel on tap like any rich control, where its
 * own PowerToggle asks before acting — see EntityMapping.requireConfirm.
 */
export function isQuickToggle(mapping: EntityMapping, entity: HassEntity | undefined): boolean {
  if (!entity) return false; // unmapped / not yet loaded → show the panel
  if (mapping.requireConfirm) return false;
  return TOGGLEABLE_DOMAINS.has(mapping.type);
}
