// The five periods every history toggle offers, each with its time step, and the part older than the villa's system
// keeps (owner, 2026-10-20: "1h, 24h, 1w at 5 min; 1m daily; 1y weekly" — on/off bands still offer all five and grey
// what is no longer kept). Driven by value through the pure modules and the history source with a fake port.
//
// ⚠️ BEFORE: every device chart drew in ONE five-minute step, so a year would be 105,120 slices; and a window older
// than the recorder keeps read as blank — "nothing happened" — where nothing is kept any more.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { RANGES, RANGE_KEYS, historyRange } = await import("@/utils/historyRanges");
const { intervalSeries, fiveMinuteSeries, widenGaps } = await import("@/utils/trendInterval");
const { loadOne, keptFromRows, keptLookFrom, withNotKept } = await import("@/ha/historySource");
const { NOT_KEPT, NOT_KEPT_COLOR, NOT_KEPT_WORDS, STATUS_COLOR } = await import("@/utils/stateColors");
const { chartColours } = await import("@/config/reading");
const { timelineCells } = await import("@/utils/timelineCells");
const { fmtOutage } = await import("@/components/panels/chartUtils");

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const now = Date.UTC(2026, 9, 20, 12, 0);
const kept = now - 11 * DAY;                                  // the villa's system keeps 11 days of every change

console.log("  the table:");
ck("five periods, in the toggle's order", RANGE_KEYS.join() === "1h,24h,1w,1m,1y", RANGE_KEYS);
ck("  ...an hour, a day, a week, 30 days, a year", RANGES.map((r) => r.hours).join() === "1,24,168,720,8760");
ck("  ...five minutes up to a day, an hour for a week, a day for a month, a week for a year (owner, 2026-10-20)",
   RANGES.map((r) => r.grainMs / MIN).join() === `5,5,60,${24 * 60},${7 * 24 * 60}`);
ck("  ...the recorder's bucket is that step", RANGES.map((r) => r.period).join() === "5minute,5minute,hour,day,week");
ck("  ...each title says the period its toggle names",
   RANGES.map((r) => r.title).join() === "Last hour,Last 24 hours,Last week,Last month,Last year", RANGES.map((r) => r.title));
ck("  ...the rain's: an hour, an hour, a day, a day, a week", RANGES.map((r) => r.totalPeriod).join() === "hour,hour,day,day,week");
ck("a year is drawn in 53 slices, not 105,120", (() => {
  const y = historyRange("1y");
  const cells = timelineCells([{ t: now - 400 * DAY, state: "on" }], now, y.hours, y.grainMs);
  return cells.length <= 54 && cells.length >= 52;
})());

console.log("\n  a step of a day:");
{
  const win = { from: now - 30 * DAY, to: now };
  const pts = Array.from({ length: 11 * 24 }, (_, i) => ({ t: kept + i * HOUR, v: i % 24 < 12 ? 100 : 0 }));
  const s = intervalSeries({ points: pts, gaps: [], window: win }, DAY);
  ck("hourly readings become one value a day (time-weighted)", s.points.length >= 11 && s.points.length <= 12
     && s.points.slice(1, -1).every((p) => Math.abs(p.v - 50) < 1e-9), s.points.map((p) => p.v));
  ck("  ...the five-minute step is the same function at five minutes",
     fiveMinuteSeries({ points: pts.slice(0, 3), gaps: [], window: { from: kept, to: kept + 3 * HOUR } }).points.length === 36);
}

console.log("\n  what is no longer kept:");
{
  ck("the oldest change of the probe is where detail begins",
     keptFromRows([{ state: "above_horizon", last_changed: new Date(kept + DAY).toISOString() },
                   { state: "below_horizon", last_changed: new Date(kept).toISOString() }], keptLookFrom(now)) === kept);
  ck("  ...nothing from the probe: not known (nothing greyed)", keptFromRows([], keptLookFrom(now)) === undefined);
  ck("  ...a history as old as the look-back: everything asked is kept",
     keptFromRows([{ state: "x", last_changed: new Date(keptLookFrom(now)).toISOString() }], keptLookFrom(now)) === undefined);
  const s = withNotKept({ points: [], gaps: [{ from: now - 2 * HOUR, to: now - HOUR }], window: { from: now - 30 * DAY, to: now } }, kept);
  ck("a month's line opens on a 'no longer kept' band up to where detail begins, its outages kept",
     s.gaps[0].notKept === true && s.gaps[0].from === now - 30 * DAY && s.gaps[0].to === kept && s.gaps.length === 2 && !s.gaps[1].notKept, s.gaps);
  ck("  ...a window inside what is kept has none", withNotKept({ points: [], gaps: [], window: { from: now - DAY, to: now } }, kept).gaps.length === 0);
  const w = widenGaps([{ from: now - 30 * DAY, to: kept, notKept: true }, { from: kept, to: kept + HOUR }], now - 30 * DAY, now, DAY);
  ck("  ...never merged with an outage beside it: two facts, two bands", w.length === 2 && w[0].notKept && !w[1].notKept, w);
  ck("its tooltip says so, never 'Unavailable'", fmtOutage({ from: now - 30 * DAY, to: kept, notKept: true }, now).startsWith(NOT_KEPT_WORDS)
     && !/Unavailable/.test(fmtOutage({ from: now - 30 * DAY, to: kept, notKept: true }, now)));
  const paint = chartColours(() => "var(--status-on)");
  ck("a state band paints it in its own colour, never the lost amber nor the idle colour",
     paint(NOT_KEPT) === NOT_KEPT_COLOR && NOT_KEPT_COLOR !== STATUS_COLOR.unavailable && NOT_KEPT_COLOR !== STATUS_COLOR.idle);
  // owner, 2026-10-20: the grey it had read as "Off" — its own token, defined in every theme, never a grey one
  const css = (await import("node:fs")).readFileSync(new URL("../../src/styles/01-base.css", import.meta.url), "utf8");
  const offGrey = /--hairline-strong|--hairline\b|--text-dim|--bg-/;
  ck("  ...its own token, set in each of the three themes, not a grey of the page",
     NOT_KEPT_COLOR === "var(--not-kept)" && (css.match(/^\s*--not-kept: rgba\(/gm) || []).length === 3 && !offGrey.test(NOT_KEPT_COLOR));
}

console.log("\n  the shared reader picks the source by the step:");
{
  const rows = Array.from({ length: 11 * 24 }, (_, i) => ({ state: String(i % 24 < 12 ? 100 : 0), last_changed: new Date(kept + i * HOUR).toISOString() }));
  const figures = Array.from({ length: 30 }, (_, i) => ({ start: now - (30 - i) * DAY, end: now - (29 - i) * DAY, mean: 42 }));
  const asked = [];
  const port = (stats) => ({
    stateRows: async () => rows,
    getStatisticsDuringPeriod: async (ids, start, period) => { asked.push(period); return stats ? { "sensor.pump_power": figures } : {}; },
    keptFrom: async () => kept,
  });
  const month = await loadOne(port(true), { kind: "trend", ids: ["sensor.pump_power"], hours: 720, period: "day" }, now);
  const m = month["sensor.pump_power"];
  ck("a month of a device with long-term figures: its daily figures, the whole month", asked.at(-1) === "day" && m.points.length === 30
     && m.points.every((p) => p.v === 42) && !m.gaps.some((g) => g.notKept), [asked, m.points.length]);
  const none = (await loadOne(port(false), { kind: "trend", ids: ["sensor.pump_power"], hours: 720, period: "day" }, now))["sensor.pump_power"];
  ck("  ...one it keeps no figures of: what is kept, a value a day, and the rest 'no longer kept'",
     none.points.length >= 11 && none.points.length <= 12 && none.gaps[0].notKept && none.gaps[0].to === kept, [none.points.length, none.gaps[0]]);
  const n = asked.length;
  const hour = (await loadOne(port(true), { kind: "trend", ids: ["sensor.pump_power"], hours: 1 }, now))["sensor.pump_power"];
  ck("an hour reads every change, in five minutes, and asks for no figures", asked.length === n && hour.points.length > 0
     && !hour.gaps.some((g) => g.notKept));
  const band = await loadOne(port(true), { kind: "stateWindow", id: "switch.pump", hours: 720 }, now);
  ck("a month's state band opens on 'no longer kept' up to the first change kept", band.data[0].state === NOT_KEPT
     && band.data[0].t === now - 720 * HOUR && band.data[1].t === kept && band.lastSeen === undefined, band.data.slice(0, 2));
  const noProbe = { stateRows: async () => rows, getStatisticsDuringPeriod: async () => ({}) };
  const plain = await loadOne(noProbe, { kind: "stateWindow", id: "switch.pump", hours: 720 }, now);
  ck("  ...not known (a port with no probe): nothing greyed, as before", plain.data[0].state !== NOT_KEPT);
  const dead = { stateRows: async (id, from) => from < now - 40 * DAY ? [{ state: "on", last_changed: new Date(now - 39 * DAY).toISOString() }]
    : [{ state: "unavailable", last_changed: new Date(kept).toISOString() }], getStatisticsDuringPeriod: async () => ({}), keptFrom: async () => kept };
  const gone = await loadOne(dead, { kind: "stateWindow", id: "switch.pump", hours: 720 }, now);
  ck("  ...'no longer kept' is not a sighting: a window with nothing else alive still looks back", gone.lastSeen !== undefined, gone.lastSeen);
}

console.log("\n  a greyed choice:");
{
  const { readFileSync } = await import("node:fs");
  const seg = readFileSync(new URL("../../src/components/common/SegmentedGroup.tsx", import.meta.url), "utf8");
  ck("shown, greyed, not pressable — the toggle looks the same everywhere",
     /disabled=\{o\.disabled\}/.test(seg) && /aria-disabled=\{o\.disabled \|\| undefined\}/.test(seg)
     && /onClick=\{\(\) => \{ if \(!o\.disabled\) onChange\(o\.key\); \}\}/.test(seg));
}

done("✅ five periods, each in its step; older than kept is said");
