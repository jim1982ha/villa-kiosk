// src/babylon/hitResolution.ts
// What is under this point of the screen — asked ONCE, for every gesture.
//
// ⚠️ THIS ORDER WAS WRITTEN FOUR TIMES. Tap, long-press, double-tap and hover
// each walked the GUI tiers themselves, each copy's comments promised to
// "mirror handleTap exactly", and two of those promises had already broken in
// production (2.293.0: hovering a group card named nothing; 2.430.0: a room
// chip took taps from badges drawn on top of it). The double-tap copy asked in
// a different order again. Now the order lives here and the gestures only say
// what each answer MEANS to them.
//
// The order, and why:
//  0. An OPEN room chip (its `+N` pill tapped) is drawn over everything, so it
//     answers first for every pixel it covers.
//  1. A GROUP CARD's cell is that device's only picture while the card draws.
//     A point on the card but in no cell (a count, an empty corner) asks the
//     badges next, because a card can be drawn over a badge from another pile
//     entirely — and a point over something visible belongs to that thing.
//  2. A BADGE.
//  3. A ROOM CHIP last among the GUI tiers: it paints BEHIND badges and cards
//     (zIndex -1), so it must not answer for a pixel one of them is drawn on.
//  4. Nothing — the caller falls through to the 3D mesh under the point.
//
// Pure: the three pickers are the seam. EntityVisuals is the adapter in the
// app; tests/oracles/hit_resolution.mjs supplies fakes.

export interface HitPickers {
  /** The group card under the point: `entityId` when the point is in a cell. */
  entityGroupAt(x: number, y: number): { room: string; entityIds: string[]; entityId: string | null } | null;
  /** The badge drawn under the point. */
  badgeAt(x: number, y: number): string | null;
  /** The room chip under the point, and the line of it (one room) the point is on. */
  clusterAt(x: number, y: number): ChipHit | null;
}

/** One line of a room chip: the one room it names, and that room's devices. */
type ChipLineHit = { room: string; entityIds: string[] };

/** A room chip under the point. `key` is its roomKey; `line` the room of a
 *  merged chip the point is on; `toggle` the point is on the `+N` pill that opens or
 *  folds it; `raised` it is the OPEN chip, drawn over everything else. */
type ChipHit = {
  key: string; room: string; entityIds: string[]; roomNames: string[];
  line: ChipLineHit | null; toggle: boolean; raised: boolean;
};

type Hit =
  /** One device: a card's cell, or a badge. */
  | { kind: "device"; entityId: string }
  /** A group card, at a point that names no device of its own. */
  | { kind: "group"; room: string; entityIds: string[] }
  /** A room chip (see ChipHit). */
  | ({ kind: "room" } & ChipHit)
  /** No GUI tier answered — the 3D scene under the point is the caller's. */
  | { kind: "none" };

export function resolveHit(p: HitPickers, x: number, y: number): Hit {
  // 0. An OPEN chip (its `+N` pill tapped) is drawn over every tier, so it
  //    answers first for every pixel it covers.
  const chip = p.clusterAt(x, y);
  if (chip?.raised) return { kind: "room", ...chip };
  const group = p.entityGroupAt(x, y);
  if (group?.entityId) return { kind: "device", entityId: group.entityId };
  const badge = p.badgeAt(x, y);
  if (badge) return { kind: "device", entityId: badge };
  if (group) return { kind: "group", room: group.room, entityIds: group.entityIds };
  if (chip) return { kind: "room", ...chip };
  return { kind: "none" };
}
