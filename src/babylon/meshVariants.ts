// src/babylon/meshVariants.ts
// The "which pose should this entity's mesh show?" rules — pure string/number
// logic with no Babylon, no scene and no side effects.
//
// Extracted from EntityVisuals.ts, which had grown to ~4,000 lines with 700 of
// them a prelude of module-level helpers sitting above the class. This block
// was the most clearly self-contained of those: its only dependency is the
// HassEntity type, and nothing in it touches a mesh, a material or the scene —
// it just maps a live HA state onto a pose WORD that the caller then applies.
// Moved verbatim; the rules themselves are unchanged (see the notes below,
// which record why the per-type vocabularies were removed in the first place).

import type { HassEntity } from "@/types/ha.types";
import { TRANSITIONAL_STATES } from "@/utils/stateColors";

// ── Multi-mesh visual variants (e.g. a curtain's closed/half/open poses) ────
// See EntityMap.extractVariantSuffix's docstring for the "__<variant>" mesh-
// naming convention this reads.
//
// There is NO per-type vocabulary any more — not one table, not one exception.
// The rule is uniform for every entity type, current or future:
//
//   desired pose word = the entity's own live STATE, sanitised
//                       (sanitizeVariantWord), EXCEPT that anything
//                       recognisably "part-way" resolves to "half".
//
// "half" is the one VIRTUAL word — it has no HA state string of its own — and
// it is available to EVERY type, not just cover. Two universal ways to be
// part-way, neither type-specific:
//   * a numeric level attribute strictly between its extremes — a cover at
//     current_position 50, a light at brightness 128, a fan at percentage 40;
//   * a transitional state (opening/closing/locking/…) — a device
//     mid-movement is by definition between its two rest poses.
// So "cover.x__half" and "light.y__half" now mean exactly the same thing and
// go through exactly the same code. Authoring "__half" is always optional: an
// entity with only two poses just falls back to the nearest one it does have.
//
// WORD_RANK is the ordering used for that nearest-available fallback — NOT a
// vocabulary (it never decides which words are legal, and an unlisted word is
// perfectly authorable, it just sorts to the middle). It exists so "nearest"
// means something: the authored words are ordered rest → part-way → active,
// which is what makes a missing "__half" fall to a sensible neighbour instead
// of to whatever order the meshes happened to be indexed in.
//
// A desired word that ISN'T authored resolves to the LOWEST-ranked pose (see
// pickNearestVariant with an index of -1), i.e. the rest/off/closed/locked
// one. That single rule replaces every previous per-type fail-safe: a lock
// reporting "jammed", any entity reporting "unavailable"/"unknown", a state
// nobody authored a mesh for — all land on the safe, closed, at-rest pose
// rather than implying a door is open or a device is running.
const WORD_RANK: Record<string, number> = {
  // rest / inactive / safe — also the fallback for any unauthored state
  closed: 0, off: 0, locked: 0, idle: 0, standby: 0, docked: 0,
  // the virtual part-way pose
  half: 1,
  // active
  open: 2, on: 2, unlocked: 2, playing: 2, running: 2, cleaning: 2,
};
const UNRANKED_WORD = 1; // unknown/custom words sort with "half", in the middle

/** Numeric "how far along is it" attributes, with the value that means 100%.
 *  Any entity exposing one of these can express the virtual "half" pose. */
const LEVEL_ATTRS: ReadonlyArray<readonly [string, number]> = [
  ["current_position", 100], // cover
  ["brightness", 255],       // light
  ["percentage", 100],       // fan
  ["volume_level", 1],       // media_player
];
/** Outside these bounds a level reads as fully at one end, not part-way.
 *  Matches the old cover-specific 15/85 split, now applied to every type. */
const HALF_LOW = 0.15;
const HALF_HIGH = 0.85;
// TRANSITIONAL_STATES ("opening"/"locking"/… — part-way by definition,
// whatever the device is) is imported at the top from the status palette,
// which paints those same states in their own colour: a device the map shows
// mid-pose and the history bar shows as a distinct segment have to agree on
// which states those are, so there is one list rather than two.

/** The available variant word nearest `desired` in `order` (by index
 *  distance) — e.g. a cover authored with only "closed"/"open" meshes (no
 *  "half") still shows something sensible for a live half-open position,
 *  rather than showing nothing or crashing. Ties are broken toward the LATER
 *  word in `order` (for cover's [closed, half, open], that biases toward
 *  "open" — the same default an unsuffixed mesh already gets elsewhere in
 *  this mechanism, rather than depending on incidental mesh-iteration
 *  order). `available` is assumed non-empty (callers already check that). */
export function pickNearestVariant(order: string[], desired: string, available: Iterable<string>): string {
  let best: string | null = null;
  let bestIndex = -1;
  let bestDist = Infinity;
  const desiredIndex = order.indexOf(desired);
  for (const word of available) {
    if (word === desired) return word;
    const idx = order.indexOf(word);
    const dist = Math.abs(idx - desiredIndex);
    if (dist < bestDist || (dist === bestDist && idx > bestIndex)) {
      bestDist = dist; best = word; bestIndex = idx;
    }
  }
  // best is only ever null if `available` was empty, which callers rule out.
  return best!;
}

/** Reproduce EntityMap.extractVariantSuffix's mesh-suffix parsing
 *  (`/__([a-z0-9]+)$/i`, lowercased) on a live HA STATE string, so a mesh
 *  authored `<entity>__<word>` and a state string resolve to the same
 *  comparable token. "Not Home", "not_home" and "NOT-HOME" all sanitise to
 *  "nothome" — the ONLY suffix a mesh could actually carry, since the export
 *  pipeline's own suffix regex has no underscore/hyphen/space in its
 *  character class either. Multi-word states are therefore still authorable,
 *  just as one run with no separator. */
function sanitizeVariantWord(rawState: string): string {
  return rawState.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The pose word an entity's CURRENT state asks for — universal, no type
 *  branch. Its live state, sanitised, except that anything part-way (a
 *  mid-range level attribute, or a transitional state) asks for the virtual
 *  "half" instead. Callers never need to know the entity's type. */
export function desiredVariantWord(entity: HassEntity): string {
  for (const [attr, full] of LEVEL_ATTRS) {
    const v = entity.attributes?.[attr];
    if (typeof v === "number" && Number.isFinite(v) && full > 0) {
      const f = v / full;
      // Only a level that's genuinely mid-range means "half"; at either end
      // the entity's own state word (open/closed/on/off/…) is the truth.
      if (f > HALF_LOW && f < HALF_HIGH) return "half";
      break; // one level attribute is enough; at an extreme, fall through
    }
  }
  const word = sanitizeVariantWord(entity.state);
  return TRANSITIONAL_STATES.has(word) ? "half" : word;
}

/** Pose words ordered rest → part-way → active, so pickNearestVariant's
 *  "nearest" is meaningful. Stable for equal ranks so two custom words keep a
 *  deterministic order rather than depending on mesh indexing.
 *
 *  "half" is ALWAYS included even when no "__half" mesh was authored: it needs
 *  a position in this list for distance to be measurable from it. Without the
 *  virtual slot, a curtain at 50% (or a light at half brightness) authored
 *  with only two poses measured "half" at index -1 and collapsed to the rest
 *  pose — a half-open curtain rendering as fully CLOSED. With it, the two
 *  neighbours are equidistant and the tie breaks toward the later/active one
 *  (open, on), which is the sane read for "it's partly on". Callers pick their
 *  default from the AUTHORED words only (see variantWordsFor) so this virtual
 *  entry can never itself be chosen as a pose. */
export function orderVariantWords(words: Iterable<string>): string[] {
  return [...new Set([...words, "half"])].sort((a, b) => {
    const ra = WORD_RANK[a] ?? UNRANKED_WORD;
    const rb = WORD_RANK[b] ?? UNRANKED_WORD;
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
}
