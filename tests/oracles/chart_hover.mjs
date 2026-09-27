// A chart's hover, both ends (src/utils/chartHover.ts): where the pointer is
// across the plot, and where the tooltip goes. Round-6 candidate 3 (2.496.117).
//
// ⚠️ SIX COPIES OF "IN", SIX CONVENTIONS OF "OUT". The pointer was read into
// px, viewBox units, percentages or a bucket index at each chart, half with no
// zero-width guard; the tip was placed in px here, a percentage there, viewBox
// units passed as px at two, flipped by four rules (one a hard-coded 160 px),
// and the state timeline drew a tooltip of its own.
import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const H = await import("@/utils/chartHover");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

console.log("  in — the pointer, as a fraction across the plot:");
ck("a quarter of the way across a 400 px chart at x=100 is 0.25", H.pointerFraction(200, 100, 400) === 0.25);
ck("clamped to the plot", H.pointerFraction(50, 100, 400) === 0 && H.pointerFraction(900, 100, 400) === 1);
ck("a chart of no width (not laid out yet) is 0, not NaN or Infinity", H.pointerFraction(10, 0, 0) === 0);

console.log("\n  out — where the tip goes:");
const vp = { w: 1000, h: 800 }, tip = { w: 200, h: 120 };
ck("it hangs right of and below its anchor", JSON.stringify(H.placeTip({ x: 300, y: 200 }, tip, vp, false)) === '{"x":300,"y":200}');
ck("flipped, it hangs to the LEFT", H.placeTip({ x: 700, y: 200 }, tip, vp, true).x === 500);
ck("no room below: it opens UPWARD from its anchor (the energy flow's low rows)", H.placeTip({ x: 300, y: 750 }, tip, vp, false).y === 630);
ck("never past the viewport's edge", (() => { const p = H.placeTip({ x: 950, y: 5 }, tip, vp, false); return p.x === 1000 - 200 - H.TIP_EDGE && p.y === H.TIP_EDGE; })());
ck("  ...even taller than the room above and below: pinned to the top margin", H.placeTip({ x: 10, y: 400 }, { w: 100, h: 900 }, vp, false).y === H.TIP_EDGE);
ck("it flips past the chart's middle, whatever the chart (no 160 px, no W/2 of a viewBox)",
   H.tipFlips(260, 100, 300) === true && H.tipFlips(240, 100, 300) === false);

console.log("\n  every chart speaks it:");
const dir = new URL("../../src/components/panels/", import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), "utf8");
const tipSrc = read("ChartTip.tsx");
ck("ChartTip floats ABOVE the window (portal, fixed) — inside, a tall tip grew the window's scroll and was cut off (2.496.112)",
   /createPortal\(\s*<div ref=\{tip\} className="spark-tip chart-tip"\s*style=\{\{ position: "fixed"/.test(tipSrc) && /document\.body,/.test(tipSrc)
     && /placeTip\(\{ x: r\.left, y: r\.top \}/.test(tipSrc) && /tipFlips\(r\.left, box\.left, box\.width\)/.test(tipSrc));
ck("  ...and above the modals", /\.chart-tip \{ z-index: 300; \}/.test(readFileSync(new URL("../../src/styles/03-panels.css", import.meta.url), "utf8")));
ck("ChartTip takes a point as FRACTIONS and a worded stamp — no px, no flip, no dummy time", /export default function ChartTip\(\{ x, y, rows, stamp \}/.test(tipSrc));
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
const tipCallers = files.filter((f) => /<ChartTip /.test(read(f)));
ck("the charts that show a tooltip are these four (one line chart since 2.496.144)", tipCallers.sort().join() === "BarChart.tsx,EnergyPanel.tsx,LineChart.tsx,StateTimeline.tsx", tipCallers);
ck("no chart draws a tooltip of its own (the state timeline did)", files.filter((f) => f !== "ChartTip.tsx" && /className="spark-tip"/.test(read(f))).length === 0);
const readers = tipCallers.filter((f) => /e\.clientX|e\.clientY/.test(read(f)));
ck("no chart reads the pointer itself: useChartPointer does, once", readers.length === 0, readers);
for (const f of ["LineChart.tsx", "BarChart.tsx", "StateTimeline.tsx"]) {
  ck(`  ${f} uses it`, /useChartPointer</.test(read(f)));
}
ck("  LineChart reads it as a time in the geometry", /const hover = frac !== null \? g\.hover\(g\.tAt\(frac \* W\)\) : null;/.test(read("LineChart.tsx")));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one hover: pointer in, tip out");
