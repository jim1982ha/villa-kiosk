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
import { prettifyEntitySlug } from "@/config/EntityMap";
import type { HassEntity } from "@/types/ha.types";
import type { SummaryGroup } from "@/components/panels/SummaryGroupPanel";

const friendly = (e: HassEntity) => e.attributes.friendly_name?.trim() || prettifyEntitySlug(e.entity_id);

/** Every `lock.*` entity — see SummaryBar's own docstring for why this is
 *  domain-only and NOT extended to switches that merely read as door/gate
 *  relays by name: a name-substring heuristic tried here once (matching
 *  "door" as a bare substring) misfired on every "outdoor" light switch in
 *  the villa. There's no reliable automatic signal for "this switch is a
 *  door lock" that doesn't risk exactly that kind of false positive — an
 *  explicit per-entity opt-in would be the honest way to add one, not a name
 *  match. Returns null (no group, no tile) when there are no locks at all. */
export function locksGroup(entities: Record<string, HassEntity>): SummaryGroup | null {
  const locks = Object.values(entities).filter((e) => e.entity_id.startsWith("lock."));
  if (locks.length === 0) return null;
  const allLocked = locks.every((l) => l.state === "locked");
  return {
    title: locks.length === 1 ? friendly(locks[0]) : "Locks",
    icon: allLocked ? DoorClosed : DoorOpen,
    entityIds: locks.map((l) => l.entity_id),
  };
}

/** Every `light.*` entity. Returns null (no group, no tile) when there are
 *  no lights at all. */
export function lightsGroup(entities: Record<string, HassEntity>): SummaryGroup | null {
  const lights = Object.values(entities).filter((e) => e.entity_id.startsWith("light."));
  if (lights.length === 0) return null;
  return { title: "Lights", icon: Lightbulb, entityIds: lights.map((e) => e.entity_id) };
}
