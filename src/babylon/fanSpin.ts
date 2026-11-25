// src/babylon/fanSpin.ts
// Which fans turn and how fast: the one rule the 3D view (fanRigs.ts) and the villa pictures (PictureView's fans)
// both read. No Babylon here: a device shown the pictures never downloads the 3D engine.

import type { HassEntity } from "@/types/ha.types";

// Ceiling-fan spin: angular speed (rad/s) at full fan percentage. A whole-mesh
// spin reads as "blades turning" at kiosk distance; ~1 rev/s is lively without
// strobing. Scaled down by the fan's percentage (min 15%) when reported.
const FAN_MAX_RAD_PER_SEC = 6.2;

/**
 * Does this fan entity SPIN on the map? Only a CEILING fan does — a VMC or a
 * bathroom extractor is a `fan.*` too, and must not turn. Read from the
 * entity id because Home Assistant has no device_class for a fan's KIND.
 *
 * ⚠️ Unanchored on purpose, and safe only because the caller gates on the
 * mapping's `fan` type — without it this would match `light.x_ceiling_fan_light`
 * and spin a lamp. /dry-audit re-flags this shape (the documented trap is
 * `door` matching inside `outdoor`); anchoring to (^|[._])…([._]|$) would
 * not change the verdict for any realistic id, since the ambiguous cases
 * (`fan.bathroom_ceiling_fan`, a ceiling-mounted extractor) match either way.
 */
export function isCeilingFan(entityId: string): boolean {
  return /ceiling[_-]?fan/i.test(entityId);
}

/** How fast a ceiling fan turns now (rad/s), from its on/off and percentage; null when it does not turn (off, or not
 *  a ceiling fan). */
export function fanTurnSpeed(entity: Pick<HassEntity, "entity_id" | "state" | "attributes"> | undefined): number | null {
  if (!entity || !isCeilingFan(entity.entity_id) || entity.state !== "on") return null;
  const pct = entity.attributes?.percentage as number | undefined;
  const frac = typeof pct === "number" ? Math.max(0.15, Math.min(1, pct / 100)) : 0.6;
  return FAN_MAX_RAD_PER_SEC * frac;
}
