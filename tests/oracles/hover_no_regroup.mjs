// Moving the mouse over the villa changes nothing (owner, 2026-10-14, the third
// report): a room's chip opened into its devices while the mouse moved and came
// back when it stopped. Two causes, both driven here by value:
//   1. a hover was VIEW MOTION — the picture dropped to the motion resolution
//      and sharpened again once the mouse stopped (frameScheduler.movesTheView);
//   2. the badge layout depended on that resolution: its rung was ceiled onto the
//      zoom lattice in RENDER px, and ceil does not commute with a scale that is
//      not a power of two (badgeScale.rungPx now quantises in CSS px).
// And the owner's rule for when a room groups at all: only when what is drawn
// would overlap — no floor on the distance between two centres.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { movesTheView } = await import("@/babylon/frameScheduler");
const { rungAt, rungPx, cssExtent } = await import("@/babylon/badgeScale");
const { solvePlacement, conflicts, markContacts, createPlacementScratch } = await import("@/babylon/badgePlacement");

console.log("  a hover is not view motion:");
ck("a mouse moving with no button held does not move the view", movesTheView(true, 0) === false);
ck("  ...a drag does (a button held)", movesTheView(true, 1) === true);
ck("  ...and so do a press, a release and the wheel", movesTheView(false, 0) === true && movesTheView(false, 1) === true);

// ── the layout at the two resolutions the valve draws at ──────────────────
// A DPR-2 screen sharpens to 0.5 when still; a slow burst eases the motion level
// anywhere up to 1.0 (resolutionGovernor.easeResolution). The CSS layout is the
// same — every render-px quantity is a CSS one times cssToGui = 1/level.
const TAN = Math.tan(0.4), CSS_H = 900, HALF = 14, GAP = 2;
const levels = [0.5, 0.55, 0.6, 0.674, 0.75, 0.8, 0.9, 1];
// A crowded room: 18 devices on a jittered grid, so pairs sit at every distance
// around the touching threshold.
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pts = Array.from({ length: 18 }, (_, i) => [(i % 6) * 0.42 + rnd() * 0.08, Math.floor(i / 6) * 0.42 + rnd() * 0.08]);
const layout = (rungRender, c) => {
  const items = pts.map(([x, z], i) => ({ sx: x * rungRender, sy: z * rungRender, sz: 0, reach: HALF * c, reachY: HALF * c,
    rank: 0, sortKey: `d${String(i).padStart(2, "0")}`, category: "light", room: "living", exempt: false }));
  const r = solvePlacement(items, GAP * c, "priority", createPlacementScratch(), 6);
  const acc = items.filter((_, i) => r.accepted[i]).map((x) => x.sortKey).join(",");
  const bk = r.buckets.slice(0, r.bucketCount).map((b) => b.members.map((i) => items[i].sortKey).sort().join("+")).sort().join("|");
  return `${acc} // ${bk} // ${[...r.chipRooms].join()}`;
};
const renderH = (level) => Math.trunc(CSS_H / level);          // Babylon's setSize truncates
let differs = 0, oldDiffers = 0, grouped = 0, n = 0;
for (let dist = 6; dist < 30; dist += 0.0625) {
  n++;
  const still = layout(rungPx(cssExtent(renderH(0.5), 0.5, CSS_H), TAN, dist, 2), 2);
  if (still.includes("+")) grouped++;
  for (const lv of levels.slice(1)) {
    const c = 1 / lv;
    if (layout(rungPx(cssExtent(renderH(lv), lv, CSS_H), TAN, dist, c), c) !== still) differs++;
    // what shipped to 2.496.345: the rung ceiled in render px
    if (layout(rungAt(renderH(lv), TAN, dist), c) !== layout(rungAt(renderH(0.5), TAN, dist), 2)) oldDiffers++;
  }
}
ck(`the scene groups at some zooms (the check below is not vacuous: ${grouped} of ${n})`, grouped > 0 && grouped < n, grouped);
ck(`  ...and sits at the threshold: the render-px rung regrouped it at ${oldDiffers} zoom × resolution cases`, oldDiffers > 0, oldDiffers);
ck(`one layout at every resolution the valve draws at (${n} zooms × ${levels.length - 1} motion levels)`, differs === 0, differs);

console.log("\n  a room groups only when what is drawn would overlap:");
const item = (sx, reach = 10) => ({ sx, sy: 0, sz: 0, reach, reachY: reach, rank: 0, sortKey: `e${sx}`, category: "light", room: "r", exempt: false });
// two badges 20 px wide with a 2 px gap: they touch below 22 px between centres
ck("23 px apart: clear of each other — not grouped, however close the centres", !conflicts(item(0), item(23), GAP));
ck("  ...21 px apart: drawn on top of each other — grouped", conflicts(item(0), item(21), GAP));
const contacts = markContacts([item(0), item(23), item(200)], GAP, createPlacementScratch());
ck("the value-pill test asks the same question", contacts[0] === 0 && contacts[1] === 0 && contacts[2] === 0, [...contacts.slice(0, 3)]);

console.log("\n  the callers:");
const src = (p) => readFileSync(new URL(`../../src/babylon/${p}`, import.meta.url), "utf8");
const sm = src("SceneManager.ts"), ev = src("EntityVisuals.ts"), zs = src("roomZoomSolver.ts");
ck("the scene asks movesTheView before counting a pointer as motion",
   /onPointerObservable\.add\(\(info\) => \{\s*if \(movesTheView\(info\.type === PointerEventTypes\.POINTERMOVE, \(info\.event as PointerEvent\)\.buttons \?\? 0\)\)/.test(sm)
   && !/onPointerObservable\.add\(\(\) => this\.frames\.motion\(\)\)/.test(sm));
ck("the layout's render scale is the CSS rung times cssToGui", /const rung = this\.cssRung\(shown\);[\s\S]{0,200}const pxPerWorld = rung \* this\.cssToGui\(\);/.test(ev));
ck("  ...the icon zoom reads the same CSS rung", /iconZoomAt\(this\.cssRung\(shown\), this\.cssViewportHeight\(\)/.test(ev));
ck("  ...and the rung is measured on the CSS height, never the render height",
   /private cssRung\(shown: ShownLabel\[\]\): number \{[\s\S]{0,120}const vpH = this\.cssViewportHeight\(\);/.test(ev));
ck("the room-zoom solver walks the same rung", /rungPx\(view\.cssH, tanV, radius, view\.cssToGui\)/.test(zs));

done("✅ the mouse moves, the badges stay");
