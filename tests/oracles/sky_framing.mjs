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

function drawn(alt, az, cam) {
  const d = dirAt(alt, az);
  const a = f.displayAltitude(alt, drop, cam), b = f.displayAzimuth(az, cam);
  return { ...f.framePosition(a, b, cam), fade: f.bodyFade(d.x, d.y, d.z, drop, cam) };
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

console.log("\n  horizontal: anywhere in the sky is on screen");
{
  let inside = true, sample = [];
  for (const hHalf of HHALF) for (const camAz of [0, deg(120), deg(-150)]) for (let a = -179; a <= 179; a += 7) {
    const { frameX } = drawn(deg(30), deg(a), { pitch: deg(61.4), halfFov: 0.4, camAz, hHalf });
    if (!(frameX > 0 && frameX < 1)) { inside = false; sample.push([hHalf, camAz, a, frameX]); }
  }
  ck("at every bearing, for every frame width and camera heading, the body lands inside 0..1 (it was 'behind you')", inside, sample.slice(0, 3));
  const cam = { pitch: deg(61.4), halfFov: 0.4, camAz: 0, hHalf: 0.7 };
  const xs = [-60, -30, 0, 30, 60].map((a) => drawn(deg(30), deg(a), cam).frameX);
  ck("  ...and east stays left of west in front of the camera: real bearings still move it, in order", xs.every((x, i) => i === 0 || x > xs[i - 1]), xs);
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
  ck("  ...asked of the TRUE altitude, never the drawn one (every drawn altitude in overview is below the horizon)",
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
