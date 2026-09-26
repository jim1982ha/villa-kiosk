// The `?debug=place` self-check (src/babylon/placementCheck.ts), made to FAIL.
//
// ⚠️ ITS OWN HISTORY: an earlier version fed the solver's items back into the
// solver's predicate — "a tautology: it could not fail whatever the screen
// looked like, and for as long as it existed it reported a clean layout over
// screenshots full of badges and cards drawn on top of each other". Until
// 2.496.100 nothing could show the current one fails either, short of the
// tablet. Each case below paints a layout that breaks one rule and requires
// the check to say so — and a clean one to stay silent.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { PlacementCheck } = await import("@/babylon/placementCheck");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const box = (cx, cy, h = 20) => ({ cx, cy, hw: h, hh: h });
const badge = (id, cx, cy, o = {}) => ({ id, box: box(cx, cy), visible: true, inFront: true, occluded: false, exempt: false, roomChipped: false, covered: false, offsetX: 0, ...o });
const snap = (o = {}) => ({
  viewport: { x: 0, y: 0, width: 1000, height: 800 }, badges: [], cards: [], chips: [],
  chipDrawnWidth: () => undefined, chipScale: 1, minSepPx: 44, minGapPx: 2, overlapAllow: 0,
  solve: { items: [], gap: 2, minSep: 44, mode: "priority", drawableMax: 6 }, ...o,
});
const check = (o) => new PlacementCheck().check(snap(o));

const clean = check({ badges: [badge("a", 100, 100), badge("b", 300, 100)] });
ck("a clean layout: silent", clean.lines.length === 0, clean.lines);

const ov = check({ badges: [badge("a", 100, 100), badge("b", 110, 100)] });
ck("two badges on the same pixels: OVERLAP reported", ov.overlaps === 1 && ov.lines.some((l) => /OVERLAP on screen/.test(l)));
const near = check({ badges: [badge("a", 100, 100), badge("b", 142, 100)] });
ck("clear of each other but inside the tap pitch: reported apart", near.overlaps === 0 && near.tooClose === 1);
const foc = check({ badges: [badge("a", 100, 100, { exempt: true }), badge("b", 110, 100)] });
ck("a focused room's overlap is COUNTED in its own bucket, not dropped", foc.overlaps === 0 && foc.focusOverlaps === 1);
const off = check({ badges: [badge("a", -500, 100), badge("b", -505, 100)] });
ck("off screen is not something anyone sees", off.overlaps === 0);

const card = (cx, cy, hw, hh, focused = false) => ({ box: { cx, cy, hw, hh }, ink: { cx, cy, hw: Math.min(hw, hh), hh: Math.min(hw, hh) }, focused });
const bur = check({ badges: [badge("a", 200, 200)], cards: [card(200, 200, 80, 20)] });
ck("a badge under a card's ink: BURIED", bur.buried === 1);
const hang = check({ badges: [badge("a", 270, 200)], cards: [card(200, 200, 80, 20)] });
ck("under the overhang only: allowed, and said so", hang.buried === 0 && hang.overhung === 1);
const cc = check({ cards: [card(200, 200, 40, 20), card(230, 200, 40, 20)] });
ck("two cards on each other: summary OVERLAP", cc.summaryOverlaps === 1);

const chip = (key, x, y, halfW = 40, halfH = 15) => ({ key, label: key, x, y, halfW, halfH });
const ch = check({ badges: [badge("a", 500, 300)], chips: [chip("kitchen", 500, 315)] });
ck("a badge on a room chip: reported", ch.chipHits === 1);
const cp = check({ chips: [chip("a", 500, 300), chip("b", 520, 300)] });
ck("two chips on each other: the merge did not settle", cp.chipPairs === 1);
// At scale 2: an 80 px render-space estimate is 40 CSS px; the GUI measured
// 120 CSS px (its measure is PRE-transform — only the estimate is divided,
// 2.421.0, whose double division reported phantom errors).
const est = check({ chips: [chip("kitchen", 500, 300, 40)], chipDrawnWidth: () => 120, chipScale: 2 });
ck("a chip drawn wider than its estimate by more than the gap: reported, in CSS px", est.chipWidthErr === 80 && est.lines.some((l) => /chipWidthPx is off/.test(l)), est.chipWidthErr);

const moved = check({ badges: [badge("a", 100, 100, { offsetX: 12 })] });
ck("a badge that moved off its anchor: reported (a badge never moves)", moved.moved === 1);
const leak = check({ badges: [badge("a", 100, 100, { roomChipped: true })] });
ck("a badge showing inside a chipped room: reported", leak.leaked === 1);
const orph = check({ badges: [badge("a", 100, 100, { visible: false }), badge("b", 300, 100, { visible: false, occluded: true }),
  badge("c", 500, 100, { visible: false, covered: true }), badge("d", 700, 100, { visible: false, roomChipped: true })] });
ck("hidden with no card and no chip: an ORPHAN; behind a wall counted apart; covered or chipped is fine",
   orph.orphaned === 1 && orph.byWall === 1, [orph.orphaned, orph.byWall]);

const items = [0, 1, 2].map((i) => ({ sx: i * 200, sy: 0, sz: 0, reach: 20, reachY: 20, rank: 0, sortKey: `b${i}`, category: "", room: "r", exempt: false }));
ck("a pure solve accepts the same badges reversed", check({ solve: { items, gap: 2, minSep: 44, mode: "priority", drawableMax: 6 } }).orderDependent === false);

{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("EntityVisuals only paints the snapshot; the rules are the check's",
     /const found = this\.placementCheck\.check\(\{/.test(ev) && !/let overlaps = 0|let buried = 0|debugScratchA/.test(ev));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ the self-check can fail, on every rule");
process.exit(fail ? 1 : 0);
