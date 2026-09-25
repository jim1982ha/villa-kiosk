// Which badges are behind a wall — and when those answers go stale.
//
// ⚠️ FOUND 2026-09-25 BY READING THE CODE: the sweep re-tested badges only when
// the EYE moved. Standing still, a floor switch (which changes which slabs
// occlude) or a badge appearing kept the old answers until the next step — a
// badge behind a wall stayed drawn, and a stale id could hide a room's chip.
// d0b3e9d4 had already met the other half of it (`occl=52/16` after going
// upstairs). This drives the real OcclusionSweep with a fake ray cast and a
// clock that only moves when told to.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { OcclusionSweep } = await import("@/babylon/occlusionSweep");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
function rig() {
  let t = 1000;
  const walls = new Set();                    // badge ids a wall currently hides
  const cast = { calls: 0 };
  const sweep = new OcclusionSweep({
    settleMs: 250, nearM: 1.2, slackM: 0.35, now: () => t,
    cast: (ox, oy, oz, dx, dy, dz, len) => {
      cast.calls++;
      // Which badge is this ray aimed at? The one whose anchor it ends near.
      const hit = [...targets].find((b) => Math.hypot(ox + dx * (len + 0.35) - b.wx, oy + dy * (len + 0.35) - b.wy, oz + dz * (len + 0.35) - b.wz) < 1e-6);
      return hit && walls.has(hit.id) ? "wall_1F" : null;
    },
  });
  const targets = new Set();
  const badge = (id, x) => { const b = { id, wx: x, wy: 1, wz: 0 }; targets.add(b); return b; };
  const eye = { x: 0, y: 1.6, z: -5 };
  return { sweep, walls, cast, badge, eye, wait: (ms) => { t += ms; } };
}
const run = (r, shown, budget = 1000) => r.sweep.step(shown, r.eye, budget);

console.log("  the settle rule:");
{
  const r = rig();
  const shown = [r.badge("light.a", 0), r.badge("light.b", 3)];
  ck("a moving eye casts no rays", run(r, shown) === "settling" && r.cast.calls === 0);
  r.wait(300);
  ck("once still, it sweeps every badge", run(r, shown) === "complete" && r.cast.calls === 2);
  ck("  ...and then rests: no rays while nothing changes", run(r, shown) === "idle" && r.cast.calls === 2);
}

console.log("\n  standing still, the world changes:");
{
  const r = rig();
  const a = r.badge("light.a", 0), b = r.badge("light.b", 3);
  run(r, [a, b]); r.wait(300); run(r, [a, b]);
  ck("nothing is occluded yet", r.sweep.occluded.size === 0);
  r.walls.add("light.b");                     // the storey switched: a slab now stands between
  ck("without being told, the sweep keeps its answers (it cannot know)", run(r, [a, b]) === "idle");
  r.sweep.invalidate();                        // what setActiveFloor now does
  run(r, [a, b]);
  ck("a floor switch while standing still re-tests every badge", r.sweep.occluded.has("light.b"), [...r.sweep.occluded]);
  const c = r.badge("light.c", -3);
  r.walls.add("light.c");
  run(r, [a, b, c]);
  ck("a badge that APPEARS while standing still is tested at once", r.sweep.occluded.has("light.c"), [...r.sweep.occluded]);
  run(r, [a, c]);
  ck("a badge no longer shown is forgotten — it cannot hide a room's chip", !r.sweep.occluded.has("light.b"), [...r.sweep.occluded]);
  ck("the blocker is named, not just counted", r.sweep.blockedBy.get("light.c") === "wall_1F");
}

console.log("\n  the other rules:");
{
  const r = rig();
  r.eye = { x: 0, y: 1.6, z: 0.5 };
  const near = r.badge("switch.here", 0);
  run(r, [near]); r.wait(300); run(r, [near]);
  ck("a badge within arm's reach is never ray-tested", r.cast.calls === 0 && !r.sweep.occluded.has("switch.here"));
}
{
  const r = rig();
  const many = Array.from({ length: 5 }, (_, i) => r.badge(`light.${i}`, i * 2));
  run(r, many); r.wait(300);
  ck("at least one ray a pass, even with no time left", run(r, many, 0) === "sweeping" && r.cast.calls === 1);
  r.sweep.reset(true);
  ck("leaving first-person forgets every answer", r.sweep.occluded.size === 0 && r.sweep.swept === 0);
}

console.log("\n  the caller:");
// invalidate() is only a fix if the storey switch calls it.
import { readFileSync } from "node:fs";
const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
const floorFn = ev.slice(ev.indexOf("  setActiveFloor("), ev.indexOf("\n  }\n", ev.indexOf("  setActiveFloor(")));
ck("a storey switch invalidates the sweep", /this\.occlusion\.invalidate\(\)/.test(floorFn));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ a stale wall never hides, or shows, a badge");
process.exit(fail ? 1 : 0);
