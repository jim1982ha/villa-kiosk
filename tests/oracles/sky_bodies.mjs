// The sun and the moon (babylon/skyBodies.ts, skyMoment.ts): through the REAL
// SkyDome and NightSky on NullEngine, and through skyBodies.placeMoon and
// skyMoment directly — no scene.
//
// The owner's rules:
//   · NO BODY IN THE OVERVIEW (2026-10-20): the sun drawn on its arc round the
//     villa hung over the living room at noon like an object of the model —
//     "this should be hidden completely". Neither the sun nor the moon is drawn
//     there; the sky's colour, the light and the stars still follow the hour;
//   · walking, the sky material draws the real sun and the moon is in its TRUE
//     direction, at sky distance, by night only (the real clock);
//   · Settings' day/night preview lights the villa and colours the sky, never
//     moves a body (2026-10-17);
//   · the moon's compass is the sun's, and Set North puts the sun on its true
//     side whichever way a model's north points (2026-10-17).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
// The moon is painted procedurally; placement needs no pixels.
globalThis.OffscreenCanvas ??= class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return new Proxy({}, { get: () => () => ({ addColorStop() {} }) }); }
};
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { ArcRotateCamera } = await import("@babylonjs/core/Cameras/arcRotateCamera.js");
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { SkyDome } = await import("@/babylon/SkyDome");
const { NightSky } = await import("@/babylon/NightSky");
const b = await import("@/babylon/skyBodies");
const { skyMoment, northOffsetFacing } = await import("@/babylon/skyMoment");
const { getSunPosition } = await import("@/utils/sunCalc");

const DROP = 700;   // SceneManager's OVERVIEW_HORIZON_DROP
const deg = (d) => (d * Math.PI) / 180;
const toward = (alt, az) => new Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt));

function rig() {
  const scene = new Scene(new NullEngine({ renderWidth: 1376, renderHeight: 640, textureSize: 256, deterministicLockstep: false, lockstepMaxSteps: 1 }));
  const cam = new ArcRotateCamera("ov", -Math.PI / 2, 1.0, 76, new Vector3(0, 1, 0), scene);
  scene.activeCamera = cam;
  const sky = new SkyDome(scene);
  const night = new NightSky(scene);
  sky.setMoon(night);
  sky.setHorizonDrop(DROP);
  return { scene, cam, sky, night, moon: scene.getMeshByName("moon") };
}
const moment = (sunTo, moon, moonT = 1) => ({
  light: { isDay: sunTo.y > 0, nightT: moonT, dir: [0, -1, 0] },
  skySun: sunTo, moon, moonT, realAltitude: 0, altitude: 0, azimuth: 0,
});
const shown = (m) => m.isEnabled() && m.material.alpha > 0.01;
const look = (dir) => ({ dir, fraction: 0.6, angle: -1, parallacticAngle: 0 });

// ── 1. NO BODY IN THE OVERVIEW ───────────────────────────────────────────────
{
  const up = toward(deg(40), deg(120));
  ck("the overview places no body: no moon, whatever the hour (placeMoon)",
     b.placeMoon(up, 1, true) === null && b.placeMoon(up, 0, true) === null && b.placeMoon(null, 1, true) === null);
  const r = rig();
  const discs = r.scene.meshes.filter((m) => /sun|glow/i.test(m.name)).map((m) => m.name);
  ck("  ...and the real sky builds no sun disc and no glow at all", discs.length === 0, discs);
  r.sky.update(moment(toward(deg(85), deg(94)), look(up)));   // noon in Bali, the moon up too
  r.scene.render();
  ck("  ...at noon and at night alike, nothing but the sky is drawn over the villa in the overview",
     !shown(r.moon) && r.scene.meshes.filter((m) => m.isEnabled() && m.name !== "skyBox" && !/^stars/.test(m.name)).length === 0,
     r.scene.meshes.filter((m) => m.isEnabled()).map((m) => m.name));
}

// ── 2. WALKING: THE TRUE SKY ─────────────────────────────────────────────────
{
  const r = rig();
  const to = toward(deg(30), deg(20));
  r.sky.update(moment(toward(deg(-20), deg(270)), look(to)));
  r.sky.setHorizonDrop(0);   // to the walk-through — no sky-clock tick
  ck("walk-through: the moon is in its TRUE direction at once, at sky distance",
     shown(r.moon) && r.moon.infiniteDistance && Vector3.Distance(r.moon.position.clone().normalize(), to) < 1e-9);
  r.sky.setHorizonDrop(DROP);
  ck("  ...and back to the overview it is gone again", !shown(r.moon));
  r.sky.setHorizonDrop(0);
  r.sky.update(moment(toward(deg(-20), deg(270)), look(toward(deg(-5), deg(20)))));
  ck("  ...set below the real horizon, it is not drawn", !shown(r.moon));
  r.sky.update(moment(toward(deg(40), deg(90)), look(to), 0));
  ck("  ...and by day (the real clock) it is not drawn either", !shown(r.moon));
  ck("  ...it fades as it sets, not blinking out", b.placeMoon(toward(deg(1), deg(0)), 1, false)?.alpha > 0
     && b.placeMoon(toward(deg(1), deg(0)), 1, false).alpha < 1 && b.placeMoon(toward(deg(10), deg(0)), 1, false).alpha === 1);
}

// ── 3. SETTINGS' DAY PREVIEW NEVER MOVES A BODY (owner's screenshots,
// 2026-10-17): the preview lights the villa; the moon follows the real clock.
const VILLA_AT = { latitude: -8.6, longitude: 115.2, northOffsetDeg: 0 };
const NIGHT_0246 = new Date("2026-10-16T18:46:00Z"), DAY_1400 = new Date("2026-10-16T06:00:00Z");
{
  for (const preview of ["day", "auto"]) {
    const m = skyMoment(NIGHT_0246, VILLA_AT, preview), p = b.placeMoon(m.moon.dir, m.moonT, false);
    ck(`02:46 with the "${preview}" preview, walking: the moon is where it really is`,
       (m.moon.dir.y > 0 ? p?.alpha > 0.01 : p === null) && m.moonT === 1, { y: m.moon.dir.y, alpha: p?.alpha });
  }
  const day = skyMoment(NIGHT_0246, VILLA_AT, "day");
  ck("  ...while the preview lights the villa as day and colours the sky by a sun above the horizon",
     day.light.isDay && day.light.nightT === 0 && day.skySun.y > 0 && day.realAltitude < 0 && day.moonT === 1);
  const night = skyMoment(DAY_1400, VILLA_AT, "night");
  ck("14:00 with the \"night\" preview: the villa is lit for night, and the moon (real clock: day) is not drawn",
     !night.light.isDay && night.light.nightT === 1 && night.moonT === 0 && !(b.placeMoon(night.moon.dir, night.moonT, false)?.alpha > 0));

  // The moon's compass is the sun's (owner's report, 2026-10-17: it was drawn
  // on the opposite side of the sky). Measured: on 2026-10-10 the two were 3.7°
  // apart in the real sky, and must still be so in the model's axes.
  const tm = skyMoment(new Date("2026-10-10T09:14:00Z"), VILLA_AT);
  const angle = Math.acos(Math.max(-1, Math.min(1, new Vector3(tm.skySun.x, tm.skySun.y, tm.skySun.z).normalize()
    .dot(new Vector3(tm.moon.dir.x, tm.moon.dir.y, tm.moon.dir.z).normalize())))) * 180 / Math.PI;
  ck("the moon's compass is the sun's: a sun and moon 3.7° apart in the real sky are 3.7° apart here (2.496.401 had them opposite)",
     Math.abs(angle - 3.7) < 1, angle);

  // "SET NORTH" ON ANY VILLA (2026-10-17): facing a model's real north and
  // pressing Set North puts the sun on its true compass side at every hour.
  const heading = (v) => ((Math.atan2(v.x, v.z) * 180) / Math.PI + 360) % 360;
  const off = [];
  for (const hN of [0, 37, 90, 180, 200, 271, 315, 359.6]) for (const t of ["2026-10-16T22:30:00Z", "2026-10-17T04:00:00Z", "2026-10-17T09:30:00Z"]) {
    const d = new Date(t), m = skyMoment(d, { ...VILLA_AT, northOffsetDeg: northOffsetFacing(hN) });
    const bearing = (getSunPosition(d, VILLA_AT.latitude, VILLA_AT.longitude).azimuth * 180) / Math.PI + 180;
    const err = Math.abs((((heading(m.skySun) - (hN + bearing)) % 360) + 540) % 360 - 180);
    if (err > 0.6) off.push({ hN, t, err: +err.toFixed(1) });
  }
  ck("Set North, facing a model's real north whichever way it points: the sun is on its true side (06:30 east, 17:30 west)", off.length === 0, off.slice(0, 3));

  // End to end: SunController hands the moment to the real sky.
  const { SunController } = await import("@/babylon/SunController");
  const { HemisphericLight } = await import("@babylonjs/core/Lights/hemisphericLight.js");
  const noop = new Proxy({}, { get: () => () => {} });
  const r = rig();
  const sc = new SunController(r.scene, new HemisphericLight("h", new Vector3(0, 1, 0), r.scene), { ...VILLA_AT, render: { dayNightPreview: "day" } }, r.sky, noop, noop);
  sc.applyRealSun(NIGHT_0246);
  r.scene.render();
  const before = shown(r.moon);
  r.sky.setHorizonDrop(0);
  const m = skyMoment(NIGHT_0246, VILLA_AT, "day");
  ck("  ...and the real SunController draws exactly that: no moon in the overview, the real one walking",
     !before && shown(r.moon) === (m.moon.dir.y > 0), { before, walking: shown(r.moon), y: m.moon.dir.y });
}

// ── 4. NO SUN IN THE OVERVIEW FROM THE SKY MATERIAL EITHER (owner, 2026-10-05
// and 2026-10-20): it paints its own disc and glow at the TRUE direction;
// loading SkyDome must gate both on the overview's drop — and a Babylon upgrade
// that rewrites those lines must fail here, not ship a sun over the villa.
{
  const { ShaderStore } = await import("@babylonjs/core/Engines/shaderStore.js");
  const { SKY_SUN_GATED } = await import("@/babylon/skyShader");
  const frag = ShaderStore.ShadersStore.skyPixelShader ?? "";
  ck("the sky's own sun disc and glow are off while the overview drops the horizon",
     SKY_SUN_GATED && frag.includes("sundisk*(cameraOffset.y>0.0?0.0:1.0)") && frag.includes("hgPhase(cosTheta,cameraOffset.y>0.0?0.0:mieDirectionalG)")
     && !frag.includes("L0+=(sunE*19000.0*Fex)*sundisk;"));
  ck("  ...walking (no drop) keeps them: the gate is the drop and nothing else", (frag.match(/cameraOffset\.y>0\.0\?0\.0:/g) ?? []).length === 2);
}

done("✅ sun and moon: none drawn in the overview; walking, the true sky");
