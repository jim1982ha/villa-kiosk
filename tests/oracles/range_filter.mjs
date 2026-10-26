// The range filter of a device's trend chart (owner, 2026-10-26): two handles beside the y-axis keep only the values
// between them; each point is the average of ONLY its finer values inside [lo, hi], 0 when none is, and 0 counts in
// the overall average. Driven through the pure module (utils/rangeFilter), the history source's "finer" request, and
// the drawn chart (LineChart, ChartRangeSlider): its handles level with the axis' own ticks in both zero modes.
import { h, draw, inside } from "../consistency/screen.mjs";
import { parseTsx, elements } from "../consistency/jsx.mjs";
import ts from "typescript";
import { ck, done } from "../consistency/check.mjs";
const R = await import("@/utils/rangeFilter");
const { intervalSeries } = await import("@/utils/trendInterval");
const { cellEdges } = await import("@/utils/timelineCells");
const { localMidnight, DAY_MS, HOUR_MS } = await import("@/utils/localDay");
const { chartGeometry } = await import("@/utils/chartGeometry");
const { loadOne, historyKey } = await import("@/ha/historySource");
const P = await import("@/utils/viewPrefs");
const LineChart = (await import("@/components/panels/LineChart")).default;
const { rangeWords } = await import("@/components/panels/LineChart");

const near = (a, b) => Math.abs(a - b) < 1e-9;
const M = 60_000;

console.log("  the owner's example: daily averages of 7 days of hourly values");
{
  const start = localMidnight(Date.UTC(2026, 5, 1, 12));            // a week with no clock change
  const window = { from: start, to: start + 7 * DAY_MS };
  // all 0 but day 2 500 for 1h, day 3 1000 for 1h, day 4 1500 all day, day 5 5000 for 2h and 2000 for 2h
  const hourly = (d, hr) => d === 1 && hr === 10 ? 500 : d === 2 && hr === 10 ? 1000 : d === 3 ? 1500
    : d === 4 && (hr === 10 || hr === 11) ? 5000 : d === 4 && (hr === 12 || hr === 13) ? 2000 : 0;
  const points = [];
  for (let d = 0; d < 7; d++) for (let hr = 0; hr < 24; hr++) points.push({ t: start + d * DAY_MS + hr * HOUR_MS, v: hourly(d, hr) });
  const finer = { of: "day", stepMs: HOUR_MS, series: { points, gaps: [], window } };
  const day = (d) => points.filter((p) => p.t >= start + d * DAY_MS && p.t < start + (d + 1) * DAY_MS).reduce((a, p) => a + p.v, 0) / 24;
  const base = { points: Array.from({ length: 7 }, (_, d) => ({ t: start + d * DAY_MS, v: day(d) })), gaps: [], window };
  const run = (lo, hi) => R.filterSeries(base, finer, DAY_MS, { lo, hi });
  const vals = (r) => r.series.points.map((p) => Math.round(p.v * 1000) / 1000).join();
  ck("unfiltered (today's chart), day 2 reads 500 / 24, about 21", near(base.points[1].v, 500 / 24) && Math.round(base.points[1].v) === 21);
  const all = run(-Infinity, Infinity);
  ck("  ...and the rule over every value gives that same chart, point for point", all.series.points.every((p, i) => near(p.v, base.points[i].v)), vals(all));
  const a = run(450, 550);
  ck("kept 450 to 550: day 2 reads 500, every other day 0", vals(a) === "0,500,0,0,0,0,0" && a.inRangeMs === HOUR_MS, [vals(a), a.inRangeMs]);
  const b = run(550, 1500);
  ck("kept 550 to 1500: day 3 1000, day 4 1500, the others 0", vals(b) === "0,0,1000,1500,0,0,0" && b.inRangeMs === 25 * HOUR_MS, [vals(b), b.inRangeMs]);
  const c = run(3000, 5000);
  ck("kept 3000 to 5000: day 5 reads 5000 (its two 5000 hours, never 3500), the others 0", vals(c) === "0,0,0,0,5000,0,0", vals(c));
  ck("  ...0 counts in the overall average (5000 / 7), and 2h in range", near(c.avg, 5000 / 7) && c.inRangeMs === 2 * HOUR_MS, [c.avg, c.inRangeMs]);
  ck("  ...each point stays where the chart drew it", c.series.points.every((p, i) => p.t === base.points[i].t) && c.series.gaps === base.gaps);
}

console.log("\n  a five-minute step: the readings themselves, each weighted by how long it held");
{
  const t0 = Date.UTC(2026, 8, 27, 10, 0);
  const window = { from: t0, to: t0 + 15 * M };
  // 10 for 2 min, 100 for 2 min, 10 for 3 min, 100 for 3 min (to 10:10), 100 again until an outage at 10:12
  const raw = { points: [{ t: t0, v: 10 }, { t: t0 + 2 * M, v: 100 }, { t: t0 + 4 * M, v: 10 }, { t: t0 + 7 * M, v: 100 }, { t: t0 + 10 * M, v: 100 }],
    gaps: [{ from: t0 + 12 * M, to: t0 + 15 * M }], window };
  const base = intervalSeries(raw, 5 * M);
  const finer = { of: "5minute", series: raw };
  const all = R.filterSeries(base, finer, 5 * M, { lo: -Infinity, hi: Infinity });
  ck("over every value, the rule is the chart's own five-minute values (intervalSeries)",
     all.series.points.length === base.points.length && all.series.points.every((p, i) => near(p.v, base.points[i].v)), [all.series.points, base.points]);
  const hi = R.filterSeries(base, finer, 5 * M, { lo: 50, hi: 150 });
  ck("kept 50 to 150: 10:00 reads 100 (its 2 min at 100), 10:05 100, 10:10 100 (2 min known before the outage)",
     hi.series.points.map((p) => p.v).join() === "100,100,100", hi.series.points.map((p) => p.v));
  ck("  ...and the time in range is the minutes at 100: 2 + 3 + 2 = 7min", hi.inRangeMs === 7 * M, hi.inRangeMs / M);
  const lo = R.filterSeries(base, finer, 5 * M, { lo: 0, hi: 50 });
  ck("kept 0 to 50: 10:00 reads 10, 10:05 10, 10:10 0 (no reading inside), weighted 3min + 2min",
     lo.series.points.map((p) => p.v).join() === "10,10,0" && lo.inRangeMs === 5 * M, [lo.series.points.map((p) => p.v), lo.inRangeMs / M]);
  // time weighting, not a count: 1 min at 20 and 4 min at 40 in one step, both kept
  const w = { points: [{ t: t0, v: 20 }, { t: t0 + M, v: 40 }], gaps: [], window: { from: t0, to: t0 + 5 * M } };
  const tw = R.filterSeries(intervalSeries(w, 5 * M), { of: "5minute", series: w }, 5 * M, { lo: 0, hi: 100 });
  ck("  ...a reading counts for how long it held (1 min at 20, 4 at 40 → 36, not 30)", near(tw.series.points[0].v, 36), tw.series.points[0].v);
}

console.log("\n  the defaults are the chart unfiltered");
{
  const pts = [{ t: 0, v: 40 }, { t: 1000, v: 90 }, { t: 2000, v: 60 }];
  const d = R.defaultRange(pts);
  ck("the slider opens on the lowest and highest value the chart shows", d.lo === 40 && d.hi === 90, d);
  ck("  ...at its defaults, or wider, nothing is filtered; any narrower side filters",
     R.activeRange(d, pts) === null && R.activeRange({ lo: 0, hi: 200 }, pts) === null && R.activeRange(null, pts) === null
       && R.activeRange({ lo: 41, hi: 90 }, pts) !== null && R.activeRange({ lo: 40, hi: 89 }, pts) !== null);
  const props = { lines: [{ pts, label: "x", unit: " W" }], window: { from: 0, to: 3000 }, status: "ready", label: "H", stepMs: 300000, height: 110 };
  const filt = (range, result = "loading") => ({ base: pts, range, onChange() {}, result });
  for (const z of [true, false]) {
    P.setChartsFromZero(z);
    const plain = inside(draw(h(LineChart, props)), "weather-chart");
    const atDefaults = draw(h(LineChart, { ...props, filter: filt(d) }));
    const none = draw(h(LineChart, { ...props, filter: filt(null) }));
    ck(`${z ? "from 0" : "zoomed"}: at its defaults the chart is drawn exactly as without a filter, no line above, no hatching`,
       inside(atDefaults, "weather-chart") === plain && inside(none, "weather-chart") === plain
         && !/chart-range-line|chart-range-out/.test(atDefaults + none) && /chart-range-thumb/.test(none));
  }
  P.setChartsFromZero(true);
}

console.log("\n  the handles stand on the left axis, level with their values, in both zero modes");
{
  const base = [{ t: 0, v: 40 }, { t: 1000, v: 90 }, { t: 2000, v: 60 }];
  const filtered = [{ t: 0, v: 0 }, { t: 1000, v: 70 }, { t: 2000, v: 60 }];   // a step with nothing in range: 0
  const props = (pts, range) => ({ lines: [{ pts, label: "x", unit: " W" }], window: { from: 0, to: 3000 }, status: "ready", label: "H",
    stepMs: 300000, height: 110, filter: { base, range, onChange() {}, result: { avg: 43, inRangeMs: 5 * M } } });
  const read = (html) => {
    const ax = inside(html, "chart-yaxis");
    const ticks = [...ax.matchAll(/bottom:([\d.]+)%">([^<]+)</g)].map((m) => ({ v: Number(m[2]), y: 110 * (1 - Number(m[1]) / 100) }));
    const thumbs = [...html.matchAll(/class="chart-range-thumb" data-k="(lo|hi)" style="top:([\d.]+)px"[^>]*aria-valuenow="([-\d.e]+)"/g)]
      .map((m) => ({ k: m[1], y: Number(m[2]), v: Number(m[3]) }));
    const axisY = (v) => { const [a, b] = ticks; return a.y + ((v - a.v) * (b.y - a.y)) / (b.v - a.v); };
    return { ticks, thumbs, axisY };
  };
  for (const z of [true, false]) {
    P.setChartsFromZero(z);
    for (const [name, pts, range] of [["before the detail comes", base, { lo: 55, hi: 80 }], ["filtered, a point at 0", filtered, { lo: 55, hi: 80 }],
      ["a handle at the axis' end", base, { lo: 40, hi: 75 }]]) {
      const html = draw(h(LineChart, props(pts, range)));
      const { ticks, thumbs, axisY } = read(html);
      ck(`${z ? "from 0" : "zoomed"}, ${name}: each handle's y is its value's y on the axis drawn beside it`,
         ticks.length >= 2 && thumbs.length === 2 && thumbs.every((t) => Math.abs(t.y - axisY(t.v)) < 1e-6)
           && thumbs.find((t) => t.k === "lo").v === range.lo && thumbs.find((t) => t.k === "hi").v === range.hi, { ticks, thumbs });
    }
    const zeros = read(draw(h(LineChart, props(filtered, { lo: 55, hi: 80 }))));
    ck(`${z ? "from 0" : "zoomed"}: a point the filter set to 0 is on the axis (it reaches 0), and the slider with it`,
       zeros.ticks.some((t) => t.v <= 0) && zeros.axisY(0) <= 98 + 1e-6, zeros.ticks);
  }
  P.setChartsFromZero(false);
  const before = chartGeometry({ from: 0, to: 3 }, [{ pts: base, gaps: [] }], { left: 0, right: 100, top: 12, bottom: 98 }, 0.08, false).series[0];
  const held = chartGeometry({ from: 0, to: 3 }, [{ pts: [{ t: 0, v: 60 }, { t: 1, v: 61 }], gaps: [], holds: [40, 90] }], { left: 0, right: 100, top: 12, bottom: 98 }, 0.08, false).series[0];
  ck("filtered, the axis keeps the unfiltered values' span: the handles do not move as the line changes", near(held.lo, before.lo) && near(held.hi, before.hi), [held.lo, held.hi, before.lo, before.hi]);
  P.setChartsFromZero(true);
  const html = draw(h(LineChart, props(base, { lo: 55, hi: 80 })));
  ck("the slider is not part of the axis: a tap on it never switches the zero mode", !/chart-range/.test(inside(html, "chart-yaxis")) && /chart-yaxis left zoomable/.test(html));
  const out = inside(html, "chart-range-out");
  ck("what is left out is hatched over the plot: above the top handle and below the bottom one, after the line",
     (out.match(/<rect x="0"/g) ?? []).length === 2 && html.indexOf("chart-range-out") > html.indexOf("chart-line") && /<pattern /.test(out));
}

console.log("\n  a handle follows the pointer, the keys, and never crosses the other");
{
  const axis = { lo: 0, hi: 100, step: 25 };
  const plot = { top: 12, bottom: 98 };
  ck("the pointer's y is read on the axis (top 100, bottom 0, the middle 50), on a tenth of a tick step",
     R.valueAtY(axis, plot, 12) === 100 && R.valueAtY(axis, plot, 98) === 0 && R.valueAtY(axis, plot, 55) === 50 && R.valueAtY(axis, plot, 50) === 55);
  ck("  ...held on the axis past its ends", R.valueAtY(axis, plot, -40) === 100 && R.valueAtY(axis, plot, 400) === 0);
  const r = { lo: 30, hi: 70 };
  ck("the nearer handle takes the pointer", R.nearerHandle(r, 65) === "hi" && R.nearerHandle(r, 35) === "lo" && R.nearerHandle(r, 90) === "hi" && R.nearerHandle(r, 5) === "lo");
  ck("a handle cannot cross the other", R.moveHandle(r, "lo", 90, axis).lo === 70 && R.moveHandle(r, "hi", 10, axis).hi === 30);
  ck("arrow keys a grain, Page keys a tick, Home and End the axis' ends",
     R.keyMove(r, "hi", "ArrowUp", axis).hi === 72.5 && R.keyMove(r, "lo", "ArrowDown", axis).lo === 27.5 && R.keyMove(r, "hi", "PageDown", axis).hi === 45
       && R.keyMove(r, "hi", "End", axis).hi === 100 && R.keyMove(r, "lo", "Home", axis).lo === 0 && R.keyMove(r, "lo", "Tab", axis) === null);
  const p = R.pillTops(40, 46, 16);
  ck("the two value pills are pushed apart when the handles meet", p.lo - p.hi === 16 && R.pillTops(10, 60, 16).hi === 10);
}

console.log("\n  kept while the period changes, cleared for another reading");
{
  const one = [{ id: "sensor.a" }];
  const scope = R.filterScope(one);
  const st = R.withFilter(R.NO_FILTERS, scope, "sensor.a", { lo: 3, hi: 9 });
  ck("a range set is read back for the same readings, whatever the period (the period is not part of it)",
     R.filterOf(st, R.filterScope([{ id: "sensor.a" }]), "sensor.a")?.hi === 9);
  ck("another reading opened (even on the same device): no range", R.filterOf(st, R.filterScope([{ id: "sensor.b" }]), "sensor.b") === null
     && R.filterOf(st, R.filterScope([{ id: "sensor.b" }]), "sensor.a") === null);
  const other = R.withFilter(st, R.filterScope([{ id: "sensor.b" }]), "sensor.b", { lo: 1, hi: 2 });
  const back = R.withFilter(other, scope, "sensor.c", { lo: 0, hi: 1 });
  ck("  ...and coming back to the first: forgotten, not resurrected (even when another chart there gets a range)",
     R.filterOf(other, scope, "sensor.a") === null && R.filterOf(back, scope, "sensor.a") === null && R.filterOf(back, scope, "sensor.c")?.hi === 1);
  ck("Show all clears it", R.filterOf(R.withFilter(st, scope, "sensor.a", null), scope, "sensor.a") === null);
  const tree = parseTsx("components/panels/NumericHistory.tsx");
  const calls = [];
  const visit = (n) => { if (ts.isCallExpression(n)) calls.push(n); ts.forEachChild(n, visit); };
  visit(tree);
  const named = (f) => calls.filter((c) => c.expression.getText() === f);
  const decls = [];
  const findDecl = (n) => { if (ts.isVariableDeclaration(n)) decls.push(n); ts.forEachChild(n, findDecl); };
  findDecl(tree);
  const scopeOf = decls.find((d) => d.name.getText() === "scope")?.initializer?.getText();
  ck("NumericHistory scopes its ranges by the series it shows (never the period), and keeps them in its own state (never stored)",
     scopeOf === "filterScope(series)" && named("filterScope").length === 1
       && ["filterOf", "withFilter"].every((f) => named(f).length > 0 && named(f).every((c) => c.arguments[1]?.getText() === "scope"))
       && named("useState").some((c) => c.arguments[0]?.getText() === "NO_FILTERS")
       && !/localStorage|viewPrefs|saveConfig/.test(tree.text));
  const charts = elements(tree, "LineChart");
  const props = (el) => el.openingElement?.attributes ?? el.attributes;
  const spread = (el) => props(el).properties.filter((p) => ts.isJsxSpreadAttribute(p)).map((p) => p.expression.getText());
  const dual = charts.filter((el) => /scale: "own"/.test(el.getText()));
  ck("the chart on two scales has no slider; every one-line chart has one",
     dual.length === 1 && spread(dual[0]).length === 0 && !/filter=/.test(dual[0].getText())
       && charts.length === 3 && charts.filter((el) => el !== dual[0]).every((el) => spread(el).some((s) => /^filtered\(/.test(s))), charts.map(spread));
  const two = draw(h(LineChart, { lines: [{ pts: [{ t: 0, v: 1 }, { t: 1, v: 2 }], label: "a" }, { pts: [{ t: 0, v: 5 }, { t: 1, v: 9 }], label: "b", scale: "own" }],
    window: { from: 0, to: 2 }, status: "ready", label: "H", stepMs: 300000,
    filter: { base: [{ t: 0, v: 1 }, { t: 1, v: 2 }], range: { lo: 1.5, hi: 2 }, onChange() {}, result: "loading" } }));
  ck("  ...and LineChart draws no slider for two lines, even if given a filter", !/chart-range/.test(two));
}

console.log("\n  the line above the chart");
{
  ck("filtered: what is kept, the average and the time in range, in the joined duration words",
     rangeWords({ lo: 300, hi: 900 }, 250, " W", { avg: 412.4, inRangeMs: 6.5 * HOUR_MS }) === "Only 300 to 900 W: average 412 W, 6h 30min in range",
     rangeWords({ lo: 300, hi: 900 }, 250, " W", { avg: 412.4, inRangeMs: 6.5 * HOUR_MS }));
  ck("  ...none in range says so (never \"1s\")", /nothing in range$/.test(rangeWords({ lo: 3, hi: 4 }, 1, " W", { avg: 0, inRangeMs: 0 })));
  ck("  ...while the detail loads the chart is unfiltered, and the line says so", /loading/.test(rangeWords({ lo: 3, hi: 4 }, 1, " W", "loading")));
  ck("  ...no long dash in any of it", ![rangeWords({ lo: 3, hi: 4 }, 1, " W", "loading"), rangeWords({ lo: 3, hi: 4 }, 1, " W", "failed"),
    rangeWords({ lo: 3, hi: 4 }, 1, " W", { avg: 1, inRangeMs: 1 })].some((t) => / — /.test(t)));
  const pts = [{ t: 0, v: 40 }, { t: 1000, v: 90 }];
  const html = draw(h(LineChart, { lines: [{ pts, label: "x", unit: " W" }], window: { from: 0, to: 3000 }, status: "ready", label: "H", stepMs: 300000,
    filter: { base: pts, range: { lo: 50, hi: 90 }, onChange() {}, result: { avg: 30, inRangeMs: HOUR_MS } } }));
  ck("  ...drawn above the chart, with Show all", html.indexOf("chart-range-line") < html.indexOf("chart-with-axis") && />Show all</.test(inside(html, "chart-range-line")));
}

console.log("\n  the finer values come from the one history source, only while a filter is set");
{
  const now = Date.UTC(2026, 9, 26, 12);
  const asked = [];
  const rows = Array.from({ length: 48 }, (_, i) => ({ state: String(i % 5), last_changed: new Date(now - (48 - i) * 30 * M).toISOString() }));
  const port = (stats) => ({
    stateRows: async () => { asked.push("readings"); return rows; },
    getStatisticsDuringPeriod: async (ids, start, period) => {
      asked.push(period);
      return stats ? { [ids[0]]: [{ start: now - 2 * HOUR_MS, end: now - HOUR_MS, mean: 7 }] } : {};
    },
  });
  const steps = [["5minute", "readings", undefined], ["hour", "5minute", 5 * M], ["day", "hour", HOUR_MS], ["week", "day", DAY_MS]];
  for (const [period, source, stepMs] of steps) {
    asked.length = 0;
    const a = (await loadOne(port(true), { kind: "finer", ids: ["sensor.q"], hours: 24, period }, now))["sensor.q"];
    ck(`a ${period} step reads ${source === "readings" ? "the readings themselves (time-weighted)" : `the ${source} figures, once each`}`,
       asked.join() === source && a.of === period && a.stepMs === stepMs && a.series.points.length > 0, [asked, a.of, a.stepMs]);
  }
  asked.length = 0;
  const none = (await loadOne(port(false), { kind: "finer", ids: ["sensor.q"], hours: 24, period: "day" }, now))["sensor.q"];
  ck("  ...a device with no figures: every change kept, in the finer step (as its chart is made)",
     asked.join() === "hour,readings" && none.stepMs === HOUR_MS && none.series.points.length > 0
       && none.series.points.slice(1).every((p) => p.t === cellEdges(p.t, p.t + 1, HOUR_MS)[0]), asked);
  ck("a different period is a different request", historyKey({ kind: "finer", ids: ["a"], hours: 24, period: "day" }) !== historyKey({ kind: "finer", ids: ["a"], hours: 24, period: "week" })
     && historyKey({ kind: "finer", ids: ["a"], hours: 24, period: "day" }) !== historyKey({ kind: "trend", ids: ["a"], hours: 24, period: "day" }));
  const tree = parseTsx("components/panels/NumericHistory.tsx");
  ck("NumericHistory asks for them only for the charts whose range leaves something out, else nothing",
     /finerIds\.length \? \{ finer: \{ kind: "finer", ids: finerIds, hours: range\.hours, period: range\.period \} \} : null/.test(tree.text.replace(/\s+/g, " "))
       && /const filtering = slidable\.filter\(\(s\) => activeRange\(/.test(tree.text));
}

done("✅ a trend chart's range filter: the owner's rule, on the chart's own axis");
