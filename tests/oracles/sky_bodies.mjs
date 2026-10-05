// The REAL SkyDome and NightSky on Babylon's NullEngine (2.496.297): the sun
// and the moon are placed by one owner, against one horizon drop.
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

// An overview pose: facing north-ish, 40° down. The body sits ahead of it.
Object.assign(sky.camera, { pitch: (40 * Math.PI) / 180, camAz: 0, halfFov: 0.4, hHalf: 0.7 });
const alt = (30 * Math.PI) / 180, az = (20 * Math.PI) / 180;
const dir = new Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt));
const unit = (m) => m.position.clone().normalize();
const near = (a, b) => Vector3.Distance(a, b) < 1e-6;

sky.setHorizonDrop(200);
night.update({ dir, fraction: 0.6, angle: -1, parallacticAngle: 0, nightT: 1 });
sky.update(dir.scale(-1), true);   // a sun in the same place, for the same-rule check
ck("overview: the moon is drawn, lifted off its true direction", moon.isEnabled() && !near(unit(moon), dir));
ck("overview: sun and moon in the same direction are drawn in the same place (one rule)",
   sun.isEnabled() && near(unit(moon), unit(sun)));

sky.setHorizonDrop(0);             // to the walk-through — NO sky-clock tick, NO camera frame
ck("walk-through: the moon moves to its TRUE direction at once, without waiting for the sky clock",
   moon.isEnabled() && near(unit(moon), dir));
ck("  ...and the sun billboard is off (the sky material draws the real one)", !sun.isEnabled());

sky.setHorizonDrop(200);           // and back
ck("back to the overview: the moon is lifted again at once", !near(unit(moon), dir) && near(unit(moon), unit(sun)));

// ── A PAN (owner, 2026-10-05, arrow keys): the villa slid across the screen
// and the sun stayed put, because the spot was round the ORBIT POINT and a pan
// carries that with the camera. Pan the real orbit camera — no turn, no tilt —
// and the disc must stay over its spot round the VILLA.
{
  const { ArcRotateCamera } = await import("@babylonjs/core/Cameras/arcRotateCamera.js");
  const f = await import("@/babylon/skyFraming");
  const s2 = new Scene(new NullEngine());
  const cam = new ArcRotateCamera("ov", -Math.PI / 2, 0.9, 60, new Vector3(0, 1, 0), s2);
  s2.activeCamera = cam;
  const sky2 = new SkyDome(s2);
  sky2.setHorizonDrop(200);
  const V = new Vector3(0, 1, 0);            // the villa's centre (the fit target)
  sky2.setVillaCentre(V);
  // A low sun to the right of the view, so its disc stays in the plain (un-eased) part of the frame.
  const alt2 = (5 * Math.PI) / 180, az2 = (70 * Math.PI) / 180;
  const sunTo = new Vector3(Math.sin(az2) * Math.cos(alt2), Math.sin(alt2), Math.cos(az2) * Math.cos(alt2));
  sky2.update(sunTo.scale(-1), true);
  const where = () => {
    s2.render();
    const r = sky2.sunReport();
    const p = cam.globalPosition, D = Vector3.Distance(p, cam.target);
    const spot = V.add(new Vector3(Math.sin(az2), 0, Math.cos(az2)).scale(f.DOME_SCALE * D)).subtract(p).normalize();
    const g = f.projectToFrame(spot.x, spot.y, spot.z, sky2.camera);
    const up = f.LIFT_LOW + (f.LIFT_HIGH - f.LIFT_LOW) * (5 / 90);
    return { r, err: Math.hypot(r.frameX - g.frameX, r.frameY - (g.frameY - up / 2)) };
  };
  const before = where();
  cam.target.x += 8; cam.target.z -= 5;      // a pan: heading and tilt untouched
  const after = where();
  ck("panning the real camera re-places the disc (a pan moves neither heading nor tilt)",
     before.r.frameX !== null && after.r.frameX !== null
     && Math.hypot(after.r.frameX - before.r.frameX, after.r.frameY - before.r.frameY) > 0.01, { before: before.r, after: after.r });
  ck("  ...onto its spot round the VILLA, before and after the pan", before.err < 1e-6 && after.err < 1e-6, { before: before.err, after: after.err, b: before.r, a: after.r, cam: sky2.camera });
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
