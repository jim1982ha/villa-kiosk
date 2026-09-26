// One history source, two recorder paths (src/ha/HAHistoryAPI.ts):
// states over REST and STATISTICS over the websocket both return a
// HistorySeries — points, gaps, window — and a failed request is a failure.
//
// ⚠️ REPRODUCED AGAINST 2.496.88: the Weather window's rain request failing,
// or the recorder holding nothing for the gauge, drew "No rain in the last
// 24 h" and a 0.0 mm figure — the rows came back as `[]`, the chart summed
// them to zero, and zero is a reading. The statistics path also carried no
// gaps, so each chart had to remember `bucketGaps`; the rain bars did not.
// The first checks below run the OLD reading of those rows to show it lies.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
register("../consistency/alias-hook.mjs", import.meta.url);
const { statisticsSeries, seriesTotal, seriesExtent, PERIOD_MS } = await import("@/utils/statisticsSeries");
const { fetchStatistics } = await import("@/ha/HAHistoryAPI");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const Hr = PERIOD_MS.hour, t0 = 1_700_000_000_000;
const win = { from: t0, to: t0 + 24 * Hr };
const hourly = (n, f) => Array.from({ length: n }, (_, i) => ({ start: t0 + i * Hr, end: t0 + (i + 1) * Hr, ...f(i) }));

console.log("  the rain that was never recorded:");
{
  const oldTotal = [].reduce((s, p) => s + (typeof p.change === "number" && p.change > 0 ? p.change : 0), 0);
  ck("the OLD reading of no rows: a total of 0 mm", oldTotal === 0);
  const s = statisticsSeries([], "change", "hour", win);
  ck("no rows is no total — not zero", seriesTotal(s) === undefined, seriesTotal(s));
  ck("  ...and an outage the width of the window", s.gaps.length === 1 && s.gaps[0].from === win.from && s.gaps[0].to === win.to, s.gaps);
  const dry = statisticsSeries(hourly(23, () => ({ change: 0 })), "change", "hour", win);
  ck("a gauge that REPORTED zero all day: 0 mm, a real reading", seriesTotal(dry) === 0 && dry.gaps.length === 0, [seriesTotal(dry), dry.gaps]);
  const wet = statisticsSeries(hourly(23, (i) => ({ change: i === 5 ? 1.2 : i === 6 ? 0.3 : 0 })), "change", "hour", win);
  ck("a wet hour sums", Math.abs(seriesTotal(wet) - 1.5) < 1e-9, seriesTotal(wet));
}

console.log("\n  the gaps travel with the points:");
{
  const rows = hourly(23, (i) => ({ mean: 20 + i })).filter((_, i) => i < 8 || i > 12);
  const s = statisticsSeries(rows, "mean", "hour", win);
  ck("missing buckets are an outage in the returned series", s.gaps.length === 1 && s.gaps[0].from === t0 + 8 * Hr && s.gaps[0].to === t0 + 13 * Hr, s.gaps);
  const nulls = statisticsSeries(hourly(23, (i) => ({ mean: i >= 10 && i < 14 ? null : 21 })), "mean", "hour", win);
  ck("a bucket written without the field is an outage too, never 0", nulls.points.every((p) => p.v === 21) && nulls.gaps.length === 1, nulls.gaps);
  ck("the series carries the window asked for", JSON.stringify(s.window) === JSON.stringify(win));
  ck("extent: min and max, or undefined with none", JSON.stringify(seriesExtent(s)) === JSON.stringify({ min: 20, max: 42 }) && seriesExtent(statisticsSeries([], "mean", "hour", win)) === undefined, seriesExtent(s));
}

console.log("\n  the statistics adapter:");
{
  const calls = [];
  const port = { async getStatisticsDuringPeriod(ids, start, period, end, types) {
    calls.push({ ids, period, types });
    return { "sensor.a": hourly(3, () => ({ mean: 1, min: 0, max: 2 })) };
  } };
  const r = await fetchStatistics(port, ["sensor.a", "sensor.b"], 24, "hour", ["mean", "max"]);
  ck("one request for every id and field", calls.length === 1 && calls[0].ids.length === 2 && calls[0].types.join() === "mean,max", calls);
  ck("a series per id per field", r["sensor.a"].mean.points.length === 3 && r["sensor.a"].max.points[0].v === 2);
  ck("an id the recorder has nothing for: an outage, not an empty zero", r["sensor.b"].mean.points.length === 0 && r["sensor.b"].mean.gaps.length === 1, r["sensor.b"]);
  let rejected = false;
  await fetchStatistics({ async getStatisticsDuringPeriod() { throw new Error("socket closed"); } }, ["sensor.a"], 24, "hour", ["mean"])
    .catch(() => { rejected = true; });
  ck("a failed request REJECTS — the caller's status is 'failed', not 'no data'", rejected);
  const none = await fetchStatistics(port, [], 24, "hour", ["mean"]);
  ck("no ids: no request", Object.keys(none).length === 0 && calls.length === 1);
}

console.log("\n  the callers:");
{
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(p) && out.push(p); } return out; };
  const files = walk(SRC).filter((f) => /\/(components|hooks)\//.test(f));
  const fetchers = files.filter((f) => /\b(fetchHistory|fetchStateHistory|fetchStatistics)\(|getStatisticsDuringPeriod\(/.test(readFileSync(f, "utf8")));
  ck(`found the panels that read history (${fetchers.length})`, fetchers.length >= 5, fetchers.map((f) => f.slice(SRC.length)));
  const raw = fetchers.filter((f) => /getStatisticsDuringPeriod\(/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length));
  ck("no panel reads raw statistics rows — only the adapter's series", raw.length === 0, raw);
  const handRolled = fetchers.filter((f) => !/\buseHistory\b/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length));
  ck("every one fetches through useHistory (one cancel guard, one failed state)", handRolled.length === 0, handRolled);
  const hook = readFileSync(new URL("../../src/hooks/useHistory.ts", import.meta.url), "utf8");
  ck("  ...which reports a failure as 'failed', and drops the other range's answer",
     /\.catch\(\(\) => \{ if \(!cancelled\) \{ setData\(initialRef\.current\); setStatus\("failed"\); \} \}\)/.test(hook));
  const range = readFileSync(new URL("../../src/components/panels/historyRange.tsx", import.meta.url), "utf8");
  ck("one range table: the Weather window's ranges are in it, with their statistics periods",
     /key: "30d"[^}]*period: "hour", totalPeriod: "day"/.test(range) && /WEATHER_RANGES[^=]*= \["12h", "24h", "7d", "30d"\]/.test(range));
  const panel = readFileSync(new URL("../../src/components/panels/WeatherPanel.tsx", import.meta.url), "utf8");
  ck("the Weather window has no range table of its own", !/const RANGES\b/.test(panel) && /useHistoryRange\(WEATHER_RANGES/.test(panel));
  ck("'No rain' is said only over readings; no readings says so (utils/barChart.barNote, driven in bar_chart.mjs)",
     /barNote\(buckets, `No rain readings in the last \$\{span\}`, `No rain in the last \$\{span\}`\)/.test(panel));
  ck("the Rain figure is a dash, not '0.0 mm', when there is nothing to sum",
     (await import("@/config/weatherStation")).weatherHistoryFigures({ gustUnit: "", rainUnit: "mm" }).find((f) => f.label === "Rain").value === "—"
     && /const rainTotal = seriesTotal\(data\.rain\);/.test(panel) && /weatherHistoryFigures\(\{[\s\S]*?rainTotal,/.test(panel));
  const lcSrc = readFileSync(new URL("../../src/components/panels/LineChart.tsx", import.meta.url), "utf8");
  ck("a failed history says it could not load (LineChart's ChartEmpty, which the rain tile uses too)",
     /status === "failed" \? "Couldn't load this history\."/.test(lcSrc) && /import LineChart, \{ ChartEmpty \} from "\.\/LineChart";/.test(panel));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one history source; absent is never zero");
process.exit(fail ? 1 : 0);
