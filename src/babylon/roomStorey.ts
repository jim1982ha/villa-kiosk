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
 * How far BELOW a world point a room's floor may sit and still be the storey
 * that point stands on.
 *
 * ⚠️ Centimetres, and deliberately NOT a comfortable margin. A ground-floor
 * ceiling fixture hangs within centimetres of the slab above it, so any
 * tolerance wide enough to feel safe hands that fixture to the upper storey.
 * A device is never more than a hair below its own floor (a recessed floor
 * light is the only case at all).
 *
 * ⚠️ THE RESIDUAL, stated because it is real and a pin would otherwise imply
 * otherwise: within roughly this distance of a slab, HEIGHT ALONE CANNOT
 * DECIDE. A ceiling lamp on the floor below and a recessed uplight on the floor
 * above are at the same world Y, and `storeyFloorYAt` will call both of them
 * upstairs. No epsilon fixes that — the two really are at the same height, and
 * a wider one only widens the band. The fix belongs to the CALLER: anything
 * that can afford a downward ray should pass the height of the floor it found
 * rather than the fixture's own, which answers by touching the floor instead of
 * guessing from a number. `EntityVisuals.reshapeLightPools` does exactly that
 * (it is already probing), and it is the caller that draws the thing a user can
 * see. The probe's own cache key cannot — it must key BEFORE casting the ray —
 * so it keeps the height rule and, with it, this band.
 */
export const STOREY_PICK_EPS = 0.05;

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
 * The floor height of the storey a world Y stands on: the HIGHEST room floor at
 * or just below it, or — for a point under every floor there is — the lowest
 * floor of all, so a fixture below the ground slab still belongs somewhere
 * rather than to nothing.
 *
 * Returns 0 for an empty room list, which is what every caller wants: before
 * calibration there are no polygons and no storeys to tell apart.
 */
export function storeyFloorYAt(rooms: readonly StoreyRoom[], y: number): number {
  let below = -Infinity;
  let lowest = Infinity;
  for (const room of rooms) {
    if (room.floorY < lowest) lowest = room.floorY;
    if (room.floorY <= y + STOREY_PICK_EPS && room.floorY > below) below = room.floorY;
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
