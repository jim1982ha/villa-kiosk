// A stretch with no readings must be DRAWN as a stretch with no readings.
//
// ⚠️ THIS ORACLE RUNS THE SHIPPED MODULE, not a transcription of it. The alias
// hook next door lets plain `node` import the real `src/` TypeScript.
//
// REPORTED FROM THE VILLA against 2.496.48: a pump's 24h chart showed the value
// drop to 0 at 22:15 and then climb in a smooth straight line all night, back
// to full power by morning. The pump reported nothing for those eleven hours.
// `fetchHistory` parsed each row with `numericState` and then dropped whatever
// was not finite — "unavailable" and "unknown" among them — so the outage was
// not drawn as an outage, it was DELETED, and the line joined the reading
// either side of it. A picture of a device ramping up all night.
//
// ⚠️ THE STATE TIMELINE NEXT DOOR WAS ALWAYS RIGHT, which is why the two
// disagreed on the same screen. It reads raw state strings, so "unavailable" is
// a value it can colour. The numeric path turns states into numbers first, and
// a number cannot say "there was nothing here" — the same shape as the older
// `Number(null) === 0` defect, one level up.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

register("../consistency/alias-hook.mjs", import.meta.url);

const { gapsFrom, splitAtGaps, gapBand } = await import("@/utils/historyGaps");

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };

const H = 3_600_000;
const T0 = 1_757_000_000_000;          // an arbitrary fixed epoch — no real date
const at = (h) => T0 + h * H;

/** The reported shape: readings, a long dead stretch, readings again. */
const ROWS = [
  { t: at(0), v: 35.7 }, { t: at(1), v: 35.6 }, { t: at(2), v: 0 },
  { t: at(3), v: NaN }, { t: at(4), v: NaN }, { t: at(12), v: NaN },
  { t: at(13), v: 35.7 }, { t: at(14), v: 35.5 },
];
const NOW = at(14);

const gaps = gapsFrom(ROWS, NOW);
const points = ROWS.filter((r) => Number.isFinite(r.v));
console.log(`\n  ${ROWS.length} rows → ${points.length} readings, ${gaps.length} gap(s)`);
for (const g of gaps) console.log(`     gap ${(g.from - T0) / H}h → ${(g.to - T0) / H}h`);

/* ── 1. the dead stretch becomes exactly one gap, of the right extent ───── */
const oneGap = gaps.length === 1 && gaps[0].from === at(3) && gaps[0].to === at(13);

/* ── 2. the line is broken across it ────────────────────────────────────── */
// This is the assertion that would have caught the bug on screen. With the old
// code there were no gaps at all, so the points formed ONE run and the chart
// drew one unbroken polyline straight through the outage.
const runs = splitAtGaps(points, gaps);
console.log(`  runs: ${runs.map((r) => r.length).join(" + ")} points`);
const runsBefore = splitAtGaps(points, []);   // the old behaviour, exactly
console.log(`  runs with no gaps (the old drawing): ${runsBefore.map((r) => r.length).join(" + ")}`);

/* ── 3. a still-running outage closes at `now`, not at the last row ─────── */
const trailing = gapsFrom(
  [{ t: at(0), v: 12 }, { t: at(1), v: NaN }], at(5));
const stillOpen = trailing.length === 1 && trailing[0].from === at(1) && trailing[0].to === at(5);

/* ── 4. an outage the window OPENS in is still an outage ────────────────── */
const leading = gapsFrom(
  [{ t: at(0), v: NaN }, { t: at(2), v: 7 }], at(3));
const fromStart = leading.length === 1 && leading[0].from === at(0) && leading[0].to === at(2);

/* ── 5. a clean series produces no gaps and no breaks ───────────────────── */
const clean = gapsFrom([{ t: at(0), v: 1 }, { t: at(1), v: 2 }], at(1));

/* ── 6. the band is clamped to the plot, and never rounds away ──────────── */
// sx maps the 14h window onto x 40..340.
const sx = (t) => 40 + ((t - T0) / (14 * H)) * 300;
// ⚠️ GUARDED, BECAUSE A MISSING GAP IS THE EXACT REGRESSION THIS PINS. The
// first version indexed gaps[0] straight into gapBand, so a change that
// stopped reporting gaps at all — the old behaviour, precisely — made this
// file THROW instead of reporting which rule broke. Exit 1 either way, but a
// stack trace does not tell the next reader what the villa will draw.
const band = gaps[0] ? gapBand(gaps[0], sx, 40, 340) : null;
// An outage that began before the window starts must not paint outside the plot.
const overhang = gapBand({ from: T0 - 50 * H, to: at(1) }, sx, 40, 340);
// Thirty seconds inside a 14-hour window is sub-pixel, and must still show.
const brief = gapBand({ from: at(6), to: at(6) + 30_000 }, sx, 40, 340);
console.log(`  band ${band ? `x=${band.x.toFixed(1)} w=${band.w.toFixed(1)}` : "NONE — no gap to draw"}`
  + ` · clamped-overhang x=${overhang.x.toFixed(1)}`
  + ` · 30s outage w=${brief.w.toFixed(2)}`);

/* ── 7. EVERY numeric line chart, not just the two that were fixed ─────── */
// ⚠️ ROLLED OUT BY WHAT IT APPLIES TO, NOT BY THE CALL SITES THAT EXISTED. The
// report named one chart; two draw numeric series, and the third somebody adds
// next year is the one this catches. A chart that draws a <polyline> from
// history and does NOT consult the gap helpers is drawing an outage as a
// reading, whatever it looks like in review.
const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const FILES = walk(SRC);
const lineCharts = FILES.filter((f) => /<polyline/.test(readFileSync(f, "utf8")));
const blind = lineCharts.filter((f) => {
  const src = readFileSync(f, "utf8");
  return !/splitAtGaps/.test(src) || !/gapBand/.test(src) || !/STATUS_COLOR\.unavailable/.test(src);
}).map((f) => f.slice(SRC.length + 1));
console.log(`\n  scanned ${FILES.length} source files · ${lineCharts.length} draw a numeric line`);
for (const f of lineCharts) console.log(`     ${f.slice(SRC.length + 1)}`);
if (blind.length) console.log(`      ✗ draws a line but ignores gaps: ${blind.join(", ")}`);

console.log("\n  assertions:");
ck("the dead stretch is one gap, spanning first-missing to next-reading", oneGap);
ck("the line is broken into two runs", runs.length === 2);
ck("  ...and every reading survives the split", runs.flat().length === points.length);
ck("  ...which the old drawing did NOT do (one run through the outage)",
   runsBefore.length === 1 && runsBefore[0].length === points.length);
ck("an outage still running closes at now, not at the last row", stillOpen);
ck("an outage the window opens in is still reported", fromStart);
ck("a clean series has no gaps", clean.length === 0);
ck("  ...and is drawn as a single unbroken run",
   splitAtGaps([{ t: at(0) }, { t: at(1) }], []).length === 1);
ck("the outage has a band at all", band !== null);
ck("the band never paints outside the plot", overhang.x >= 40 && overhang.x + overhang.w <= 340);
ck("a sub-pixel outage still gets a visible band", brief.w >= 1);
ck("the scan reached the source tree", FILES.length > 100);
ck("both numeric line charts were found", lineCharts.length >= 2);
ck("every numeric line chart shades its gaps", blind.length === 0);

if (fail) {
  console.log("\n  FAIL — the chart is drawing a reading where there was none.");
}
process.exit(fail ? 1 : 0);
