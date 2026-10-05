// How much fits on this screen (placementPass: viewportBudget, cellCapFor,
// drawableMaxOf — 2.496.287). It was derived inside EntityVisuals, so every
// oracle handed the pass fixed caps and the measuring loop never ran here.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { viewportBudget, cellCapFor, drawableMaxOf, cardOf } = await import("@/babylon/placementPass");
const { MAX_GRID_CHIPS, MAX_TOTAL_CHIPS } = await import("@/babylon/badgeCard");
const { PHONE_MAX_GRID_CHIPS, CARD_MAX_VIEWPORT_FRACTION } = await import("@/babylon/badgeMetrics");

const metrics = { minGapPx: 2, cardIconFraction: 0.8, countPillFraction: 0.4, countFontFraction: 0.6 };
const shape = (perCardCap) => ({ metrics, summary: { size: 40, font: 16, countSize: 16, countFont: 10 }, perCardCap });

ck("the budget is the screen's share, divided back through the drawn scale", viewportBudget(1000, 2, 0.5) === 250);
ck("  ...and nothing before there is a screen or a scale", viewportBudget(0, 2, 0.5) === 0 && viewportBudget(1000, 0, 0.5) === 0);

const wide = cellCapFor(shape(MAX_GRID_CHIPS), viewportBudget(2400, 1, CARD_MAX_VIEWPORT_FRACTION));
const narrow = cellCapFor(shape(MAX_GRID_CHIPS), viewportBudget(320, 1, CARD_MAX_VIEWPORT_FRACTION));
ck("a wide screen fits every cell", wide === MAX_TOTAL_CHIPS, wide);
ck("a narrow one fewer — measured against the card the layout draws", narrow < wide
   && cardOf(shape(MAX_GRID_CHIPS), narrow).width <= viewportBudget(320, 1, CARD_MAX_VIEWPORT_FRACTION) || narrow === 2, narrow);
ck("never below a pair, however small the screen", cellCapFor(shape(MAX_GRID_CHIPS), 1) === 2);
ck("no screen yet: the ceiling, not zero", cellCapFor(shape(MAX_GRID_CHIPS), 0) === MAX_TOTAL_CHIPS);
let mono = true, prev = 0;
for (let w = 200; w <= 3000; w += 50) { const c = cellCapFor(shape(PHONE_MAX_GRID_CHIPS), viewportBudget(w, 1, CARD_MAX_VIEWPORT_FRACTION)); if (c < prev) mono = false; prev = c; }
ck("a wider screen never fits FEWER cells (the cap is monotone in width)", mono);
ck("drawableMax: the cells cap, never above the ceiling", drawableMaxOf(4) === Math.min(4, MAX_TOTAL_CHIPS) && drawableMaxOf(99) === MAX_TOTAL_CHIPS);

const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
const pp = readFileSync(new URL("../../src/babylon/placementPass.ts", import.meta.url), "utf8");
ck("the solver and the renderer ask the same drawableMax", /drawableMaxOf\(frame\.cellCap\)/.test(pp) && /return drawableMaxOf\(this\.cardCellCap\(\)\);/.test(ev)
   && !/Math\.min\(MAX_TOTAL_CHIPS, (frame\.cellCap|this\.cardCellCap\(\))\)/.test(ev + pp));
ck("the renderer measures with cellCapFor and viewportBudget (no copy of either)",
   /const cells = cellCapFor\(this\.cardShape\(\), this\.cardBudget\(\), max\);/.test(ev) && (ev.match(/viewportBudget\(/g) ?? []).length === 2);
done("✅ how much fits on this screen is one tested rule");
