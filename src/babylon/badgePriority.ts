// src/babylon/badgePriority.ts
// Which badge keeps its place when two of them cannot both be drawn.
// Pure: no Babylon, no scene, no state, no config.
//
// ── Why a ranking exists at all (2.232.0) ──────────────────────────────────
// Collisions used to be all-or-nothing: any badges whose footprints touched
// joined one pile, and the WHOLE pile became a single summary badge. Five
// colliding devices meant five devices each two taps away, and the fifth was
// no more crowded than the first — the pile simply had no way to say which of
// its members mattered.
//
// Every serious label renderer ranks instead. Mapbox GL JS places symbols in
// `symbol-sort-key` order and the first one into the collision index wins;
// deck.gl's CollisionFilterExtension takes `getCollisionPriority`; Google
// Maps has `CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY`. In every
// case the loser is dropped rather than the whole cluster being flattened,
// because a map with its important labels showing beats a map of blobs.
//
// ── Why the rank is STATIC, and must stay so ───────────────────────────────
// The rank is a function of (type, category) and nothing else. Both are fixed
// for the life of a badge, so the SAME devices win every time — which is the
// whole point: a person learns "the ceiling light is always there" and reaches
// for it without looking. A rank that moved would spend that.
//
// Three tempting inputs were considered and rejected outright:
//
//   * a live "attention" bit, so an alerting device wins a slot. It would
//     make a badge appear and disappear on a STATE change rather than only on
//     a zoom change, breaking the one guarantee this subsystem sells. Alerts
//     already have their own channel — the ring and the pulse — and a summary
//     badge inherits the worst state of its members, so an alert inside a
//     group is still visible AS an alert.
//   * recent interaction, persisted per device. The layout would then drift
//     under the user, which is the opposite of muscle memory.
//   * an explicit per-entity pin. Defensible, and the cheapest to add later
//     (entityMap is already the shared per-entity store), but it is
//     configuration the user has to maintain and the static rank turns out to
//     order things the way people expect without being asked.
//
// If one of these is ever revisited, note that only the third keeps
// `badgeRank` a pure function of static data. The first two would make
// placement depend on time, and every guarantee in EntityVisuals' header
// derives from it not doing that.

import { CATEGORY_ORDER } from "@/config/EntityCategories";
import type { EntityDomain } from "@/types/ha.types";
import type { Category, EntityType } from "@/types/scene.types";

/**
 * 0 = you can DO something to it, 1 = it only tells you something.
 *
 * The primary split, because a badge is a control first: a light you tap to
 * turn on earns its place over a thermometer that would read the same in the
 * device panel one tap away. Read-only devices are not hidden — they fall to
 * the group badge, which is exactly what a summary is for.
 *
 * Exhaustive on purpose. `Record<EntityDomain, …>` means a domain added to
 * EntityDomain without a rank here is a COMPILE ERROR rather than a silent
 * default, and `npm run build` is the only automated gate this repo has.
 */
const DOMAIN_RANK: Record<EntityDomain, 0 | 1> = {
  light: 0,
  switch: 0,
  cover: 0,
  fan: 0,
  climate: 0,
  lock: 0,
  media_player: 0,
  input_boolean: 0,
  // Controllable in the sense that matters here: tapping it does something
  // (opens the stream) rather than restating a number already on the badge.
  camera: 0,
  sensor: 1,
  binary_sensor: 1,
  assist_satellite: 1,
};

/** Category order is already a considered, user-visible ordering (it drives
 *  the HUD filter row), so it is reused rather than invented again here. */
const CATEGORY_RANK: Record<Category, number> = Object.fromEntries(
  CATEGORY_ORDER.map((c, i) => [c, i]),
) as Record<Category, number>;

/**
 * Placement rank — LOWER is placed first, matching `symbol-sort-key`.
 *
 * Controllability dominates; category breaks ties within it. Ties beyond that
 * are broken by entity_id at the call site, which makes the total order the
 * same on every device and every frame — the property the solver's purity
 * argument rests on.
 */
export function badgeRank(type: EntityType, category: Category): number {
  return DOMAIN_RANK[type] * CATEGORY_ORDER.length + CATEGORY_RANK[category];
}
