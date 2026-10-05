// Where the overview draws the sun and the moon (babylon/skyFraming.ts).
//
// 2.496.302: ONE RULE — a body is a fixed point on a sun-path diagram round
// the villa (Revit draws one at 150 % of the model's radius), and the disc is
// drawn in the direction from the camera to it. 2.496.290–301 drew it by screen
// rules (a ground spot, a lift up the screen, an edge pull-in, a behind-you
// fade, pan and zoom factors) and each rule moved it under another camera
// motion. This pins that NO camera motion can: whatever the pose, the drawn
// direction points at the same world point, and that point depends on the
// villa and the true direction alone.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const f = await import("@/babylon/skyFraming");

const deg = (d) => (d * Math.PI) / 180;
const dirAt = (alt, az) => ({ x: Math.sin(az) * Math.cos(alt), y: Math.sin(alt), z: Math.cos(az) * Math.cos(alt) });
const drop = f.liftFor(200);
// A model's world extents (any — the rule must not care) and its diagram.
const MIN = { x: -18, y: 0, z: -9 }, MAX = { x: 22, y: 7, z: 11 };
const path = f.sunPathOf(MIN, MAX, 0);

console.log("  the sun-path diagram, from the model alone");
ck("centred on the model's footprint, on its ground",
   path.centre.x === 2 && path.centre.z === 1 && path.centre.y === 0);
ck("  ...its radius 150 % of the model's (half its footprint's diagonal) — Revit's default",
   Math.abs(path.radius - 1.5 * Math.hypot(40, 20) / 2) < 1e-9 && f.SUN_PATH_SCALE === 1.5);

console.log("\n  one fixed point, whatever the camera does");
{
  // Every pose a person can reach and more: orbit (heading), tilt, zoom
  // (distance), pan (the orbit point anywhere), a phone's narrow frame.
  let worst = 0, at = null, n = 0;
  for (const camAz of [0, deg(70), deg(160), deg(-120)]) for (const pitch of [deg(5), deg(30), deg(60), deg(85)])
    for (const D of [8, 40, 150]) for (const T of [[2, 1, 1], [30, 1, -25], [-40, 1, 30]]) for (const hHalf of [0.3, 0.7])
      for (let a = -170; a <= 180; a += 25) for (const alt of [2, 20, 50, 85]) {
        const F = { x: Math.sin(camAz) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(camAz) * Math.cos(pitch) };
        const eye = { x: T[0] - D * F.x, y: T[1] - D * F.y, z: T[2] - D * F.z };
        const cam = { pitch, halfFov: 0.4, camAz, hHalf, eye, path };
        const d = dirAt(deg(alt), deg(a));
        const r = f.placeBody(d.x, d.y, d.z, drop, cam);
        // The point, worked out here from the villa and the true direction only.
        const P = { x: path.centre.x + path.radius * d.x, y: path.centre.y + path.radius * d.y, z: path.centre.z + path.radius * d.z };
        const v = [P.x - eye.x, P.y - eye.y, P.z - eye.z], m = Math.hypot(...v);
        const err = Math.hypot(r.dir.x - v[0] / m, r.dir.y - v[1] / m, r.dir.z - v[2] / m);
        n++;
        if (err > worst) { worst = err; at = { camAz, pitch, D, T, a, alt }; }
      }
  ck(`the disc points from the camera at ONE world point — orbit, tilt, zoom, pan and frame alike (${n} poses)`,
     worst < 1e-12 && n > 10000, { worst, at });
}
{
  // That point belongs to the villa and the sky, not to the camera: east of
  // the house for an eastern sun, at the true height, on the ground at sunrise.
  const east = dirAt(deg(30), deg(90)), P = f.bodyPoint(east.x, east.y, east.z, path);
  ck("  ...the point is where the sun really is, seen from the villa: an eastern sun east of the house, at its true height",
     P.x > path.centre.x && Math.abs(P.z - path.centre.z) < 1e-9 && Math.abs(Math.atan2(P.y - path.centre.y, P.x - path.centre.x) - deg(30)) < 1e-9);
  const rise = dirAt(0, deg(-90)), Q = f.bodyPoint(rise.x, rise.y, rise.z, path);
  ck("  ...a sun on the horizon sits on the ground circle, one radius out",
     Math.abs(Q.y - path.centre.y) < 1e-12 && Math.abs(Math.hypot(Q.x - path.centre.x, Q.z - path.centre.z) - path.radius) < 1e-9);
}
{
  // The camera cannot reach the point through anything but `eye`: two
  // different headings/tilts/frames at one position draw the same direction.
  const d = dirAt(deg(40), deg(200)), eye = { x: 30, y: 25, z: -60 };
  const a = f.placeBody(d.x, d.y, d.z, drop, { pitch: deg(10), halfFov: 0.4, camAz: 0, hHalf: 0.7, eye, path });
  const b = f.placeBody(d.x, d.y, d.z, drop, { pitch: deg(70), halfFov: 0.6, camAz: 2, hHalf: 0.3, eye, path });
  ck("  ...where the camera LOOKS changes nothing — only where it stands (a pan, a zoom, an orbit move it)",
     a.dir.x === b.dir.x && a.dir.y === b.dir.y && a.dir.z === b.dir.z && a.fade === b.fade);
}

console.log("\n  setting");
{
  const cam = { pitch: deg(40), halfFov: 0.4, camAz: 0, hHalf: 0.7, eye: { x: 0, y: 40, z: -50 }, path };
  ck("set: below −1° of TRUE altitude it is gone; above 3° fully up; between, a fade",
     f.horizonFade(deg(-1.5)) === 0 && f.horizonFade(deg(4)) === 1 && f.horizonFade(deg(1)) > 0 && f.horizonFade(deg(1)) < 1);
  const lo = dirAt(deg(-0.5), 0), r = f.placeBody(lo.x, lo.y, lo.z, drop, cam);
  ck("  ...asked of the TRUE altitude, never the drawn one (from above, the drawn direction points down)",
     r.dir !== null && r.dir.y < 0 && r.fade > 0);
  const gone = dirAt(deg(-5), 0);
  ck("  ...a set body is not drawn at all", f.placeBody(gone.x, gone.y, gone.z, drop, cam).dir === null);
}

console.log("\n  first person, and before a model");
{
  const cam = { pitch: deg(5), halfFov: 0.4, camAz: 1, hHalf: 0.7, eye: { x: 3, y: 1.6, z: 2 }, path };
  const d = dirAt(deg(37), deg(140));
  const out = f.placeBody(d.x, d.y, d.z, 0, cam).dir;
  ck("no horizon drop: the true sky, untouched (the viewer is standing under it)", out.x === d.x && out.y === d.y && out.z === d.z);
  const none = f.placeBody(d.x, d.y, d.z, drop, { ...cam, path: null }).dir;
  ck("  ...and before a model is loaded, the true direction too (nothing to stand round)", none.x === d.x && none.y === d.y && none.z === d.z);
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
