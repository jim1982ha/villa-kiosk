// The sun's geometry and the day/night light levels (src/babylon/sunState.ts,
// round 11, 2.496.171). They were inline in SunController, beside Babylon
// writes, and the night-dimming lerp was written there AND in sceneLook.
// Driven over a grid of altitudes, azimuths and dimming values against the
// formulas as they stood in 2.496.170 (copied below as the reference), so the
// move is proven to change no number — then the rules that matter, by name.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { sunGeometry, sunLights, nightLerp } = await import("@/babylon/sunState");

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
const norm = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };

// ── the 2.496.170 reference ──
const refGeo = (alt, az) => ({
  dir: norm(-Math.sin(az) * Math.cos(alt), -Math.max(0.05, Math.sin(alt)), -Math.cos(az) * Math.cos(alt)),
  skyDir: norm(-Math.sin(az) * Math.cos(alt), -Math.sin(alt), -Math.cos(az) * Math.cos(alt)),
  nightT: Math.min(1, Math.max(0, -alt / ((6 * Math.PI) / 180))),
});
const refLights = (isDay, r) => {
  const nd = isDay ? 0 : Math.min(1, Math.max(0, r.nightDimming));
  const lerp = (a, b) => a + (b - a) * nd;
  const amb = isDay ? [0.4, 0.35, 0.3] : [0.26, 0.23, 0.19].map((c) => c * lerp(1, 0.35));
  return {
    sun: (isDay ? 1.2 : lerp(0.32, 0.2)) * r.sunIntensity,
    ambient: amb.map((c) => c * r.ambientIntensity),
    hemi: r.hemiIntensity * (isDay ? 1 : lerp(0.7, 0.22)),
  };
};

let geoBad = 0, lightBad = 0, cases = 0;
for (let altDeg = -30; altDeg <= 60; altDeg += 1.5) {
  for (let az = 0; az < 6.3; az += 0.7) {
    const alt = (altDeg * Math.PI) / 180, g = sunGeometry(alt, az), ref = refGeo(alt, az);
    cases++;
    if (!close(g.dir, ref.dir) || !close(g.skyDir, ref.skyDir) || Math.abs(g.nightT - ref.nightT) > 1e-12 || g.isDay !== alt > 0) geoBad++;
  }
}
for (const isDay of [true, false]) for (const nd of [-0.5, 0, 0.3, 0.7, 1, 2]) for (const k of [0.5, 1, 1.7]) {
  const r = { nightDimming: nd, sunIntensity: k, ambientIntensity: k * 0.9, hemiIntensity: k * 1.1 };
  const L = sunLights(isDay, r), ref = refLights(isDay, r);
  if (Math.abs(L.sunIntensity - ref.sun) > 1e-12 || !close(L.ambient, ref.ambient) || Math.abs(L.hemiIntensity - ref.hemi) > 1e-12) lightBad++;
}
ck(`the sun's geometry is unchanged over ${cases} altitude × azimuth cases`, geoBad === 0, geoBad);
ck("the key, ambient and fill levels are unchanged over 36 day/night × dimming × multiplier cases", lightBad === 0, lightBad);

// ── the rules, by name ──
ck("night dimming is clamped: below 0 is the mild night, above 1 the deep", nightLerp(-1)(0.7, 0.2) === 0.7 && nightLerp(3)(0.7, 0.2) === 0.2);
const low = sunGeometry(-0.5, 1);
ck("after dark the LIGHT stays 0.05 down (never edge-on) while the SKY's sun sinks", low.dir[1] < 0 && low.skyDir[1] > 0);
ck("twilight: half-way at 3° below the horizon, full night by 6°", Math.abs(sunGeometry((-3 * Math.PI) / 180, 0).nightT - 0.5) < 1e-12 && sunGeometry((-7 * Math.PI) / 180, 0).nightT === 1);
ck("night is warm: the fill's red exceeds its blue", (() => { const h = sunLights(false, { nightDimming: 1, sunIntensity: 1, ambientIntensity: 1, hemiIntensity: 1 }).hemiDiffuse; return h[0] > h[2]; })());

// ── the callers ──
const src = (f) => readFileSync(new URL(`../../src/babylon/${f}`, import.meta.url), "utf8");
const sun = src("SunController.ts"), look = src("sceneLook.ts");
ck("SunController reads sunGeometry and sunLights, and keeps no lerp of its own",
   /sunGeometry\(altitude, azimuth\)/.test(sun) && /sunLights\(isDay, r\)/.test(sun) && !/const lerp =/.test(sun) && !/TWILIGHT/.test(sun));
ck("sceneLook's exposure and IBL night use the same nightLerp", /nightLerp\(i\.isDay \? 0 : i\.nightDimming\)/.test(look) && !/Math\.min\(1, Math\.max\(0, i\.nightDimming\)\)/.test(look));

done("✅ the sun and the night, one rule");
