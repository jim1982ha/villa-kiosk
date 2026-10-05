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

done();
