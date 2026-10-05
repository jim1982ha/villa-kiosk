// Where the overview draws the sun and the moon (babylon/skyFraming.ts, 2.496.251).
//
// Nearly every sky release since 2.388 retuned the overview framing, checked by
// eye in a browser, because the maths was private to SkyDome and read four
// shared static fields. It is pure now, the camera an argument; this pins the
// promises the comments make, across every tilt and turn the user can hold.
// 2.496.292 replaced the placement with a dome round the villa; see lift().
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const f = await import("@/babylon/skyFraming");

const deg = (d) => (d * Math.PI) / 180;
const dirAt = (alt, az) => ({ x: Math.sin(az) * Math.cos(alt), y: Math.sin(alt), z: Math.cos(az) * Math.cos(alt) });
const drop = f.liftFor(200);
// The overview's tilt range: beta 0.05..1.4 rad, so the camera looks 10°..87° below horizontal.
const PITCHES = [deg(10), deg(25), deg(40), deg(61.4), deg(75), deg(87)];

// Measured through the CAMERA'S OWN PROJECTION of the direction lift() hands
// the disc — never the design numbers (2.496.290: a flat approximation stayed
// green while the moon slid sideways).
function drawn(alt, az, cam) {
  const d = dirAt(alt, az);
  const l = f.lift(d.x, d.y, d.z, drop, cam);
  return { ...(f.projectToFrame(l.x, l.y, l.z, cam) ?? { frameX: NaN, frameY: NaN }), dir: l };
}
const CAMS = [];
for (const pitch of PITCHES) for (const [halfFov, hHalf] of [[0.4, 0.7], [0.4, 1.0], [0.55, 0.3], [0.4, 0.35]])
  for (const camAz of [0, deg(120), deg(-150)]) CAMS.push({ pitch, halfFov, camAz, hHalf });

console.log("  a spot on the ground round the villa, the disc straight up the screen from it");
{
  // A REAL ground spot: the camera orbits target T at distance D; the spot is
  // DOME_SCALE·D from T along the body's bearing, on the ground. Where the
  // frame is not eased, the disc must be exactly above that spot's projection
  // by the lift for its altitude — at every distance and target, so zoom and
  // pan cannot move it either.
  let worst = 0, at = null, checked = 0;
  for (const cam of CAMS) for (const [D, T] of [[10, [0, 0, 0]], [80, [12, 1, -30]], [400, [-50, 3, 7]]])
    for (let a = -170; a <= 180; a += 10) for (const alt of [0, 20, 45, 70, 89]) {
      const F = { x: Math.sin(cam.camAz) * Math.cos(cam.pitch), y: -Math.sin(cam.pitch), z: Math.cos(cam.camAz) * Math.cos(cam.pitch) };
      const C = [T[0] - D * F.x, T[1] - D * F.y, T[2] - D * F.z];
      const k = f.DOME_SCALE * D, b = deg(a);
      const v = [T[0] + k * Math.sin(b) - C[0], T[1] - C[1], T[2] + k * Math.cos(b) - C[2]], n = Math.hypot(...v);
      const g = f.projectToFrame(v[0] / n, v[1] / n, v[2] / n, cam);
      const up = f.LIFT_LOW + (f.LIFT_HIGH - f.LIFT_LOW) * alt / 90;
      const want = { frameX: g.frameX, frameY: g.frameY - up / 2 };
      if (Math.abs(2 * want.frameX - 1) > f.FRAME_TRUE || Math.abs(1 - 2 * want.frameY) > f.FRAME_TRUE) continue;
      checked++;
      const r = drawn(deg(alt), b, cam);
      const err = Math.hypot(r.frameX - want.frameX, r.frameY - want.frameY);
      if (err > worst) { worst = err; at = { cam, D, a, alt }; }
    }
  ck(`the disc stands straight above a real spot on the ground beside the villa — orbit, tilt, zoom and pan alike (${checked} poses)`, worst < 1e-9 && checked > 1000, { worst, at, checked });
  // The 2.496.294 defect: a disc raised into the AIR lines up with different
  // ground as the view tilts, so tilting slid the sun from beside the pool to
  // above it. Over the same spot, the disc's offset from it must not change
  // with the tilt at all.
  let drift = 0, at3 = null;
  for (const [halfFov, hHalf] of [[0.4, 0.75], [0.55, 0.3]]) for (const camAz of [0, deg(70), deg(200)]) for (let a = -170; a <= 180; a += 20) for (const alt of [5, 40, 75]) {
    const offs = [];
    for (const pitch of PITCHES) {
      const cam = { pitch, halfFov, camAz, hHalf };
      const F = { x: Math.sin(camAz) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(camAz) * Math.cos(pitch) };
      const b = deg(a), v = [F.x + f.DOME_SCALE * Math.sin(b), F.y, F.z + f.DOME_SCALE * Math.cos(b)];
      const g = f.projectToFrame(...v, cam), r = drawn(deg(alt), b, cam);
      const eased = [g.frameX, g.frameY, r.frameX, r.frameY].some((q) => Math.abs(2 * q - 1) > f.FRAME_TRUE);
      if (!eased) offs.push([r.frameX - g.frameX, r.frameY - g.frameY]);
    }
    for (const o of offs) { const d = Math.hypot(o[0] - offs[0][0], o[1] - offs[0][1]); if (d > drift) { drift = d; at3 = { camAz, a, alt, offs }; } }
  }
  ck("  ...TILTING never moves the disc off its spot: the same offset from the same patch of ground at every tilt (it slid from beside the pool to above it)", drift < 1e-9, at3);
  let out = [];
  for (const cam of CAMS) for (let a = -179; a <= 179; a += 7) for (const alt of [0, 15, 35, 60, 85, 90]) {
    const r = drawn(deg(alt), cam.camAz + deg(a), cam);
    if (!(r.frameX > 0.04 && r.frameX < 0.96 && r.frameY > 0.04 && r.frameY < 0.96)) out.push([cam, a, alt, r.frameX, r.frameY]);
  }
  ck("  ...and it is ALWAYS on screen: every bearing, height, tilt, heading, tablet and phone (eased toward the villa near the edges)", out.length === 0, out.slice(0, 2));
  let wrongSide = [];
  for (const cam of CAMS) for (let a = 5; a <= 175; a += 10) for (const alt of [0, 40, 80]) for (const sgn of [1, -1]) {
    const x = drawn(deg(alt), cam.camAz + sgn * deg(a), cam).frameX;
    if (Math.sign(x - 0.5) !== sgn) wrongSide.push([cam, sgn * a, alt, x]);
  }
  ck("  ...a body to the RIGHT of where the camera faces is drawn right of the villa, and left is left", wrongSide.length === 0, wrongSide.slice(0, 2));
  let low = [];
  for (const cam of CAMS) for (let a = -60; a <= 60; a += 10) for (const alt of [20, 50]) {
    const y = drawn(deg(alt), cam.camAz + deg(a), cam).frameY;
    if (!(y < 0.5)) low.push([cam.pitch, a, alt, y]);
  }
  ck("  ...a sun in front of you is drawn ABOVE the villa, in the sky", low.length === 0, low.slice(0, 2));
}

console.log("\n  the same wall from every side (owner, 2026-10-05, 2.496.293)");
{
  // A sun east of the house must be drawn on the side of the screen where the
  // house's EAST side is, whichever way the camera faces — and clearly so, not
  // a few pixels off the middle. 2.496.292 drew a 65° sun above the roof: over
  // a whole turn it stayed within 0.41..0.58 of the frame, "following the camera".
  const T = [0, 0, 0], D = 50;
  let wrong = [], weak = [];
  for (const [halfFov, hHalf] of [[0.4, 0.75], [0.55, 0.3]]) for (const pitch of [deg(20), deg(35), deg(61.4), deg(80)])
    for (const alt of [10, 40, 65, 80]) for (const az of [deg(83), deg(200), deg(-60)]) for (let t = 0; t < 360; t += 15) {
      const cam = { pitch, halfFov, camAz: deg(t), hHalf };
      const F = { x: Math.sin(cam.camAz) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(cam.camAz) * Math.cos(pitch) };
      const C = [T[0] - D * F.x, T[1] - D * F.y, T[2] - D * F.z];
      // the house's wall on the sun's side: a ground point toward the sun's bearing
      const G = [0.3 * D * Math.sin(az) - C[0], -C[1], 0.3 * D * Math.cos(az) - C[2]], n = Math.hypot(...G);
      const g = f.projectToFrame(G[0] / n, G[1] / n, G[2] / n, cam);
      const side = g.frameX - 0.5;
      const sx = drawn(deg(alt), az, cam).frameX - 0.5;
      if (Math.abs(side) > 0.08 && Math.sign(sx) !== Math.sign(side)) wrong.push([pitch, alt, az, t, side, sx]);
      if (Math.abs(side) > 0.25 && Math.abs(sx) < 0.15) weak.push([+pitch.toFixed(2), alt, +az.toFixed(2), t, +side.toFixed(2), +sx.toFixed(2)]);
    }
  ck("whichever way the camera faces, the sun is drawn on the side of the house it really is on", wrong.length === 0, wrong.slice(0, 2));
  ck("  ...and CLEARLY there when that wall is side-on to you, however high the sun is (not near the middle, as if following the camera)", weak.length === 0, weak.slice(0, 3));
}

console.log("\n  nothing jumps (2.496.290: east to west in one step)");
{
  let seams = [];
  for (const [halfFov, hHalf] of [[0.4, 0.7], [0.55, 0.3]]) for (const pitch of [deg(10), deg(61.4), deg(87)]) for (const alt of [5, 40, 80]) {
    let prev = null;
    for (let t = 0; t <= 720; t += 0.5) {
      const r = drawn(deg(alt), deg(40), { pitch, halfFov, camAz: deg(t), hHalf });
      if (prev && Math.hypot(r.frameX - prev.frameX, r.frameY - prev.frameY) > 0.03) seams.push(["turn", hHalf, pitch, alt, t]);
      prev = r;
    }
  }
  for (const [halfFov, hHalf] of [[0.4, 0.7], [0.55, 0.3]]) for (let a = -180; a < 180; a += 30) {
    let prev = null;
    for (let p = 3; p <= 87; p += 0.25) {
      const r = drawn(deg(35), deg(a), { pitch: deg(p), halfFov, camAz: 0, hHalf });
      if (prev && Math.hypot(r.frameX - prev.frameX, r.frameY - prev.frameY) > 0.03) seams.push(["tilt", hHalf, a, p]);
      prev = r;
    }
  }
  ck("turning all the way round, twice, and tilting end to end: it glides, never pops", seams.length === 0, seams.slice(0, 3));
}

console.log("\n  setting");
{
  const cam = { pitch: deg(61.4), halfFov: 0.4, camAz: 0, hHalf: 0.7 };
  ck("set: below −1° of TRUE altitude it is gone; above 3° fully up; between, a fade",
     f.horizonFade(deg(-1.5)) === 0 && f.horizonFade(deg(4)) === 1 && f.horizonFade(deg(1)) > 0 && f.horizonFade(deg(1)) < 1);
  const lo = dirAt(deg(-0.5), 0);
  ck("  ...asked of the TRUE altitude, never the drawn one (in overview the drawn direction is below the horizon)",
     f.lift(lo.x, lo.y, lo.z, drop, cam).y < 0 && f.bodyFade(lo.x, lo.y, lo.z) > 0);
}

console.log("\n  first person");
{
  const cam = { pitch: deg(5), halfFov: 0.4, camAz: 1, hHalf: 0.7 };
  const d = dirAt(deg(37), deg(140));
  const out = f.lift(d.x, d.y, d.z, 0, cam);
  ck("no horizon drop: the true sky, untouched (the viewer is standing under it)",
     out.x === d.x && out.y === d.y && out.z === d.z && f.bodyFade(d.x, d.y, d.z) === 1);
  ck("liftFor: 0 units is 0; 200 units is about 22° (the drop's own rotation)",
     f.liftFor(0) === 0 && Math.abs(f.liftFor(200) - deg(21.8)) < deg(0.1));
}

console.log("\n  the villa covers the sun and the moon, never the reverse");
{
  // 2.496.292 drew both discs with the depth test OFF in overview, so a moon
  // beside the house was painted over its walls (owner, 2026-10-05: "never
  // displayed over the villa ... display it behind it"). They are billboards at
  // SKY distance, far behind the villa, under the ordinary depth test.
  const fs = await import("node:fs");
  const src = (n) => fs.readFileSync(new URL(`../../src/babylon/${n}`, import.meta.url), "utf8");
  const sky = src("SkyDome.ts"), night = src("NightSky.ts");
  ck("neither disc changes the depth test (no depthFunction, no rendering group drawn after the villa)",
     ![sky, night].some((t) => /(sunMat|moonMat|sunDisc|moon)\.(depthFunction|renderingGroupId)\b/.test(t) || /\b(sun|moon)\.renderingGroupId\b/.test(t)));
  ck("  ...and both stay at sky distance, behind the villa (infiniteDistance billboards)",
     /sun\.infiniteDistance = true/.test(sky) && /moon\.infiniteDistance = true/.test(night));
}

console.log("\n  warmth");
ck("the disc warms over the last 25°: white high, orange on the horizon",
   f.sunWarmth(deg(60)) === 0 && f.sunWarmth(0) === 1 && Math.abs(f.sunWarmth(deg(12.5)) - 0.5) < 1e-9);

console.log("\n  the theme's night");
{
  const { isDeepNight } = await import("@/utils/themeTime");
  // On the equator at 0° longitude the sun is near the zenith at 12:00 UTC and far below at 00:00 UTC.
  ck("night is the SUN's: deep below the horizon at midnight, not at noon",
     isDeepNight(0, 0, new Date("2026-03-20T00:00:00Z")) && !isDeepNight(0, 0, new Date("2026-03-20T12:00:00Z")));
  ck("  ...and with no date given it asks the SKY's clock (skyNow), so ?skyTime previews the theme too",
     ((t) => (t.match(/date: Date = skyNow\(\)/g) || []).length === 2 && !/date: Date = new Date\(\)/.test(t))(
       (await import("node:fs")).readFileSync(new URL("../../src/utils/themeTime.ts", import.meta.url), "utf8")));
}

done("✅ the sun and the moon are drawn by one rule round the villa, from every view");
