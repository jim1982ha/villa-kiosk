// One chart geometry for every history chart (src/utils/chartGeometry.ts):
// scales, lines, a band per series, ticks, and what the pointer is over.
//
// ⚠️ REPRODUCED AGAINST 2.496.88. Two sensors on one chart, the second out
// from 10:00 to 14:00. Hovering at 11:00:
//   * the Weather tooltip took each line's NEAREST bucket — the indoor line's
//     09:55 value, from before its outage — and stamped every row with the
//     OUTDOOR line's time, so it read "Inside 28.4° at 11:00": a reading
//     nobody took;
//   * its band shaded only the FIRST line's outages, so this one had none.
// The first check reruns the old nearest rule to show it lies.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
register("../consistency/alias-hook.mjs", import.meta.url);
const { chartGeometry, readingAt } = await import("@/utils/chartGeometry");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const P = 300_000, H = 3_600_000, t0 = 1_700_000_000_000;
const win = { from: t0, to: t0 + 24 * H };
const plot = { left: 0, right: 320, top: 12, bottom: 138 };
const every5 = (from, to, v) => { const o = []; for (let t = from; t < to; t += P) o.push({ t, v: v(t) }); return o; };
const outdoor = every5(t0, t0 + 24 * H, () => 25);
const indoor = [...every5(t0, t0 + 10 * H, () => 28.4), ...every5(t0 + 14 * H, t0 + 24 * H, () => 27)];
const indoorGap = [{ from: t0 + 10 * H, to: t0 + 14 * H }];
const noon = t0 + 11 * H + 60_000;

console.log("  hovering inside one line's outage:");
{
  const nearest = (pts, t) => pts.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b));
  const old = nearest(indoor, noon);
  ck("the OLD nearest rule reports a reading from before the outage", old.t < t0 + 10 * H && old.v === 28.4, old);
  const g = chartGeometry(win, [{ pts: outdoor, gaps: [] }, { pts: indoor, gaps: indoorGap }], plot, 0.08);
  const h = g.hover(noon);
  ck("the outdoor line reports its reading in force", h?.readings[0]?.v === 25, h?.readings[0]);
  ck("the indoor line reports NOTHING inside its outage", h?.readings[1] === null, h?.readings[1]);
  ck("the stamp is the time of a reading shown, not of one hidden", h?.t === t0 + 11 * H, h?.t);
  ck("  ...and the crosshair is there", Math.abs(h.x - g.sx(t0 + 11 * H)) < 1e-9);
  ck("after the outage, the indoor line reports again", g.hover(t0 + 15 * H)?.readings[1]?.v === 27);
}

console.log("\n  a band per line, in its own slice:");
{
  const g = chartGeometry(win, [{ pts: outdoor, gaps: [] }, { pts: indoor, gaps: indoorGap }], plot);
  ck("the SECOND line's outage has a band (it was the first line's only)", g.series[1].bands.length === 1 && g.series[0].bands.length === 0, g.series.map((s) => s.bands));
  const b = g.series[1].bands[0];
  ck("  ...in the lower half, which says which sensor was out", b.y === plot.top + (plot.bottom - plot.top) / 2 && Math.abs(b.h - (plot.bottom - plot.top) / 2) < 1e-9, b);
  ck("  ...spanning 10:00–14:00", Math.abs(b.x - g.sx(t0 + 10 * H)) < 1e-9 && Math.abs(b.x + b.w - g.sx(t0 + 14 * H)) < 1e-9, b);
  ck("the line is broken at the outage", g.series[1].runs.length === 2, g.series[1].runs.length);
  const one = chartGeometry(win, [{ pts: indoor, gaps: indoorGap }], plot);
  ck("one line: its band is the full height", one.series[0].bands[0].y === plot.top && one.series[0].bands[0].h === plot.bottom - plot.top);
  const dead = chartGeometry(win, [{ pts: outdoor, gaps: [] }, { pts: [], gaps: [{ from: win.from, to: win.to }] }], plot);
  ck("a sensor with no readings at all still has its band", dead.series[1].bands.length === 1 && dead.series[1].runs.length === 0);
}

console.log("\n  the reading in force:");
{
  const pts = [{ t: 10, v: 1 }, { t: 20, v: 2 }, { t: 30, v: 3 }];
  ck("before the first reading: none", readingAt(pts, [], 5) === null);
  ck("at a reading: that reading", readingAt(pts, [], 20)?.v === 2);
  ck("between readings: the last one, which holds", readingAt(pts, [], 29)?.v === 2);
  ck("after the last: it holds", readingAt(pts, [], 99)?.v === 3);
  ck("inside an outage: none", readingAt(pts, [{ from: 25, to: 40 }], 35) === null);
  const g = chartGeometry({ from: 0, to: 100 }, [{ pts, gaps: [] }], plot);
  ck("no series has a reading: no tooltip", g.hover(5) === null);
}

console.log("\n  the scales and the axis:");
{
  const a = [{ t: t0, v: 10 }, { t: t0 + H, v: 20 }], b = [{ t: t0, v: 30 }, { t: t0 + H, v: 40 }];
  const shared = chartGeometry(win, [{ pts: a, gaps: [] }, { pts: b, gaps: [] }], plot);
  ck("shared: one scale for both lines", shared.series[0].lo === 10 && shared.series[1].hi === 40 && shared.series[0].hi === shared.series[1].hi);
  const own = chartGeometry(win, [{ pts: a, gaps: [], scale: "own" }, { pts: b, gaps: [], scale: "own" }], plot);
  ck("own: each its own (the dual chart's two axes)", own.series[0].hi === 20 && own.series[1].lo === 30);
  const zero = chartGeometry(win, [{ pts: b, gaps: [], scale: "fromZero" }], plot, 0.08);
  ck("fromZero: 0 to the top (sunlight, rain), no padding below zero", zero.series[0].lo === 0 && zero.series[0].hi === 40);
  const flat = chartGeometry(win, [{ pts: [{ t: t0, v: 5 }, { t: t0 + H, v: 5 }], gaps: [] }], plot);
  ck("a flat line is drawn, not divided by zero", Number.isFinite(flat.series[0].sy(5)));
  ck("ticks: the window's start, middle and end", shared.ticks.join() === [win.from, (win.from + win.to) / 2, win.to].join());
  ck("the pointer's time is clamped to the window", shared.tAt(-50) === win.from && shared.tAt(9999) === win.to);
}

console.log("\n  the callers:");
{
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(p) && out.push(p); } return out; };
  const files = walk(SRC);
  // ⚠️ "A CHART" USED TO BE WHATEVER HAD <polyline OR className="chart-bar",
  // and the scan shrank silently: the Energy bars (energy-bar) and the state
  // timelines matched neither, and once the rain bars moved to BarChart
  // (2.496.114) "chart-bar" matched nothing at all — three files checked, six
  // charts drawn. Now every chart PRIMITIVE is looked for, every file that
  // draws one must be a known chart module, and the set is pinned exactly, so
  // a chart added or dropped fails here until this list is updated.
  const PRIMITIVE = /<polyline|className="bar-chart"|className="state-timeline-seg"|className="energy-flow"|className="chart-bar"/;
  const CHARTS = {
    // ONE line chart since 2.496.144 (Sparkline, DualSparkline and the
    // Weather tiles drew their own before).
    "components/panels/LineChart.tsx": "line",
    "components/panels/BarChart.tsx": "bars",
    "components/panels/StateTimeline.tsx": "timeline",
    "components/panels/EnergyPanel.tsx": "flow",
  };
  const rel = (f) => f.slice(SRC.length);
  const src = (f) => readFileSync(f, "utf8");
  const charts = files.filter((f) => PRIMITIVE.test(src(f)));
  const unknown = charts.map(rel).filter((f) => !(f in CHARTS));
  ck("every file that draws a chart is a known chart module", unknown.length === 0, unknown);
  const missing = Object.keys(CHARTS).filter((f) => !charts.map(rel).includes(f));
  ck(`  ...and all ${Object.keys(CHARTS).length} still draw one — the scan cannot shrink unseen`, missing.length === 0, missing);
  const lineUsers = files.filter((f) => /<LineChart\b/.test(src(f))).map(rel).sort();
  ck("every history line is drawn by LineChart: the Weather window and both device panels",
     lineUsers.join() === "components/panels/DeviceGroupPanel.tsx,components/panels/SensorPanel.tsx,components/panels/WeatherPanel.tsx", lineUsers);
  const byKind = (k) => charts.filter((f) => CHARTS[rel(f)] === k);
  const own = byKind("line").filter((f) => !/\bchartGeometry\(/.test(src(f))).map(rel);
  ck("every line chart draws from chartGeometry", own.length === 0, own);
  const bars = byKind("bars").filter((f) => !/barLayout\(/.test(src(f)) || !/className="bar-band" style=\{\{ background: STATUS_COLOR\.unavailable \}\}/.test(src(f))).map(rel);
  ck("the bar chart draws from barLayout, and a bucket with no reading as the outage band", bars.length === 0, bars);
  const rules = files.filter((f) => /function (nearest|timeAt|nearestIndexByX)\b|const sx = \(t: number\)/.test(src(f))).map(rel);
  ck("no chart keeps a hover rule or x-scale of its own", rules.length === 0, rules);
  const unbanded = byKind("line").filter((f) => {
    // The shared <Bands> renderer's own body is not a use of it.
    const body = src(f).replace(/function Bands\([\s\S]*?\n\}\n/, "");
    const drawn = (body.match(/\.bands\b[^;\n]*\.map\(|<Bands g=\{g\} \/>/g) ?? []).length;
    return drawn < (body.match(/\bchartGeometry\(/g) ?? []).length;
  }).map(rel);
  ck("every line chart draws the bands its geometry returns", unbanded.length === 0, unbanded);
  const tips = charts.filter((f) => /className="spark-tip/.test(src(f))).map(rel);
  ck("every chart's tooltip is ChartTip", tips.length === 0, tips);
}

console.log("\n  an outage you can SEE and POINT AT (2.496.149 — a pump's 3-min drop-outs were hairlines, its 2-s blips nothing):");
{
  const { MIN_BAND_OF_PLOT } = await import("@/utils/chartGeometry");
  const { fmtOutage, fmtDuration } = await import("@/components/panels/chartUtils");
  const H = 3_600_000, t0 = 1_800_000_000_000, win = { from: t0, to: t0 + 24 * H };
  const blip = { from: t0 + 3 * H, to: t0 + 3 * H + 2_000 };            // 2 s
  const drop = { from: t0 + 5 * H, to: t0 + 5 * H + 3 * 60_000 };        // 3 min
  const pts = [0, 1, 2, 3, 4, 5, 6, 8, 12, 20].map((h) => ({ t: t0 + h * H + 60_000, v: h < 6 ? 0 : 750 }));
  const plot = { left: 0, right: 320, top: 0, bottom: 100 };
  const g = chartGeometry(win, [{ pts, gaps: [blip, drop] }], plot);
  const b = g.series[0].bands;
  ck("every outage is drawn at least MIN_BAND_OF_PLOT wide — the 2-second blip too (it was 1 unit: nothing on screen)",
     b.length === 2 && b.every((x) => x.w >= 320 * MIN_BAND_OF_PLOT - 1e-9), b.map((x) => x.w));
  ck("  ...centred on its outage", Math.abs((b[1].x + b[1].w / 2) - g.sx((drop.from + drop.to) / 2)) < 1e-6);
  // The pointer where the owner's was: at the band's edge, a whole pointer step
  // from the outage's own minutes — the tooltip read the reading after it.
  const edge = g.tAt(b[1].x + b[1].w - 0.1);
  const h1 = g.hover(edge);
  ck("hovering anywhere on the drawn band reports the outage, and no reading for that line",
     !!h1 && h1.outages[0] === drop && h1.readings[0] === null, h1 && { out: h1.outages[0], r: h1.readings[0] });
  ck("  ...even where no line has a reading at all (it returned no tooltip)", !!g.hover(drop.from + 60_000));
  ck("  ...and just clear of it, the reading again", g.hover(g.tAt(b[1].x + b[1].w + 2))?.outages[0] === null);
  ck("the tooltip says what and how long: 'Unavailable · from–to (3 min)', a 2-s blip in seconds, a running one 'since'",
     /^Unavailable · .+–.+ \(3 min\)$/.test(fmtOutage(drop, win.to)) && fmtDuration(2_000) === "2 s" && fmtDuration(80 * 60_000) === "1 h 20 min"
     && /^Unavailable since .+ \(2 h\)$/.test(fmtOutage({ from: win.to - 2 * H, to: Infinity }, win.to)), fmtOutage(drop, win.to));
  const lc = readFileSync(new URL("../../src/components/panels/LineChart.tsx", import.meta.url), "utf8");
  ck("LineChart prints the outage row the geometry reports", /if \(out\) return \[\{ key: `\$\{i\}`, marker: keyOf\(l\), text: `\$\{who\}\$\{fmtOutage\(out, g\.window\.to\)\}` \}\];/.test(lc));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one chart geometry; an outage is never a reading");
process.exit(fail ? 1 : 0);
