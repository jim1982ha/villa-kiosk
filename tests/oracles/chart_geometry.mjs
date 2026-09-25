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
  const charts = files.filter((f) => /<polyline|className="chart-bar"/.test(readFileSync(f, "utf8")));
  ck(`found the history charts (${charts.length}: Sparkline, DualSparkline, Weather)`, charts.length >= 3, charts.map((f) => f.slice(SRC.length)));
  const own = charts.filter((f) => !/\bchartGeometry\(/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length));
  ck("every one draws from chartGeometry", own.length === 0, own);
  const rules = files.filter((f) => /function (nearest|timeAt|nearestIndexByX)\b|const sx = \(t: number\)/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length));
  ck("no chart keeps a hover rule or x-scale of its own", rules.length === 0, rules);
  const unbanded = charts.filter((f) => {
    // The shared <Bands> renderer's own body is not a use of it.
    const src = readFileSync(f, "utf8").replace(/function Bands\([\s\S]*?\n\}\n/, "");
    const drawn = (src.match(/\.bands\b[^;\n]*\.map\(|<Bands g=\{g\} \/>/g) ?? []).length;
    return drawn < (src.match(/\bchartGeometry\(/g) ?? []).length;
  }).map((f) => f.slice(SRC.length));
  ck("every chart draws the bands its geometry returns", unbanded.length === 0, unbanded);
  const tips = charts.filter((f) => /className="spark-tip/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length));
  ck("every chart's tooltip is ChartTip", tips.length === 0, tips);
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one chart geometry; an outage is never a reading");
process.exit(fail ? 1 : 0);
