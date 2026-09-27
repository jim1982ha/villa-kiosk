// Every device trend in ONE five-minute interval, outages shaded by interval,
// and unavailable always the legend's colour (2.496.179). Owner: "values
// reported as 5 min time intervals everywhere … the pumps report every minute
// … background coloured when unavailable on each 5 min interval … the state
// shift time in the tooltip"; and an AP's lost stretches painted dark green.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const T = await import("@/utils/trendInterval");
const { paintState, paletteColorFor, STATUS_COLOR } = await import("@/utils/stateColors");
const { fmtOutage } = await import("@/components/panels/chartUtils");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const M = 60_000, t0 = Date.UTC(2026, 8, 27, 10, 0);

// A pump reporting every minute: 0, 1, 2 … 19 W over 20 minutes.
const minutely = { points: Array.from({ length: 20 }, (_, i) => ({ t: t0 + i * M, v: i })), gaps: [], window: { from: t0, to: t0 + 20 * M } };
const f = T.fiveMinuteSeries(minutely);
ck("a sensor reporting every minute becomes one value per five minutes, stamped on the clock's :00 :05 :10 :15",
   f.points.length === 4 && f.points.map((p) => (p.t - t0) / M).join() === "0,5,10,15", f.points.map((p) => (p.t - t0) / M));
ck("  ...each the interval's time-weighted mean (0..4 → 2, 5..9 → 7)", near(f.points[0].v, 2) && near(f.points[1].v, 7), f.points.map((p) => p.v));

const held = T.fiveMinuteSeries({ points: [{ t: t0, v: 0 }, { t: t0 + 2 * M, v: 100 }], gaps: [], window: { from: t0, to: t0 + 10 * M } });
ck("a reading HOLDS until the next one (the chart's step rule): 2 min at 0 then 3 at 100 → 60; the next interval 100",
   near(held.points[0].v, 60) && near(held.points[1].v, 100), held.points.map((p) => p.v));

const out = T.fiveMinuteSeries({ points: [{ t: t0, v: 10 }, { t: t0 + 8 * M, v: 20 }], gaps: [{ from: t0 + 7 * M, to: t0 + 8 * M }], window: { from: t0, to: t0 + 15 * M } });
ck("an outage is shaded over the WHOLE five-minute interval it touched (10:07–10:08 → 10:05–10:10)",
   out.gaps.length === 1 && out.gaps[0].from === t0 + 5 * M && out.gaps[0].to === t0 + 10 * M, out.gaps);
ck("  ...keeping its REAL times for the tooltip: 'Unavailable · 10:07–10:08 (1 min)'",
   out.gaps[0].actual.from === t0 + 7 * M && /\(1 min\)$/.test(fmtOutage(out.gaps[0], t0 + 15 * M)), fmtOutage(out.gaps[0], t0 + 15 * M));
ck("  ...and the interval's value counts only its available minutes (10:05–10:07 at 10, 10:08–10:10 at 20 → 15, the outage minute not counted)",
   near(out.points[1].v, 15), out.points.map((p) => p.v));
const two = T.widenGaps([{ from: t0 + 1 * M, to: t0 + 2 * M }, { from: t0 + 3 * M, to: t0 + 4 * M }], t0, t0 + 10 * M);
ck("two outages in one interval are one shaded interval, from the first's start to the last's end",
   two.length === 1 && two[0].actual.from === t0 + M && two[0].actual.to === t0 + 4 * M, two);
const none = T.fiveMinuteSeries({ points: [{ t: t0, v: 5 }], gaps: [{ from: t0 + M, to: t0 + 10 * M }], window: { from: t0, to: t0 + 10 * M } });
ck("an interval with no available minute has no value (no invented reading)", none.points.length === 1, none.points);

ck("unavailable and unknown are the legend's colour on ANY timeline mapping", paintState(() => "green")("unavailable") === STATUS_COLOR.unavailable
   && paintState(() => "green")("unknown") === STATUS_COLOR.unavailable && paintState(() => "green")("connected") === "green");
const pal = paletteColorFor(["unavailable", "connected", "disconnected"]);
ck("  ...a text sensor's palette never spends a colour on them — the AP's first real state keeps the first colour",
   pal("unavailable") === STATUS_COLOR.unavailable && pal("connected") === paletteColorFor(["connected"])("connected"));

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const st = src("components/panels/StateTimeline.tsx");
ck("the timeline has ONE interval (no bucketMinutes anywhere) and paints through paintState",
   /const bucketMs = TREND_INTERVAL_MS;/.test(st) && /const colorFor = useMemo\(\(\) => paintState\(ownColour\)/.test(st)
   && !["components/panels/historyRange.tsx", "components/panels/SensorPanel.tsx", "components/panels/GenericPanel.tsx", "components/panels/LastDayTimeline.tsx", "components/panels/CameraPanel.tsx"].some((f) => /bucketMinutes/.test(src(f))));
ck("numeric device charts (sensor, pumps, device groups) draw the five-minute trend, not raw points",
   /series: await fetchTrend\(mapping\.entityId, range\.hours\)/.test(src("components/panels/SensorPanel.tsx")) && /fetchTrend\(id, range\.hours\)/.test(src("components/panels/DeviceGroupPanel.tsx"))
   && /return fiveMinuteSeries\(await fetchHistory\(entityId, hours\)\);/.test(src("ha/HAHistoryAPI.ts")));
ck("a device-group member that is unavailable NOW still gets its chart", /r\.numeric !== undefined \|\| \(r\.unavailable && r\.unit !== ""\)/.test(src("components/panels/DeviceGroupPanel.tsx")));
ck("the camera bar paints a lost motion sensor as unavailable, not 'online'",
   /return "motion-unavailable";/.test(src("components/panels/CameraPanel.tsx")) && /s === "offline" \|\| s === "motion-unavailable" \? STATUS_COLOR\.unavailable/.test(src("components/panels/CameraPanel.tsx")));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one five-minute interval, one unavailable colour");
