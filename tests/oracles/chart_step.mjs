// Every chart says a value's moment at its own step, and its step and aggregation beside its title (owner, 2026-10-20:
// a daily value read "231 W · 15 Oct, 00:00"; "show the aggregation … avg or sum, consistently everywhere").
// Driven by value; dates never pinned as locale text (CI is en-US): a clock's absence, a week's dash, equal calls.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { fmtStepStamp, fmtCellSpan, stepWords, aggregationWords } = await import("@/components/panels/chartUtils");

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const CLOCK = /\d\d?:\d\d/;
const t = new Date(2026, 9, 15, 0, 0).getTime();              // a day's figure, stamped at its local midnight

console.log("  a value's moment, at its step");
ck("a day's value: the day, never a clock time", !CLOCK.test(fmtStepStamp(t, DAY, 720)), fmtStepStamp(t, DAY, 720));
ck("  ...the same day whatever hour of it is asked", fmtStepStamp(t, DAY, 720) === fmtStepStamp(t + 13 * HOUR, DAY, 720));
const wk = fmtStepStamp(t, 7 * DAY, 8760);
ck("a week's value: its first and last day, no clock", wk.includes(" – ") && !CLOCK.test(wk), wk);
ck("  ...its last day is the 7th, not the next week's first", wk.endsWith(fmtStepStamp(t + 6 * DAY, DAY, 720)), wk);
ck("a month's value: the month, no clock, no dash", !CLOCK.test(fmtStepStamp(t, 31 * DAY, 8760)) && !fmtStepStamp(t, 31 * DAY, 8760).includes("–"));
ck("an hour's and five minutes' values keep their time", CLOCK.test(fmtStepStamp(t + 14 * HOUR, HOUR, 168)) && CLOCK.test(fmtStepStamp(t + 14 * HOUR, 5 * MIN, 24)));
ck("a band's day and week slices say the same as a line's (one wording)",
   fmtCellSpan(t, t + DAY, DAY, 720) === fmtStepStamp(t, DAY, 720) && fmtCellSpan(t, t + 7 * DAY, 7 * DAY, 8760) === wk);

console.log("\n  the step and its aggregation");
ck("each step in words", [5 * MIN, HOUR, DAY, 7 * DAY, 31 * DAY].map(stepWords).join() === "5-min,hourly,daily,weekly,monthly");
ck("a measured value says avg, a total sum, a band its step alone",
   aggregationWords(DAY, "avg") === "daily avg" && aggregationWords(HOUR, "sum") === "hourly sum" && aggregationWords(DAY, null) === "daily");

console.log("\n  every chart passes its step (the wiring)");
const src = (f) => readFileSync(new URL(`../../src/components/panels/${f}`, import.meta.url), "utf8");
const line = src("LineChart.tsx"), num = src("NumericHistory.tsx"), band = src("LastDayTimeline.tsx");
const weather = src("WeatherPanel.tsx"), energy = src("EnergyPanel.tsx"), head = src("historyRange.tsx");
ck("the line chart's tooltip says the moment at its step (a closed-up chart: its kept step's real time, worded for the period)", /stamp=\{fmtStepStamp\(realAt\(hover\.t\), stepMs, dated\.spanHours\)\}/.test(line) && !/fmtChartStamp\(hover/.test(line));
ck("every device line chart gives the range's step, its header 'avg'",
   // two drawings: the one-line chart (oneLine: one series, and each of several) and the chart on two scales
   (num.match(/<LineChart stepMs=\{range\.grainMs\}/g) || []).length === 2 && /aggregationWords\(range\.grainMs, "avg"\)/.test(num)
   // one header for every layout, the larger chart's too (owner, 2026-10-29: its window has the same `Last …` line)
   && /const header = \(title: string\) => <HistoryHeader title=\{title\} picker=\{picker\} step=\{step\} \/>/.test(num));
ck("the on/off band's header: its step alone", /step=\{aggregationWords\(range\.grainMs, null\)\}/.test(band));
ck("a history header shows the step beside its title", /\{title\}<ChartStep words=\{step\} \/>/.test(head));
ck("the Weather charts: their period's step, 'avg', the rain 'sum' at its own bucket",
   (weather.match(/<ChartTile picker=\{picker\} stepMs=\{PERIOD_MS\[range\.period\]\}/g) || []).length === 5
   && /aggregationWords\(stepMs, "avg"\)/.test(weather) && /aggregationWords\(stepMs, "sum"\)/.test(weather)
   && /stepMs=\{PERIOD_MS\[range\.totalPeriod\]\}/.test(weather) && /const slot = stepMs;/.test(weather));
ck("the Energy charts: 'sum' at their bucket, tooltips at their step",
   (energy.match(/aggregationWords\(PERIOD_MS[.[][^,]+, "sum"\)/g) || []).length === 3 && (energy.match(/stamp=\{\(t\) => fmtStepStamp\(/g) || []).length === 3);

done("✅ every chart's moment and aggregation at its step");
