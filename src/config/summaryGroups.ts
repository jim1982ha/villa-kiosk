// src/config/summaryGroups.ts
// The "all locks" / "all lights" device groups — ONE definition shared by the
// bottom-bar SummaryBar tiles AND the Facility Readiness tab's "View doors" /
// "View lights" shortcuts, so both open the exact same SummaryGroupPanel
// (same title, icon, and — crucially — the same FULL entity list) instead of
// two independently-built views that could disagree. The Readiness shortcuts
// used to open just the FAILING subset a check named (the unlocked locks, the
// still-lit lights), which read as a different, smaller modal than tapping
// the bottom-bar tile for the same category — this is the single source both
// now read from.

import { DoorClosed, DoorOpen, Lightbulb } from "lucide-react";
import { displayLabelFor } from "@/config/EntityMap";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";
import type { SummaryGroup } from "@/components/panels/SummaryGroupPanel";

// Same label the map badge, Advanced Settings and every device list show —
// displayLabelFor is THE rule (a user's stored label wins over HA's
// friendly_name, raw slugs get prettified). Deriving it here from
// friendly_name alone meant a device the owner had renamed kept its old HA
// name on this one tile while reading correctly everywhere else.
const friendly = (e: HassEntity, entityMap: Record<string, EntityMapping>) =>
  displayLabelFor(e.entity_id, entityMap[e.entity_id]?.label, e.attributes.friendly_name);

/** Every `lock.*` entity — see SummaryBar's own docstring for why this is
 *  domain-only and NOT extended to switches that merely read as door/gate
 *  relays by name: a name-substring heuristic tried here once (matching
 *  "door" as a bare substring) misfired on every "outdoor" light switch in
 *  the villa. There's no reliable automatic signal for "this switch is a
 *  door lock" that doesn't risk exactly that kind of false positive — an
 *  explicit per-entity opt-in would be the honest way to add one, not a name
 *  match. Returns null (no group, no tile) when there are no locks at all. */
export function locksGroup(
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping> = {},
  /** ⚠️ NARROW THIS TO THE VILLA'S OWN DEVICES WHERE THE CALLER KNOWS THEM.
   *  Optional and unfiltered by default, so the bottom-bar tile keeps the
   *  behaviour it has always had — see the note at `SummaryBar`'s call. The
   *  Readiness tab MUST pass it: since 2.572.0 its checks count villa devices
   *  (`selectableDeviceIds`), so an unfiltered drill-down would answer "2 not
   *  locked" and then open a panel listing every `lock.*` Home Assistant has. */
  allowed?: ReadonlySet<string>,
): SummaryGroup | null {
  const locks = Object.values(entities).filter(
    (e) => e.entity_id.startsWith("lock.") && (!allowed || allowed.has(e.entity_id)));
  if (locks.length === 0) return null;
  const allLocked = locks.every((l) => l.state === "locked");
  return {
    title: locks.length === 1 ? friendly(locks[0], entityMap) : "Locks",
    icon: allLocked ? DoorClosed : DoorOpen,
    entityIds: locks.map((l) => l.entity_id),
  };
}

/** Every `light.*` entity. Returns null (no group, no tile) when there are
 *  no lights at all. */
export function lightsGroup(
  entities: Record<string, HassEntity>,
  /** See `locksGroup`'s own parameter — same rule, same reason. */
  allowed?: ReadonlySet<string>,
): SummaryGroup | null {
  const lights = Object.values(entities).filter(
    (e) => e.entity_id.startsWith("light.") && (!allowed || allowed.has(e.entity_id)));
  if (lights.length === 0) return null;
  return { title: "Lights", icon: Lightbulb, entityIds: lights.map((e) => e.entity_id) };
}
