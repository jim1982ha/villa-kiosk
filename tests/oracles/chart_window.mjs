// A device's chart, larger (owner, 2026-10-29: "a graceful icon at the top right of the mini-chart trends on the same
// line as the Y-axis unit … to increase the chart in full-screen (or … a modal the same size as the Cockpit modal) …
// the extended view shall have the line `Last …` and the time aggregation toggle too … and the Y-axis bound filter"):
// the button drawn on the chart's unit line, at its right; the window the windows' own frame at the Cockpit's width;
// the larger chart the same chart (its header, toggle and slider, bound to the same choices), without a button of its
// own. Drawn by value, then the history section's markup read through the compiler's tree.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { h, draw, inside } from "../consistency/screen.mjs";
import { elements, guardsOf, parseTsx, propText } from "../consistency/jsx.mjs";
const LineChart = (await import("@/components/panels/LineChart")).default;
const ChartWindow = (await import("@/components/panels/ChartWindow")).default;
const { chartWindowHeight } = await import("@/components/panels/ChartWindow");

const pts = [{ t: 0, v: 40 }, { t: 1000, v: 90 }, { t: 2000, v: 60 }];
const chart = (extra = {}) => ({ lines: [{ pts, label: "x", unit: " W" }], window: { from: 0, to: 3000 }, status: "ready",
  label: "History", stepMs: 300000, height: 110, ...extra });

console.log("  the button, on the unit line:");
const small = draw(h(LineChart, chart({ onExpand() {} })));
const line = inside(small, "chart-unit-line");
ck("a mini chart draws its enlarge button on the unit line, after the unit (on its right)",
   /W<\/span>[\s\S]*class="chart-expand"/.test(line) && /aria-label="Enlarge: History"/.test(line), line);
const two = inside(draw(h(LineChart, chart({ onExpand() {}, lines: [{ pts, label: "a", unit: " W", scale: "own" },
  { pts, label: "b", unit: " %", scale: "own" }] }))), "chart-unit-line");
ck("  ...on a chart of two scales, after the right axis' unit too: at the far right", /%<\/span>[\s\S]*class="chart-expand"/.test(two), two);
ck("  ...the larger one (no onExpand) draws none", !draw(h(LineChart, chart())).includes("chart-expand"));

console.log("\n  the window:");
const win = draw(h(ChartWindow, { title: "Pool pump", onClose() {} }, h("p", null, "the chart")));
ck("the windows' own frame at the Cockpit's width: its title, the chart, Close",
   /class="modal window-content settings-modal cockpit-modal chart-modal"/.test(win) && win.includes("<h2>Pool pump</h2>")
   && win.includes("the chart") && win.includes("Close"), win);
ck("  ...the plot as tall as the screen allows, within bounds",
   chartWindowHeight(1000) === 560 && chartWindowHeight(700) === 340 && chartWindowHeight(400) === 220);

console.log("\n  the same chart, larger:");
const hist = parseTsx("components/panels/NumericHistory.tsx");
const windows = elements(hist, "ChartWindow");
ck("every layout opens one (one series, two on one chart, a chart per series), only when asked",
   windows.length === 3 && windows.every((w) => guardsOf(w).some((g) => g === "big" || g === "opened")),
   windows.map((w) => guardsOf(w)));
ck("  ...each with the header (`Last …`, its step and the period toggle) and the chart, at the window's height",
   windows.every((w) => /header\(/.test(w.getText()) && /\(tall\)|, tall\)/.test(w.getText())));
const charts = elements(hist, "LineChart");
ck("  ...the same chart: one LineChart per layout, drawn twice (small with its button, large without)",
   charts.length === 3 && charts.every((c) => propText(c, "onExpand") === "onExpand"));
const filtered = charts.filter((c) => propText(c, "filter"));
ck("  ...with its range slider where the small one has it (its filter, the same state)",
   filtered.length === 2 && filtered.every((c) => propText(c, "filter") === "f.filter"));

done("✅ a device's chart opens larger, the same chart with its header, toggle and slider");
