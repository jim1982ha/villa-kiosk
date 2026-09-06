// tests/geometry_test.ts
// Run: npm run test:geometry   (node strips the types; no runner, no deps)
//
// src/utils/geometry.ts imports NOTHING — no Babylon, no DOM, no path aliases —
// which is what makes this possible at all, and is a good reason to keep it
// that way (badgePlacement.ts is held to the same rule for the same reason).
//
// The check that matters most is the ARGUMENT ORDER of clipPolygonToConvex.
// Sutherland-Hodgman requires the CLIP region to be convex; the SUBJECT may be
// concave. Villa rooms are routinely L-shaped, so the room must always be the
// subject and the marker's footprint always the clip. Swapping them compiles,
// passes any test written on a rectangular room, and quietly eats a leg off
// every L-shaped one — so that is the case pinned hardest below.

import {
  clipPolygonToConvex, distanceToPolygonBoundary, pointInPolygon,
  regularPolygon, signedArea2, earClipTriangulate, type Pt2,
} from "../../src/utils/geometry.ts";
// Imports nothing itself, same rule as geometry.ts — that is what makes it
// testable here. See its header for the two field defects it fixes.
import { nearestFloorRoom, onStorey, storeyFloorYAt } from "../../src/babylon/roomStorey.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
}

/** Shoelace area, always positive — the measure every assertion below uses,
 *  because a clip's identity is its area, not its vertex list (the algorithm is
 *  free to emit collinear or duplicated vertices and often does). */
function area(poly: Pt2[]): number {
  return Math.abs(signedArea2(poly)) / 2;
}

const rect = (x0: number, z0: number, x1: number, z1: number): Pt2[] =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

// ── a convex room, marker wholly inside ──────────────────────────────────────
{
  const room = rect(0, 0, 10, 10);
  const clip = rect(4, 4, 6, 6);
  const out = clipPolygonToConvex(room, clip);
  check("convex room, marker inside: area is the marker's",
    Math.abs(area(out) - 4) < 1e-9, `got ${area(out)}`);
}

// ── marker straddling one wall: exactly the half inside survives ─────────────
{
  const room = rect(0, 0, 10, 10);
  const clip = rect(-1, 4, 1, 6); // 2x2, half of it outside x=0
  const out = clipPolygonToConvex(room, clip);
  check("marker straddling a wall: only the inside half survives",
    Math.abs(area(out) - 2) < 1e-9, `got ${area(out)}`);
  check("marker straddling a wall: nothing crosses the wall",
    out.every((p) => p.x >= -1e-9), JSON.stringify(out));
}

// ── marker entirely outside: empty, not the whole room ──────────────────────
{
  const room = rect(0, 0, 10, 10);
  const out = clipPolygonToConvex(room, rect(20, 20, 22, 22));
  check("marker outside the room clips to nothing", area(out) < 1e-9, `got ${area(out)}`);
}

// ── THE ONE THAT MATTERS: an L-shaped room as the SUBJECT ───────────────────
// L occupying the full 10x10 square minus its top-right 5x5 quadrant.
const lRoom: Pt2[] = [
  { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 },
  { x: 5, z: 5 }, { x: 5, z: 10 }, { x: 0, z: 10 },
];
{
  check("L-shaped room: fixture sits in the notch, so it is NOT in the room",
    !pointInPolygon(7.5, 7.5, lRoom));

  // A marker in the LEG, well clear of the notch: full area survives.
  const inLeg = clipPolygonToConvex(lRoom, rect(1, 6, 3, 8));
  check("L-shaped room as subject: a marker in the leg keeps its whole area",
    Math.abs(area(inLeg) - 4) < 1e-9, `got ${area(inLeg)}`);

  // A marker straddling the reflex corner: the notch must be bitten out of it.
  // Marker = 4x4 centred on (5,5); the room covers three of its four quadrants.
  const atNotch = clipPolygonToConvex(lRoom, rect(3, 3, 7, 7));
  check("L-shaped room as subject: the reflex notch is bitten out",
    Math.abs(area(atNotch) - 12) < 1e-9, `got ${area(atNotch)} want 12`);
  check("L-shaped room as subject: no vertex lands inside the notch",
    !atNotch.some((p) => p.x > 5 + 1e-9 && p.z > 5 + 1e-9), JSON.stringify(atNotch));

  // And the swap that would look fine on every rectangular room: with the
  // concave polygon as the CLIP, Sutherland-Hodgman is out of contract and
  // must NOT be trusted to agree. This asserts the two orders differ, so a
  // future "tidy-up" that swaps them fails here instead of in the villa.
  const swapped = clipPolygonToConvex(rect(3, 3, 7, 7), lRoom);
  check("swapping subject/clip on a concave room does NOT agree (contract)",
    Math.abs(area(swapped) - area(atNotch)) > 1e-6,
    `swapped ${area(swapped)} vs correct ${area(atNotch)}`);
}

// ── winding independence: the caller must not have to know ──────────────────
{
  const room = rect(0, 0, 10, 10);
  const cw = [...rect(4, 4, 6, 6)].reverse();
  const ccw = rect(4, 4, 6, 6);
  check("clip winding does not matter",
    Math.abs(area(clipPolygonToConvex(room, cw)) - area(clipPolygonToConvex(room, ccw))) < 1e-9);
}

// ── the clipped result must still be triangulable ───────────────────────────
{
  const out = clipPolygonToConvex(lRoom, rect(3, 3, 7, 7));
  const tris = earClipTriangulate(out);
  check("clipped polygon triangulates", tris.length >= 3, `got ${tris.length} tris`);
  const triArea = tris.reduce((sum, [a, b, c]) =>
    sum + area([out[a], out[b], out[c]]), 0);
  check("triangulation covers the clipped area exactly",
    Math.abs(triArea - area(out)) < 1e-6, `tris ${triArea} vs poly ${area(out)}`);
}

// ── regularPolygon / footprint sizing ───────────────────────────────────────
{
  const oct = regularPolygon(0, 0, 1, 8);
  check("regularPolygon returns the requested number of sides", oct.length === 8);
  check("regularPolygon is CCW (what clipPolygonToConvex normalises to)",
    signedArea2(oct) > 0);
  check("regularPolygon vertices sit on the circumcircle",
    oct.every((p) => Math.abs(Math.hypot(p.x, p.z) - 1) < 1e-9));
  // The pool inflates by 1/cos(pi/n) so the disc is strictly INSIDE the
  // footprint — the property that keeps the octagon's edges from printing.
  const inflated = regularPolygon(0, 0, 1 / Math.cos(Math.PI / 8), 8);
  const edgeMid = {
    x: (inflated[0].x + inflated[1].x) / 2,
    z: (inflated[0].z + inflated[1].z) / 2,
  };
  check("inflated footprint's inscribed circle is the pool radius",
    Math.abs(Math.hypot(edgeMid.x, edgeMid.z) - 1) < 1e-9);
}

// ── distanceToPolygonBoundary: the no-room fallback's bound ─────────────────
{
  const room = rect(0, 0, 10, 10);
  check("distance from inside is to the NEAREST edge",
    Math.abs(distanceToPolygonBoundary(2, 5, room) - 2) < 1e-9);
  check("distance from outside is to the boundary too (not signed)",
    Math.abs(distanceToPolygonBoundary(-3, 5, room) - 3) < 1e-9);
  check("distance near a corner uses the corner, not the edge line",
    Math.abs(distanceToPolygonBoundary(-3, -4, room) - 5) < 1e-9);
}

// ── roomStorey: which storey a world height stands on ───────────────────────
// A room polygon is a flat outline with no height, and on a two-storey villa
// the upper storey's outlines sit over the lower one's — so containment alone
// answers with whichever polygon was listed first. These pin the discriminator
// that stops it. Both defects it fixed are in roomStorey.ts's header.
{
  // Ground floor at 0, upper storey at 3 — with the ground floor's rooms
  // probed slightly apart from each other, as real per-centroid probes are.
  const storeys = [{ floorY: 0 }, { floorY: 0.12 }, { floorY: 3.0 }, { floorY: 2.94 }];

  check("a fixture near the ground stands on the ground floor",
    storeyFloorYAt(storeys, 0.8) === 0.12);
  check("an upper-storey fixture stands on the upper storey",
    storeyFloorYAt(storeys, 5.6) === 3.0);
  check("a ground-floor ceiling fixture belongs to the ground floor",
    storeyFloorYAt(storeys, 2.6) === 0.12,
    `got ${storeyFloorYAt(storeys, 2.6)}`);
  // ⚠️ THE PIN THAT WOULD HAVE CAUGHT v2.434.0, and the reason the tolerance is
  // a CLEARANCE and not an epsilon. A ceiling lamp hangs centimetres UNDER the
  // slab above it. With a +0.05 tolerance (a floor "at or just above" counting)
  // this returned 3.0 — the storey above — so the lamp shared the floor probe's
  // bucket with a genuine upstairs fixture, inherited its floor height, and its
  // pool was drawn at ceiling level: a disc of light floating in mid-air.
  check("a lamp hanging just UNDER a slab belongs to the floor it lights, not the slab's",
    storeyFloorYAt(storeys, 2.95) === 0.12,
    `got ${storeyFloorYAt(storeys, 2.95)} — this is the 2.434.0 bug`);
  // ...while anything mounted a usable distance above an upper floor is upstairs.
  check("a table lamp upstairs belongs upstairs",
    storeyFloorYAt(storeys, 3.4) === 3.0,
    `got ${storeyFloorYAt(storeys, 3.4)}`);
  check("an upstairs ceiling lamp is upstairs too",
    storeyFloorYAt(storeys, 5.5) === 3.0);
  // ⚠️ THE RESIDUAL, pinned as it really behaves rather than as one would like:
  // a fixture recessed into an upper floor, with less clearance than a lamp
  // needs, reads as the storey below. Height alone genuinely cannot separate it
  // from a ceiling lamp hanging at the same Y — only a ray can. Do not widen
  // the clearance to "fix" this; that re-opens the case above, which is the one
  // that reaches the glass.
  check("a floor-recessed uplight upstairs reads as the storey below — the known residual",
    storeyFloorYAt(storeys, 3.1) === 0.12,
    `got ${storeyFloorYAt(storeys, 3.1)}`);
  check("a point under every floor falls back to the LOWEST, never to nothing",
    storeyFloorYAt(storeys, -12) === 0);
  check("no rooms at all answers 0 rather than Infinity",
    storeyFloorYAt([], 1.5) === 0);

  check("rooms probed tens of cm apart are still one storey",
    onStorey(0.12, 0) && onStorey(2.94, 3.0));
  check("rooms a storey apart are not",
    !onStorey(3.0, 0) && !onStorey(0, 3.0));
  // The degradation that keeps single-storey villas byte-identical.
  // ── nearestFloorRoom: the OTHER question, and why it is not the same rule ──
  // A caller that KNOWS its floor height (the walker's feet, a landing anchor, a
  // probed floor under a fixture) must not go through storeyFloorYAt — that one
  // works from a clearance because a fixture's height is a guess. Collapsing the
  // two blanked the walk-in room banner entirely in 2.437.0.
  {
    const rooms = [
      { name: "kitchen", floorY: 0 },
      { name: "terrace", floorY: 1.2 }, // the partway group that broke it
      { name: "bedroom", floorY: 3.0 },
    ];
    const all = () => true;
    check("feet on the ground floor pick the ground-floor room",
      nearestFloorRoom(rooms, 0, all)?.name === "kitchen");
    check("feet upstairs pick the upstairs room",
      nearestFloorRoom(rooms, 3.0, all)?.name === "bedroom");
    check("feet on a mid-level terrace pick the terrace",
      nearestFloorRoom(rooms, 1.2, all)?.name === "terrace");
    // THE REGRESSION, stated as the property that prevents it: this rule always
    // returns one of the rooms offered, so a reader that had an answer cannot
    // lose it. The eye-and-clearance rule could and did.
    check("mid-staircase still names a room rather than nothing",
      nearestFloorRoom(rooms, 1.9, all) !== null);
    check("...and no candidates is the only way to get null",
      nearestFloorRoom(rooms, 0, () => false) === null);
    check("the predicate filters before the distance does",
      nearestFloorRoom(rooms, 0, (r) => r.name !== "kitchen")?.name === "terrace");
    // What the walker would have got from the FIXTURE rule at eye height 1.7:
    // floors at or 0.30 below 1.7 are {0, 1.2}, the highest is 1.2 — so the
    // ground floor was excluded and every ground-floor room filtered out.
    check("...which is exactly what the fixture rule answers, and why it is wrong here",
      storeyFloorYAt(rooms, 1.7) === 1.2);

    check("with one storey, every room is on it",
      [{ floorY: 0 }, { floorY: 0.2 }, { floorY: -0.1 }]
        .every((r) => onStorey(r.floorY, storeyFloorYAt(
          [{ floorY: 0 }, { floorY: 0.2 }, { floorY: -0.1 }], 2.4))));
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
