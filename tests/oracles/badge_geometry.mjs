// The badge pipeline's arithmetic — the part that decides what you see, and
// which nothing has ever run.
//
// ⚠️ SEVEN FILES CLAIMED THIS WAS ALREADY COVERED. `badgeMetrics`, `badgeCard`,
// `badgeProjection`, `roomStorey` (now storeys) and `EntityVisuals` all cite
// `npm run test:placement` or `test:geometry` as live coverage. Neither script
// has ever existed on this branch — they pointed at files that were not here
// and were deleted in 2.496.23. One of them goes further and claims a pin
// "now reads THIS CONSTANT rather than a copy of its value"; that constant has
// no reader outside its own file. A reader working through the sizing
// concludes it is guarded. It was not guarded at all.
//
// These modules import NOTHING, so all of this was reachable the whole time.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);

const { arrange, cardStruts, gridCells, MAX_GRID_CHIPS, MAX_TOTAL_CHIPS } =
  await import("@/babylon/badgeCard");
const { chipWidthPx, fitChipLabel } = await import("@/babylon/labelLayout");
const { snapToZoomLattice, badgeMetricsFor } = await import("@/babylon/badgeMetrics");
const { viewBasis, projectToView } = await import("@/babylon/badgeProjection");

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };

/* ── the card layout ───────────────────────────────────────────────────── */
// ⚠️ THE MONOTONICITY IS LOAD-BEARING. `EntityVisuals.cardCellCap` runs
// `while (cells > 2 && cardOf(cells).width > budget) cells--` — a search that
// only terminates at the right answer if width never DROPS as cells are added.
// Nothing stated that, so nothing could notice it breaking.
console.log("  the card's shape:");
const widths = [];
for (let n = 1; n <= 12; n++) widths.push(arrange(n, 28, 0.8, 2).width);
const monotone = widths.every((w, i) => i === 0 || w >= widths[i - 1]);
console.log(`      widths 1..12 cells: ${widths.join(" ")}`);
ck("width never shrinks as cells are added", monotone);
ck("one cell is not zero-width", widths[0] > 0);

const perCard = arrange(MAX_GRID_CHIPS + 1, 28, 0.8, 2, MAX_TOTAL_CHIPS, 0, MAX_GRID_CHIPS);
ck("a pile past one card's cap becomes more than one card", perCard.cards.length > 1);
ck("every cell lands in some card",
   perCard.cards.reduce((s, c) => s + c.cells, 0) >= MAX_GRID_CHIPS + 1);

const wrapped = arrange(9, 28, 0.8, 2, MAX_TOTAL_CHIPS, 120, MAX_GRID_CHIPS);
ck("a width budget is respected rather than overrun", wrapped.width <= 120);

ck("a non-finite count is zero cells, not NaN", gridCells(Number.NaN) === 0);
ck("a negative count is zero cells", gridCells(-3) === 0);

/* ── a card's width: the parts ARE the whole ───────────────────────────── */
// ⚠️ IT WAS COMPUTED TWICE, FROM DISJOINT CONSTANTS. The solver modelled a card
// as `cardPadLeftPx + cardHeightPx + valueWidth` while the renderer built it
// from six struts, sharing one term out of six — so every card reserved about
// 25% more width than it drew, three to five times the minimum gap the metrics
// table exists to tune. Both now read `cardStruts`; this pins that its parts
// sum to what it reports, which is what stops them drifting apart again.
console.log("\n  a card's width:");
const bare = cardStruts(28, 22, 0);
const val = cardStruts(28, 22, 12);
console.log(`      bare ${bare.width.toFixed(2)}  ·  with a value ${val.width.toFixed(2)}`);
ck("a bare card is its three visible struts: its own left margin, the glyph, the right",
   Math.abs(bare.barepad + bare.glyph + bare.padr - bare.width) < 1e-9);
// ⚠️ A BARE ICON SAT LEFT OF CENTRE (owner's screenshots, 2.496.130): its
// left margin was `padl`, short by the ink, so the visible margins were 3.0
// and 5.2 px and the card 25.8 by 28 — and Babylon floors a width to whole
// pixels (measured on a real GUI: padl's 0.8 drew as 0, the glyph flush left).
ck("a bare icon is CENTRED: its left margin is the same number as its right (so both floor alike)", bare.barepad === bare.padr);
ck("  ...and its card is SQUARE", Math.abs(bare.width - 28) < 1e-9, bare.width);
ck("  ...the visible margin round the chip is the same on all four sides",
   Math.abs((bare.barepad + 0.1 * 22) - (bare.padr + 0.1 * 22)) < 1e-9 && Math.abs((bare.padr + 0.1 * 22) - ((28 - 22) / 2 + 0.1 * 22)) < 1e-9);
ck("a valued card is all six",
   Math.abs(val.padl + val.glyph + val.valgap + val.value + val.valtail + val.padr
            - val.width) < 1e-9);
ck("a value makes the card wider", val.width > bare.width);
ck("the value's own struts are reported even when nothing is shown",
   bare.valgap > 0 && bare.valtail > 0);
ck("  ...but do not count toward a bare card's width",
   bare.width < bare.padl + bare.glyph + bare.padr + bare.valgap);
ck("beside a VALUE the left margin is short by the ink the icon insets",
   val.padl < val.padr);
{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("the renderer shows ONE left margin at a time: padl beside a value, barePad without",
     /if \(lbl\.padL\) lbl\.padL\.isVisible = on;/.test(ev) && /if \(lbl\.barePad\) lbl\.barePad\.isVisible = !on;/.test(ev) && /padL\.isVisible = false;/.test(ev));
  ck("ONE mechanism for every card border, dashed included: the card's own DashableRectangle (owner: 'why is there a difference in the icon shape?')",
     /badge: DashableRectangle;/.test(ev) && /new DashableRectangle\(`lbl_badge_/.test(ev)
       && /lbl\.badge\.dash = dashed && ringW > 0 \? \[ringW \* RING_DASH\[0\], ringW \* RING_DASH\[1\]\] : null;/.test(ev)
       && /BADGE_INSET_CARD, ringState, true, this\.glyphBakePx\(true\)/.test(ev) && !/cardRing|badgeRingDataUrl/.test(ev));
  // The dash is set around Rectangle's own drawing and nowhere else: drive the
  // real _localDraw against a context that records what it is asked to do.
  globalThis.OffscreenCanvas ??= class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return new Proxy({}, { get: () => () => ({}) }); } };
  const { DashableRectangle } = await import("@/babylon/dashableRectangle");
  const log = [];
  let dash = [];
  const ctx = new Proxy({}, {
    get: (_t, k) => k === "setLineDash" ? (d) => { dash = d; log.push(`dash ${d.join(",")}`); }
      : k === "save" ? () => log.push("save") : k === "restore" ? () => { log.push("restore"); }
      : k === "stroke" || k === "strokeRect" ? () => log.push(`stroke with dash [${dash.join(",")}]`)
      : () => {},
    set: () => true,
  });
  const r = new DashableRectangle("t");
  r.thickness = 3; r.color = "#b8862e"; r.cornerRadius = 7;
  Object.assign(r._currentMeasure, { left: 0, top: 0, width: 28, height: 28 });
  r.dash = [6.6, 5.4];
  r._localDraw(ctx);
  ck("  ...a dashed border STROKES with the dash", log.some((l) => l === "stroke with dash [6.6,5.4]"), log);
  ck("  ...and the dash is set inside a save/restore of its own, so nothing drawn after it inherits it",
     log[0] === "save" && log[1] === "dash 6.6,5.4" && log[log.length - 1] === "restore", log);
  const solid = []; dash = [];
  const r2 = new DashableRectangle("u"); r2.thickness = 3; Object.assign(r2._currentMeasure, { left: 0, top: 0, width: 28, height: 28 });
  const ctx2 = new Proxy({}, { get: (_t, k) => k === "setLineDash" ? () => solid.push("dash") : () => {}, set: () => true });
  r2._localDraw(ctx2);
  ck("  ...a solid border sets no dash at all", solid.length === 0);
}
ck("a taller card pads more", cardStruts(40, 22, 0).padr > bare.padr);

/* ── the chip width model ──────────────────────────────────────────────── */
console.log("\n  the chip width model:");
const m = { charPx: 6, padPx: 10 };
ck("width grows with the text", chipWidthPx("10 W", m) > chipWidthPx("9 W", m));
ck("  ...by exactly one character", chipWidthPx("10 W", m) - chipWidthPx("9 W", m) === m.charPx);
ck("empty text is still padded", chipWidthPx("", m) === m.padPx);
// ⚠️ THE SUFFIX IS A SEPARATE ARGUMENT AND IS NEVER TRUNCATED — the function's
// own rule, because folding it into the name let the truncation eat the "+2"
// that says rooms were merged.
const LONG = "a very long room name indeed";
const fitted = fitChipLabel(LONG, "", m, 60);
ck("a label too wide for the chip is shortened", fitted.length < LONG.length);
ck("  ...to something that fits", chipWidthPx(fitted, m) <= 60);
const withSuffix = fitChipLabel(LONG, "+2", m, 60);
ck("  ...and the merged-rooms marker survives the cut", withSuffix.endsWith("+2"));
ck("a label that already fits is left alone", fitChipLabel("Hall", "", m, 200) === "Hall");

/* ── storey picking ────────────────────────────────────────────────────── */
// Which storey a room is on, and which room a point stands in, are
// tests/oracles/storeys.mjs's now (2.496.81; one villa plan, 2.496.91).

/* ── the zoom lattice ──────────────────────────────────────────────────── */
// Badges resize in discrete steps so they do not shimmer while the camera
// moves. Two nearby zooms must land on the SAME rung or the shimmer is back.
// ⚠️ IT ROUNDS UP, NOT TO NEAREST. `Math.ceil` — so two nearby zooms do NOT
// collapse onto one rung; they land on the next one up. I asserted the
// opposite first and the oracle failed on correct code, which is the whole
// reason to check the function rather than the comment.
console.log("\n  the zoom lattice:");
const sweep = [];
for (let v = 1; v <= 4; v += 0.01) sweep.push(snapToZoomLattice(v));
const rungs = new Set(sweep.map((x) => x.toFixed(6)));
console.log(`      1.0 -> 4.0 in 0.01 steps lands on ${rungs.size} rung(s)`);
ck("snapping is idempotent", sweep.every((x) => snapToZoomLattice(x) === x));
ck("a snapped value is never below the input",
   [1, 1.3, 2.7, 3.9].every((v) => snapToZoomLattice(v) >= v));
ck("it is monotone", sweep.every((x, i) => i === 0 || x >= sweep[i - 1]));
ck("300 zooms collapse to a handful of rungs — the anti-shimmer property",
   rungs.size > 1 && rungs.size < 40);
ck("a non-positive zoom is returned untouched", snapToZoomLattice(0) === 0);

/* ── the metrics table ─────────────────────────────────────────────────── */
console.log("\n  the metrics table:");
const coarse = badgeMetricsFor("coarse");
const fine = badgeMetricsFor("fine");
ck("a touch screen gets a bigger badge than a pointer",
   coarse.badgeDiameterPx >= fine.badgeDiameterPx);
// ⚠️ SIZES, NOT OFFSETS. `classicCyPx` is negative on purpose — it lifts the
// badge above its anchor — so a blanket "every *Px is positive" sweep fails on
// correct code. It did.
const SIZES = ["badgeDiameterPx", "cardHeightPx", "labelHeightPx", "valueChipHeightPx"];
ck("every SIZE is positive",
   SIZES.every((k) => !(k in coarse) || coarse[k] > 0));
ck("the badge lifts above its anchor rather than sitting on it", coarse.classicCyPx < 0);

/* ── projection ────────────────────────────────────────────────────────── */
console.log("\n  projection onto the view plane:");
// `projectToView` writes into an out-parameter — it is called once per badge
// per frame and allocating there is what the reuse avoids.
const basis = viewBasis(0, 0, -1, 16, "perspective");
const near = {}, far = {};
projectToView(basis, 0, 0, 0, near);
projectToView(basis, 5, 0, 0, far);
ck("a point projects to finite coordinates",
   Object.values(near).every((v) => typeof v !== "number" || Number.isFinite(v)));
ck("two different world points do not collapse to one",
   JSON.stringify(near) !== JSON.stringify(far));
const again = {};
projectToView(basis, 0, 0, 0, again);
ck("the same point projects the same way twice", JSON.stringify(again) === JSON.stringify(near));

console.log();
console.log(fail ? "❌ THE BADGE ARITHMETIC IS WRONG" : "✅ the badge arithmetic holds");
process.exit(fail ? 1 : 0);
