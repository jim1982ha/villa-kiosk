// The range filter of a device's trend chart (owner, 2026-10-26): two handles beside the y-axis keep only the values
// between them; each point is the average of ONLY its finer values inside [lo, hi]; a step with none inside sits on its
// unfiltered value held inside the range (above it: the upper limit; below it: the lower one), never 0. A handle goes
// anywhere on the axis; at its end it is no limit. The axis fit (from 0 / fitted) holds the limits, the slider stands
// on it, the chip says the range on the unit line. Driven through the pure modules (utils/rangeFilter,
// utils/chartGeometry), the history source's "finer" request, and the drawn chart (LineChart, ChartRangeSlider).
import { h, draw, inside, text } from "../consistency/screen.mjs";
import { parseTsx, elements, propText } from "../consistency/jsx.mjs";
import { readFileSync } from "node:fs";
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
const { RangeChip, rangeWords } = await import("@/components/panels/ChartRangeSlider");

const near = (a, b) => Math.abs(a - b) < 1e-9;
const M = 60_000;
const NONE = { lo: -Infinity, hi: Infinity };
const FITS = ["zero", "fitted"];

// a closed-up chart as "day:value" per kept step (its real day, read back through realAt)
const keptOf = (c, start, stepMs) => c.series.points.map((p) => `${Math.round((c.realAt(p.t) - start) / stepMs)}:${Math.round(p.v * 1000) / 1000}`).join();

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
  const run = (lo, hi) => R.keptChart(base, finer, DAY_MS, { lo, hi });
  const kept = (lo, hi) => keptOf(run(lo, hi), start, DAY_MS);
  ck("unfiltered (today's chart), day 2 reads 500 / 24, about 21", near(base.points[1].v, 500 / 24) && Math.round(base.points[1].v) === 21);
  const all = run(-Infinity, Infinity);
  ck("  ...and the rule with no limit gives that same chart, every day kept, on its own day",
     all.count === 7 && all.of === 7 && all.series.points.every((p, i) => near(p.v, base.points[i].v) && all.realAt(p.t) === base.points[i].t), keptOf(all, start, DAY_MS));
  ck("kept 450 to 550: only day 2 is drawn, reading 500; every day with nothing in range is removed",
     kept(450, 550) === "1:500", kept(450, 550));
  ck("kept 550 to 1500: day 3 1000, day 4 1500; day 5 (only 0, 2000, 5000: none inside, though its 583 average is) removed",
     kept(550, 1500) === "2:1000,3:1500", kept(550, 1500));
  ck("kept 3000 to 5000: day 5 alone, reading 5000 (its two 5000 hours, never 3500)", kept(3000, 5000) === "4:5000", kept(3000, 5000));
  const q = run(-Infinity, 10);
  ck("kept up to 10 (no lower limit): the 1500 day is removed, the quiet days read 0, their own",
     keptOf(q, start, DAY_MS) === "0:0,1:0,2:0,4:0,5:0,6:0" && q.count === 6 && q.of === 7, keptOf(q, start, DAY_MS));
  ck("  ...closed up: the kept days side by side, a day apart, on a window as long as they are, no outage",
     q.series.points.every((p, j) => p.t === start + j * DAY_MS) && q.series.window.from === start
       && q.series.window.to === start + 6 * DAY_MS && q.series.gaps.length === 0, q.series.points.map((p) => p.t - start));
  const g = chartGeometry(q.series.window, [{ pts: q.series.points, gaps: [] }], { left: 0, right: 320, top: 0, bottom: 100 });
  ck("  ...drawn as ONE unbroken line across the whole plot (owner: no gap)", g.series[0].runs.length === 1
     && g.series[0].runs[0][0].x === 0 && g.series[0].runs[0].at(-1).x === 320, g.series[0].runs.map((r) => r.length));
  ck("  ...the ribbon: the whole week but the removed day (day 4), consecutive days merged",
     JSON.stringify(q.ribbon) === JSON.stringify([{ from: 0, to: 3 / 7 }, { from: 4 / 7, to: 1 }]), q.ribbon);
  ck("  ...the dates: the first kept day, the middle one (the third of six) and the week's end (the last is its last day)",
     q.ticks[0] === start && q.ticks[1] === start + 2 * DAY_MS && q.ticks[2] === window.to && near(q.spanHours, 7 * 24), q.ticks.map((t) => (t - start) / DAY_MS));
  const one = run(3000, 5000);
  ck("  ...one day kept: its date first and in the middle, and its own day last (not the week's end)",
     one.ticks.join() === [4, 4, 4].map((d) => start + d * DAY_MS).join() && one.ribbon.length === 1 && near(one.ribbon[0].from, 4 / 7), one.ticks);
}

console.log("\n  the owner's pump, 273 to 514 W: nothing in range on any day");
{
  const start = localMidnight(Date.UTC(2026, 5, 1, 12)), D = 6;
  const window = { from: start, to: start + D * DAY_MS };
  const runDay = (d) => d === 1 || d === 4;
  // a quiet day rests at 120 to 250 W; a run day runs 18h at 900 W and rests 6h at 150 W
  const hourly = (d, hr) => runDay(d) ? (hr >= 4 && hr < 22 ? 900 : 150) : 120 + ((hr * 37) % 131);
  const points = [];
  for (let d = 0; d < D; d++) for (let hr = 0; hr < 24; hr++) points.push({ t: start + d * DAY_MS + hr * HOUR_MS, v: hourly(d, hr) });
  const avg = (d) => points.slice(d * 24, d * 24 + 24).reduce((a, p) => a + p.v, 0) / 24;
  const base = { points: Array.from({ length: D }, (_, d) => ({ t: start + d * DAY_MS, v: avg(d) })), gaps: [], window };
  const f = R.keptChart(base, { of: "day", stepMs: HOUR_MS, series: { points, gaps: [], window } }, DAY_MS, { lo: 273, hi: 514 });
  ck("every day removed: nothing kept (0 of 6), no ribbon", f.count === 0 && f.of === D && f.series.points.length === 0 && f.ribbon.length === 0, f);
}

console.log("\n  a Wi-Fi signal, always negative (dBm): -75 and below");
{
  const start = localMidnight(Date.UTC(2026, 5, 1, 12)), D = 4;
  const window = { from: start, to: start + D * DAY_MS };
  const weak = (d) => d === 2;
  const hourly = (d, hr) => weak(d) && hr < 12 ? -80 : -53;
  const points = [];
  for (let d = 0; d < D; d++) for (let hr = 0; hr < 24; hr++) points.push({ t: start + d * DAY_MS + hr * HOUR_MS, v: hourly(d, hr) });
  const avg = (d) => points.slice(d * 24, d * 24 + 24).reduce((a, p) => a + p.v, 0) / 24;
  const base = { points: Array.from({ length: D }, (_, d) => ({ t: start + d * DAY_MS, v: avg(d) })), gaps: [], window };
  const f = R.keptChart(base, { of: "day", stepMs: HOUR_MS, series: { points, gaps: [], window } }, DAY_MS, { lo: -Infinity, hi: -75 });
  ck("the weak day alone, reading -80 (its weak hours only); every other day removed", keptOf(f, start, DAY_MS) === "2:-80", keptOf(f, start, DAY_MS));
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
  const all = R.keptChart(base, finer, 5 * M, NONE);
  ck("with no limit, the rule is the chart's own five-minute values (intervalSeries)",
     all.series.points.length === base.points.length && all.series.points.every((p, i) => near(p.v, base.points[i].v)), [all.series.points, base.points]);
  const hi = R.keptChart(base, finer, 5 * M, { lo: 50, hi: 150 });
  ck("kept 50 to 150: 10:00 reads 100 (its 2 min at 100), 10:05 100, 10:10 100 (2 min known before the outage)",
     keptOf(hi, t0, 5 * M) === "0:100,1:100,2:100", keptOf(hi, t0, 5 * M));
  const lo = R.keptChart(base, finer, 5 * M, { lo: 0, hi: 50 });
  ck("kept 0 to 50: 10:00 reads 10, 10:05 10, 10:10 (only 100s) removed", keptOf(lo, t0, 5 * M) === "0:10,1:10", keptOf(lo, t0, 5 * M));
  const w = { points: [{ t: t0, v: 20 }, { t: t0 + M, v: 40 }], gaps: [], window: { from: t0, to: t0 + 5 * M } };
  const tw = R.keptChart(intervalSeries(w, 5 * M), { of: "5minute", series: w }, 5 * M, { lo: 0, hi: 100 });
  ck("  ...a reading counts for how long it held (1 min at 20, 4 at 40 → 36, not 30)", near(tw.series.points[0].v, 36), tw.series.points[0].v);
}

const chart = (pts, extra = {}) => ({ lines: [{ pts, label: "x", unit: " W" }], window: { from: 0, to: 3000 }, status: "ready", label: "H",
  stepMs: 300000, height: 110, ...extra });
const filt = (base, range, state = "ready") => ({ base, range, onChange() {}, state });

console.log("\n  no limit is the chart unfiltered");
{
  const pts = [{ t: 0, v: 40 }, { t: 1000, v: 90 }, { t: 2000, v: 60 }];
  ck("no limit on either side filters nothing; one limit filters", R.activeRange(NONE) === null && R.activeRange(null) === null
     && R.activeRange({ lo: 41, hi: Infinity }) !== null && R.activeRange({ lo: -Infinity, hi: 89 }) !== null);
  for (const fit of FITS) {
    P.setChartFit(fit);
    const plain = inside(draw(h(LineChart, chart(pts))), "weather-chart");
    const none = draw(h(LineChart, chart(pts, { filter: filt(pts, null) })));
    const open = draw(h(LineChart, chart(pts, { filter: filt(pts, NONE) })));
    ck(`${fit}: with no limit the chart is drawn exactly as without a filter, no chip, no hatching, both handles at the axis' ends`,
       inside(none, "weather-chart") === plain && inside(open, "weather-chart") === plain
         && !/chart-range-chip|chart-range-out/.test(none + open) && /chart-range-thumb/.test(none)
         && /aria-valuetext="No upper limit"/.test(none) && /aria-valuetext="No lower limit"/.test(none));
  }
}

const readChart = (html, plotH = 110) => {
  const ax = inside(html, "chart-yaxis");
  const ticks = [...ax.matchAll(/bottom:([-\d.e]+)%">([^<]+)</g)].map((m) => ({ v: Number(m[2]), y: plotH * (1 - Number(m[1]) / 100) }));
  const thumbs = [...html.matchAll(/class="chart-range-thumb" data-k="(lo|hi)" style="top:([-\d.e]+)px"[^>]*aria-valuemin="([-\d.e]+)" aria-valuemax="([-\d.e]+)" aria-valuenow="([-\d.e]+)"/g)]
    .map((m) => ({ k: m[1], y: Number(m[2]), min: Number(m[3]), max: Number(m[4]), v: Number(m[5]) }));
  const axisY = (v) => { const [a, b] = ticks; return a.y + ((v - a.v) * (b.y - a.y)) / (b.v - a.v); };
  return { ticks, thumbs, axisY };
};

console.log("\n  the handles stand on the left axis, level with their values, in both fits");
{
  const base = [{ t: 0, v: 40 }, { t: 1000, v: 90 }, { t: 2000, v: 60 }];
  const filtered = [{ t: 0, v: 55 }, { t: 1000, v: 70 }, { t: 2000, v: 60 }];
  for (const fit of FITS) {
    P.setChartFit(fit);
    for (const [name, pts, range] of [["before the detail comes", base, { lo: 55, hi: 80 }], ["filtered", filtered, { lo: 55, hi: 80 }],
      ["a limit past the values (200)", filtered, { lo: 55, hi: 200 }], ["one limit", filtered, { lo: 55, hi: Infinity }]]) {
      const { ticks, thumbs, axisY } = readChart(draw(h(LineChart, chart(pts, { filter: filt(base, range, "loading") }))));
      const lo = thumbs.find((t) => t.k === "lo"), hi = thumbs.find((t) => t.k === "hi");
      const yOf = (t) => (t.v >= t.max ? 12 : t.v <= t.min ? 98 : axisY(t.v));
      ck(`${fit}, ${name}: each limit's handle is at its value's y on the axis drawn beside it, strictly inside the axis; no limit at its end`,
         ticks.length >= 2 && thumbs.length === 2 && thumbs.every((t) => Math.abs(t.y - yOf(t)) < 1e-6)
           && lo.v === range.lo && lo.v > lo.min && lo.y < 98
           && (!Number.isFinite(range.hi) ? hi.v === hi.max && hi.y === 12
             // a limit past the chart's values (one kept from another period): at the axis' top, the axis never widened
             // to it (owner, 2026-10-30)
             : range.hi > hi.max ? hi.v === range.hi && hi.y === 12
             : hi.v === range.hi && hi.v < hi.max && hi.y > 12), { ticks, thumbs });
    }
  }
  P.setChartFit("zero");
  const html = draw(h(LineChart, chart(base, { filter: filt(base, { lo: 55, hi: 80 }) })));
  ck("the slider is not part of the axis: a tap on it never switches the fit", !/chart-range/.test(inside(html, "chart-yaxis")) && /chart-yaxis left zoomable/.test(html));
  const out = inside(html, "chart-range-out");
  ck("what is left out is hatched over the plot: above the upper limit and below the lower one, after the line",
     (out.match(/<rect x="0"/g) ?? []).length === 2 && html.indexOf("chart-range-out") > html.indexOf("chart-line") && /<pattern /.test(out));
  const one = inside(draw(h(LineChart, chart(base, { filter: filt(base, { lo: 55, hi: Infinity }) }))), "chart-range-out");
  ck("  ...only on a side that has a limit: 55 and up hatches below 55 only", (one.match(/<rect x="0"/g) ?? []).length === 1 && /y="([\d.]+)"[^>]*height="([\d.]+)"/.exec(one.slice(one.indexOf('<rect x="0"')))?.slice(1).reduce((a, b) => Number(a) + Number(b)) === 98, one);
}

console.log("\n  the axis: unfiltered, filtered and every finite limit; fitted to a range with a margin");
{
  const w = { from: 0, to: 3 }, plot = { left: 0, right: 100, top: 12, bottom: 98 };
  const g = (pts, fit, extra = {}) => chartGeometry(w, [{ pts, gaps: [], ...extra }], plot, 0.08, fit).series[0];
  const filtered = [{ t: 0, v: 60 }, { t: 1, v: 61 }];
  for (const fit of ["zero"]) {
    const s = g(filtered, fit, { holds: [40, 90], limits: { lo: 30, hi: 200 } });
    const plain = g(filtered, fit, { holds: [40, 90] });
    ck(`${fit}: the axis is the one the values give unfiltered (from 0 to 90), never widened to a limit past them (30, 200)`,
       s.lo === plain.lo && s.hi === plain.hi && s.lo === 0, [s.lo, s.hi, plain.lo, plain.hi]);
  }
  const f = g(filtered, "fitted", { holds: [0, 900], limits: { lo: 273, hi: 514 } });
  const span = 514 - 273;
  ck("fitted with a range: the axis is its limits plus 8 % of their span each side (the handles inside, never on an end)",
     near(f.lo, 273 - 0.08 * span) && near(f.hi, 514 + 0.08 * span), [f.lo, f.hi]);
  const open = g([{ t: 0, v: 620 }, { t: 1, v: 910 }], "fitted", { holds: [100, 700], limits: { lo: 600, hi: Infinity } });
  ck("  ...an open side is fitted to the values on that side (600 and up: to 910)", near(open.lo, 600 - 0.08 * 310) && near(open.hi, 910 + 0.08 * 310), [open.lo, open.hi]);
  ck("  ...a value outside a fitted axis (a day at 0) is drawn on its edge", f.sy(0) === 98 && f.sy(900) === 12, [f.sy(0), f.sy(900)]);
  const wifi = g([{ t: 0, v: -80 }, { t: 1, v: -75 }], "zero", { holds: [-86, -48], limits: { lo: -Infinity, hi: -75 } });
  ck("from 0, a signal with a range: 0 at the top, the limit -75 inside", wifi.hi >= 0 && wifi.lo <= -86 && wifi.sy(-75) > 12, [wifi.lo, wifi.hi]);
  const both = chartGeometry(w, [{ pts: filtered, gaps: [], limits: { lo: 0, hi: 1000 } }, { pts: filtered, gaps: [] }], plot, 0.08, "fitted").series[0];
  ck("  ...limits shape only a scale their line is alone on (a slider stands on one axis)", both.hi < 100, [both.lo, both.hi]);
}

console.log("\n  a handle anywhere on the axis; at its end no limit; never crossing");
{
  const axis = { lo: 0, hi: 100, step: 25 };
  const plot = { top: 12, bottom: 98 };
  ck("the pointer's y is read on the axis exactly (no grain): the middle 50, 1px under it 48.837...",
     R.valueAtY(axis, plot, 55) === 50 && near(R.valueAtY(axis, plot, 56), 50 - 100 / 86));
  ck("  ...within a few px of an end, or past it, the end itself", R.valueAtY(axis, plot, 14) === 100 && R.valueAtY(axis, plot, -40) === 100
     && R.valueAtY(axis, plot, 96) === 0 && R.valueAtY(axis, plot, 400) === 0);
  ck("a handle goes to any value: 91 is 91, 37.3 is 37.3", R.moveHandle(null, "hi", 91, axis).hi === 91 && R.moveHandle(null, "lo", 37.3, axis).lo === 37.3);
  ck("  ...at its own end it is no limit: the top is +Infinity, the bottom -Infinity",
     R.moveHandle({ lo: 20, hi: 80 }, "hi", 100, axis).hi === Infinity && R.moveHandle({ lo: 20, hi: 80 }, "lo", 0, axis).lo === -Infinity
       && R.moveHandle({ lo: 20, hi: 80 }, "hi", 130, axis).hi === Infinity);
  const r = { lo: 30, hi: 70 };
  ck("the handles never cross nor meet: the lower stops under the upper, the upper over the lower",
     R.moveHandle(r, "lo", 90, axis).lo === 70 - 2.5 && R.moveHandle(r, "hi", 10, axis).hi === 30 + 2.5
       && R.moveHandle({ lo: 30, hi: Infinity }, "lo", 100, axis).lo === 97.5 && R.moveHandle({ lo: -Infinity, hi: 70 }, "hi", 0, axis).hi === 2.5);
  ck("the nearer handle takes the pointer (an open side counts at its end)", R.nearerHandle(r, 65, axis) === "hi" && R.nearerHandle(r, 35, axis) === "lo"
     && R.nearerHandle({ lo: -Infinity, hi: Infinity }, 60, axis) === "hi" && R.nearerHandle({ lo: -Infinity, hi: Infinity }, 40, axis) === "lo");
  ck("a handle with no limit is drawn at its axis end", JSON.stringify(R.handleValues(null, axis)) === '{"lo":0,"hi":100}'
     && R.handleValues({ lo: 20, hi: Infinity }, axis).hi === 100);
  ck("arrow keys a tenth of a tick, Page keys a tick, End the top (no limit), Home the bottom (no limit)",
     R.keyMove(r, "hi", "ArrowUp", axis).hi === 72.5 && R.keyMove(r, "lo", "ArrowDown", axis).lo === 27.5 && R.keyMove(r, "hi", "PageDown", axis).hi === 45
       && R.keyMove(r, "hi", "End", axis).hi === Infinity && R.keyMove(r, "lo", "Home", axis).lo === -Infinity && R.keyMove(r, "lo", "Tab", axis) === null);
}

console.log("\n  the chip on the unit line; no line above the chart, no value pills");
{
  ck("what the chip says: 273–514 W, ≥ 220 W, ≤ -75 dBm, -86 to -75 dBm, 1.2k–3.4k W",
     rangeWords({ lo: 273.4, hi: 514.2 }, 100, " W") === "273–514 W" && rangeWords({ lo: 220, hi: Infinity }, 100, " W") === "≥ 220 W"
       && rangeWords({ lo: -Infinity, hi: -75 }, 10, " dBm") === "≤ -75 dBm" && rangeWords({ lo: -86, hi: -75 }, 10, " dBm") === "-86 to -75 dBm"
       && rangeWords({ lo: 1234, hi: 3420 }, 1000, " W") === "1.2k–3.4k W",
     [rangeWords({ lo: 273.4, hi: 514.2 }, 100, " W"), rangeWords({ lo: -86, hi: -75 }, 10, " dBm"), rangeWords({ lo: 1234, hi: 3420 }, 1000, " W")]);
  const base = [{ t: 0, v: 200 }, { t: 1000, v: 600 }];
  P.setChartFit("zero");
  const plain = draw(h(LineChart, chart(base, { filter: filt(base, null) })));
  const on = draw(h(LineChart, chart(base, { filter: filt(base, { lo: 273, hi: 514 }) })));
  const line = inside(on, "chart-unit-line");
  ck("filtered, the chip sits on the unit line, after the unit, right-aligned (the spacer before it)",
     /chart-range-chip/.test(line) && text(line).includes("273–514 W") && line.indexOf("chart-unit-grow") < line.indexOf("chart-range-chip")
       && line.indexOf('class="chart-unit"') < line.indexOf("chart-range-chip"), text(line));
  const before = (html) => html.slice(0, html.indexOf("chart-with-axis"));
  ck("  ...the same markup before the chart filtered or not but the chip, and no line or pill anywhere (the window never grows)",
     before(on).replace(inside(on, "chart-range-chip"), "") === before(plain) && /chart-unit-line/.test(plain) && !/chart-range-line|chart-range-pill|>Show all</.test(on + plain), before(on));
  const cleared = [];
  const chip = RangeChip({ range: { lo: 273, hi: 514 }, step: 100, unit: " W", state: "ready", onClear: () => cleared.push(1) });
  chip.props.onClick();
  ck("  ...a tap on the chip (its ✕ is inside it) clears the range", cleared.length === 1 && chip.type === "button");
  ck("  ...while the detail loads it is dimmed and says so; when it failed a warning says the chart is in full",
     /chart-range-chip loading/.test(draw(h(LineChart, chart(base, { filter: filt(base, { lo: 273, hi: 514 }, "loading") }))))
       && /couldn&#x27;t load the detail: shown in full/.test(draw(h(LineChart, chart(base, { filter: filt(base, { lo: 273, hi: 514 }, "failed") })))));
  const lineTree = parseTsx("components/panels/LineChart.tsx"), sliderTree = parseTsx("components/panels/ChartRangeSlider.tsx");
  const classes = (tree) => { const out = []; const v = (n) => { if (ts.isJsxAttribute(n) && n.name.getText() === "className") out.push(n.initializer.getText()); ts.forEachChild(n, v); }; v(tree); return out.join(" "); };
  ck("  ...the markup has no summary line, no Show all, and the slider no value pills (jsx reader)",
     !/chart-range-line|chart-range-reset/.test(classes(lineTree)) && !/pill/.test(classes(sliderTree)) && /chart-range-thumb/.test(classes(sliderTree))
       && elements(lineTree, "RangeChip").length === 1 && elements(lineTree, "ChartUnitLine").length === 1);
  const tight = text(inside(on, "chart-unit-line"));
  ck("  ...the chip's words are short enough for a phone (at most 16 characters for a range of two 4-digit limits)",
     rangeWords({ lo: -1234, hi: -1000 }, 100, " dBm").length <= 20 && rangeWords({ lo: 2730, hi: 5140 }, 1000, " W").length <= 16, tight);
}

console.log("\n  closed up on screen: one line, the real dates, the count on the chip, the ribbon in the strip under the plot");
{
  const { fmtChartTick, keptWords } = await import("@/components/panels/chartUtils");
  const start = localMidnight(Date.UTC(2026, 5, 1, 12)), window = { from: start, to: start + 7 * DAY_MS };
  // hourly: 900 W from 10:00 to 14:00 on days 1, 2 and 5, else 150 W
  const run = (d) => d === 1 || d === 2 || d === 5;
  const points = [];
  for (let d = 0; d < 7; d++) for (let hr = 0; hr < 24; hr++) points.push({ t: start + d * DAY_MS + hr * HOUR_MS, v: run(d) && hr >= 10 && hr < 14 ? 900 : 150 });
  const avg = (d) => points.slice(d * 24, d * 24 + 24).reduce((a, p) => a + p.v, 0) / 24;
  const base = { points: Array.from({ length: 7 }, (_, d) => ({ t: start + d * DAY_MS, v: avg(d) })), gaps: [], window };
  const finer = { of: "day", stepMs: HOUR_MS, series: { points, gaps: [], window } };
  const show = (range) => {
    const k = R.keptChart(base, finer, DAY_MS, range);
    return { k, html: draw(h(LineChart, { lines: [{ pts: k.series.points, gaps: k.series.gaps, label: "x", unit: " W" }], status: "ready", label: "H",
      stepMs: DAY_MS, height: 110, window: k.count ? k.series.window : window,
      filter: { base: base.points, range, onChange() {}, state: "ready", kept: k } })) };
  };
  for (const fit of FITS) {
    P.setChartFit(fit);
    const { k, html } = show({ lo: 600, hi: Infinity });
    ck(`${fit}: three run days kept (2nd, 3rd, 6th), drawn as one line`, k.count === 3 && (inside(html, "weather-chart").match(/<polyline/g) ?? []).length === 1, k.count);
    ck("  ...the chip counts them on the unit line: \u201c\u2265 600 W \u00b7 3 of 7 days\u201d", text(inside(html, "chart-unit-line")).includes("3 of 7 days"), text(inside(html, "chart-unit-line")));
    const dates = [...inside(html, "weather-axis").matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]);
    ck("  ...the dates are the kept days' own (the first, the middle one, the last), never the closed-up chart's",
       dates.join("|") === [1, 2, 5].map((d) => fmtChartTick(start + d * DAY_MS, 7 * 24)).join("|"), dates);
    const wrap = inside(html, "spark-wrap"), rib = inside(html, "chart-range-ribbon");
    const bottom = Number(/class="chart-range-ribbon" style="bottom:([\d.]+)px"/.exec(html)?.[1]);
    ck("  ...the ribbon: inside the plot's own box (no row added), one segment per run of kept days, in the 12px strip under the plot's floor",
       wrap.includes(rib) && (rib.match(/<i /g) ?? []).length === 2 && bottom >= 0 && bottom + 4 <= 12, [bottom, rib]);
  }
  const css = readFileSync(new URL("../../src/styles/03-panels.css", import.meta.url), "utf8");
  const rule = /\.chart-range-ribbon \{([^}]*)\}/.exec(css)?.[1] ?? "";
  ck("  ...and it takes no room: absolutely placed, 4px high", /position: absolute/.test(rule) && /height: 4px/.test(rule), rule);
  const unf = draw(h(LineChart, { lines: [{ pts: base.points, label: "x", unit: " W" }], status: "ready", label: "H", stepMs: DAY_MS, height: 110, window,
    filter: { base: base.points, range: null, onChange() {}, state: "ready" } }));
  const wait = draw(h(LineChart, { lines: [{ pts: base.points, label: "x", unit: " W" }], status: "ready", label: "H", stepMs: DAY_MS, height: 110, window,
    filter: { base: base.points, range: { lo: 600, hi: Infinity }, onChange() {}, state: "loading", kept: null } }));
  ck("no range, or the detail still loading: no ribbon and no count", !/chart-range-ribbon|chart-range-chip-kept/.test(unf + wait));
  const { k, html } = show({ lo: 2000, hi: Infinity });
  ck("nothing in range: no line, no ribbon, a plain line says so, and the slider stays to widen it",
     k.count === 0 && !/<polyline|chart-range-ribbon/.test(html) && text(inside(html, "chart-range-none")).includes("Nothing in \u2265 2k W. Widen the range")
       && (html.match(/chart-range-thumb/g) ?? []).length === 2 && text(inside(html, "chart-unit-line")).includes("0 of 7 days"), text(inside(html, "chart-range-none")));
  const labels = [...inside(html, "chart-yaxis").matchAll(/">([-\d.]+)(k?)</g)].map((m) => Number(m[1]) * (m[2] ? 1000 : 1));
  const loThumb = Number(/data-k="lo" style="top:([\d.]+)px"/.exec(html)?.[1]);
  ck(`  ...fitted (${P.chartFit()}), the axis frames the values as unfiltered, not a sliver around the limit, never widened to it (2k): its handle at the top`,
     P.chartFit() === "fitted" && new Set(labels).size === labels.length && Math.min(...labels) <= 1000 && Math.max(...labels) < 2000 && loThumb === 12, [labels, loThumb]);
  ck("the count at each step: days, hours, weeks; five-minute steps as the time they make",
     keptWords(3, 7, DAY_MS) === "3 of 7 days" && keptWords(18, 24, HOUR_MS) === "18 of 24 hours" && keptWords(3, 52, 7 * DAY_MS) === "3 of 52 weeks"
       && keptWords(40, 288, 5 * M) === "3h 20min of 1d" && keptWords(0, 288, 5 * M) === "0min of 1d",
     [keptWords(40, 288, 5 * M), keptWords(0, 288, 5 * M)]);
}

console.log("\n  in the chart's columns: the unit over the axis numbers, the fit mark in the dates' row under the slider or the numbers");
{
  const css = readFileSync(new URL("../../src/styles/03-panels.css", import.meta.url), "utf8");
  const rule = (sel) => { const m = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css); return m ? m[2] : ""; };
  const prop = (sel, p) => (new RegExp(`(^|;|\\s)${p}:\\s*([^;]+);`).exec(rule(sel)) ?? [])[2]?.trim();
  const basis = (sel) => prop(sel, "flex")?.split(/\s+/).slice(2).join(" ");
  ck("the unit's column is the axis numbers' (same width at the same size), past a column as wide as the slider's",
     basis(".chart-unit.left") === basis(".chart-yaxis") && prop(".chart-unit-line", "font-size") === prop(".chart-yaxis", "font-size")
       && basis(".chart-unit-slider") === basis(".chart-range") && prop(".chart-unit-line", "gap") === prop(".chart-with-axis", "gap"),
     [basis(".chart-unit.left"), basis(".chart-yaxis"), basis(".chart-unit-slider"), basis(".chart-range")]);
  ck("  ...one fixed height, in the flow (filtered or not, nothing moves)", prop(".chart-unit-line", "height") === "22px" && !prop(".chart-unit-line", "position"));
  // the corner: out of the row's flow, from the row's left edge back to the chart's left edge, one column wide
  const terms = (calc) => (calc ?? "").replace(/^calc\(|\)$/g, "").split(/\s*\+\s*/).filter((t) => t !== "100%").sort().join(" + ");
  const corner = (rowSel, cornerSel) => {
    const right = terms(prop(cornerSel, "right")), width = prop(cornerSel, "width"), margin = terms(prop(rowSel, "margin-left"));
    return { fills: terms(`calc(${[right, width].join(" + ")})`) === margin, right, width, margin };
  };
  const plain = corner(".weather-axis.under-yaxis", ".chart-fit-corner");
  const slid = corner(".weather-axis.under-yaxis.beside-range", ".weather-axis.under-yaxis.beside-range .chart-fit-corner");
  ck("the fit mark's corner is the dates' row's empty left part: under the axis numbers (2.6em), or under the slider",
     plain.fills && plain.width === basis(".chart-yaxis") && slid.fills && slid.width === basis(".chart-range")
       && prop(".chart-fit-corner", "position") === "absolute", { plain, slid });
  const base = [{ t: 0, v: 200 }, { t: 1000, v: 600 }];
  const html = draw(h(LineChart, chart(base, { filter: filt(base, null) })));
  const row = inside(html, "weather-axis");
  ck("  ...drawn there, before the dates; the slider before the axis; the unit once, on the line",
     /weather-axis under-yaxis beside-range/.test(row) && row.indexOf("chart-fit-corner") < row.indexOf("<span>", row.indexOf("</button>"))
       && /chart-fit-mark/.test(inside(row, "chart-fit-corner")) && !/chart-fit-mark/.test(inside(html, "chart-unit-line"))
       && html.indexOf('class="chart-range"') < html.indexOf("chart-yaxis left") && /chart-unit-slider/.test(inside(html, "chart-unit-line"))
       && text(inside(html, "chart-unit-line")).includes("W") && !/chart-yaxis-unit/.test(html), row);
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
  // the trend's own window, read an hour before this detail: the detail is read over it, not over "the last 24 hours"
  const W24 = { from: now - 25 * HOUR_MS, to: now - HOUR_MS };
  const steps = [["5minute", "readings", undefined], ["hour", "5minute", 5 * M], ["day", "hour", HOUR_MS], ["week", "day", DAY_MS]];
  for (const [period, source, stepMs] of steps) {
    asked.length = 0;
    const a = (await loadOne(port(true), { kind: "finer", ids: ["sensor.q"], window: W24, period }, now))["sensor.q"];
    ck(`a ${period} step reads ${source === "readings" ? "the readings themselves (time-weighted)" : `the ${source} figures, once each`}`,
       asked.join() === source && a.of === period && a.stepMs === stepMs && a.series.points.length > 0 && a.window === W24, [asked, a.of, a.stepMs]);
  }
  asked.length = 0;
  const none = (await loadOne(port(false), { kind: "finer", ids: ["sensor.q"], window: W24, period: "day" }, now))["sensor.q"];
  ck("  ...a device with no figures: every change kept, in the finer step (as its chart is made)",
     asked.join() === "hour,readings" && none.stepMs === HOUR_MS && none.series.points.length > 0
       && none.series.points.slice(1).every((p) => p.t === cellEdges(p.t, p.t + 1, HOUR_MS)[0]), asked);
  const fk = (period, window = W24) => historyKey({ kind: "finer", ids: ["a"], window, period });
  ck("a different period, or another trend's window, is a different request", fk("day") !== fk("week")
     && fk("day") !== fk("day", { from: W24.from + M, to: W24.to + M }) && fk("day") !== historyKey({ kind: "trend", ids: ["a"], hours: 24, period: "day" }));
  const seen = [];
  await loadOne({ stateRows: async (id, from, to) => { seen.push([from, to]); return rows; }, getStatisticsDuringPeriod: async () => ({}) },
    { kind: "finer", ids: ["sensor.q"], window: W24, period: "5minute" }, now);
  ck("  ...read over that window exactly, whatever the clock says now", seen.length === 1 && seen[0][0] === W24.from && seen[0][1] === W24.to, seen);
  const tree = parseTsx("components/panels/NumericHistory.tsx");
  const flat = tree.text.replace(/\s+/g, " ");
  ck("NumericHistory asks for them only for the charts whose range leaves something out, over their trend's own window, else nothing",
     /useHistorySource\(filtering\.length && over \? \{ finer: \{ kind: "finer", ids: filtering\.map\(\(s\) => s\.id\), window: over, period: range\.period \} \} : null\)/.test(flat)
       && /const over = history\[filtering\[0\]\?\.id\]\?\.window;/.test(flat)
       && /const filtering = slidable\.filter\(\(s\) => activeRange\(filterOf\(filters, scope, s\.id\)\)\)/.test(tree.text));
  ck("  ...and draws what rangeChart says, with the series' own detail, never the request's status but its failure",
     /rangeChart\(base, set, range\.period, range\.grainMs, \{ finer: finer\?\.finer\?\.\[s\.id\], failed: finerStatus === "failed" \}\)/.test(flat)
       && /lines: \[\{ \.\.\.line\(s\), pts: c\.points, gaps: c\.gaps \}\], window: c\.window,/.test(flat)
       && /kept: c\.kept, state: c\.state,/.test(flat) && (flat.match(/finerStatus/g) ?? []).length === 2);
}

console.log("\n  the filtered chart: its detail only for this trend, whatever else is loading");
{
  const start = localMidnight(Date.UTC(2026, 5, 1, 12)), window = { from: start, to: start + 24 * HOUR_MS };
  // a pump at 900 W for its first 3 hours and from 12:00 to 15:00, else 150 W, in five-minute readings
  const raw = { points: Array.from({ length: 24 * 12 }, (_, i) => ({ t: start + i * 5 * M, v: i < 36 || (i >= 144 && i < 180) ? 900 : 150 })), gaps: [], window };
  const base = intervalSeries(raw, HOUR_MS);
  const finerOver = (w) => ({ of: "hour", stepMs: 5 * M, window: w,
    series: { points: raw.points.filter((p) => p.t >= w.from && p.t < w.to), gaps: [], window: w } });
  const on = { lo: 600, hi: Infinity };
  const mine = R.rangeChart(base, on, "hour", HOUR_MS, { finer: finerOver(window), failed: false });
  ck("its own detail: the 6 running hours kept, the first 3 among them", mine.state === "ready" && mine.kept.count === 6
     && mine.points.map((p) => mine.kept.realAt(p.t)).slice(0, 3).join() === [0, 1, 2].map((h) => start + h * HOUR_MS).join(), mine.kept?.count);
  const later = { from: window.from + 3 * HOUR_MS, to: window.to + 3 * HOUR_MS };
  const old = R.rangeChart(base, on, "hour", HOUR_MS, { finer: finerOver(later), failed: false });
  ck("a detail read 3 hours later (another window) is never used: the chart waits for its own, drawn in full, nothing dropped",
     old.state === "loading" && old.kept === null && old.points === base.points && old.window === base.window, old.state);
  ck("  ...nor one for another period", R.rangeChart(base, on, "day", HOUR_MS, { finer: finerOver(window), failed: false }).state === "loading");
  ck("  ...and when the detail could not be read: in full, said as failed", R.rangeChart(base, on, "hour", HOUR_MS, { failed: true }).state === "failed");
  ck("its detail in, a failure of a later reload changes nothing (another chart's range never blinks this one)",
     R.rangeChart(base, on, "hour", HOUR_MS, { finer: finerOver(window), failed: true }).state === "ready");
  const none = R.rangeChart(base, null, "hour", HOUR_MS, { failed: false });
  ck("no range: the trend itself, on its own window", none.state === "ready" && none.points === base.points && none.kept === null && none.window === window);
  const empty = R.rangeChart(base, { lo: 2000, hi: Infinity }, "hour", HOUR_MS, { finer: finerOver(window), failed: false });
  ck("nothing kept: the frame stays on the period's window", empty.kept.count === 0 && empty.window === window && empty.points.length === 0);
  ck("kept: the line on the kept steps' own window", mine.window === mine.kept.series.window && mine.window.to === start + 6 * HOUR_MS);
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
  const attr = (el, k) => props(el).properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === k)?.initializer?.expression?.getText();
  ck("the chart on two scales has no slider; every one-line chart has one",
     dual.length === 1 && spread(dual[0]).length === 0 && !/filter=/.test(dual[0].getText())
       // one drawing of a one-line chart (oneLine: one series, and each of several), and the chart on two scales
       && charts.length === 2 && charts.filter((el) => el !== dual[0]).every((el) => ["filter", "lines", "window"].every((k) => attr(el, k) === `f.${k}`))
       && named("filtered").length === 1 && named("filtered").every((c) => ts.isVariableDeclaration(c.parent) && c.parent.name.getText() === "f"),
     charts.map((el) => ["filter", "lines", "window"].map((k) => attr(el, k))));
}

console.log("\n  every line chart shows the fit mark, a bar chart none");
{
  const two = draw(h(LineChart, { lines: [{ pts: [{ t: 0, v: 1 }, { t: 1, v: 2 }], label: "a", unit: " °C" }, { pts: [{ t: 0, v: 5 }, { t: 1, v: 9 }], label: "b", unit: " %", scale: "own" }],
    window: { from: 0, to: 2 }, status: "ready", label: "H", stepMs: 300000,
    filter: { base: [{ t: 0, v: 1 }, { t: 1, v: 2 }], range: { lo: 1.5, hi: 2 }, onChange() {}, state: "loading" } }));
  const line2 = inside(two, "chart-unit-line"), row2 = inside(two, "weather-axis");
  ck("the chart on two scales: no slider nor chip even if given a filter; the fit mark under its left axis numbers; its units on the line, left and right",
     !/chart-range|chart-unit-slider/.test(two) && /weather-axis under-yaxis right"/.test(row2) && /chart-fit-mark/.test(inside(row2, "chart-fit-corner"))
       && text(inside(line2, "chart-unit left")).includes("°C") && line2.indexOf("chart-unit right") > line2.indexOf("chart-unit-grow")
       && text(inside(line2, "chart-unit right")).includes("%") && !/chart-yaxis-unit/.test(two), [text(line2), row2.slice(0, 60)]);
  const weather = draw(h(LineChart, { lines: [{ pts: [{ t: 0, v: 20 }, { t: 1, v: 24 }], label: "Temperature", unit: "°" }], window: { from: 0, to: 2 }, status: "ready", label: "W", stepMs: 3600000 }));
  ck("  ...a Weather line chart (no filter): the fit mark under its axis numbers, the plot its full width (no slider column)",
     /chart-fit-mark/.test(inside(inside(weather, "weather-axis"), "chart-fit-corner")) && !/beside-range|chart-range|chart-unit-slider/.test(weather));
  const BarChart = (await import("@/components/panels/BarChart")).default;
  const bars = draw(h(BarChart, { buckets: [{ t: 0, segs: [{ key: "a", label: "a", v: 3, cls: "out" }] }, { t: 1, segs: [{ key: "a", label: "a", v: 5, cls: "out" }] }], fmt: String, unit: "kWh", stamp: String, ticks: [], label: "E" }));
  ck("  ...a bar chart (always from 0) has none, its unit on its axis", /chart-yaxis/.test(bars) && !/chart-fit-mark|chart-unit-line/.test(bars) && /chart-yaxis-unit/.test(bars));
  const lineTree = parseTsx("components/panels/LineChart.tsx");
  ck("  ...one place draws it for every line chart: the dates' row (TimeAxis), once", elements(lineTree, "FitMark").length === 1
     && elements(parseTsx("components/panels/ChartAxis.tsx"), "FitMark").length === 0);
}

console.log("\n  dragging the lower handle up from the floor (owner, 2026-10-30: \u201cthe baseline graph only shows values >0, when i start to filter from the lower boundary, the graph show negative values\u201d)");
{
  const w = { from: 0, to: 4 }, plot = { left: 0, right: 100, top: 12, bottom: 98 };
  const axisOf = (values, fit, range) => chartGeometry(w, [{ pts: values.map((v, i) => ({ t: i, v })), gaps: [],
    ...(range && R.activeRange(range) ? { holds: values, limits: R.activeRange(range) } : {}) }], plot, 0.08, fit).series[0];
  // the slider's loop, as ChartRangeSlider runs it: the finger read on the axis pressed on, the chart re-fitted to the
  // range after each move; `frozen` false reads it on the re-fitted axis (as before)
  const drag = (values, fit, ys, frozen = true) => {
    const extent = R.valueExtent(values), pressed = axisOf(values, fit, null);
    let range = null;
    const seen = [];
    for (const y of ys) {
      const on = frozen ? pressed : axisOf(values, fit, range);
      range = R.moveHandle(range, "lo", R.valueAtY(on, plot, y), on, extent);
      seen.push({ lo: range.lo, axisLo: axisOf(values, fit, range).lo });
    }
    return { seen, plainLo: pressed.lo };
  };
  const up = [97, 96, 95, 94, 93, 92, 90, 88, 85, 80, 75, 70];
  const pump = [0, 0, 110, 1500, 1620, 0, 400];
  for (const fit of ["zero", "fitted"]) {
    for (const frozen of [true, false]) {
      const { seen, plainLo } = drag(pump, fit, up, frozen);
      // from 0 the floor stays; fitted, the axis zooms to the range (owner, 2026-10-26) but never below its floor unfiltered
      const floorKept = (x) => (fit === "zero" ? x.axisLo === plainLo : x.axisLo >= plainLo);
      ck(`${fit}${frozen ? "" : ", read on the re-fitted axis"}: a pump's power (never below 0) dragged up from the floor: every limit at or above its lowest reading, the axis never below its floor unfiltered${fit === "zero" ? " (it stays)" : ""}`,
         seen.every((x) => (x.lo === -Infinity || x.lo >= 0) && floorKept(x)) && seen.some((x) => x.lo > 0),
         { plainLo, seen: seen.map((x) => [x.lo, x.axisLo]) });
    }
  }
  ck("  ...from 0, that floor is 0 itself", drag(pump, "zero", up).plainLo === 0);
  // a grid export: the readings go below 0 for good reason
  const grid = [-3000, -1200, 0, 800, 2000];
  for (const fit of ["zero", "fitted"]) {
    const { seen, plainLo } = drag(grid, fit, [97, 95, 92, 88]);
    const low = R.moveHandle(null, "lo", -2900, axisOf(grid, fit, null), R.valueExtent(grid)).lo;
    const past = R.moveHandle(null, "lo", -3500, { ...axisOf(grid, fit, null), lo: -4000 }, R.valueExtent(grid)).lo;
    ck(`${fit}: a grid export (down to -3k): the lower handle reaches its most negative reading, never beyond, the axis keeps that negative floor`,
       plainLo < 0 && seen.every((x) => (x.lo === -Infinity || x.lo >= -3000) && (fit === "zero" ? x.axisLo === plainLo : x.axisLo >= plainLo))
         && low === -2900 && past === -Infinity,
       { plainLo, low, past, seen: seen.map((x) => [x.lo, x.axisLo]) });
  }
  const slider = readFileSync(new URL("../../src/components/panels/ChartRangeSlider.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
  ck("  ...the slider reads the finger on the axis it pressed on until the finger lifts, its limits among the chart's values",
     /pressed\.current = \{ lo: axis\.lo, hi: axis\.hi, step: axis\.step \};/.test(slider)
       && /moveHandle\(range, drag\.current, valueAt\(e\.clientY, pressed\.current\), pressed\.current, extent\)/.test(slider)
       && /const end = \(\) => \{ drag\.current = null; pressed\.current = null; \};/.test(slider)
       && readFileSync(new URL("../../src/components/panels/LineChart.tsx", import.meta.url), "utf8").includes("extent={valueExtent(slid.base.map((p) => p.v))}"));
}

console.log("\n  a range pressed: nothing of the last range under the new one (owner, 2026-10-30)");
{
  const flat = readFileSync(new URL("../../src/components/panels/NumericHistory.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
  ck("while the new range loads, the last one's line is not drawn, nor its window asked for detail with the new period",
     /const history = status === "loading" \? \{\} : data\?\.trend \?\? \{\};/.test(flat) && /const over = history\[filtering\[0\]\?\.id\]\?\.window;/.test(flat));
}

done("✅ a trend chart's range filter: the owner's rule, on the chart's own axis");
