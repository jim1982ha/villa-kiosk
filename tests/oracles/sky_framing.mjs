// Where the overview draws the sun and the moon (babylon/skyFraming.ts, 2.496.251).
//
// Nearly every sky release since 2.388 retuned the overview framing, checked by
// eye in a browser, because the maths was private to SkyDome and read four
// shared static fields. It is pure now, the camera an argument; this pins the
// promises the comments make, across every tilt and turn the user can hold.
// (Moving it out was proved output-identical: 3,456 lift/fade values over a
// grid of poses and directions matched the old SkyDome to 12 decimals.)
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const f = await import("@/babylon/skyFraming");

const deg = (d) => (d * Math.PI) / 180;
const dirAt = (alt, az) => ({ x: Math.sin(az) * Math.cos(alt), y: Math.sin(alt), z: Math.cos(az) * Math.cos(alt) });
const drop = f.liftFor(200);
// The overview's tilt range: beta 0.05..1.4 rad, so the camera looks 10°..87° below horizontal.
const PITCHES = [deg(10), deg(25), deg(40), deg(61.4), deg(75), deg(87)];
const VFOV = [0.4, 0.55];                       // landscape tablet, portrait phone
const HHALF = [0.35, 0.7, 1.0];

// Measured through the CAMERA'S OWN PROJECTION of the direction lift() hands
// the disc — never the design numbers. Until 2.496.290 this read a flat
// approximation (framePosition) that ignored how a steep tilt pulls every
// bearing toward the centre, and stayed green while the moon slid sideways.
function drawn(alt, az, cam) {
  const d = dirAt(alt, az);
  const l = f.lift(d.x, d.y, d.z, drop, cam);
  return { ...(f.projectToFrame(l.x, l.y, l.z, cam) ?? { frameX: NaN, frameY: NaN }), fade: f.bodyFade(d.x, d.y, d.z, drop, cam) };
}

console.log("  vertical: the arc hangs from the camera's own forward ray");
{
  let worst = [1, 0], independent = true;
  for (const halfFov of VFOV) for (const alt of [0, deg(20), deg(45), deg(70), deg(89)]) {
    const ys = PITCHES.map((pitch) => drawn(alt, 0, { pitch, halfFov, camAz: 0, hHalf: 0.7 }).frameY);
    if (Math.max(...ys) - Math.min(...ys) > 1e-9) independent = false;
    worst = [Math.min(worst[0], ...ys), Math.max(worst[1], ...ys)];
  }
  ck("the sun's height in the FRAME is the same at every tilt the user can hold (2.396's defect: a fixed world elevation)", independent);
  ck("  ...always in the upper part of the frame, above the villa at the centre", worst[0] > 0.05 && worst[1] < 0.35, worst);
  const cam = { pitch: deg(61.4), halfFov: 0.4, camAz: 0, hHalf: 0.7 };
  const ys = [0, 15, 30, 60, 89].map((a) => drawn(deg(a), 0, cam).frameY);
  ck("  ...and the sun CLIMBS across the frame as it rises (smaller frameY = higher)", ys.every((y, i) => i === 0 || y < ys[i - 1]), ys);
}

console.log("\n  horizontal: the TRUE bearing, whatever the view (owner, 2026-10-05)");
{
  let worst = 0, at = null;
  for (const hHalf of HHALF) for (const halfFov of VFOV) for (const a of [-150, -80, -40, -10, 10, 40, 80, 150]) for (const alt of [5, 35, 70]) {
    const xs = PITCHES.map((pitch) => drawn(deg(alt), deg(a), { pitch, halfFov, camAz: 0, hHalf }).frameX);
    const spread = Math.max(...xs) - Math.min(...xs);
    if (spread > worst) { worst = spread; at = { hHalf, a, alt, xs }; }
  }
  ck("TILTING the camera never moves the sun or moon sideways (it slid 0.94 → 0.64 between 20° and 85°)", worst < 1e-9, at);
  let off = 0, at2 = null;
  for (const hHalf of HHALF) for (const pitch of PITCHES) for (const camAz of [0, deg(120), deg(-150)]) for (let a = -20; a <= 20; a += 4) {
    const rel = deg(a), cam = { pitch, halfFov: 0.4, camAz, hHalf };
    const want = 0.5 + 0.5 * Math.tan(rel) / Math.tan(hHalf);
    if (Math.abs(want - 0.5) > 0.5 * f.AZ_TRUE) continue;
    const e = Math.abs(drawn(deg(30), camAz + rel, cam).frameX - want);
    if (e > off) { off = e; at2 = { hHalf, pitch, camAz, a }; }
  }
  ck("  ...and TURNING moves it by the true amount in the middle of the frame, as the landscape moves", off < 1e-9, { off, at2 });
  let wrongSide = [];
  for (const pitch of PITCHES) for (const camAz of [0, deg(120), deg(-150)]) for (let a = -170; a <= 170; a += 10) {
    if (a === 0) continue;
    const x = drawn(deg(30), camAz + deg(a), { pitch, halfFov: 0.4, camAz, hHalf: 0.7 }).frameX;
    if (Math.sign(x - 0.5) !== Math.sign(a)) wrongSide.push([pitch, camAz, a, x]);
  }
  ck("  ...a body to the RIGHT of where the camera faces is always drawn right of the villa, and left is left", wrongSide.length === 0, wrongSide.slice(0, 3));
  let inside = true, sample = [];
  for (const hHalf of HHALF) for (const pitch of PITCHES) for (const camAz of [0, deg(120), deg(-150)]) for (let a = -179; a <= 179; a += 7) {
    const { frameX, frameY } = drawn(deg(30), deg(a), { pitch, halfFov: 0.4, camAz, hHalf });
    if (!(frameX > 0 && frameX < 1 && frameY > 0 && frameY < 1)) { inside = false; sample.push([hHalf, pitch, camAz, a, frameX]); }
  }
  ck("  ...at every bearing, frame width, tilt and heading it lands INSIDE the frame — at the edge on its true side when it is out of view (it was 'behind you')", inside, sample.slice(0, 3));
  const cam = { pitch: deg(61.4), halfFov: 0.4, camAz: 0, hHalf: 0.7 };
  const xs = [-120, -60, -30, 0, 30, 60, 120].map((a) => drawn(deg(30), deg(a), cam).frameX);
  ck("  ...and bearings stay in order across the frame", xs.every((x, i) => i === 0 || x > xs[i - 1]), xs);
}

console.log("\n  the cut directly behind, and setting");
{
  const cam = { pitch: deg(61.4), halfFov: 0.4, camAz: 0, hHalf: 0.7 };
  const behind = dirAt(deg(30), Math.PI - 1e-6), beside = dirAt(deg(30), Math.PI - deg(20));
  ck("directly behind the camera the body is faded out (no jump across the frame)", f.bodyFade(behind.x, behind.y, behind.z, drop, cam) < 0.01);
  ck("  ...20° off the cut it is fully there", f.bodyFade(beside.x, beside.y, beside.z, drop, cam) === 1);
  ck("set: below −1° of TRUE altitude it is gone; above 3° fully up; between, a fade",
     f.horizonFade(deg(-1.5)) === 0 && f.horizonFade(deg(4)) === 1 && f.horizonFade(deg(1)) > 0 && f.horizonFade(deg(1)) < 1);
  const lo = dirAt(deg(-0.5), 0);
  ck("  ...asked of the TRUE altitude, never the drawn one (in overview the drawn direction is below the horizon)",
     f.lift(lo.x, lo.y, lo.z, drop, cam).y < 0 && f.bodyFade(lo.x, lo.y, lo.z, drop, cam) > 0);
}

console.log("\n  first person");
{
  const cam = { pitch: deg(5), halfFov: 0.4, camAz: 1, hHalf: 0.7 };
  const d = dirAt(deg(37), deg(140));
  const out = f.lift(d.x, d.y, d.z, 0, cam);
  ck("no horizon drop: the true sky, untouched (the viewer is standing under it)",
     out.x === d.x && out.y === d.y && out.z === d.z && f.azimuthFade(d.x, d.z, 0, cam) === 1);
  ck("liftFor: 0 units is 0; 200 units is about 22° (the drop's own rotation)",
     f.liftFor(0) === 0 && Math.abs(f.liftFor(200) - deg(21.8)) < deg(0.1));
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

done("✅ the sun and the moon are framed by one tested rule, at every tilt");
