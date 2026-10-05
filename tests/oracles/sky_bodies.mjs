// The REAL SkyDome and NightSky on Babylon's NullEngine (2.496.297): the sun
// and the moon are placed by one owner, against one horizon drop — and, since
// 2.496.304, drawn on exactly the pixel skyFraming places them at, round the
// villa's outline, through Babylon's OWN camera and every camera motion.
//
// The drop used to be handed to each body separately, and only the sun was
// re-placed when it changed. Walking has no drop, so the camera tracker stops
// early, and the moon stayed where the overview had put it until the next
// sky-clock tick. sky_framing.mjs pins WHERE a body goes; this pins that the
// moon is actually MOVED there, and by the rule the sun is.
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
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { SkyDome } = await import("@/babylon/SkyDome");
const { NightSky } = await import("@/babylon/NightSky");

const scene = new Scene(new NullEngine());
const sky = new SkyDome(scene);
const night = new NightSky(scene, sky.camera);
sky.setMoon(night);
const moon = scene.getMeshByName("moon");
const sun = scene.getMeshByName("sunDisc");

// An overview pose: facing north-ish, 40° down, standing south of a villa
// whose sun-path diagram is set. The body sits ahead of it.
const f0 = await import("@/babylon/skyFraming");
Object.assign(sky.camera, { pitch: (40 * Math.PI) / 180, camAz: 0, halfFov: 0.4, hHalf: 0.7,
  eye: { x: 0, y: 40, z: -50 }, villa: f0.boxCorners({ x: -10, y: 0, z: -6 }, { x: 10, y: 6, z: 6 }) });
const alt = (30 * Math.PI) / 180, az = (20 * Math.PI) / 180;
const dir = new Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt));
const unit = (m) => m.position.clone().normalize();
const near = (a, b) => Vector3.Distance(a, b) < 1e-6;

sky.setHorizonDrop(200);
night.update({ dir, fraction: 0.6, angle: -1, parallacticAngle: 0, nightT: 1 });
sky.update(dir.scale(-1), true);   // a sun in the same place, for the same-rule check
ck("overview: the moon is drawn round the villa, not along its true direction", moon.isEnabled() && !near(unit(moon), dir));
ck("overview: sun and moon in the same direction are drawn in the same place (one rule)",
   sun.isEnabled() && near(unit(moon), unit(sun)));

sky.setHorizonDrop(0);             // to the walk-through — NO sky-clock tick, NO camera frame
ck("walk-through: the moon moves to its TRUE direction at once, without waiting for the sky clock",
   moon.isEnabled() && near(unit(moon), dir));
ck("  ...and the sun billboard is off (the sky material draws the real one)", !sun.isEnabled());

sky.setHorizonDrop(200);           // and back
ck("back to the overview: the moon is back round the villa at once", !near(unit(moon), dir) && near(unit(moon), unit(sun)));

// ── EVERY CAMERA MOTION, through Babylon's own projection (2.496.304) ──────
// Drive the REAL orbit camera through each motion and measure, with Babylon's
// projection (not skyFraming's), where the disc lands on screen against where
// skyFraming placed it: the same pixel, always — and gone while behind you.
{
  const { ArcRotateCamera } = await import("@babylonjs/core/Cameras/arcRotateCamera.js");
  const { Matrix } = await import("@babylonjs/core/Maths/math.vector.js");
  const f = await import("@/babylon/skyFraming");
  const s2 = new Scene(new NullEngine());
  const cam = new ArcRotateCamera("ov", -Math.PI / 2, 1.1, 60, new Vector3(0, 1, 0), s2);
  cam.fov = 0.8;
  s2.activeCamera = cam;
  const sky2 = new SkyDome(s2);
  const night2 = new NightSky(s2, sky2.camera);
  sky2.setMoon(night2);
  sky2.setHorizonDrop(200);
  sky2.setVillaOutline(f.boxCorners({ x: -15, y: 0, z: -8 }, { x: 15, y: 7, z: 8 }));
  const alt2 = (25 * Math.PI) / 180, az2 = (30 * Math.PI) / 180;
  const to = new Vector3(Math.sin(az2) * Math.cos(alt2), Math.sin(alt2), Math.cos(az2) * Math.cos(alt2));
  sky2.update(to.scale(-1), true);
  const mdir = new Vector3(-Math.sin(az2) * Math.cos(0.6), Math.sin(0.6), Math.cos(az2) * Math.cos(0.6));
  night2.update({ dir: mdir, fraction: 0.5, angle: -1, parallacticAngle: 0, nightT: 1 });
  const sunMesh = s2.getMeshByName("sunDisc"), moonMesh = s2.getMeshByName("moon");
  const eng = s2.getEngine();
  const px = (w) => {
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    return Vector3.Project(w, Matrix.Identity(), s2.getTransformMatrix(), vp);
  };
  // Where a disc is drawn: the camera's position plus its offset (an
  // infiniteDistance billboard follows the camera).
  const drawnAt = (m) => cam.globalPosition.add(m.position);
  const moves = [
    ["as fitted", () => {}],
    ["orbited", () => { cam.alpha += 0.6; }],
    ["tilted", () => { cam.beta = 0.7; }],
    ["zoomed in", () => { cam.radius = 40; }],
    ["panned", () => { cam.target.x += 6; cam.target.z -= 4; }],
    ["zoomed out and orbited", () => { cam.radius = 90; cam.alpha -= 1.4; }],
    ["tilted low", () => { cam.beta = 1.35; }],
  ];
  const off = [];
  let shown = 0;
  for (const [name, move] of moves) {
    move();
    s2.render();
    for (const [body, mesh, dir] of [["sun", sunMesh, to], ["moon", moonMesh, mdir]]) {
      const want = f.placeBody(dir.x, dir.y, dir.z, f.liftFor(200), sky2.camera);
      if (!mesh.isEnabled() || !want.frame) { if (mesh.isEnabled() !== !!want.dir) off.push({ name, body, enabled: mesh.isEnabled(), want: !!want.dir }); continue; }
      shown++;
      const a = px(drawnAt(mesh)), W = eng.getRenderWidth(), H = eng.getRenderHeight();
      const e = Math.hypot(a.x - want.frame.fx * W, a.y - want.frame.fy * H);
      if (e > 0.5) off.push({ name, body, e, drawn: [a.x, a.y], want: [want.frame.fx * W, want.frame.fy * H] });
    }
  }
  ck(`the sun and the moon land on the pixel skyFraming placed them at, through orbit, tilt, zoom and pan (${shown} measured)`,
     off.length === 0 && shown >= 8, off.slice(0, 3));
  // Turn round until the sun is behind the camera: it is not drawn.
  cam.target = new Vector3(0, 1, 0); cam.beta = 1.0; cam.radius = 60;
  cam.alpha = Math.atan2(Math.cos(az2), Math.sin(az2));   // camera on the sun's side, looking away from it
  s2.render();
  ck("  ...and with the sun behind the camera, it is not drawn (not on the lawn in front of the villa)", !sunMesh.isEnabled(),
     { camAz: sky2.camera.camAz, rel: f.relativeSky(to.x, to.y, to.z, sky2.camera.camAz).rel });
}

// ── OPENING THE APP (2.496.306): before the villa has loaded there is no
// outline, so the sun is drawn along its true direction — and at dusk that can
// be BEHIND the opening view, with no place on screen. 2.496.305's sky debug
// line called .toFixed on that missing place, from a React effect on load:
// the whole app down, on every device, every evening.
{
  const { ArcRotateCamera } = await import("@babylonjs/core/Cameras/arcRotateCamera.js");
  const s3 = new Scene(new NullEngine());
  const cam = new ArcRotateCamera("open", -Math.PI / 2, 1.1, 60, new Vector3(0, 1, 0), s3);
  s3.activeCamera = cam;
  const sky3 = new SkyDome(s3);
  sky3.setHorizonDrop(200);                       // the overview — no villa outline yet
  s3.render();
  // A low sun straight behind the camera (it looks along +z from -z).
  const behind = new Vector3(0, Math.sin(0.1), -Math.cos(0.1));
  sky3.update(behind.scale(-1), true);
  let report;
  try { report = sky3.sunReport(); } catch (e) { report = e; }
  ck("opening, sun behind the view, no villa yet: the sky report says 'behind' instead of throwing",
     typeof report === "string" && report.includes("frame=behind"), String(report));
}

// ── ONE sun in the overview (owner, 2026-10-05, 17:37 screenshot): the sky
// material paints its own disc and glow at the TRUE direction; at a shallow
// tilt that showed beside the billboard. Loading SkyDome must gate both on the
// overview's drop — and a Babylon upgrade that rewrites those lines must fail
// here, not ship a second sun.
{
  const { ShaderStore } = await import("@babylonjs/core/Engines/shaderStore.js");
  const { SKY_SUN_GATED } = await import("@/babylon/skyShader");
  const frag = ShaderStore.ShadersStore.skyPixelShader ?? "";
  ck("the sky's own sun disc and glow are off while the overview drops the horizon (the billboard is the sun)",
     SKY_SUN_GATED && frag.includes("sundisk*(cameraOffset.y>0.0?0.0:1.0)") && frag.includes("hgPhase(cosTheta,cameraOffset.y>0.0?0.0:mieDirectionalG)")
     && !frag.includes("L0+=(sunE*19000.0*Fex)*sundisk;"));
  ck("  ...walking (no drop) keeps them: the gate is the drop and nothing else", (frag.match(/cameraOffset\.y>0\.0\?0\.0:/g) ?? []).length === 2);
}

done();
