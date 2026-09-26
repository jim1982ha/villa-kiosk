// Tap a room, see its devices (src/babylon/roomZoomSolver.ts): the shot the
// camera flies to, searched on the renderer's own zoom ladder.
//
// ⚠️ ITS DOCSTRING RECORDS THREE RELEASES OF WRONG VERSIONS, shipped "because
// the only test available was a person tapping a room chip on a phone". Then
// 2.424.0 and 2.426.0: the shot framed the BADGES, not the room — tapping a
// room with two devices near its middle dived past the room, 1.5–1.8x too
// close (measured: rung 271 where the owner settled at ~152). Replayed here,
// with the rule's other cases: every badge fully in frame PER SCREEN AXIS
// (2.364.0), only the room's own badges need be in frame, and "declutters" is
// advisory — two devices at one point never separate.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { solveRoomZoom, roomWallFit, ROOM_FIT_VIEWPORT_FRACTION, ROOM_FIT_VIEWPORT_FRACTION_ENTITIES, MIN_ROOM_FIT_RADIUS } = await import("@/babylon/roomZoomSolver");
const { rungAt } = await import("@/babylon/badgeScale");
const { GROUP_ZOOM_STEPS_PER_DOUBLING } = await import("@/babylon/badgeMetrics");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
// Looking straight down: screen x = world x, screen y = −world z.
const down = { rx: 1, rz: 0, ax: 0, az: 1, sinPhi: 1, cosPhi: 0, mode: "plane" };
const view = (o = {}) => ({ vpH: 1000, vpW: 1600, vFov: 0.8, frame: down, grouping: down, cx: 0, cy: 0, cz: 0, minRadius: 2, maxRadius: 20, ...o });
const spacing = { gapPx: 6, minSepPx: 40, allow: 1 };
const badge = (x, z, mine = true, half = 24) => ({ wx: x, wy: 1, wz: z, mine, halfW: half, halfH: half, cy: 0 });
const step = 2 ** (1 / GROUP_ZOOM_STEPS_PER_DOUBLING);
/** The widest lattice rung at or below `r` — what "the room's own fit" is on the ladder. */
const rungBelow = (r) => 2 ** (Math.floor(Math.log2(r) * GROUP_ZOOM_STEPS_PER_DOUBLING) / GROUP_ZOOM_STEPS_PER_DOUBLING);

console.log("  the shot frames the ROOM (2.424.0, 2.426.0):");
{
  const room = [badge(-0.5, 0), badge(0.5, 0)]; // two devices near the middle of a room whose wall fit is 20
  const r = solveRoomZoom(room, view(), spacing);
  // The OLD rule — the tightest rung at which the two badges draw apart —
  // dived to a fraction of the room's fit.
  let tightest = null;
  for (let k = Math.floor(Math.log2(2) * 12); k <= Math.ceil(Math.log2(20) * 12); k++) {
    const rad = 2 ** (k / 12); if (rad < 2 || rad > 20) continue;
    const px = rungAt(1000, Math.tan(0.4), rad);
    if (Math.abs(1 * px) - 2 * 24 >= 40 && tightest === null) tightest = rad;
  }
  ck("the OLD 'tightest clean rung' dives well inside the room's fit", tightest !== null && tightest < 20 / 1.5, tightest);
  ck("the shot is the room's own fit — the widest rung that frames it", r && Math.abs(r.radius - rungBelow(20)) < 1e-9, r);
  ck("  ...and says the badges are drawn apart there", r?.declutters === true, r);
}

console.log("\n  in frame, per screen axis (2.364.0):");
{
  // A wide screen: a badge 9 m to the side fits at the room's fit; the same
  // 9 m up the screen does not — a circle inscribed in the frame would have
  // treated them alike.
  const side = solveRoomZoom([badge(-9, 0), badge(9, 0)], view({ maxRadius: 16 }), spacing);
  const tall = solveRoomZoom([badge(0, -9), badge(0, 9)], view({ maxRadius: 16 }), spacing);
  ck("across the wide axis: framed at the fit", side !== null && Math.abs(side.radius - rungBelow(16)) < 1e-9, side);
  ck("along the short axis: no rung up to the fit frames it — none is claimed", tall === null, tall);
  const withNeighbour = solveRoomZoom([badge(-1, 0), badge(1, 0), badge(40, 0, false)], view(), spacing);
  ck("a neighbour room's badge off screen does not have to be framed", withNeighbour !== null, withNeighbour);
}

console.log("\n  declutters is advisory:");
{
  const stacked = solveRoomZoom([badge(0, 0), badge(0, 0)], view(), spacing);
  ck("two devices at ONE point never separate — framed anyway, declutters false", stacked !== null && stacked.declutters === false, stacked);
  const touched = solveRoomZoom([badge(-3, 0), badge(3, 0), badge(3, 0, false)], view(), spacing);
  ck("a neighbour touching the room's badge at every rung: declutters false (it would chip the room)", touched?.declutters === false, touched);
}

console.log("\n  nothing to solve:");
ck("one of the room's badges: null", solveRoomZoom([badge(0, 0), badge(3, 0, false)], view(), spacing) === null);
ck("no viewport: null", solveRoomZoom([badge(-1, 0), badge(1, 0)], view({ vpH: 0 }), spacing) === null);
ck("the answer is always ON the ladder (the renderer quantises to it)",
   (() => { const r = solveRoomZoom([badge(-1, 0), badge(1, 0)], view({ maxRadius: 13.7 }), spacing); return r && Math.abs(Math.log2(r.radius) * 12 - Math.round(Math.log2(r.radius) * 12)) < 1e-9 && r.radius <= 13.7 && r.radius * step > 13.7; })());

console.log("\n  the wall fit (roomWallFit, 2.496.102):");
{
  const room = { minX: 0, maxX: 12, minZ: 0, maxZ: 6, floorY: 0 };
  const top = { alpha: -Math.PI / 2, beta: 0.05 };
  // A portrait phone (narrow horizontal fov) and a landscape tablet.
  const portrait = roomWallFit(room, true, { ...top, vFov: 1.0, hFov: 0.62 });
  const landscape = roomWallFit(room, true, { ...top, vFov: 0.8, hFov: 1.2 });
  const oldSphere = (hFov, vFov) => (Math.hypot(6, 3) / Math.tan(Math.min(hFov, vFov) / 2)) / ROOM_FIT_VIEWPORT_FRACTION;
  ck("the OLD bounding-sphere fit pushed a portrait phone further out than the room needs (2.362.0)",
     oldSphere(0.62, 1.0) > portrait.radius * 1.05, [oldSphere(0.62, 1.0), portrait.radius]);
  ck("per screen axis: the binding axis sets the radius, at the context fraction",
     Math.abs(portrait.radius - Math.max(portrait.halfW / Math.tan(0.31), portrait.halfH / Math.tan(0.5), MIN_ROOM_FIT_RADIUS) / ROOM_FIT_VIEWPORT_FRACTION) < 1e-9);
  ck("centred on the footprint, looking (nearly) straight down", portrait.cx === 6 && portrait.cz === 3 && portrait.destDir.y < -0.99);
  ck("a landscape screen frames the same room closer than a portrait one", landscape.radius < portrait.radius, [landscape.radius, portrait.radius]);
  const entities = roomWallFit(room, false, { ...top, vFov: 0.8, hFov: 1.2 });
  ck("entity-anchor bounds get the wider shot (they under-state the room)",
     Math.abs(entities.radius / landscape.radius - ROOM_FIT_VIEWPORT_FRACTION / ROOM_FIT_VIEWPORT_FRACTION_ENTITIES) < 1e-9);
  const point = roomWallFit({ minX: 3, maxX: 3, minZ: 3, maxZ: 3, floorY: 0 }, true, { ...top, vFov: 0.8, hFov: 1.2 });
  ck("a room that measures as a point is not flown into", Math.abs(point.radius - MIN_ROOM_FIT_RADIUS / ROOM_FIT_VIEWPORT_FRACTION) < 1e-9);
}

console.log("\n  the caller:");
{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("EntityVisuals measures the badges and asks the solver, through the destination's grouping basis",
     /return solveRoomZoom\(\s*members\.map\(/.test(ev) && /grouping: this\.currentViewBasis\(view\.dir\),/.test(ev));
  ck("  ...and keeps no ladder of its own", !/widestFitting|widestClean|Math\.pow\(2, k \/ q\)/.test(ev));
  const sm = readFileSync(new URL("../../src/babylon/SceneManager.ts", import.meta.url), "utf8");
  ck("SceneManager's room shot asks roomWallFit, and fits nothing itself",
     /const fit = roomWallFit\(bounds, allReal, /.test(sm) && !/Math\.tan\(hFov \/ 2\)|ROOM_FIT_VIEWPORT_FRACTION_ENTITIES/.test(sm));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ the room shot, replayed");
process.exit(fail ? 1 : 0);
