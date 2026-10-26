// Every chart shows its y-axis (owner, 2026-09-26: "always show the Y-axis
// details in the chart, so user knows the value displayed ... properly
// handled for mobile screens too"). The ticks are round steps over the
// chart's own range (chartGeometry.niceTicks), labelled short
// (chartGeometry.fmtAxis), and drawn by ONE module (ChartAxis) that every
// chart in the Energy and Weather windows uses.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const G = await import("@/utils/chartGeometry");


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
ck("with its step, every tick exact: a 2.5 step reads 27.5 / 25 / 22.5 / 20 (it read 28 / 25 / 23 / 20)",
   [27.5, 25, 22.5, 20].map((v) => G.fmtAxis(v, 2.5)).join() === "27.5,25,22.5,20", [27.5, 25, 22.5, 20].map((v) => G.fmtAxis(v, 2.5)));
ck("  ...whole steps stay whole, and k / M keep the step's precision (0.25 kWh, 1.25k, 2k)",
   G.fmtAxis(30, 10) === "30" && G.fmtAxis(0.25, 0.25) === "0.25" && G.fmtAxis(1250, 250) === "1.25k" && G.fmtAxis(2000, 250) === "2k" && G.fmtAxis(1.5e6, 5e5) === "1.5M");
{
  const ax = readFileSync(new URL("../../src/components/panels/ChartAxis.tsx", import.meta.url), "utf8");
  ck("  ...and the one y-axis passes its ticks' step", /const step = ticks\.length > 1 \? Math\.abs\(ticks\[1\]\.v - ticks\[0\]\.v\) : undefined;/.test(ax) && /fmtAxis\(t\.v, step\)/.test(ax));
}
ck("2500 → 2.5k, 1200000 → 1.2M", G.fmtAxis(2500) === "2.5k" && G.fmtAxis(1200000) === "1.2M");
ck("0.2 → 0.2, 50 → 50, 2.5 → 2.5 — no trailing zeros", G.fmtAxis(0.2) === "0.2" && G.fmtAxis(50) === "50" && G.fmtAxis(2.5) === "2.5");

console.log("\n  one tick rule for every line chart — the geometry's:");
{
  const w = { from: 0, to: 10 };
  const g = G.chartGeometry(w, [{ pts: [{ t: 0, v: 23.4 }, { t: 5, v: 31.2 }], gaps: [] }], { left: 0, right: 100, top: 0, bottom: 100 });
  const sg = g.series[0];
  ck("a series' ticks are round values inside its range", sg.ticks.length >= 2 && sg.ticks.every((t) => t.v >= sg.lo && t.v <= sg.hi) && sg.ticks.map((t) => t.v).join() === "24,26,28,30", sg.ticks);
  ck("  ...each at its pixel y", sg.ticks.every((t) => Math.abs(t.y - sg.sy(t.v)) < 1e-9));
  const own = G.chartGeometry(w, [{ pts: [{ t: 0, v: 20 }], gaps: [] }, { pts: [{ t: 0, v: 0 }, { t: 5, v: 900 }], gaps: [], scale: "fromZero" }], { left: 0, right: 100, top: 0, bottom: 100 });
  ck("a series on its own scale has its own ticks (sunlight 0 / 250 / 500 / 750)", own.series[1].ticks.map((t) => t.v).join() === "0,250,500,750", own.series[1].ticks);
}
const lc = readFileSync(new URL("../../src/components/panels/LineChart.tsx", import.meta.url), "utf8");
ck("the app's one line chart draws the geometry's ticks through the one axis (YAxis) — no hi/mid/lo of its own",
   /const leftAxis: readonly AxisTick\[\] = g\.series\[0\]\.ticks;/.test(lc) && /<YAxis zoomable height=\{H\} frame=\{H\}/.test(lc)
     && /ticks=\{g\.series\[ownAt\]\.ticks\}/.test(lc) && !/yTicks|\[ga\.hi, ga\.lo\]/.test(lc));

console.log("\n  the callers:");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const energy = read("../../src/components/panels/EnergyPanel.tsx");
ck("the Energy bars are the app's BarChart, which draws the axis over the round top (bar_chart.mjs)",
   !/function Bars\(/.test(energy) && (energy.match(/<BarChart /g) ?? []).length === 3);
const bars = energy.match(/<BarChart\b[^]*?\/>/g) ?? [];
ck("  ...every Energy bar chart names its unit (the energy-and-cost one both: kWh left, the currency right)", bars.length === 3 && bars.every((b) => /\bunit=/.test(b)), bars.filter((b) => !/\bunit=/.test(b)));
const barComp = read("../../src/components/panels/BarChart.tsx");
ck("  ...and BarChart draws the YAxis from its layout's ticks", /<YAxis unit=\{unit\} height=\{height\} frame=\{1\} ticks=\{L\.ticks\} \/>/.test(barComp));
const weather = read("../../src/components/panels/WeatherPanel.tsx");
ck("each Weather line chart is the app's LineChart, at the rain chart's CHART_PX (a right axis for a line on its own scale is LineChart's)",
   /<LineChart stepMs=\{stepMs\} label=\{`\$\{title\} history`\} height=\{CHART_PX\}/.test(weather) && /scale: l\.ownScale \? "fromZero" as const : "shared" as const/.test(weather)
     && !/<YAxis|<svg className="weather-chart"/.test(weather));
ck("  ...and LineChart sets its SVG to the same height as its axis", /style=\{\{ height: H, touchAction: "none" \}\}/.test(lc));
ck("the rain chart is a BarChart with its unit (so it has the axis)", /<BarChart label="Rain history" buckets=\{buckets\} height=\{CHART_PX\} unit=\{unit\}/.test(weather));
const css = read("../../src/styles/03-panels.css");
ck("the axis keeps its column at every width (no phone rule hides it)", !/\.chart-yaxis[^{]*\{[^}]*display:\s*none/.test(css));
ck("the unit sits clear above the top tick", /\.chart-yaxis-unit \{[^}]*top: -2em;/.test(css) && /\.chart-with-axis\.has-unit \{ margin-top: 1\.6em; \}/.test(css));

const sunUv = weather.match(/line\("solar", \{ cls: "([^"]+)"[^)]*\), line\("uv", \{ cls: "([^"]+)"/);
ck("Sun & UV: the two lines have DIFFERENT colours (owner, 2026-09-26: tell sunlight from UV)",
   !!sunUv && sunUv[1].split(" ")[0] !== sunUv[2].split(" ")[0], sunUv && [sunUv[1], sunUv[2]]);
ck("  ...the legend says the same, and UV's colour has a line, a key and an axis tint",
   /\["UV", "uv"\]/.test(weather) && /\)\.uv \{ --series: var\(--status-danger\); \}/.test(css)
     && /\.chart-line:is\([^)]*\.uv[^)]*\) \{ stroke: var\(--series\); \}/.test(css) && /\.key:is\([^)]*\.uv[^)]*\) \{ background: var\(--series\); \}/.test(css)
     && /\.chart-yaxis\.tint-uv, \.chart-unit\.tint-uv \{/.test(css));
ck("  ...and the right axis wears its line's colour (its class, or its CSS colour)",
   /ticks=\{g\.series\[ownAt\]\.ticks\}\s*cls=\{right\.cls\?\.split\(" "\)\[0\]\} color=\{right\.color\} \/>/.test(lc));

console.log("\n  the axis fit, one setting per tablet (owner, 2026-10-26): from 0, or fitted; a tap on any y-axis or its fit mark swaps it:");
{
  const w = { from: 0, to: 10 }, plot = { left: 0, right: 100, top: 0, bottom: 100 };
  const battery = [{ t: 0, v: 40 }, { t: 6, v: 91 }];                          // the owner's picture: 40 to 91 %
  const z = G.chartGeometry(w, [{ pts: battery, gaps: [], unit: "%" }], plot, 0.08, "zero").series[0];
  const fitted = G.chartGeometry(w, [{ pts: battery, gaps: [], unit: "%" }], plot, 0.08, "fitted").series[0];
  ck("from 0: a battery from 40 to 91 % is drawn on 0 to its top, its ticks from 0", z.lo === 0 && z.hi >= 91 && z.ticks[0].v === 0, z.ticks);
  ck("  ...fitted: its values fill the plot (the old zoomed look), no 0", fitted.lo > 30 && fitted.ticks.every((t) => t.v > 0), fitted.ticks);
  const cold = G.chartGeometry(w, [{ pts: [{ t: 0, v: -4 }, { t: 5, v: 6 }], gaps: [] }], plot, 0.08, "zero").series[0];
  ck("  ...a temperature below 0 keeps its floor (the axis holds 0 and every value)", cold.lo <= -4 && cold.hi >= 6, [cold.lo, cold.hi]);
  const wifi = G.chartGeometry(w, [{ pts: [{ t: 0, v: -86 }, { t: 5, v: -48 }], gaps: [] }], plot, 0.08, "zero").series[0];
  ck("  ...a signal always negative (dBm): from 0 puts 0 at the TOP", wifi.hi === 0 && wifi.lo <= -86 && wifi.ticks.at(-1).v === 0, [wifi.lo, wifi.hi]);
  const two = G.chartGeometry(w, [{ pts: [{ t: 0, v: 20 }, { t: 5, v: 22 }], gaps: [] }, { pts: [{ t: 0, v: 300 }, { t: 5, v: 900 }], gaps: [], scale: "own" }], plot, 0.08, "zero");
  ck("  ...a line on its own scale too (the right axis)", two.series[0].lo === 0 && two.series[1].lo === 0, [two.series[0].lo, two.series[1].lo]);
  const pump = G.chartGeometry(w, [{ pts: [{ t: 0, v: 190 }, { t: 5, v: 610 }], gaps: [] }], plot, 0.08, "fitted").series[0];
  ck("fitted, no range: 190 to 610 W starts near its lowest value (about 150), never rounded down to 0, its ticks inside",
     pump.lo > 140 && pump.lo < 190 && pump.hi > 610 && pump.hi < 660 && pump.ticks.every((t) => t.v >= pump.lo && t.v <= pump.hi) && pump.ticks[0].v > 0,
     { lo: pump.lo, hi: pump.hi, ticks: pump.ticks.map((t) => t.v) });
  const P = await import("@/utils/viewPrefs");
  let told = 0;
  const off = P.onChartFit(() => told++);
  const was = P.chartFit();
  P.toggleChartFit();
  const flipped = P.chartFit();
  P.setChartFit(was);
  off();
  ck("the setting opens from 0, one call swaps it for every chart and tells each one shown", was === "zero" && flipped === "fitted" && told === 2, { was, flipped, told });
  const { h, draw } = await import("../consistency/screen.mjs");
  const { parseTsx, elements, propText } = await import("../consistency/jsx.mjs");
  const { FitMark } = await import("@/components/panels/ChartAxis");
  P.setChartFit("zero");
  const asZero = draw(h(FitMark));
  P.setChartFit("fitted");
  const asFitted = draw(h(FitMark));
  ck("the fit mark shows the fit now: from 0 an arrow down to a line with a 0, fitted two arrows closing in",
     /chart-fit-mark zero/.test(asZero) && /lucide-arrow-down-to-line/.test(asZero) && />0</.test(asZero) && /Axis from 0: tap to fit/.test(asZero)
       && /chart-fit-mark fitted/.test(asFitted) && /lucide-fold-vertical/.test(asFitted) && /Axis fitted: tap to show from 0/.test(asFitted), [asZero, asFitted]);
  // a tap: the mark's own onClick, taken from it as React draws it (its hooks run inside a component)
  const tap = () => { let on = null; draw(h(() => { on = FitMark().props.onClick; return null; })); on(); };
  P.setChartFit("zero");
  tap();
  const afterOne = P.chartFit();
  tap();
  ck("  ...a tap on it swaps the one setting (from 0 → fitted → from 0)", afterOne === "fitted" && P.chartFit() === "zero", { afterOne, now: P.chartFit() });
  const lineTree = parseTsx("components/panels/LineChart.tsx");
  const axes = elements(lineTree, "YAxis");
  ck("  ...a line chart's axes are the tap too (both sides); a bar chart's axis is not",
     axes.length === 2 && axes.every((a) => propText(a, "zoomable") === true) && !/zoomable/.test(barComp));
  const ax = read("../../src/components/panels/ChartAxis.tsx");
  ck("  ...the chart draws with the setting", /const fit = useChartFit\(\);/.test(lc) && /plot, 0\.08, fit\)/.test(lc)
     && /onClick: toggleChartFit,/.test(ax) && /onClick=\{toggleChartFit\}/.test(ax), null);
  // stored before: "1" from 0, "0" zoomed (= fitted); the key keeps its meaning
  ck("a tablet's old choice reads the same: \"1\" from 0, \"0\" fitted, nothing from 0; and each fit writes back what it reads",
     P.fitOfStored("1") === "zero" && P.fitOfStored("0") === "fitted" && P.fitOfStored(null) === "zero"
       && /writeString\(CHART_FIT_KEY, fit === "zero" \? "1" : "0"\)/.test(read("../../src/utils/viewPrefs.ts")));
}

done("✅ every chart says what its values are");
