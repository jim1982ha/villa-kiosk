// Every chart shows its y-axis (owner, 2026-09-26: "always show the Y-axis
// details in the chart, so user knows the value displayed ... properly
// handled for mobile screens too"). The ticks are round steps over the
// chart's own range (chartGeometry.niceTicks), labelled short
// (chartGeometry.fmtAxis), and drawn by ONE module (ChartAxis) that every
// chart in the Energy and Weather windows uses.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const G = await import("@/utils/chartGeometry");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

console.log("  round ticks, over the chart's own range:");
const wk = G.niceTicks(0, 75.46);                       // a week's peak day, kWh
ck("a 75 kWh peak reads 0 / 50 / 100", wk.ticks.join() === "0,50,100" && wk.top === 100, wk);
const cost = G.niceTicks(0, 128281);                    // that day's cost
ck("a 128k cost peak reads 0 / 50k / 100k / 150k — the bar fills most of the height",
   cost.ticks.join() === "0,50000,100000,150000" && 128281 / cost.top > 0.8, cost);
const small = G.niceTicks(0, 0.42);
ck("a fraction of a kWh still gets steps (0.2), not one 0-to-1 interval", small.step === 0.2 && small.ticks.length === 4, small);
const temp = G.niceTicks(23.4, 31.2);
ck("a line's range that does not start at 0 gets ticks inside it", temp.bottom <= 23.4 && temp.top >= 31.2 && temp.ticks.some((v) => v > 23.4 && v < 31.2), temp);
ck("a flat range (lo = hi) does not divide by zero", G.niceTicks(5, 5).ticks.every(Number.isFinite));
ck("every tick is a whole multiple of the step (no 0.30000000000000004)",
   [wk, cost, small, temp].every((a) => a.ticks.every((v) => Math.abs(v / a.step - Math.round(v / a.step)) < 1e-9)));

console.log("\n  short labels (they sit in a 2.6em column on a phone):");
ck("128281 → 128k", G.fmtAxis(128281) === "128k", G.fmtAxis(128281));
ck("2500 → 2.5k, 1200000 → 1.2M", G.fmtAxis(2500) === "2.5k" && G.fmtAxis(1200000) === "1.2M");
ck("0.2 → 0.2, 50 → 50, 2.5 → 2.5 — no trailing zeros", G.fmtAxis(0.2) === "0.2" && G.fmtAxis(50) === "50" && G.fmtAxis(2.5) === "2.5");

console.log("\n  the callers:");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const energy = read("../../src/components/panels/EnergyPanel.tsx");
ck("the Energy bars are the app's BarChart, which draws the axis over the round top (bar_chart.mjs)",
   !/function Bars\(/.test(energy) && (energy.match(/<BarChart /g) ?? []).length === 4);
const bars = energy.match(/<BarChart\b[^]*?\/>/g) ?? [];
ck("  ...every Energy bar chart names its unit", bars.length === 4 && bars.every((b) => /\bunit=/.test(b)), bars.filter((b) => !/\bunit=/.test(b)));
const barComp = read("../../src/components/panels/BarChart.tsx");
ck("  ...and BarChart draws the YAxis from its layout's ticks", /<YAxis unit=\{unit\} height=\{height\} ticks=\{L\.ticks\} \/>/.test(barComp));
const weather = read("../../src/components/panels/WeatherPanel.tsx");
ck("each Weather line chart has a left axis, and a right one for a line on its own scale",
   /<YAxis height=\{CHART_PX\} unit=\{present\[0\]\?\.unit\.trim\(\)\} ticks=\{leftAxis\} \/>/.test(weather)
     && /\{rightAxis && <YAxis side="right"/.test(weather));
ck("the rain chart is a BarChart with its unit (so it has the axis)", /<BarChart label="Rain history" buckets=\{buckets\} height=\{CHART_PX\} unit=\{unit\}/.test(weather));
const css = read("../../src/styles/03-panels.css");
ck("the axis keeps its column at every width (no phone rule hides it)", !/\.chart-yaxis[^{]*\{[^}]*display:\s*none/.test(css));
ck("the unit sits clear above the top tick", /\.chart-yaxis-unit \{[^}]*top: -2em;/.test(css) && /\.chart-with-axis\.has-unit \{ margin-top: 1\.6em; \}/.test(css));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ every chart says what its values are");
