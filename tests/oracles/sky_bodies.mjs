// The sun and the moon in the overview (babylon/skyBodies.ts, skyArc.ts),
// through the REAL SkyDome and NightSky and Babylon's own orbit camera on
// NullEngine.
//
// The owner's rules (2026-10-16):
//   · the sun follows its real path as an ARC ROUND THE VILLA: facing north it
//     rises on the right, climbs one step per hour, passes over the top at noon
//     and sets on the left — no jump between 12:00 and 13:00, even where the
//     real sun goes nearly overhead and its compass side flips;
//   · looking down at the villa facing north, the sun goes round the house and
//     never crosses it (the arc's size reference);
//   · the camera never moves the body's point; when the point is off screen the
//     body waits at the screen edge on its side (almost flat, the midday sun
//     runs along the top edge — "I like that");
//   · hidden only when really behind the viewer;
//   · the moon follows the same rule and MOVES through the night, down to the
//     horizon (it once sat still, pinned to a limit);
//   · zoomed in, the sun never washes over the villa (owner's recording on
//     2.496.391): never bigger than at the usual zoom, always drawn beyond
//     the villa so the house hides it.
// 2.496.390 drew a fixed sky direction per hour: facing north the sun jumped
// from the right of the villa to the left at noon. The path check fails it.
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
// A made-up villa: long side along x (east–west), as a box.
const MIN = new Vector3(-20, 0, -12), MAX = new Vector3(20, 6, 12);
const SPAN = 40;
const NORTH = -Math.PI / 2;   // ArcRotate alpha that puts the camera south of the villa, facing north (+z)

function rig() {
  const scene = new Scene(new NullEngine({ renderWidth: 1376, renderHeight: 640, textureSize: 256, deterministicLockstep: false, lockstepMaxSteps: 1 }));
  const cam = new ArcRotateCamera("ov", NORTH, 1.0, 1.9 * SPAN, new Vector3(0, 1, 0), scene);
  cam.fov = 0.8;
  scene.activeCamera = cam;
  const sky = new SkyDome(scene);
  const night = new NightSky(scene);
  sky.setMoon(night);
  sky.setHorizonDrop(DROP);
  sky.setVilla(MIN, MAX);
  return { scene, cam, sky, night, sun: scene.getMeshByName("sunDisc"), moon: scene.getMeshByName("moon") };
}
function pose(r, alphaDeg, beta, radius = 1.9 * SPAN) {
  r.cam.alpha = deg(alphaDeg); r.cam.beta = beta; r.cam.radius = radius;
  r.cam.target = new Vector3(0, 1, 0);
  r.cam.alpha = deg(alphaDeg); r.cam.beta = beta;   // the target setter rebuilds the angles
  r.scene.render();
}
function screen(r, w) {
  const eng = r.scene.getEngine();
  const vp = r.cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
  const s = Vector3.Project(w, Matrix.Identity(), r.cam.getViewMatrix().multiply(r.cam.getProjectionMatrix()), vp);
  return { x: s.x / vp.width, y: s.y / vp.height, z: s.z };
}
const shown = (m) => m.isEnabled() && m.material.alpha > 0.01;
const sunAt = (r, alt, az) => { r.sky.update(toward(deg(alt), deg(az)).scale(-1), alt > 0); r.scene.render(); };
const moonAt = (r, alt, az) => {
  r.night.update({ dir: toward(deg(alt), deg(az)), fraction: 0.3, angle: -1, parallacticAngle: 0, nightT: 1 });
  r.scene.render();
};
// Today's real path at a latitude where the sun goes nearly overhead: 15° an
// hour, due east in the morning, west in the afternoon.
const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const path = (h) => ({ alt: h === 12 ? 89 : Math.max(0.5, 90 - Math.abs(h - 12) * 15), az: h <= 12 ? 94 : 269 });
const box = b.villaBox(MIN, MAX);

// ── 1. THE PATH, FACING NORTH: AN ARC, NO JUMP AT NOON ──────────────────────
for (const [name, beta] of [["almost flat", 1.35], ["looking down", 0.25]]) {
  const r = rig();
  pose(r, -90, beta);
  const pts = [];
  for (const h of HOURS) { const p = path(h); sunAt(r, p.alt, p.az); pts.push({ h, shown: shown(r.sun), ...screen(r, r.sun.position) }); }
  const hidden = pts.filter((p) => !p.shown).map((p) => p.h);
  let leftward = true, worstStep = 0;
  for (let i = 1; i < pts.length; i++) {
    if (!(pts[i].x < pts[i - 1].x + 1e-6)) leftward = false;
    worstStep = Math.max(worstStep, Math.abs(pts[i].x - pts[i - 1].x));
  }
  ck(`facing north, ${name}: the sun is seen at every hour 06:00–18:00`, hidden.length === 0, hidden);
  // Almost flat the arc is seen side on: left every hour. Looking down it is
  // seen from above, its rising end bulging outward: mornings on the right,
  // afternoons on the left, noon in the middle.
  const sides = pts.every((p) => (p.h < 12 ? p.x > 0.55 : p.h > 12 ? p.x < 0.45 : Math.abs(p.x - 0.5) < 0.17));
  ck(`  ...rising on the right, over the middle at noon, setting on the left`, sides && (name !== "almost flat" || leftward),
     pts.map((p) => `${p.h}h:${p.x.toFixed(2)}`).join(" "));
  ck(`  ...with no jump: no hour moves it more than a fifth of the screen (12:00→13:00 included)`, worstStep < 0.2, worstStep);
  const noon = pts.find((p) => p.h === 12);
  ck(`  ...and highest at noon`, pts.every((p) => noon.y <= p.y + 1e-6), pts.map((p) => `${p.h}h:${p.y.toFixed(2)}`).join(" "));
  if (name === "looking down") {
    // The arc's size reference: the sun never crosses the villa.
    const corners = [];
    for (const x of [MIN.x, MAX.x]) for (const y of [MIN.y, MAX.y]) for (const z of [MIN.z, MAX.z]) corners.push(screen(r, new Vector3(x, y, z)));
    const bx = { x0: Math.min(...corners.map((c) => c.x)), x1: Math.max(...corners.map((c) => c.x)), y0: Math.min(...corners.map((c) => c.y)), y1: Math.max(...corners.map((c) => c.y)) };
    const over = pts.filter((p) => p.x > bx.x0 && p.x < bx.x1 && p.y > bx.y0 && p.y < bx.y1).map((p) => p.h);
    ck(`  ...and looking down it goes ROUND the villa, never over it`, over.length === 0, { over, bx });
  } else {
    const top = pts.filter((p) => Math.abs(p.y - b.EDGE_MARGIN) < 1e-3).map((p) => p.h);
    ck(`  ...almost flat, the midday sun waits along the top edge in a straight line`, top.includes(12) && top.length >= 3, top);
  }
}

// ── 2. THE CAMERA NEVER MOVES THE POINT; OFF SCREEN IT WAITS AT THE EDGE ────
{
  const r = rig();
  const sunTo = toward(deg(35), deg(100)), moonTo = toward(deg(50), deg(230));
  r.sky.update(sunTo.scale(-1), true);
  r.night.update({ dir: moonTo, fraction: 0.6, angle: -1, parallacticAngle: 0, nightT: 1 });
  const want = { sun: b.arcPoint(sunTo.x, sunTo.y, sunTo.z, box), moon: b.arcPoint(moonTo.x, moonTo.y, moonTo.z, box) };
  let poses = 0, shownN = 0, onScreen = 0, held = 0;
  const moved = [], outside = [], behind = [], tooBig = [], inFront = [];
  for (let a = 0; a < 360; a += 15) for (let beta = BETA_MIN; beta <= BETA_MAX + 1e-9; beta += (BETA_MAX - BETA_MIN) / 6)
    for (const radius of [0.6 * SPAN, 1.9 * SPAN, 4 * SPAN]) {
      pose(r, a, beta, radius);
      poses++;
      for (const [name, mesh] of [["sun", r.sun], ["moon", r.moon]]) {
        const w = want[name], P = new Vector3(w.at.x, w.at.y, w.at.z);
        const fwd = r.cam.getDirection(new Vector3(0, 0, 1));
        const fade = b.behindFade(w.side, w.alt, fwd);
        const pz = screen(r, P).z;
        // A point behind the camera (a close camera under a high body) is out
        // of view, not "behind the viewer": nothing to show or to hold.
        if (!shown(mesh)) { if (fade > 0.05 && pz > 0 && pz < 1) behind.push({ name, a, beta, radius, why: "hidden while not behind" }); continue; }
        shownN++;
        if (fade < 0.01) behind.push({ name, a, beta, radius, why: "shown while behind" });
        const s = screen(r, mesh.position), p = screen(r, P);
        const m = b.EDGE_MARGIN - 1e-3;
        if (s.x < m || s.x > 1 - m || s.y < m || s.y > 1 - m) outside.push({ name, a, beta, radius, s });
        const inside = p.z > 0 && p.z < 1 && p.x >= b.EDGE_MARGIN && p.x <= 1 - b.EDGE_MARGIN && p.y >= b.EDGE_MARGIN && p.y <= 1 - b.EDGE_MARGIN;
        if (inside) { onScreen++; if (Math.hypot(s.x - p.x, s.y - p.y) > 1e-6) moved.push({ name, a, beta, radius }); }
        else held++;
        // Never bigger than at the usual zoom; never nearer than just beyond the villa.
        const eye = r.cam.globalPosition, dist = Vector3.Distance(eye, mesh.position);
        const plane = name === "sun" ? 46 : 11, spans = name === "sun" ? b.SUN_SPANS : b.MOON_SPANS;
        if ((mesh.scaling.x * plane) / dist > spans / b.NEAREST_SPANS + 1e-9) tooBig.push({ name, a, beta, radius });
        if (dist < Vector3.Distance(eye, new Vector3(box.cx, box.ground, box.cz)) + box.span - 1e-6) inFront.push({ name, a, beta, radius });
      }
    }
  ck(`orbit, tilt, zoom (${poses} poses): wherever its point is on screen, the body shows exactly there (${onScreen} times)`,
     moved.length === 0 && onScreen > 100, moved.slice(0, 3));
  ck(`  ...and when its point is off screen it waits inside the screen's edge (${held} times), never off it`,
     outside.length === 0 && held > 20, outside.slice(0, 3));
  ck("  ...hidden exactly when it is really behind the viewer", behind.length === 0 && shownN < poses * 2, behind.slice(0, 3));
  ck("  ...zoomed in, never bigger than at the usual zoom (it washed over the villa, 2.496.391)", tooBig.length === 0, tooBig.slice(0, 3));
  ck("  ...and always drawn beyond the villa, so the house hides it where they meet", inFront.length === 0, inFront.slice(0, 3));
}

// ── 2b. ZOOMED RIGHT IN UNDER A HIGH SUN: it waits at the screen edge on
// its side (its point is above and behind the eye), never vanishes.
{
  const r = rig();
  pose(r, -90, 0.6, 0.25 * SPAN);
  sunAt(r, 70, 100);   // high, east: to the right of a camera facing north
  const s = screen(r, r.sun.position);
  ck("zoomed right in under a high sun: still shown, waiting at the screen edge on its side",
     shown(r.sun) && s.x > 0.5 && (Math.abs(s.x - (1 - b.EDGE_MARGIN)) < 1e-3 || Math.abs(s.y - b.EDGE_MARGIN) < 1e-3), s);
  pose(r, 0, 0.8, 0.9 * SPAN);   // camera on the east side facing west, zoomed in; the morning sun behind it
  sunAt(r, 44, 93);
  const behindLow = shown(r.sun) ? screen(r, r.sun.position) : null;
  ck("  ...but never waiting along the bottom, over the ground in front of the house",
     behindLow === null || behindLow.y < 0.5, behindLow);
}

// ── 3. THE MOON MOVES THROUGH THE NIGHT, DOWN TO THE HORIZON ────────────────
for (const [name, beta] of [["almost flat", 1.35], ["looking down", 0.25]]) {
  const r = rig();
  pose(r, -90, beta);
  const night = [[52, 223], [39, 230], [27, 235], [14, 239], [1, 243]].map(([alt, az]) => {
    moonAt(r, alt, az);
    return { alt, shown: shown(r.moon), ...screen(r, r.moon.position) };
  });
  let still = 0, travel = 0, sinks = true;
  for (let i = 1; i < night.length; i++) {
    const step = Math.hypot(night[i].x - night[i - 1].x, night[i].y - night[i - 1].y);
    travel += step;
    if (step < 0.015) still++;
    if (night[i].y < night[i - 1].y - 1e-6) sinks = false;
  }
  ck(`the moon, facing north ${name}: seen every hour of the evening and MOVING every hour`,
     night.every((p) => p.shown) && still === 0 && travel > 0.1, night.map((p) => `${p.alt}°:${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "));
  if (name === "almost flat") ck("  ...going down toward the horizon as it sets", sinks);
}

// ── 4. WALKING: THE TRUE SKY ───────────────────────────────────────────────
{
  const r = rig();
  const to = toward(deg(30), deg(20));
  r.night.update({ dir: to, fraction: 0.6, angle: -1, parallacticAngle: 0, nightT: 1 });
  r.sky.update(to.scale(-1), true);
  r.scene.render();
  r.sky.setHorizonDrop(0);   // to the walk-through — no sky-clock tick
  ck("walk-through: the moon moves to its TRUE direction at once, at sky distance",
     shown(r.moon) && r.moon.infiniteDistance && Vector3.Distance(r.moon.position.clone().normalize(), to) < 1e-9);
  ck("  ...and the sun billboard and its glow are off (the sky material draws the real one)",
     !r.sun.isEnabled() && !r.scene.getMeshByName("sunGlow").isEnabled());
  r.sky.setHorizonDrop(DROP);
  pose(r, -90, 1.35, 6 * SPAN);   // far enough that its point is on screen
  const back = screen(r, r.moon.position), want = screen(r, new Vector3(...Object.values(b.arcPoint(to.x, to.y, to.z, box).at)));
  ck("back to the overview: the moon is back on the arc round the villa", !r.moon.infiniteDistance
     && Math.hypot(back.x - want.x, back.y - want.y) < 1e-6);
  r.sky.update(toward(deg(-5), deg(270)).scale(-1), false);
  ck("  ...and once the sun has set it is gone, glow and all", !r.sun.isEnabled() && !r.scene.getMeshByName("sunGlow").isEnabled());
}

// ── 5. THE SKY DEBUG LINE NEVER THROWS (2.496.306: the whole app down when
// the evening sun was behind the opening view).
{
  const r = rig();
  pose(r, 90, 1.3);                                          // camera north of the villa, facing south
  r.sky.update(toward(deg(10), deg(0)).scale(-1), true);     // a low sun straight behind
  r.scene.render();
  let report;
  try { report = r.sky.sunReport(); } catch (e) { report = e; }
  ck("a sun behind the view: the sky report says so instead of throwing", typeof report === "string" && report.includes("hidden"), String(report));
  pose(r, -90, 1.0);
  ck("  ...and facing it, the report gives its place on screen", String(r.sky.sunReport()).includes("frame="), r.sky.sunReport());
}

// ── 6. ONE sun in the overview (owner, 2026-10-05): the sky material paints
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

done("✅ sun and moon: an arc round the villa, no jump at noon, round the house looking down, the moon moving, held on screen");
