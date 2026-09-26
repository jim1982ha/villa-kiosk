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

import type { ComponentType } from "react";
import { DoorClosed, DoorOpen, Lightbulb, Lock } from "lucide-react";
import { displayLabelFor } from "@/config/EntityMap";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";
import type { LockFacts, OnOffFacts } from "./villaSummary";

/** A device group a summary opens (SummaryGroupPanel). Defined here, beside
 *  the groups, so this config module no longer imports from a screen. */
export interface SummaryGroup {
  title: string;
  icon: ComponentType<{ size?: number | string }>;
  entityIds: string[];
}

// Same label the map badge, Advanced Settings and every device list show —
// displayLabelFor is THE rule (a user's stored label wins over HA's
// friendly_name, raw slugs get prettified).
const friendly = (e: HassEntity | undefined, id: string, entityMap: Record<string, EntityMapping>) =>
  displayLabelFor(id, entityMap[id]?.label, e?.attributes.friendly_name);

/**
 * Every lock of the villa, as ONE group — built from villaSummary's LockFacts
 * (round 10, 2.496.157), the same facts the tile's words and the readiness
 * report read. It re-selected `lock.*` itself with an OPTIONAL villa scope (the
 * forgotten-argument shape the villa_devices oracle warns about), and chose its
 * icon by "every lock locked, else an open door" — so a lock that could not be
 * read showed an OPEN DOOR beside "1 Unknown", the exact "lie about a door"
 * villaSummary exists to stop. The icon now follows the facts: a closed door
 * when all are locked, an open door only when one IS unlocked, a plain lock
 * when one cannot be read. `lock.*` only — a switch that merely looks like a
 * door relay by name is not a lock (a "door" substring once matched every
 * "outdoor" light switch). Null: no locks.
 */
export function locksGroup(
  facts: LockFacts | null,
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping> = {},
): SummaryGroup | null {
  if (!facts || facts.ids.length === 0) return null;
  const single = facts.ids.length === 1;
  return {
    title: single ? friendly(entities[facts.ids[0]], facts.ids[0], entityMap) : "Locks",
    icon: facts.unlocked.length > 0 ? DoorOpen : facts.unknown.length > 0 ? Lock : DoorClosed,
    entityIds: facts.ids.slice(),
  };
}

/** Every light of the villa, from villaSummary's facts (scoped to the villa's
 *  own devices there — a helper light or a neighbour's is not one). */
export function lightsGroup(facts: OnOffFacts | null): SummaryGroup | null {
  if (!facts || facts.ids.length === 0) return null;
  return { title: "Lights", icon: Lightbulb, entityIds: facts.ids.slice() };
}
