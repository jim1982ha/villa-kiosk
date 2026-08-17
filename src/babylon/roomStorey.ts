// src/babylon/roomStorey.ts
// "Which room is this world point in?" — answered with the STOREY included,
// which is the whole reason this file exists.
//
// A calibrated room polygon is a floor PLAN: a flat outline with no height. On
// a two-storey villa the upper storey's outlines sit directly over the lower
// one's, so a plain containment test answers with whichever polygon the array
// happened to list first — i.e. with the load order of `.rooms.json`, and with
// nothing about where the point actually is. Two real defects came out of that,
// both visible on the glass:
//
//   - a ground-floor light's floor pool clipped to the outline of the room
//     ABOVE it: cut off along edges that do not exist on this storey, or
//     spilling through this storey's walls where the upper room is wider.
//     Because the winner was array order, two identical fixtures in one room
//     could disagree with each other — reported as "why are the light effects
//     shown differently".
//   - the floor probe's cache key is `room|round(y)` (see floorProbe.ts), so
//     two rooms on one storey lying under a single room of the storey above
//     collapsed to ONE key and shared a probed floor height. That is exactly
//     the 4-metre grid key 2.300.0 deleted for merging THROUGH A WALL,
//     reintroduced along the vertical axis — where the wall is a whole slab.
//
// IMPORTS NOTHING, for the reason `badgePlacement` and `badgeMetrics` import
// nothing: that is what lets `npm run test:geometry` pin it with no runner and
// no dependency, and this is exactly the kind of rule that regresses silently.
// The containment half stays with its caller (EntityVisuals already holds
// `pointInPolygon`); what lives here is the JUDGMENT — which storey a height
// belongs to — because that is the part with a number in it.

/** A calibrated room, as far as this file is concerned: the height of the floor
 *  it is drawn on (SceneManager.estimateFloorY, per storey). Callers pass their
 *  own richer room objects; only `floorY` is read. */
export interface StoreyRoom {
  floorY: number;
}

/**
 * How far a floor must sit BELOW a world point to be the storey that point
 * belongs to. A CLEARANCE, not an epsilon — and the sign is the entire fix
 * (2.435.0).
 *
 * ⚠️ v2.434.0 had this as a +0.05 tolerance: a floor at or *just above* the
 * point still counted. That reads as cautious and is exactly backwards, because
 * of where light fixtures actually live. A ground-floor ceiling lamp hangs
 * within centimetres of the slab above it — 2.60 m under a slab at 2.56 — so
 * the tolerance handed it to the UPPER storey. It then shared the floor probe's
 * cache bucket (`room|round(y)`, and both round to 3) with a genuine upstairs
 * fixture, inherited that room's floor height, and its pool was drawn at 2.58 m
 * — a disc of light hanging at ceiling height instead of lying on the floor
 * two and a half metres below. Reported as exactly that: "the light disk is
 * floating in the air".
 *
 * Flipping the sign separates the two cases by the thing that really tells them
 * apart: **a lamp is mounted a usable distance above the floor it lights.** A
 * ceiling lamp is ~0.04 m below its slab (fails the test, falls through to the
 * floor it actually lights); a table or floor lamp upstairs is 0.3–1.5 m above
 * its own (passes). 0.30 m sits an order of magnitude from both.
 *
 * ⚠️ THE RESIDUAL, stated because a pin would otherwise imply there is none: a
 * fixture recessed INTO an upper floor and pointing up (a floor uplight less
 * than 0.30 m above its own slab) still reads as belonging to the storey below.
 * That case fails quietly — its pool lands on the floor beneath — and it cannot
 * be fixed by a number, because height alone genuinely cannot separate it from
 * a ceiling lamp hanging at the same Y. Only a ray can, and a ray per fixture is
 * what the memo exists to avoid.
 */
export const STOREY_MIN_MOUNT = 0.30;

/**
 * How far two room floor heights may differ and still be the SAME storey.
 *
 * Each room's `floorY` is probed at its own centroid, so a step-down lounge, a
 * raised terrace or a sloped slab legitimately reads tens of centimetres from
 * its neighbours — while a storey separation is metres. 0.6 m sits an order of
 * magnitude away from both.
 */
export const STOREY_MATCH_M = 0.6;

/** Whether a room's floor belongs to the storey whose floor is at `storeyY`. */
export function onStorey(roomFloorY: number, storeyY: number): boolean {
  return Math.abs(roomFloorY - storeyY) <= STOREY_MATCH_M;
}

/**
 * The floor height of the storey a world Y belongs to: the HIGHEST room floor
 * at least `STOREY_MIN_MOUNT` below it, or — for a point with no floor that far
 * beneath it (something at or near ground level, or below every floor there is)
 * — the lowest floor of all, so nothing ever belongs to no storey.
 *
 * Returns 0 for an empty room list, which is what every caller wants: before
 * calibration there are no polygons and no storeys to tell apart.
 */
export function storeyFloorYAt(rooms: readonly StoreyRoom[], y: number): number {
  let below = -Infinity;
  let lowest = Infinity;
  for (const room of rooms) {
    if (room.floorY < lowest) lowest = room.floorY;
    if (room.floorY <= y - STOREY_MIN_MOUNT && room.floorY > below) below = room.floorY;
  }
  if (below > -Infinity) return below;
  return Number.isFinite(lowest) ? lowest : 0;
}

// The containment half — "and is the point inside that room's outline" — is
// EntityVisuals.roomPolyAt, which already holds `pointInPolygon`. It degrades to
// plain containment exactly where storeys cannot be told apart: on a
// single-storey villa, and on any model whose per-storey probes all came back
// equal, every room is on the point's storey and the first containing one wins,
// which is the behaviour this replaced.
