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
const { chartWindowHeight, ExpandableChart } = await import("@/components/panels/ChartWindow");

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

console.log("\n  the same chart, larger, wherever a trend chart is (architecture review 2026-10-29 #6):");
const sections = (rel) => elements(parseTsx(rel), "ExpandableChart");
const hist = sections("components/panels/NumericHistory.tsx"), weather = sections("components/panels/WeatherPanel.tsx");
ck("one shared section opens it: every device layout (one series, two on one chart, a chart per series) and the "
   + "Weather window's line charts", hist.length === 3 && weather.length === 1, [hist.length, weather.length]);
ck("  ...its window shows the chart's head: the `Last …` line with its period toggle (the device's header; the "
   + "Weather chart's title with the window's toggle)",
   hist.every((e) => /header\(/.test(propText(e, "head"))) && /picker/.test(propText(weather[0], "head")));
// a one-line chart is drawn by NumericHistory's oneLine (one series, and each of several): read its body once
const oneLine = elements(parseTsx("components/panels/NumericHistory.tsx"), "LineChart")
  .map((c) => c.getText()).find((t) => /filter=\{f\.filter\}/.test(t)) ?? "";
const drawn = (e) => (/^oneLine\(/.test(propText(e, "chart")) ? oneLine : propText(e, "chart"));
ck("  ...the same chart in both: small with its button, larger at the window's height, its range slider kept",
   [...hist, ...weather].every((e) => /onExpand=\{onExpand\}/.test(drawn(e)) && /height \?\? /.test(drawn(e)))
   && hist.filter((e) => /^oneLine\(/.test(propText(e, "chart"))).length === 2 && /filter=\{f\.filter\}/.test(oneLine));
const opened = draw(h(ExpandableChart, { title: "T", head: h("p", null, "HEAD"),
  chart: (height, onExpand) => h("i", { "data-h": String(height), "data-x": onExpand ? "yes" : "no" }) }));
ck("  ...drawn closed: the small chart (its own height) with its button, no window",
   /data-h="undefined" data-x="yes"/.test(opened) && !opened.includes("HEAD"), opened);
done("✅ a device's chart opens larger, the same chart with its header, toggle and slider");
