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

console.log("  a dome round the villa (owner, 2026-10-05: 'too far from the villa')");
{
  // A REAL object: the camera orbits target T at distance D; the body sits on a
  // dome of radius DOME_SCALE·D round T. Where the frame is not eased, the
  // drawn direction must be exactly the camera's line of sight to that point —
  // at every distance and target, so zoom and pan cannot move it either.
  let worst = 0, at = null, checked = 0;
  for (const cam of CAMS) for (const [D, T] of [[10, [0, 0, 0]], [80, [12, 1, -30]], [400, [-50, 3, 7]]])
    for (let a = -170; a <= 180; a += 10) for (const alt of [0, 20, 45, 70, 89]) {
      const e = f.DOME_LOW + (Math.PI / 2 - f.DOME_LOW) * alt / 90;
      const F = { x: Math.sin(cam.camAz) * Math.cos(cam.pitch), y: -Math.sin(cam.pitch), z: Math.cos(cam.camAz) * Math.cos(cam.pitch) };
      const C = [T[0] - D * F.x, T[1] - D * F.y, T[2] - D * F.z];
      const k = f.DOME_SCALE * D, b = deg(a);
      const P = [T[0] + k * Math.sin(b) * Math.cos(e), T[1] + k * Math.sin(e), T[2] + k * Math.cos(b) * Math.cos(e)];
      const v = [P[0] - C[0], P[1] - C[1], P[2] - C[2]], n = Math.hypot(...v);
      const pr = f.projectToFrame(v[0] / n, v[1] / n, v[2] / n, cam);
      if (Math.hypot(2 * pr.frameX - 1, 1 - 2 * pr.frameY) > f.FRAME_TRUE) continue;
      checked++;
      const l = drawn(deg(alt), b, cam).dir;
      const err = Math.hypot(l.x - v[0] / n, l.y - v[1] / n, l.z - v[2] / n);
      if (err > worst) { worst = err; at = { cam, D, a, alt }; }
    }
  ck(`the sun is drawn exactly where a real object on a dome round the villa would be — orbit, tilt, zoom and pan alike (${checked} poses)`, worst < 1e-9 && checked > 1000, { worst, at, checked });
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

console.log("\n  drawn over the villa in overview only");
{
  const { Constants } = await import("@babylonjs/core/Engines/constants.js");
  ck("overview: the disc is drawn OVER the villa (GL ALWAYS), so the house never hides it; walking: the ordinary test, so walls and ceilings do",
     f.overDepth(f.liftFor(200)) === Constants.ALWAYS && f.overDepth(0) === 0);
  const fs = await import("node:fs");
  const src = (n) => fs.readFileSync(new URL(`../../src/babylon/${n}`, import.meta.url), "utf8");
  const setter = (t) => (t.match(/setHorizonDrop\(units: number\): void \{[\s\S]*?\n  \}/) || [""])[0];
  ck("  ...and BOTH discs take it from the drop they are handed (sun and moon alike)",
     /this\.sunMat\.depthFunction = overDepth\(units\)/.test(setter(src("SkyDome.ts")))
     && /this\.moonMat\.depthFunction = overDepth\(units\)/.test(setter(src("NightSky.ts"))));
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

done("✅ the sun and the moon are drawn on one dome round the villa, from every view");
