// The room shot, as a value (src/babylon/roomShot.ts, 2.496.261). One tap on a
// room crossed five modules; the union, the forced tilt and the double clamp
// had no test, a 1.5 m floor could never bind (the camera's own zoom-in limit
// is at least 2 and was applied after it), and the ?debug line printed the
// radius BEFORE the camera clamped it.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { roomShot } = await import("@/babylon/roomShot");
const { BETA_MIN } = await import("@/babylon/overviewPose");
const { roomWallFit } = await import("@/babylon/roomZoomSolver");

const view = { alpha: 1.2, vFov: 0.9, hFov: 1.4 };
const limits = { lo: 2, hi: 60 };
const pan = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
const box = (x0, x1, z0, z1, y = 0) => ({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, floorY: y });
const calls = [];
const solve = (s) => { calls.push(s); return { radius: s.minRadius + 1, declutters: false }; };

ck("nothing measurable: no shot", roomShot({ rooms: [{ bounds: null, real: false }], view, limits, pan }) === null);

const one = roomShot({ rooms: [{ bounds: box(0, 6, 0, 4), real: true }], view, limits, pan, solve });
const fit = roomWallFit(box(0, 6, 0, 4), true, { alpha: 1.2, beta: BETA_MIN, vFov: 0.9, hFov: 1.4 });
ck("ONE room: the wall fit, then the badge solver between the camera's zoom-in limit and that fit",
   calls.length === 1 && calls[0].minRadius === 2 && Math.abs(calls[0].maxRadius - Math.max(fit.radius, 2)) < 1e-9
   && one.solved && one.requested === 3 && one.declutters === false && Math.abs(one.wallFit - fit.radius) < 1e-9, { calls, one });
ck("  ...zenithal (the camera's own tilt limit), spin kept, orbit centre on the room at its floor",
   one.pose.beta === BETA_MIN && one.pose.alpha === 1.2 && one.pose.target.x === 3 && one.pose.target.z === 2 && one.pose.target.y === 0);

calls.length = 0;
const two = roomShot({ rooms: [{ bounds: box(0, 4, 0, 4), real: true }, { bounds: box(10, 14, 0, 4, -0.5), real: false }], view, limits, pan, solve });
ck("SEVERAL rooms: their union is framed, on the lower floor, with no badge solve (the fit IS the shot)",
   calls.length === 0 && !two.solved && two.pose.target.x === 7 && two.pose.target.y === -0.5 && two.real === false
   && Math.abs(two.requested - roomWallFit(box(0, 14, 0, 4, -0.5), false, { alpha: 1.2, beta: BETA_MIN, vFov: 0.9, hFov: 1.4 }).radius) < 1e-9, two);

const huge = roomShot({ rooms: [{ bounds: box(-200, 200, -200, 200), real: true }], view, limits, pan });
ck("THE POSE IS THE ONE THE CAMERA TAKES: a fit past the zoom-out limit is clamped here, and says what it asked",
   huge.pose.radius === 60 && huge.requested > 60, { radius: huge.pose.radius, requested: huge.requested });
const tiny = roomShot({ rooms: [{ bounds: box(1, 1.1, 1, 1.1), real: true }], view, limits: { lo: 2.5, hi: 60 }, pan });
ck("  ...and a point-sized room stops at the camera's OWN zoom-in limit (the 1.5 m floor never bound)", tiny.pose.radius === 2.5, tiny.pose);

const src = (p) => readFileSync(new URL(`../../src/babylon/${p}`, import.meta.url), "utf8");
const sm = src("SceneManager.ts");
ck("focusRooms flies the shot's pose, and the debug line prints the radius it flies AND the one it asked",
   /this\.overview\.applyPose\(framed\.pose\)/.test(sm) && /radius=\$\{framed\.pose\.radius\.toFixed\(2\)\} asked=\$\{framed\.requested/.test(sm));

done("✅ the room shot is one value");
