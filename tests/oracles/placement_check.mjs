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
const { PlacementCheck, ALLOWED_FINDINGS } = await import("@/babylon/placementCheck");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const box = (cx, cy, h = 20) => ({ cx, cy, hw: h, hh: h });
const badge = (id, cx, cy, o = {}) => ({ id, box: box(cx, cy), visible: true, inFront: true, occluded: false, exempt: false, roomChipped: false, covered: false, offsetX: 0, ...o });
const snap = (o = {}) => ({
  viewport: { x: 0, y: 0, width: 1000, height: 800 }, badges: [], cards: [], chips: [],
  chipDrawnWidth: () => undefined, chipScale: 1, minGapPx: 2, overlapAllow: 0,
  solve: { items: [], gap: 2, mode: "priority", drawableMax: 6 }, ...o,
});
const check = (o) => new PlacementCheck().check(snap(o));

const clean = check({ badges: [badge("a", 100, 100), badge("b", 300, 100)] });
ck("a clean layout: silent", clean.lines.length === 0, clean.lines);

const ov = check({ badges: [badge("a", 100, 100), badge("b", 110, 100)] });
ck("two badges on the same pixels: OVERLAP reported", ov.overlaps === 1 && ov.lines.some((l) => /OVERLAP on screen/.test(l)));
const near = check({ badges: [badge("a", 100, 100), badge("b", 142, 100)] });
ck("clear of each other, however close: nothing to report (no centre floor, 2026-10-14)", near.overlaps === 0 && near.lines.length === 0, near.lines);
const foc = check({ badges: [badge("a", 100, 100, { exempt: true }), badge("b", 110, 100, { exempt: true })] });
ck("a focused room's own overlap is COUNTED in its own bucket, not dropped", foc.overlaps === 0 && foc.focusOverlaps === 1);
const mixed = check({ badges: [badge("a", 100, 100, { exempt: true }), badge("b", 110, 100)] });
ck("  ...a focused badge under another room's is a plain OVERLAP (2.496.553)", mixed.overlaps === 1 && mixed.focusOverlaps === 0);
const off = check({ badges: [badge("a", -500, 100), badge("b", -505, 100)] });
ck("off screen is not something anyone sees", off.overlaps === 0);

const card = (cx, cy, hw, hh, focused = false) => ({ box: { cx, cy, hw, hh }, ink: { cx, cy, hw: Math.min(hw, hh), hh: Math.min(hw, hh) }, focused });
const bur = check({ badges: [badge("a", 200, 200)], cards: [card(200, 200, 80, 20)] });
ck("a badge under a card's ink: BURIED", bur.buried === 1);
const hang = check({ badges: [badge("a", 270, 200)], cards: [card(200, 200, 80, 20)] });
ck("under the card's end only: counted apart, and never called allowed (2.496.552)",
   hang.buried === 0 && hang.overhung === 1 && hang.lines.some((l) => /under a card's END$/.test(l)), hang.lines);
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
ck("a pure solve accepts the same badges reversed", check({ solve: { items, gap: 2, mode: "priority", drawableMax: 6 } }).orderDependent === false);

// ── NO HIDDEN EXCEPTIONS (owner, 2026-10-27) ──────────────────────────────
// Every count is a failure unless ALLOWED_FINDINGS names the owner's decision in rules/decided.md. The old check
// called an overhung badge "allowed" and a focused room's overlaps "expected", which no owner ever decided.
const { readFileSync } = await import("node:fs");
const decided = readFileSync(new URL("../../rules/decided.md", import.meta.url), "utf8");
const anchors = new Set([...decided.matchAll(/^## (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")));
const unanchored = Object.entries(ALLOWED_FINDINGS).filter(([, a]) => !anchors.has(a));
ck("every allowed finding names an entry in rules/decided.md", Object.keys(ALLOWED_FINDINGS).length > 0 && unanchored.length === 0, unanchored);
ck("  ...and the owner allowed one category only: a badge behind a wall while walking",
   JSON.stringify(ALLOWED_FINDINGS) === JSON.stringify({ byWall: "badges-behind-a-wall-hide-while-walking" }), ALLOWED_FINDINGS);
const every = [clean, ov, foc, mixed, bur, hang, cc, ch, cp, est, moved, leak, orph,
  check({ cards: [card(200, 200, 40, 20, true), card(230, 200, 40, 20)] }),
  check({ badges: [badge("a", 200, 200, { exempt: true })], cards: [card(200, 200, 80, 20)] }),
  check({ badges: [badge("a", 500, 300, { exempt: true })], chips: [chip("kitchen", 500, 315)] })];
const [focCards, focCardHit, focChip] = every.slice(-3);
ck("a focused room's own overlaps are FAILURES, in their buckets", foc.failures === 1 && focCards.summaryFocusOverlaps === 1
   && focCards.failures === 1 && focCardHit.focusCardHits === 1 && focCardHit.failures === 1 && focChip.chipHitsFocused === 1 && focChip.failures === 1,
   [foc.failures, focCards.failures, focCardHit.failures, focChip.failures]);
ck("  ...as are a card's end, two cards, a chip, a moved or leaked badge and a chip estimate off by more than the gap",
   hang.failures === 1 && cc.failures === 1 && ch.failures === 1 && cp.failures === 1 && moved.failures === 1
   && leak.failures === 1 && est.failures === 1, [hang, cc, ch, cp, moved, leak, est].map((f) => f.failures));
ck("  ...a badge behind a wall is the one count that is not; an orphan beside it is", orph.byWall === 1 && orph.failures === 1, orph.failures);
ck("  ...and a clean layout has none", clean.failures === 0);
const said = every.flatMap((f) => f.lines).filter((l) => /expected|accepted|harmless|deliberately/i.test(l));
ck("no line calls an overlap expected or accepted", said.length === 0, said);
ck("every overlapping pair is named, by id", JSON.stringify(ov.pairs) === JSON.stringify([{ kind: "overlaps", a: "a", b: "b" }])
   && hang.pairs[0]?.kind === "overhung" && hang.pairs[0]?.b === "a" && cp.pairs[0]?.a === "chip:a", [ov.pairs, hang.pairs, cp.pairs]);

{
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("EntityVisuals only paints the snapshot; the rules are the check's",
     /const found = this\.placementCheck\.check\(snapshot\);/.test(ev) && !/let overlaps = 0|let buried = 0|debugScratchA/.test(ev));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ the self-check can fail, on every rule");
process.exit(fail ? 1 : 0);
