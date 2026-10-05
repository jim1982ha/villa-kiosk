// Badge placement for the WALK camera (2.496.174): turning on the spot must not
// regroup anything, and it must measure what the screen shows.
//
// ⚠️ IT REGROUPED WITH THE HEADING. Run on the villa's own model with the real
// layout pass, one spot and a full turn gave 8–9 different groupings: a card
// took in a device at one heading and dropped it at the next, and moved with
// it ("the icons change based on the direction the person is looking at").
// Three causes, each driven here by value:
//   1. the depth correction measured from the WORLD ORIGIN, not the walker;
//   2. the absorb test took the two ground axes as a SQUARE, which turns with
//      the heading (placementPass — pinned below);
//   3. the solver's pile centroids dropped the along-view axis `sz`.
// And one scale for every depth, while the walker stands among the badges —
// now each badge is measured at the reference depth along its own line of
// sight (atReferenceDepth), so every distance is an on-screen separation.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { onGlass } = await import("@/babylon/badgeLayout");
const { viewBasis, VIEW_BASIS_STEPS, atReferenceDepth } = await import("@/babylon/badgeProjection");
const { solvePlacement, createPlacementScratch } = await import("@/babylon/badgePlacement");

const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;

// ── atReferenceDepth ──
const eye = { x: 7, y: 1.6, z: -4 };   // NOT at the origin: cause 1 hides there
const o = { x: 0, y: 0, z: 0 };
atReferenceDepth(eye, 6, 0.5, eye.x + 3, 2.6, eye.z + 4, o);
ck("a point is moved onto the reference depth along its own line of sight",
   near(Math.hypot(o.x - eye.x, o.z - eye.z), 6) && near((o.x - eye.x) / (o.z - eye.z), 3 / 4) && near(o.y - eye.y, (2.6 - 1.6) * 6 / 5), o);
atReferenceDepth(eye, 6, 0.5, eye.x + 0.01, 1.6, eye.z, o);
ck("  ...a device at the walker's feet is taken as half a metre away, not flung to infinity", near(o.x - eye.x, 0.01 * 12));

// ── the scene: 60 devices around the walker, plus a dense pile of 8 ──
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pts = [];
for (let i = 0; i < 60; i++) { const a = rnd() * Math.PI * 2, r = 1 + rnd() * 11; pts.push([eye.x + Math.sin(a) * r, 0.3 + rnd() * 2.3, eye.z + Math.cos(a) * r]); }
for (let i = 0; i < 8; i++) pts.push([eye.x + 3 + rnd() * 0.25, 2.3 + rnd() * 0.2, eye.z + 3 + rnd() * 0.25]);
const cats = ["light", "sensor", "climate", "security"];
const solveAt = (headingRad) => {
  const basis = viewBasis(Math.sin(headingRad), -0.15, Math.cos(headingRad), VIEW_BASIS_STEPS, "world3d");
  const c = { pxPerWorld: 100, allow: 1, basis, refDepth: 6, eye };
  const scratch = { px: 0, py: 0, pz: 0, pd: 0 }, m = { x: 0, y: 0, z: 0 };
  const items = pts.map((p, i) => {
    atReferenceDepth(eye, 6, 0.5, p[0], p[1], p[2], m);
    const it = onGlass(c, m.x, m.y, m.z, { halfW: 22, halfH: 22, cy: -30 }, scratch, { sx: 0, sy: 0, sz: 0, reach: 0, reachY: 0 });
    return { ...it, rank: i % 3, sortKey: `dev.${String(i).padStart(2, "0")}`, category: cats[i % 4], room: `room${i % 5}`, exempt: false };
  });
  const r = solvePlacement(items, 4, 40, "priority", createPlacementScratch(), 4);
  const acc = items.filter((_, i) => r.accepted[i]).map((x) => x.sortKey).join(",");
  const bk = r.buckets.slice(0, r.bucketCount).map((b) => b.members.map((i) => items[i].sortKey).sort().join("+")).sort().join("|");
  return { sig: `${acc} // ${bk}`, buckets: r.bucketCount, big: r.buckets.slice(0, r.bucketCount).some((b) => b.members.length > 1) };
};
const sigs = new Set(); let grouped = false;
for (let h = 0; h < 360; h += 10) { const s = solveAt((h * Math.PI) / 180); sigs.add(s.sig); grouped ||= s.big; }
ck("the scene groups at all (the check below is not vacuous)", grouped);
ck("turning on the spot through 36 headings gives ONE placement", sigs.size === 1, sigs.size);

// ── perspective: what the screen shows ──
{
  const basis = viewBasis(0, 0, 1, VIEW_BASIS_STEPS, "world3d");
  const c = { pxPerWorld: 100, allow: 1, basis, refDepth: 6, eye };
  const sep = (d) => {
    const s = { px: 0, py: 0, pz: 0, pd: 0 }, a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    atReferenceDepth(eye, 6, 0.5, eye.x - 0.5, 1.6, eye.z + d, a); atReferenceDepth(eye, 6, 0.5, eye.x + 0.5, 1.6, eye.z + d, b);
    const A = onGlass(c, a.x, a.y, a.z, { halfW: 22, halfH: 22, cy: 0 }, s, {}), B = onGlass(c, b.x, b.y, b.z, { halfW: 22, halfH: 22, cy: 0 }, s, {});
    return Math.hypot(B.sx - A.sx, B.sz - A.sz);
  };
  // The screen draws them exactly 10x apart. The measure is the ANGLE between
  // the lines of sight, which differs from the flat screen by ~3% at this
  // spread (9.70); the old single scale measured them the SAME (1x).
  ck("two devices a metre apart measure ~10x further apart at 2 m than at 20 m, as drawn", Math.abs(sep(2) / sep(20) - 10) < 0.5, sep(2) / sep(20));
  const A = onGlass(c, eye.x, 1.6, eye.z + 6, { halfW: 22, halfH: 22, cy: 0 }, { px: 0, py: 0, pz: 0, pd: 0 }, {});
  ck("  ...and no second depth correction is applied on top (reach = the drawn half-width)", A.reach === 22, A.reach);
}

// ── the callers ──
const src = (p) => readFileSync(new URL(`../../src/babylon/${p}`, import.meta.url), "utf8");
const ev = src("EntityVisuals.ts");
ck("EntityVisuals gives the eye to the walk camera only", /eye: this\.orbitCamera\(\) \? undefined : this\.walkEye\(\)/.test(ev));
{
  // Badges AND cards measured through measuredAt — driven by value through the
  // pass's own functions (placementPass: placementItems, planeOf): with an eye,
  // a device 20 m ahead is measured at the reference depth, so it lands where
  // one at that depth would; without one, where it stands.
  const P = await import("@/babylon/placementPass");
  const { RoomFocus } = await import("@/babylon/roomFocus");
  const basis = { rx: 1, rz: 0, ax: 0, az: 1, sinPhi: 0, cosPhi: 1, mode: "world3d" };
  const eye = { x: 0, y: 0, z: 0 };
  const walk = { pxPerWorld: 10, allow: 1, basis, refDepth: 5, eye };
  const far = P.planeOf(walk, 4, 0, 20, P.glassScratch()), near = P.planeOf(walk, 1, 0, 5, P.glassScratch());
  ck("a card: a far point is measured at the reference depth (same bearing, same glass point)",
     Math.abs(far.sx - near.sx) < 1e-9 && Math.abs(far.sz - near.sz) < 1e-9, [far, near]);
  const orbit = P.planeOf({ ...walk, eye: undefined }, 4, 0, 20, P.glassScratch());
  ck("  ...and without an eye it stands where it is", orbit.sx === 40 && orbit.sz === 200, orbit);
  const shown = [{ id: "a", lbl: { type: "light", category: "light" }, wx: 4, wy: 0, wz: 20 }];
  const items = P.placementItems(shown, [{ halfW: 5, halfH: 5, cy: 0 }], walk, {}, new RoomFocus().rooms, [], P.glassScratch());
  ck("a badge is measured the same way as a card", Math.abs(items[0].sx - near.sx) < 1e-9 && Math.abs(shown[0].sx - near.sx) < 1e-9, [items[0].sx, near.sx]);
}
// The absorb test's ground metric is driven by VALUE in walk_frame.mjs (the
// same distance in every direction) — it replaced a regex pin here.

done("✅ walking: one placement at every heading, measured as drawn");
