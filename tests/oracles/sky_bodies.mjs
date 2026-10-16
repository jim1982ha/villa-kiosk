// The sun and the moon in the overview (babylon/skyBodies.ts), through the
// REAL SkyDome and NightSky and Babylon's own orbit camera on NullEngine.
//
// The owner's rules (2026-10-16, after a recording where the sun went round
// the villa as the camera turned):
//   · the camera never moves a body — orbit, tilt, zoom, pan, a full turn and
//     back: the same direction in the sky, every frame;
//   · that direction is the hour's: the true azimuth (east stays east), higher
//     in the sky as the true sun climbs, and it moves when the time changes;
//   · never in front of the villa: whenever a body is shown, it is on screen
//     ABOVE the point the camera looks at, and drawn at sky distance so the
//     villa hides it where they meet;
//   · out of view or behind the viewer it is simply not seen — never pulled in.
// 2.496.290–389 placed the body by the camera's heading; the first check is
// the one that version fails.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
// The discs are painted procedurally; placement needs no pixels.
globalThis.OffscreenCanvas ??= class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return new Proxy({}, { get: () => () => ({ addColorStop() {} }) }); }
};
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { ArcRotateCamera } = await import("@babylonjs/core/Cameras/arcRotateCamera.js");
const { Matrix, Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { SkyDome } = await import("@/babylon/SkyDome");
const { NightSky } = await import("@/babylon/NightSky");
const { BETA_MIN, BETA_MAX } = await import("@/babylon/overviewPose");
const b = await import("@/babylon/skyBodies");

const DROP = 700;   // SceneManager's OVERVIEW_HORIZON_DROP
const deg = (d) => (d * Math.PI) / 180;
const toward = (alt, az) => new Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt));

function rig() {
  const scene = new Scene(new NullEngine());
  const cam = new ArcRotateCamera("ov", -Math.PI / 2, 1.0, 60, new Vector3(0, 1, 0), scene);
  cam.fov = 0.8;
  scene.activeCamera = cam;
  const sky = new SkyDome(scene);
  const night = new NightSky(scene);
  sky.setMoon(night);
  sky.setHorizonDrop(DROP);
  return { scene, cam, sky, night, sun: scene.getMeshByName("sunDisc"), moon: scene.getMeshByName("moon") };
}
const unit = (m) => m.position.clone().normalize();

// ── 1. THE CAMERA NEVER MOVES A BODY ───────────────────────────────────────
{
  const r = rig();
  const sunTo = toward(deg(25), deg(100)), moonTo = toward(deg(50), deg(230));
  r.sky.update(sunTo.scale(-1), true);
  r.night.update({ dir: moonTo, fraction: 0.6, angle: -1, parallacticAngle: 0, nightT: 1 });
  r.scene.render();
  const sun0 = unit(r.sun), moon0 = unit(r.moon);
  let poses = 0, shown = 0;
  const moved = [], inFront = [], wrongDepth = [];
  const eng = r.scene.getEngine();
  const W = eng.getRenderWidth(), H = eng.getRenderHeight();
  const screenY = (w) => Vector3.Project(w, Matrix.Identity(), r.scene.getTransformMatrix(), r.cam.viewport.toGlobal(W, H)).y;
  for (let a = 0; a <= 360; a += 7.5) for (let beta = BETA_MIN; beta <= BETA_MAX + 1e-9; beta += (BETA_MAX - BETA_MIN) / 9)
    for (const radius of [8, 60, 160]) for (const [px, pz] of [[0, 0], [18, -10]]) {
      r.cam.alpha = deg(a); r.cam.beta = beta; r.cam.radius = radius;
      r.cam.target = new Vector3(px, 1, pz);
      r.scene.render();
      poses++;
      for (const [name, mesh, d0] of [["sun", r.sun, sun0], ["moon", r.moon, moon0]]) {
        if (Vector3.Distance(unit(mesh), d0) > 1e-9) moved.push({ name, a, beta, radius, px });
        if (!mesh.isEnabled() || !(mesh.material.alpha > 0.01)) continue;
        shown++;
        // On screen: above the point looked at (the villa), never under or in front of it.
        const at = r.cam.globalPosition.add(mesh.position);
        if (!(screenY(at) < screenY(r.cam.target))) inFront.push({ name, a, beta, radius, y: screenY(at), target: screenY(r.cam.target) });
        // Drawn at sky distance, further away than the point looked at.
        if (!(mesh.position.length() > Vector3.Distance(r.cam.globalPosition, r.cam.target))) wrongDepth.push({ name, radius });
      }
    }
  ck(`orbit, tilt, zoom, pan, a full turn (${poses} poses): the sun and the moon keep ONE direction in the sky`, moved.length === 0, moved.slice(0, 3));
  ck(`  ...shown in ${shown} body-poses, always ABOVE the point the camera looks at — never under or in front of the villa`,
     inFront.length === 0 && shown > 100, inFront.slice(0, 3));
  ck("  ...and further away than the villa, so the villa hides it where they meet", wrongDepth.length === 0, wrongDepth.slice(0, 3));
  ck("  ...and hidden in some poses (behind the viewer, or it would sit under the villa) rather than pulled into view",
     shown < poses * 2);
  // Back to where we started: the same picture.
  r.cam.alpha = deg(0); r.cam.beta = 1.0; r.cam.radius = 60; r.cam.target = new Vector3(0, 1, 0);
  r.scene.render();
  const a1 = r.sun.material.alpha;
  r.cam.alpha = deg(200); r.scene.render();
  r.cam.alpha = deg(0); r.scene.render();
  ck("  ...and turning away and back gives the same sun, as bright", Vector3.Distance(unit(r.sun), sun0) < 1e-9 && Math.abs(r.sun.material.alpha - a1) < 1e-9);
}

// ── 2. THE DIRECTION IS THE HOUR'S ─────────────────────────────────────────
{
  const r = rig();
  const az = (v) => Math.atan2(v.x, v.z);
  const alt = (v) => Math.atan2(v.y, Math.hypot(v.x, v.z));
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  let worstAz = 0, rises = true, prev = -Infinity, prevSun = null, moves = true;
  for (let h = 4; h <= 88; h += 4) {
    const trueAz = deg(60 + h * 2);
    r.sky.update(toward(deg(h), trueAz).scale(-1), true);
    const d = r.sun.position.clone().normalize();
    worstAz = Math.max(worstAz, Math.abs(wrap(az(d) - trueAz)));
    if (!(alt(d) > prev)) rises = false;
    prev = alt(d);
    if (prevSun && Vector3.Distance(prevSun, d) < 1e-6) moves = false;
    prevSun = d;
  }
  ck("the drawn sun is on its TRUE compass side (east stays east), every hour", worstAz < 1e-9, worstAz);
  ck("  ...higher in the sky as the true sun climbs, and it moves when the time changes", rises && moves);
  const lift = b.liftFor(DROP);
  ck("  ...in the overview: horizon to zenith squeezed into the band above the villa",
     b.drawnAltitude(0, lift) === b.OVERVIEW_HORIZON && b.drawnAltitude(Math.PI / 2, lift) === b.OVERVIEW_ZENITH);
  r.sky.update(toward(deg(-5), deg(270)).scale(-1), false);
  ck("  ...and once it has set it is gone", !r.sun.isEnabled());
}

// ── 3. WALKING: THE TRUE SKY ───────────────────────────────────────────────
{
  const r = rig();
  const to = toward(deg(30), deg(20));
  r.night.update({ dir: to, fraction: 0.6, angle: -1, parallacticAngle: 0, nightT: 1 });
  r.sky.update(to.scale(-1), true);
  r.scene.render();
  r.sky.setHorizonDrop(0);   // to the walk-through — no sky-clock tick, no camera frame
  ck("walk-through: the moon moves to its TRUE direction at once", r.moon.isEnabled() && Vector3.Distance(unit(r.moon), to) < 1e-9);
  ck("  ...and the sun billboard is off (the sky material draws the real one)", !r.sun.isEnabled());
  r.sky.setHorizonDrop(DROP);
  r.scene.render();
  ck("back to the overview: sun and moon in the same direction are drawn in the same place (one rule)",
     Vector3.Distance(unit(r.moon), unit(r.sun)) < 1e-9 && Vector3.Distance(unit(r.moon), to) > 0.1);
}

// ── 4. THE SKY DEBUG LINE NEVER THROWS (2.496.306: the whole app down when
// the evening sun was behind the opening view).
{
  const r = rig();
  r.cam.alpha = -Math.PI / 2; r.cam.beta = 1.3;              // looks along +z
  r.sky.update(toward(deg(10), deg(180)).scale(-1), true);   // a low sun straight behind
  r.scene.render();
  let report;
  try { report = r.sky.sunReport(); } catch (e) { report = e; }
  ck("a sun behind the view: the sky report says so instead of throwing", typeof report === "string", String(report));
  r.cam.alpha = Math.PI / 2; r.cam.beta = 0.5; r.scene.render();   // now facing it, looking down
  ck("  ...and facing it, the report gives its place on screen", String(r.sky.sunReport()).includes("frame="), r.sky.sunReport());
}

// ── 5. ONE sun in the overview (owner, 2026-10-05): the sky material paints
// its own disc and glow at the TRUE direction; loading SkyDome must gate both
// on the overview's drop — and a Babylon upgrade that rewrites those lines
// must fail here, not ship a second sun.
{
  const { ShaderStore } = await import("@babylonjs/core/Engines/shaderStore.js");
  const { SKY_SUN_GATED } = await import("@/babylon/skyShader");
  const frag = ShaderStore.ShadersStore.skyPixelShader ?? "";
  ck("the sky's own sun disc and glow are off while the overview drops the horizon (the billboard is the sun)",
     SKY_SUN_GATED && frag.includes("sundisk*(cameraOffset.y>0.0?0.0:1.0)") && frag.includes("hgPhase(cosTheta,cameraOffset.y>0.0?0.0:mieDirectionalG)")
     && !frag.includes("L0+=(sunE*19000.0*Fex)*sundisk;"));
  ck("  ...walking (no drop) keeps them: the gate is the drop and nothing else", (frag.match(/cameraOffset\.y>0\.0\?0\.0:/g) ?? []).length === 2);
}

done("✅ sun and moon: one sky direction per hour, never moved by the camera, never in front of the villa");
