// tests/consistency/room_fit_test.ts
// Run: npm run test:room-fit   (node strips the types; no runner, no deps)
// Also run by `tests/py/test_villa_rules.py`, which parametrises every oracle
// in this directory — so this is a CI gate, not local feedback.
//
// ⚠️ FOUR RELEASES GOT THIS WRONG AND ONLY FIELD TELEMETRY COULD SAY SO. The
// method it came out of records the count: "Guessing between those two is what
// three releases did wrong before 2.361.0 measured it, and 2.426.0 is the
// fourth — it read 0.53x for a long thin room and ~1.0 after." Every one of
// those was arithmetic over numbers, sealed inside a class that cannot be
// constructed without a GPU context.

import {
  MIN_ROOM_FIT_RADIUS, ROOM_FIT_VIEWPORT_FRACTION,
  ROOM_FIT_VIEWPORT_FRACTION_ENTITIES, projectedHalfExtents, unionFootprint,
  viewDirection, wallFit, type Footprint,
} from "../../src/babylon/roomFit.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

const ZENITH = 0.05;               // what OverviewController.BETA_MIN allows
const room = (minX: number, maxX: number, minZ: number, maxZ: number,
              floorY = 0): Footprint => ({ minX, maxX, minZ, maxZ, floorY });

// A square room, and the same room stretched along one axis.
const SQUARE = room(-5, 5, -5, 5);
const LONG = room(-15, 15, -2, 2);

const fit = (b: Footprint, vHalf: number, hHalf: number, alpha = 0,
             allReal = true) =>
  wallFit({ bounds: b, alpha, beta: ZENITH, vHalf, hHalf, allReal });

// ── the union is the union ──────────────────────────────────────────────────
{
  const merged = unionFootprint([room(0, 4, 0, 4, 0), room(6, 10, -2, 2, -3)]);
  check("a merged chip frames every room it stands for",
    merged !== null && merged.minX === 0 && merged.maxX === 10
    && merged.minZ === -2 && merged.maxZ === 4);
  check("...and clears the DEEPER floor of the two",
    merged !== null && merged.floorY === -3,
    `got ${merged?.floorY}`);
  check("a room with no polygon at all contributes nothing rather than NaN",
    unionFootprint([null, undefined, room(1, 2, 1, 2)])?.minX === 1);
  check("no rooms at all is null, not an empty box at the origin",
    unionFootprint([null, undefined]) === null);
}

// ── the defect that cost four releases ──────────────────────────────────────
{
  // A portrait phone: the HORIZONTAL half-angle is the tight one.
  const portraitV = 0.55, portraitH = 0.35;
  const landscapeV = 0.35, landscapeH = 0.55;

  // ⚠️ THE ROOM IS IDENTICAL AND ONLY THE SCREEN CHANGES. The old formula fitted
  // a bounding SPHERE inside the TIGHTER angle — both halves rotation-invariant
  // — so a portrait phone pushed the room back until its DIAGONAL fitted the
  // SHORT axis and left the tall axis, most of the glass, empty. Measured at the
  // time: 36.05 at aspect 0.719 against 51.13 at aspect 0.495, 42% further out
  // on the iPhone for the same room.
  const sphere = Math.hypot(LONG.maxX - LONG.minX, LONG.maxZ - LONG.minZ) / 2;
  const naive = sphere / Math.tan(Math.min(portraitV, portraitH))
    / ROOM_FIT_VIEWPORT_FRACTION;
  const real = fit(LONG, portraitV, portraitH).radius;
  check("a long room on a portrait phone is not pushed back to fit its DIAGONAL",
    real < naive * 0.85, `per-axis ${real.toFixed(2)} vs sphere ${naive.toFixed(2)}`);

  // ⚠️ THE AXIS THAT BINDS IS THE ONE WHOSE OWN ANGLE IT OVERFLOWS. Rotating the
  // screen must move the binding axis; a rotation-invariant fit cannot.
  const p = fit(LONG, portraitV, portraitH);
  const l = fit(LONG, landscapeV, landscapeH);
  check("rotating the screen changes the fit for a long room",
    Math.abs(p.radius - l.radius) > 0.5,
    `portrait ${p.radius.toFixed(2)} landscape ${l.radius.toFixed(2)}`);

  // A square room is the control: it has no long axis to bind on, so swapping
  // the two half-angles must give the same answer.
  const sp = fit(SQUARE, portraitV, portraitH);
  const sl = fit(SQUARE, landscapeH, landscapeV);
  check("a SQUARE room fits the same whichever way the screen is turned",
    Math.abs(sp.radius - sl.radius) < 1e-9,
    `${sp.radius} vs ${sl.radius}`);
}

// ── tan, not sin ────────────────────────────────────────────────────────────
{
  // ⚠️ `sin` IS THE TANGENT-SPHERE FORM and is more conservative by 1/cos. Small
  // next to the anisotropy above, and wrong in the same direction — so it is
  // pinned separately, or "fixing" the anisotropy could reintroduce it unseen.
  const half = 0.5;
  const f = fit(SQUARE, half, half);
  const byTan = 5 / Math.tan(half) / ROOM_FIT_VIEWPORT_FRACTION;
  const bySin = 5 / Math.sin(half) / ROOM_FIT_VIEWPORT_FRACTION;
  check("a plane facing the camera is fitted with tan, not sin",
    Math.abs(f.radius - byTan) < 1e-6 && Math.abs(f.radius - bySin) > 0.1,
    `${f.radius.toFixed(4)} tan=${byTan.toFixed(4)} sin=${bySin.toFixed(4)}`);
}

// ── the fraction is applied AFTER the per-axis fit ──────────────────────────
{
  // ⚠️ THE ORDER IS WHAT MAKES ONE NUMBER CORRECT ON EVERY ASPECT RATIO.
  // Dividing each axis by the fraction before taking the max is the same
  // arithmetic here, but scaling the ANGLE instead — the obvious other reading
  // — is not, and would drift with the aspect ratio.
  const f = fit(SQUARE, 0.4, 0.6);
  // ⚠️ FROM THE EXTENTS THE FIT ACTUALLY MEASURED, not from the room's own
  // half-width. At the destination tilt the view plane is a hair off vertical,
  // so one axis carries a `sinPhi` factor — my first version assumed 5 for
  // both and failed by 0.06%, which is the test being wrong about the geometry
  // rather than the geometry being wrong.
  const perAxis = Math.max(f.halfW / Math.tan(0.6), f.halfH / Math.tan(0.4));
  check("the viewport fraction divides the fitted radius",
    Math.abs(f.radius - perAxis / ROOM_FIT_VIEWPORT_FRACTION) < 1e-9,
    `${f.radius} vs ${perAxis / ROOM_FIT_VIEWPORT_FRACTION}`);
  check("...and the fraction is applied AFTER the max, not to each axis first",
    Math.abs(f.radius
             - Math.max(f.halfW / Math.tan(0.6) / ROOM_FIT_VIEWPORT_FRACTION,
                        f.halfH / Math.tan(0.4) / ROOM_FIT_VIEWPORT_FRACTION))
    < 1e-9);

  const anchors = fit(SQUARE, 0.4, 0.6, 0, false);
  check("an entity-anchor box is given more headroom than a wall polygon",
    anchors.radius > f.radius,
    `${anchors.radius.toFixed(2)} vs ${f.radius.toFixed(2)}`);
  check("...and it is the fraction that did it, not a second rule",
    Math.abs(anchors.radius * ROOM_FIT_VIEWPORT_FRACTION_ENTITIES
             - f.radius * ROOM_FIT_VIEWPORT_FRACTION) < 1e-9);
}

// ── the floor never disappears ──────────────────────────────────────────────
{
  // A one-device room has a degenerate footprint: without the floor the fit is
  // zero and the camera frames nothing.
  const point = room(3, 3, 7, 7, 0);
  const f = fit(point, 0.5, 0.5);
  check("a degenerate footprint still frames something",
    f.radius >= MIN_ROOM_FIT_RADIUS && Number.isFinite(f.radius),
    `${f.radius}`);
  check("the shot is centred on the room, not on the world origin",
    f.target.x === 3 && f.target.z === 7);
  check("and it sits on the room's OWN floor",
    fit(room(0, 2, 0, 2, -2.5), 0.5, 0.5).target.y === -2.5);
}

// ── the zenithal direction ──────────────────────────────────────────────────
{
  // Babylon puts the camera at target + r(cos α sin β, cos β, sin α sin β), so
  // the direction it LOOKS is the negated unit offset.
  const d = viewDirection(0, ZENITH);
  check("at the tightest tilt the camera looks very nearly straight down",
    d.y < -0.99 && Math.abs(d.x) < 0.06 && Math.abs(d.z) < 0.06,
    JSON.stringify(d));
  check("the direction is a unit vector",
    Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9);

  // ⚠️ ALPHA IS KEPT, NOT FORCED. Tapping two rooms in a row used to give two
  // different pictures purely because of where the tilt was left; only the TILT
  // is normalised, so the villa keeps the orientation the reader built their
  // sense of it from.
  const a = viewDirection(0, ZENITH);
  const b = viewDirection(Math.PI / 2, ZENITH);
  check("orbit angle still steers the shot", Math.abs(a.x - b.x) > 1e-6);
}

// ── the half-extents are the footprint's, measured on the view plane ────────
{
  // Seen from almost straight above, a 30x4 room measures ~15 by ~2.
  const { halfW, halfH } = projectedHalfExtents(LONG, viewDirection(0, ZENITH));
  // ⚠️ WHICH SCREEN AXIS THE LONG ONE LANDS ON IS THE BASIS'S BUSINESS, not
  // this test's — at alpha 0 the room's X runs "along" and lands on py. What
  // has to hold is that a 30x4 room measures 15 by 2 on the plane, not that a
  // particular field holds a particular one.
  const measured = [halfW, halfH].sort((a, b) => a - b);
  check("a 30x4 room measures 15 by 2 on the view plane",
    Math.abs(measured[0] - 2) < 0.2 && Math.abs(measured[1] - 15) < 0.2,
    `halfW=${halfW.toFixed(3)} halfH=${halfH.toFixed(3)}`);

  // ⚠️ FOUR CORNERS BOUND THE WHOLE FOOTPRINT because the projection is linear.
  // Sampling the edges as well must find nothing outside them.
  const dir = viewDirection(0.7, ZENITH);
  const box = projectedHalfExtents(LONG, dir);
  let escaped = false;
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const x = LONG.minX + (LONG.maxX - LONG.minX) * i / 20;
      const z = LONG.minZ + (LONG.maxZ - LONG.minZ) * j / 20;
      const one = projectedHalfExtents(room(x, x, z, z), dir);
      const cx = (LONG.minX + LONG.maxX) / 2, cz = (LONG.minZ + LONG.maxZ) / 2;
      const p = projectedHalfExtents(room(x - cx, x - cx, z - cz, z - cz), dir);
      void one;
      if (p.halfW > box.halfW + 1e-9 || p.halfH > box.halfH + 1e-9) escaped = true;
    }
  }
  check("no interior point projects outside the frame the corners bound", !escaped);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
