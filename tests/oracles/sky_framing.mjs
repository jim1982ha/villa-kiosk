// The overview's sun and moon (babylon/skyFraming.ts), SIMULATED in every
// pose a person can reach (2.496.304).
//
// It is an INDICATOR round the villa as the screen shows it, not a physical
// sun (owner, 2026-10-05). Seven releases each fixed one camera motion and
// the owner's next recording showed another, because each was checked by eye
// in the pose that had been reported. So this drives the placement through the
// app's own overview camera (ArcRotate, fov 0.8, its tilt limits and fit) for
// a villa-like model and a bare box, on four screen shapes, through turning,
// tilting, zooming, panning and the whole day, and asserts the owner's rules:
//   · behind the viewer → not drawn; ahead → drawn (unless the villa fills
//     the screen), and always on screen;
//   · never over the villa, never in front of it, on its true side;
//   · rising on the east side, highest at noon, setting on the west side;
//   · no jump: a step that does not SHRINK when the motion is cut finer is a
//     discontinuity (a large step that does shrink is just fast motion).
// FULL=1 runs the exhaustive grid (~1.7 M poses, a few minutes); the gate runs
// a coarser one.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const f = await import("@/babylon/skyFraming");

const FULL = process.env.FULL === "1";
const deg = (d) => (d * Math.PI) / 180;
// The app's overview camera: ArcRotate round `target`, vertical fov 0.8.
function camera({ alpha, beta, radius, target, aspect }) {
  const eye = { x: target.x + radius * Math.cos(alpha) * Math.sin(beta), y: target.y + radius * Math.cos(beta), z: target.z + radius * Math.sin(alpha) * Math.sin(beta) };
  const F = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z }, n = Math.hypot(F.x, F.y, F.z);
  return { pitch: Math.atan2(-F.y / n, Math.hypot(F.x, F.z) / n), camAz: Math.atan2(F.x, F.z), halfFov: 0.4, hHalf: Math.atan(Math.tan(0.4) * aspect), eye };
}
const box = (x0, y0, z0, x1, y1, z1) => f.boxCorners({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 });
// A plot with a house, a pool deck and two tall trees (the villa's shape), and a bare box.
const VILLAS = {
  plot: f.outlinePoints([...box(-31, 0, -13, 31, 0.6, 13), ...box(-12, 0, -6, 12, 8, 6), ...box(-29, 0, 4, -14, 1.2, 12), ...box(20, 0, -10, 22, 9, -8), ...box(-25, 0, -11, -23, 7, -9)]),
  box: box(-10, 0, -10, 10, 7, 10),
};
const ASPECTS = { wide: 1376 / 512, desktop: 16 / 9, tablet: 4 / 3, phone: 9 / 19.5 };
const sun = (alt, az) => ({ x: Math.sin(az) * Math.cos(alt), y: Math.sin(alt), z: Math.cos(az) * Math.cos(alt) });
const span = (pts) => Math.max(Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.z)) - Math.min(...pts.map((p) => p.z)));
const fitOf = (pts, aspect) => span(pts) * Math.max(1, Math.tan(0.4) / Math.tan(Math.atan(Math.tan(0.4) * aspect))) * 1.05;
const camFor = (pts, aspect, o) => ({ ...camera({ alpha: deg(o.al), beta: o.beta, radius: fitOf(pts, aspect) * o.zoom, target: { x: (o.px ?? 0) * span(pts), y: 1, z: (o.pz ?? 0) * span(pts) }, aspect }), villa: pts });
function hull(P) {
  P = P.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function insideOrNear(H, q, pad) {
  let inside = true, dmin = Infinity;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    if ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1)));
    dmin = Math.min(dmin, Math.hypot(q.x - a.x - t * (b.x - a.x), q.y - a.y - t * (b.y - a.y)));
  }
  return inside || dmin < pad;
}

console.log("  every pose: behind, ahead, over, in front, side, on screen");
{
  const bad = {}; let n = 0;
  const note = (k, d) => { (bad[k] ??= []).length < 2 && bad[k].push(d); bad[k].n = (bad[k].n ?? 0) + 1; };
  const step = FULL ? 15 : 45;
  for (const [vn, pts] of Object.entries(VILLAS)) for (const [an, aspect] of Object.entries(ASPECTS))
    for (const zoom of FULL ? [0.4, 0.6, 1, 1.8] : [0.5, 1, 1.6]) for (const [px, pz] of FULL ? [[0, 0], [0.2, 0], [0, -0.2]] : [[0, 0], [0.2, -0.1]]) for (const beta of FULL ? [0.15, 0.5, 0.9, 1.25, 1.4] : [0.2, 0.9, 1.35])
      for (let al = 0; al < 360; al += step) for (const alt of [0, 5, 20, 45, 70, 88]) for (let az = 0; az < 360; az += step) {
        const c = camFor(pts, aspect, { al, beta, zoom, px, pz }), s = sun(deg(alt), deg(az));
        const r = f.placeBody(s.x, s.y, s.z, 1, c), { rel } = f.relativeSky(s.x, s.y, s.z, c.camAz), shape = f.villaShape(pts, c);
        const ahead = Math.cos(rel) * Math.cos(deg(alt)); n++;
        const ctx = { vn, an, zoom, px, pz, beta, al, alt, az };
        if (ahead <= f.AHEAD_GONE && r.dir) note("drawn although behind the viewer", ctx);
        if (ahead >= f.AHEAD_FULL && alt >= 3 && !r.dir && shape.fill < f.FILL_FULL) note("hidden although ahead", ctx);
        if (!r.frame || r.fade < 0.15) continue;   // too faint to be seen
        const { fx, fy } = r.frame;
        if (fx < 0 || fx > 1 || fy < 0 || fy > 1) note("off screen while drawn", ctx);
        const hx0 = Math.min(...shape.hull.map((v) => v.x)) / aspect, hx1 = Math.max(...shape.hull.map((v) => v.x)) / aspect;
        if (Math.cos(rel) > 0.05 && fy > shape.c.y + 1e-9 && fx > hx0 + 0.02 && fx < hx1 - 0.02) note("in front of the villa while ahead", ctx);
        const proj = pts.map((p) => f.projectToFrame(p.x - c.eye.x, p.y - c.eye.y, p.z - c.eye.z, c));
        if (proj.some((q) => !q)) continue;
        const H = hull(proj.map((q) => ({ x: q.frameX * aspect, y: q.frameY })));
        const xs = H.map((v) => v.x / aspect), ys = H.map((v) => v.y);
        const room = Math.min(...xs) > 0.12 && Math.max(...xs) < 0.88 && Math.min(...ys) > 0.12 && Math.max(...ys) < 0.88;
        if (room && insideOrNear(H, { x: fx * aspect, y: fy }, 0.025)) note("drawn over the villa", ctx);
        const side = Math.sin(rel) * Math.cos(deg(alt));
        if (room && Math.abs(side) > 0.25 && Math.sign(fx - shape.c.x / aspect) !== Math.sign(side)) note("on the wrong side", ctx);
      }
  for (const [k, v] of Object.entries(bad)) console.log(`      ${k}: ${v.n}`, JSON.stringify(v));
  ck(`no rule broken in ${n} poses (villa and box × four screens × zoom, pan, tilt, heading × the sun round the sky)`, Object.keys(bad).length === 0 && n > 50000);
}

console.log("\n  the day, facing north: rising east (right), highest at noon, setting west (left)");
for (const [an, aspect] of Object.entries(ASPECTS)) {
  const pts = VILLAS.plot, c = camFor(pts, aspect, { al: -90, beta: 0.9, zoom: 1 }), sh = f.villaShape(pts, c);
  const day = [[2, 75], [15, 80], [35, 88], [60, 100], [85, 170], [60, 250], [35, 268], [15, 275], [2, 285]];
  const p = day.map(([alt, az]) => { const s = sun(deg(alt), deg(az)); return f.placeBody(s.x, s.y, s.z, 1, c).frame; });
  const mid = sh.c.x / aspect, ys = p.map((q) => q.fy);
  ck(`${an}: sunrise right of the villa, sunset left, noon the highest, morning and evening lower`,
     p[0].fx > mid && p[8].fx < mid && ys[4] <= Math.min(...ys) + 1e-9 && ys[0] > ys[2] && ys[8] > ys[6],
     p.map((q) => `${q.fx.toFixed(2)},${q.fy.toFixed(2)}`).join(" "));
}

console.log("\n  no jump: turning, tilting, zooming, panning, the day passing");
{
  // A discontinuity does not shrink when the motion is cut finer; fast motion
  // does. Cut a large step 20-fold, then cut ITS largest piece 20-fold again,
  // three times (8 000-fold): a jump keeps a piece about as large at every
  // level, motion — even motion bunched into a sliver of the step — does not.
  const at = (pts, aspect, o, s) => { const r = f.placeBody(s.x, s.y, s.z, 1, camFor(pts, aspect, o)); return r.frame && r.fade > 0.15 ? { x: r.frame.fx * aspect, y: r.frame.fy } : null; };
  const jumps = [];
  const gap = (p, q) => (p && q ? Math.hypot(p.x - q.x, p.y - q.y) : 0);
  function isJump(pos, t0, t1, big) {
    let a = t0, b = t1, size = big;
    for (let level = 0; level < 3; level++) {
      let worst = 0, wa = a, wb = b, q0 = pos(a);
      for (let k = 1; k <= 20; k++) {
        const t = a + ((b - a) * k) / 20, q = pos(t), g = gap(q, q0);
        if (g > worst) { worst = g; wa = t - (b - a) / 20; wb = t; }
        q0 = q;
      }
      if (worst < size * 0.5) return false;   // it shrank: motion
      a = wa; b = wb; size = worst;
    }
    return true;                               // as large after 8 000-fold: a jump
  }
  function sweep(name, a, b, n, pos, ctx) {
    let prev = pos(a), prevT = a;
    for (let i = 1; i <= n; i++) {
      const t = a + ((b - a) * i) / n, p = pos(t), big = gap(p, prev);
      if (big > 0.02 && isJump(pos, prevT, t, big)) jumps.push({ name, ...ctx, t, big });
      prev = p; prevT = t;
    }
  }
  for (const [vn, pts] of Object.entries(VILLAS)) for (const [an, aspect] of Object.entries(ASPECTS))
    for (const alt of FULL ? [0, 10, 30, 60, 80, 89] : [0, 40]) for (const az of FULL ? [0, 37, 90, 160, 233, 300] : [37, 233]) {
      const s = sun(deg(alt), deg(az)), ctx = { vn, an, alt, az };
      for (const beta of FULL ? [0.3, 0.9, 1.35] : [0.4, 1.3]) for (const zoom of FULL ? [0.5, 1, 1.6] : [0.6, 1.3]) sweep("turning", 0, 360, FULL ? 720 : 120, (al) => at(pts, aspect, { al, beta, zoom }, s), { ...ctx, beta, zoom });
      for (const al of FULL ? [0, 70, 140, 250] : [70, 200]) {
        sweep("tilting", 0.05, 1.4, FULL ? 270 : 60, (beta) => at(pts, aspect, { al, beta, zoom: 1 }, s), { ...ctx, al });
        sweep("zooming", 0.3, 2, FULL ? 340 : 70, (zoom) => at(pts, aspect, { al, beta: 0.9, zoom }, s), { ...ctx, al });
        sweep("panning", -0.3, 0.3, FULL ? 240 : 50, (px) => at(pts, aspect, { al, beta: 0.9, zoom: 1, px }, s), { ...ctx, al });
      }
    }
  for (const [vn, pts] of Object.entries(VILLAS)) for (const [an, aspect] of Object.entries(ASPECTS)) for (let h = 0; h < 360; h += FULL ? 45 : 90)
    sweep("the day passing", 0, 720, FULL ? 720 : 144, (min) => { const tt = (min / 720) * Math.PI; return at(pts, aspect, { al: h, beta: 0.9, zoom: 1 }, sun(Math.sin(tt) * deg(88), deg(90) + (min / 720) * deg(180))); }, { vn, an, h });
  ck("no step is a jump (each large step shrinks when cut finer and finer)", jumps.length === 0, jumps.slice(0, 3));
}

console.log("\n  pan and zoom carry it with the villa");
{
  // In the frame, a pan moves the villa's outline; the body must move by
  // EXACTLY that (while neither touches the frame's edge). Exact, in 2D: the
  // placement of a shifted outline is the shifted placement.
  const pts = VILLAS.plot, aspect = 16 / 9;
  let worst = 0, n = 0;
  for (const al of [0, 60, 130, 250]) for (const [alt, az, zoom] of [[0, 30, 1.5], [0, 100, 1.5], [0, 330, 1.5], [20, 100, 3], [45, 200, 3], [80, 300, 3]]) {
    const c = camFor(pts, aspect, { al, beta: 0.9, zoom }), sh = f.villaShape(pts, c);
    const { rel } = f.relativeSky(...Object.values(sun(deg(alt), deg(az))), c.camAz);
    if (Math.cos(rel) * Math.cos(deg(alt)) < 0) continue;
    for (const [dx, dy] of [[0.04, 0], [-0.05, 0.03], [0.02, -0.04]]) {
      const moved = { ...sh, hull: sh.hull.map((v) => ({ x: v.x + dx, y: v.y + dy })), c: { x: sh.c.x + dx, y: sh.c.y + dy }, top: sh.top + dy };
      // Noon's rise is capped by the room above the villa ON SCREEN (by
      // design, so the height stays legible); where that cap binds, a move
      // changes it. The rule is exact everywhere else.
      const capped = (q) => f.RISE * q.size > q.top - f.EDGE - f.CLEAR;
      if (capped(sh) || capped(moved)) continue;
      const a = f.placeAround(rel, deg(alt), sh, aspect), b = f.placeAround(rel, deg(alt), moved, aspect);
      const inner = (p) => p.fx > f.EDGE / aspect + 0.02 && p.fx < 1 - f.EDGE / aspect - 0.02 && p.fy > f.EDGE + 0.02 && p.fy < 1 - f.EDGE - 0.02;
      if (!inner(a) || !inner(b)) continue;
      n++;
      worst = Math.max(worst, Math.hypot((b.fx - a.fx) * aspect - dx, b.fy - a.fy - dy));
    }
  }
  ck(`the villa's outline moved, the body moves by exactly as much (${n} uncapped cases)`, worst < 1e-6 && n > 10, worst);
  // Zoom grows the outline about its centre: a LOW body stays at its clearance
  // from it, in the same direction (a high one rises with the villa's size).
  let off = 0, m = 0;
  for (const al of [0, 40, 80, 130, 170, 220, 300]) for (const az of [30, 100, 200, 300]) {
    const c = camFor(pts, aspect, { al, beta: 0.9, zoom: 1.8 }), sh = f.villaShape(pts, c);
    const { rel } = f.relativeSky(...Object.values(sun(0, deg(az))), c.camAz);
    if (Math.cos(rel) < 0) continue;
    const k = 1.3, big = { ...sh, hull: sh.hull.map((v) => ({ x: sh.c.x + (v.x - sh.c.x) * k, y: sh.c.y + (v.y - sh.c.y) * k })), size: sh.size * k, top: sh.c.y + (sh.top - sh.c.y) * k };
    const a = f.placeAround(rel, 0, sh, aspect), b = f.placeAround(rel, 0, big, aspect);
    const inner = (p) => p.fx > f.EDGE / aspect + 0.02 && p.fx < 1 - f.EDGE / aspect - 0.02 && p.fy > f.EDGE + 0.02;
    if (!inner(a) || !inner(b)) continue;
    m++;
    const da = Math.atan2(a.fy - sh.c.y, a.fx * aspect - sh.c.x), db = Math.atan2(b.fy - sh.c.y, b.fx * aspect - sh.c.x);
    off = Math.max(off, Math.abs(da - db));
  }
  ck(`  ...and zoomed, a low body keeps its direction round the villa (${m} cases)`, off < 1e-6 && m > 8, off);
}

{
  // The rule cannot see the camera except through the villa's outline and the
  // heading: two cameras at different places that show the villa identically
  // place the body identically.
  const pts = VILLAS.plot, aspect = 16 / 9;
  const c = camFor(pts, aspect, { al: 30, beta: 0.8, zoom: 1 });
  const s = sun(deg(25), c.camAz + deg(30));   // ahead of this camera, a little to the right
  const moved = { ...c, eye: { x: c.eye.x + 100, y: c.eye.y, z: c.eye.z }, villa: pts.map((p) => ({ x: p.x + 100, y: p.y, z: p.z })) };
  const a = f.placeBody(s.x, s.y, s.z, 1, c).frame, b = f.placeBody(s.x, s.y, s.z, 1, moved).frame;
  ck("the same view of the villa gives the same place, wherever the camera stands", Math.abs(a.fx - b.fx) < 1e-9 && Math.abs(a.fy - b.fy) < 1e-9);
}

console.log("\n  walking, and before a model");
{
  const c = { pitch: deg(5), halfFov: 0.4, camAz: 1, hHalf: 0.7, eye: { x: 3, y: 1.6, z: 2 }, villa: VILLAS.plot };
  const d = sun(deg(37), deg(140));
  const out = f.placeBody(d.x, d.y, d.z, 0, c).dir;
  ck("no horizon drop: the true sky, untouched (the viewer is standing under it)", out.x === d.x && out.y === d.y && out.z === d.z);
  const none = f.placeBody(d.x, d.y, d.z, f.liftFor(200), { ...c, villa: null }).dir;
  ck("  ...and before a model is loaded, the true direction too", none.x === d.x && none.y === d.y && none.z === d.z);
  ck("set: below −1° of TRUE altitude it is gone; above 3° fully up; between, a fade",
     f.horizonFade(deg(-1.5)) === 0 && f.horizonFade(deg(4)) === 1 && f.horizonFade(deg(1)) > 0 && f.horizonFade(deg(1)) < 1);
  ck("liftFor: 0 units is 0; 200 units is about 22° (the drop's own rotation)", f.liftFor(0) === 0 && Math.abs(f.liftFor(200) - deg(21.8)) < deg(0.1));
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

done("✅ the sun and the moon point round the villa from every view, and never jump");
