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
  ck("a month of a device with long-term figures: its daily figures, the whole month", asked.includes("day") && m.points.length === 30
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
  // the look-back reads back to what is kept (historySource.readBackFrom, 2.496.499): as a real recorder, nothing older
  // than `kept` comes back, so what is checked is that it is ASKED (a not-kept window counted as alive asked nothing)
  const looked = [];
  const dead = { stateRows: async (id, from) => { looked.push(from); return [{ state: "unavailable", last_changed: new Date(kept).toISOString() }]; },
    getStatisticsDuringPeriod: async () => ({}), keptFrom: async () => kept };
  const gone = await loadOne(dead, { kind: "stateWindow", id: "switch.pump", hours: 720 }, now);
  ck("  ...'no longer kept' is not a sighting: a window with nothing else alive still looks back, to what is kept",
     looked.length === 2 && looked[1] === kept && gone.lastSeen === undefined, { looked, lastSeen: gone.lastSeen });
}

console.log("\n  a greyed choice:");
{
  const { readFileSync } = await import("node:fs");
  const seg = readFileSync(new URL("../../src/components/common/SegmentedGroup.tsx", import.meta.url), "utf8");
  ck("shown, greyed, not pressable — the toggle looks the same everywhere",
     /disabled=\{o\.disabled\}/.test(seg) && /aria-disabled=\{o\.disabled \|\| undefined\}/.test(seg)
     && /onClick=\{\(\) => \{ if \(!o\.disabled\) onChange\(o\.key\); \}\}/.test(seg));
}

// architecture review, 2026-10-20: a line without long-term figures cut its weeks on the 1970 Thursday and its days on
// UTC's midnight, the band beside it on the villa's own — one edge rule for both
{
  const { PERIOD_MS } = await import("@/utils/statisticsSeries");
  ck("each range's step is its period's length, said once", RANGES.every((r) => r.grainMs === PERIOD_MS[r.period]));
  const to = new Date(2026, 9, 20, 4, 0).getTime();
  for (const key of ["1m", "1y"]) {
    const r = historyRange(key), from = to - r.hours * 3_600_000;
    const raw = { points: [{ t: from - 1, v: 5 }], gaps: [], window: { from, to } };
    const line = intervalSeries(raw, r.grainMs).points.map((p) => p.t).slice(1);
    const band = timelineCells([{ t: from - 1, state: "on" }], to, r.hours, r.grainMs).map((c) => c.from).slice(1);
    ck(`  ...${key}: the line's values and the band's slices start at the same moments (the villa's midnight${key === "1y" ? ", a Monday" : ""})`,
       line.length > 3 && JSON.stringify(line.slice(0, band.length)) === JSON.stringify(band.slice(0, line.length))
       && line.every((t) => new Date(t).getHours() === 0 && (key !== "1y" || new Date(t).getDay() === 1)), [line.slice(0, 3), band.slice(0, 3)]);
  }
}

console.log("\n  a step offline inside it (owner, 2026-11-05: a meter offline 22min showed nothing on its 1w chart):");
{
  // complete figures at every step, but for the five-minute ones: one slot missing on day 3 (the device said nothing
  // those five minutes), and the newest slots not compiled yet
  const slot = 5 * MIN, day3 = now - 3 * DAY + 10 * HOUR;
  const rowsOf = (step, from, to, skip = () => false) => {
    const out = [];
    for (let t = Math.ceil(from / step) * step; t + step <= to; t += step) if (!skip(t)) out.push({ start: t, end: t + step, mean: 5 });
    return out;
  };
  const W = { day: 7 * DAY };
  const port = (missing) => ({
    stateRows: async () => [],
    keptFrom: async () => kept,
    getStatisticsDuringPeriod: async (ids, start, period) => {
      const from = Date.parse(start);
      const step = { "5minute": slot, hour: HOUR, day: DAY, week: W.day }[period];
      // the recorder keeps five-minute figures ~10 days; the newest five-minute slot is not compiled yet
      const lo = period === "5minute" ? Math.max(from, kept) : from;
      const hi = period === "5minute" ? now - slot : now;
      return { "sensor.meter_power": rowsOf(step, lo, hi, (t) => period === "5minute" && missing(t)) };
    },
  });
  const marks = async (missing, hours, period) =>
    (await loadOne(port(missing), { kind: "trend", ids: ["sensor.meter_power"], hours, period }, now))["sensor.meter_power"].gaps
      .filter((g) => g.within);
  const lost = (t) => t === day3;
  // a year's week only once compiled: the slot lost nine days ago, inside the last whole week
  const day9 = now - 9 * DAY + 10 * HOUR;
  const month = await marks(lost, 720, "day"), year = await marks((t) => t === day9, 8760, "week"), week = await marks(lost, 168, "hour");
  const dayStart = Math.floor(day3 / DAY) * DAY;
  ck("a month: the day the five-minute figures miss a slot is marked, its whole width, its line kept (one mark, nothing else)",
     month.length === 1 && month[0].from === dayStart && month[0].to === dayStart + DAY && month[0].within === "day", month);
  ck("  ...a year: that day's week; a week: that hour",
     year.length === 1 && year[0].within === "week" && year[0].from <= day9 && year[0].to > day9
     && week.length === 1 && week[0].within === "hour" && week[0].from <= day3 && week[0].to > day3, { year, week });
  ck("  ...a slot not compiled yet is no outage, and nothing is marked with every slot written",
     (await marks(() => false, 720, "day")).length === 0, await marks(() => false, 720, "day"));
  ck("  ...its tooltip: \"Unavailable during this day · <day>\"",
     fmtOutage(month[0], now, 720).startsWith("Unavailable during this day · ") && fmtOutage(week[0], now, 168).startsWith("Unavailable during this hour · "),
     fmtOutage(month[0], now, 720));
}
// owner, 2026-11-05: "Unavailable · 13:40–13:40 (1s)" for a drop of 0.46s
ck("an outage within one minute says when and how long, under 1s or for its seconds",
   /^Unavailable at .+, under 1s$/.test(fmtOutage({ from: now - 2 * HOUR, to: now - 2 * HOUR + 460 }, now))
   && /^Unavailable at .+, for 4s$/.test(fmtOutage({ from: now - 2 * HOUR, to: now - 2 * HOUR + 4_000 }, now)),
   fmtOutage({ from: now - 2 * HOUR, to: now - 2 * HOUR + 460 }, now));
ck("  ...on a chart of several days, with its day", /\d/.test(fmtOutage({ from: now - 2 * DAY, to: now - 2 * DAY + 460 }, now, 168).replace(/\d\d:\d\d/, "")),
   fmtOutage({ from: now - 2 * DAY, to: now - 2 * DAY + 460 }, now, 168));

console.log("\n  every chart's (i): what it shows and what it may not (owner, 2026-11-05):");
{
  const { chartAbout } = await import("@/components/panels/chartUtils");
  const { PERIOD_MS } = await import("@/utils/statisticsSeries");
  const about = Object.fromEntries(RANGES.map((r) => [r.key, chartAbout("average", r.grainMs, now - r.hours * HOUR, kept)]));
  ck("1h and 24h: every reading, each outage at its real length",
     about["1h"] === about["24h"] && about["24h"] === "Every reading. A grey band is each time the device was unavailable, at its real length.", about["24h"]);
  ck("  ...1w: hourly averages, an hour striped when unavailable part of it, an outage under the finest figures' 5min may not show",
     about["1w"] === "Hourly averages. An hour striped grey had the device unavailable for part of it. An outage shorter than 5min may not show: averages do not keep it.", about["1w"]);
  const keptDay = (await import("@/utils/dateText")).dayMonth(kept);
  ck("  ...1m and 1y: days and weeks, and before what the villa's system keeps, only an outage of a whole hour (day)",
     about["1m"].startsWith("Daily averages. A day striped grey") && about["1m"].endsWith(`Before ${keptDay}, only an outage of a whole hour shows: the villa's system keeps finer figures since then.`)
     && about["1y"].startsWith("Weekly averages. A week striped grey") && about["1y"].includes("only an outage of a whole day shows"), [about["1m"], about["1y"]]);
  ck("  ...a window inside what is kept says nothing of before",
     !chartAbout("average", PERIOD_MS.day, kept + DAY, kept).includes("Before"));
  ck("  ...a state band: each step's states, unavailable at any length; a total: why it shows no outage",
     chartAbout("states", PERIOD_MS.day, now - 30 * DAY, kept).startsWith("Each day shows the states it saw: striped when it saw several, grey among them when the device was unavailable, at any length. Before ")
     && chartAbout("total", PERIOD_MS.hour) === "Hourly totals. An hour with no total written is left empty. A meter counts on through an outage, so its total stays right and no outage is shown.",
     [chartAbout("states", PERIOD_MS.day, now - 30 * DAY, kept), chartAbout("total", PERIOD_MS.hour)]);
  ck("  ...words a person reads: no platform name, no long dash", Object.values(about).every((w) => !/Home Assistant|\bHA\b| — /.test(w)));
  // the set, derived from the tree: every chart with a title says its (i) through ChartStep's `about`, from chartAbout
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../../src/components/panels/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
  const src = (f) => readFileSync(new URL(f, dir), "utf8");
  const charts = files.filter((f) => /<(LineChart|BarChart|StateTimeline)\b/.test(src(f)));
  // drawn under another chart's title, in its window and its range: the camera's status bar (its band of the camera
  // and its motion sensor, no range of its own) and a device's linked sensor row (under the device's band)
  const nested = new Set(["CameraPanel.tsx", "LinkedSensorRow.tsx"]);
  const untitled = charts.filter((f) => !nested.has(f) && !/<(ChartStep|HistoryHeader)\b/.test(src(f)));
  const steps = files.flatMap((f) => [...src(f).matchAll(/<(ChartStep|HistoryHeader)\b[\s\S]*?\/>/g)].map((m) => [f, m[0]]));
  const noAbout = steps.filter(([f, el]) => !(/about=\{chartAbout\(/.test(el) || /about=\{about\}/.test(el)
    || (f === "historyRange.tsx" && /about=\{about\}/.test(el))));
  ck("every chart with a title (derived from the tree) carries its (i), from the one text builder",
     charts.length >= 5 && untitled.length === 0 && noAbout.length === 0 && /about: string/.test(src("historyRange.tsx")), { charts, untitled, noAbout });
}

done("✅ five periods, each in its step; older than kept is said");
