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
  ck("  ...its tooltip: \"Unavailable at least once that day\" (owner, 2026-11-05), its day once, under it",
     fmtOutage(month[0], now, 720) === "Unavailable at least once that day" && fmtOutage(week[0], now, 168) === "Unavailable at least once that hour",
     fmtOutage(month[0], now, 720));
}
// ⚠️ ONE WAY TO SAY IT AT EVERY RANGE (owner, 2026-11-05): a power sensor's 10s drop said "Unavailable at 06:58, for 10s"
// with no value on its 24h chart, "● 2.1 kW" and "Unavailable at least once that hour" on its week's. Through the real
// path: the history source over a port with the villa's changes AND its figures (the slot of the drop missing, as the
// recorder writes it), the chart's geometry, the tooltip's words
console.log("\n  one drop, the same words at every range (owner, 2026-11-05):");
{
  const { chartGeometry } = await import("@/utils/chartGeometry");
  const slot = 5 * MIN, id = "sensor.pump_power";
  const drop = now - 21 * HOUR + 3 * MIN + 20_000, back = drop + 10_000;    // 10s, inside the last 24 hours, its day compiled
  const iso = (t) => new Date(t).toISOString();
  const changes = [];
  for (let t = now - 12 * DAY; t < now; t += MIN) changes.push({ state: String(2000 + (t / MIN) % 7), last_changed: iso(t) });
  changes.push({ state: "unavailable", last_changed: iso(drop) }, { state: "2100", last_changed: iso(back) });
  changes.sort((a, b) => Date.parse(a.last_changed) - Date.parse(b.last_changed));
  const reads = [];
  // the recorder's days begin at the villa's midnight (this machine's, as cellEdges reads it)
  const tz = -new Date(now).getTimezoneOffset() * MIN;
  const rowsOf = (step, from, to, skip) => { const o = []; for (let t = Math.ceil((from + tz) / step) * step - tz; t + step <= to; t += step) if (!skip(t)) o.push({ start: t, end: t + step, mean: 2050 }); return o; };
  // `slotLost`: the recorder wrote no five-minute figure for the drop's slot (a drop of minutes); a drop of seconds
  // leaves every figure written (the device reported in that slot). `days`: the tablet's cache of finished days.
  const villa = (figures = true, slotLost = true, days) => ({ keptFrom: async () => kept, ...(days ? { outageDays: days } : {}),
    // as the villa's system answers: the state in force at `from`, then every change kept
    stateRows: async (e, from, to) => { reads.push(to - from);
      const inside = changes.filter((r) => { const t = Date.parse(r.last_changed); return t >= Math.max(from, kept) && t <= to; });
      const before = changes.filter((r) => Date.parse(r.last_changed) < from).pop();
      return before ? [{ ...before, last_changed: iso(from) }, ...inside] : inside; },
    getStatisticsDuringPeriod: async (ids, start, period) => {
      if (!figures) return {};
      const from = Date.parse(start), step = { "5minute": slot, hour: HOUR, day: DAY, week: 7 * DAY }[period];
      const lo = period === "5minute" ? Math.max(from, kept) : from;
      return { [id]: rowsOf(step, lo, now - slot, (t) => slotLost && period === "5minute" && t <= drop && drop < t + slot) };
    } });
  const said = async (port, hours, period) => {
    const s = (await loadOne(port, { kind: "trend", ids: [id], hours, period }, now))[id];
    const band = s.gaps.find((g) => !g.notKept && g.from <= drop && g.to > drop);
    const g = chartGeometry(s.window, [{ pts: s.points, gaps: s.gaps }], { left: 0, right: 320, top: 12, bottom: 138 });
    const hover = g.hover(drop);
    return { band, words: band && fmtOutage(band, now, hours), value: !!hover?.readings[0], outage: !!hover?.outages[0] };
  };
  const d24 = await said(villa(true), 24, "5minute"), d1w = await said(villa(true), 168, "hour");
  reads.length = 0;
  const m1 = await said(villa(true), 720, "day");
  const monthRead = Math.max(0, ...reads);
  ck("the same drop, the same outage line on the 24h and the 1w chart: when and how long",
     /^Unavailable at [^,]+, for 10s$/.test(d24.words) && d1w.words === d24.words && m1.words === d24.words,
     { d24: d24.words, d1w: d1w.words, m1: m1.words });
  ck("  ...at every range the step's value is said above it (the line runs through), its band striped",
     [d24, d1w, m1].every((x) => x.value && x.outage && x.band.within), { d24, d1w, m1 });
  // ⚠️ A DROP OF SECONDS EMPTIES NO FIVE-MINUTE FIGURE (owner, 2026-11-06: a pool pump's 24h chart striped two drops
  // its week's chart did not show): the recorder writes a slot's mean whenever the device reported in it, so the
  // figures alone never see it; every drop the detail kept shows is marked, with its real time and length
  const days = new Map();
  const s24 = await said(villa(true, false, days), 24, "5minute");
  reads.length = 0;
  const s1w = await said(villa(true, false, days), 168, "hour");
  const weekReads = reads.length, weekSpan = reads.reduce((a, b) => a + b, 0);
  reads.length = 0;
  const s1m = await said(villa(true, false, days), 720, "day");
  const afterWeek = [...reads];
  reads.length = 0;
  const again = await said(villa(true, false, days), 168, "hour");
  ck("a 10s drop that empties no five-minute figure: the same outage line on the 24h, 1w and 1m charts",
     /^Unavailable at [^,]+, for 10s$/.test(s24.words) && s1w.words === s24.words && s1m.words === s24.words
     && [s1w, s1m].every((x) => x.value && x.outage && x.band.within), { s24: s24.words, s1w: s1w.words, s1m: s1m.words });
  ck("  ...the week's detail in one read of whole villa days, at most 8 of them",
     weekReads === 1 && weekSpan <= 8 * DAY + HOUR && weekSpan > 7 * DAY, { weekReads, days: weekSpan / DAY });
  ck("  ...then the month reads only the days the week had not (finished days are kept), and the week again only today",
     afterWeek.length >= 1 && afterWeek.every((r) => r <= 4 * DAY) && reads.length === 1 && reads[0] <= DAY && again.words === s24.words,
     { month: afterWeek.map((r) => r / HOUR), again: reads.map((r) => r / HOUR) });
  // the Weather window's figures (a "statistics" request of means) through the same path: the same drop, the same words
  {
    const w = (await loadOne(villa(true, false), { kind: "statistics", ids: [id], period: "hour", fields: ["mean", "min", "max"], hours: 168 }, now))[id];
    const band = w.mean.gaps.find((g) => g.within && g.from <= drop && g.to > drop);
    ck("  ...the Weather window's hourly figures mark it the same, its words the 24h chart's",
       !!band && fmtOutage(band, now, 168) === s24.words, band && fmtOutage(band, now, 168));
  }
  // ⚠️ ONE PATH (owner, 2026-11-06: "make sure … this fix [is applied] everywhere it shall be"): every chart that draws
  // an outage over time gets it from the history source, so nothing outside it reads the villa's history or turns rows
  // or figures into outages. Derived from the tree: a new chart reading its own would fail here
  {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const root = new URL("../../src/", import.meta.url);
    const walk = (u) => readdirSync(u).flatMap((f) => { const c = new URL(f, u);
      return statSync(c).isDirectory() ? walk(new URL(f + "/", u)) : /\.tsx?$/.test(f) ? [c] : []; });
    // the code, not its comments (one names the read it explains)
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const files = walk(root).map((u) => [u.pathname.slice(root.pathname.length), code(readFileSync(u, "utf8"))]);
    const builders = /\b(gapsFrom|finerOutages|missingSlots|stepsOfflineInside|statisticsSeries|intervalSeries|fiveMinuteSeries|dropsOf)\b/;
    const imports = (src) => [...src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)].map((m) => m[1]).join(",");
    const own = new Set(["ha/historySource.ts", "utils/historyGaps.ts", "utils/statisticsSeries.ts", "utils/trendInterval.ts"]);
    const builds = files.filter(([f, src]) => !own.has(f) && builders.test(imports(src))).map(([f]) => f);
    const reads = files.filter(([f, src]) => !["ha/historySource.ts", "ha/HAHistoryAPI.ts", "ha/HAWebSocket.ts", "types/ha.types.ts", "ha/entityStore.ts"].includes(f)
      && /\b(getStatisticsDuringPeriod|recordedStates|stateRows|history\/period)\b/.test(src)).map(([f]) => f);
    ck("  ...every chart's outages from the history source alone: nothing else turns history into outages or reads it",
       files.length > 100 && builds.length === 0 && reads.length === 0, { builds, reads });
  }
  // the line first: the figures' answer is given before the detail arrives (historySource.loadHistory `early`)
  {
    const { loadHistory } = await import("@/ha/historySource");
    let release, first;
    const gate = new Promise((r) => { release = r; });
    const slow = { ...villa(true, false), stateRows: async (...a) => { await gate; return villa(true, false).stateRows(...a); } };
    const done_ = loadHistory(slow, { w: { kind: "trend", ids: [id], hours: 168, period: "hour" } }, now, (a) => { first = a; });
    for (let i = 0; i < 20 && !first; i++) await new Promise((r) => setTimeout(r, 0));
    const early = first, firstBand = first?.w[id].gaps.some((g) => g.within && g.from <= drop && g.to > drop);
    release();
    const last = await done_;
    ck("  ...the week's line is drawn from the figures before the detail arrives, its band added when it does",
       !!early && early.w[id].points.length > 100 && !firstBand && last.w[id].gaps.some((g) => g.within && g.from <= drop && g.to > drop),
       { early: !!early, firstBand });
  }
  // older than the detail kept: only the averages tell it
  const old = { from: kept - DAY, to: kept - DAY + HOUR, within: "hour" };
  ck("  ...\"at least once that hour\" only where the detail is no longer kept",
     fmtOutage(old, now, 168) === "Unavailable at least once that hour", fmtOutage(old, now, 168));
  // several drops in one band
  const { stepsOfflineInside, fiveMinuteSeries: five } = await import("@/utils/trendInterval");
  const t0 = now - 2 * HOUR, w = { from: now - 3 * HOUR, to: now };
  const raw = { points: [{ t: w.from, v: 1 }, { t: t0 + 30_000, v: 1 }, { t: t0 + 70_000, v: 1 }, { t: t0 + 110_000, v: 1 }],
    gaps: [{ from: t0, to: t0 + 30_000 }, { from: t0 + 60_000, to: t0 + 70_000 }, { from: t0 + 100_000, to: t0 + 110_000 }], window: w };
  const three = stepsOfflineInside(five(raw), "5minute", slot, raw.gaps).gaps.find((g) => g.from <= t0 && g.to > t0);
  ck("  ...several drops in one step: \"Unavailable 3 times, 50s in all, the first at …\"",
     /^Unavailable 3 times, 50s in all, the first at [^,]+$/.test(fmtOutage(three, now, 24)), fmtOutage(three, now, 24));
}

// owner, 2026-11-05: "Unavailable · 13:40–13:40 (1s)" for a drop of 0.46s
ck("an outage within one minute says when and how long, under 1s or for its seconds",
   /^Unavailable at .+, under 1s$/.test(fmtOutage({ from: now - 2 * HOUR, to: now - 2 * HOUR + 460 }, now))
   && /^Unavailable at .+, for 4s$/.test(fmtOutage({ from: now - 2 * HOUR, to: now - 2 * HOUR + 4_000 }, now)),
   fmtOutage({ from: now - 2 * HOUR, to: now - 2 * HOUR + 460 }, now));
ck("  ...on a chart of several days, with its day", /\d/.test(fmtOutage({ from: now - 2 * DAY, to: now - 2 * DAY + 460 }, now, 168).replace(/\d\d:\d\d/, "")),
   fmtOutage({ from: now - 2 * DAY, to: now - 2 * DAY + 460 }, now, 168));

// architecture review 24: "Unavailable · 3 Nov, 06:13–3 Nov, 06:40" said the day twice
{
  const day2 = now - 2 * DAY, tip = fmtOutage({ from: day2, to: day2 + 27 * MIN }, now, 168);
  const across = fmtOutage({ from: day2 - 20 * MIN, to: day2 + 4 * HOUR }, now, 168);
  ck("an outage on a chart of several days says its day once when it ends the same day, twice when it does not",
     (tip.match(/\d\d\/\d\d\/\d{4}/g) ?? []).length === 1
     && (new Date(day2 - 20 * MIN).getUTCDate() === new Date(day2 + 4 * HOUR).getUTCDate()
       || (across.match(/\d\d\/\d\d\/\d{4}/g) ?? []).length === 2), [tip, across]);
}

console.log("\n  an outage inside a step looks the same whatever drew it, and a sleep is none (architecture review 24):");
{
  const slot = 5 * MIN, id = "sensor.terrace_temp";
  const rowsOf = (step, from, to, keep) => { const o = []; for (let t = Math.ceil(from / step) * step; t + step <= to; t += step) if (keep(t)) o.push({ start: t, end: t + step, mean: 21 }); return o; };
  // a battery sensor that sleeps between its half-hourly reports: no five-minute figure for the slots it slept through
  const sleeper = (asleep) => ({ stateRows: async () => [], keptFrom: async () => kept, ...(asleep ? { asleep: (e) => e === id } : {}),
    getStatisticsDuringPeriod: async (ids, start, period) => {
      const from = Date.parse(start), step = { "5minute": slot, hour: HOUR, day: DAY, week: 7 * DAY }[period];
      const lo = period === "5minute" ? Math.max(from, kept) : from;
      // an hour a day it slept through whole: no hourly figure either
      return { [id]: rowsOf(step, lo, now - slot, (t) => (period !== "5minute" || t % (30 * MIN) === 0) && (period !== "hour" || new Date(t).getUTCHours() !== 3)) };
    } });
  const weekOf = async (port) => (await loadOne(port, { kind: "trend", ids: [id], hours: 168, period: "hour" }, now))[id];
  const awake = await weekOf(sleeper(false)), asleep = await weekOf(sleeper(true));
  ck("a device asleep by design: no step of its week striped, its line held across the hours it slept through",
     awake.gaps.filter((g) => g.within).length > 100 && asleep.gaps.length === 0, { awake: awake.gaps.length, asleep: asleep.gaps });
  // the caller: the tablet's port says which devices sleep, from the entity store's list (useHistorySource)
  const { haHistoryPort } = await import("@/ha/HAHistoryAPI");
  const real = haHistoryPort({ getStatisticsDuringPeriod: async () => ({}) }, new Set([id]));
  ck("  ...the tablet's history port knows them, from the list it is given", real.asleep?.(id) === true && real.asleep?.("sensor.other") === false);
  // a sensor with no figures, drawn from its changes: offline 22min inside an hour, and a whole hour
  const iso = (t) => new Date(t).toISOString(), off = now - 3 * DAY + 10 * HOUR + 13 * MIN, gone = now - 2 * DAY + 5 * HOUR;
  const changes = [];
  for (let t = now - 8 * DAY; t < now; t += 10 * MIN) {
    if (t >= off && t < off + 22 * MIN) continue;
    if (t >= gone && t < gone + HOUR + 10 * MIN) continue;
    changes.push({ state: "20", last_changed: iso(t) });
  }
  changes.push({ state: "unavailable", last_changed: iso(off) }, { state: "unavailable", last_changed: iso(gone) });
  changes.sort((a, b) => Date.parse(a.last_changed) - Date.parse(b.last_changed));
  const plain = { keptFrom: async () => kept, getStatisticsDuringPeriod: async () => ({}),
    stateRows: async (e, from, to) => changes.filter((r) => { const t = Date.parse(r.last_changed); return t >= from && t <= to; }) };
  const g = (await loadOne(plain, { kind: "trend", ids: ["sensor.x"], hours: 168, period: "hour" }, now))["sensor.x"].gaps;
  const inside = g.filter((x) => x.within), breaks = g.filter((x) => !x.within && !x.notKept);
  // owner, 2026-11-05: when and how long whenever the detail is kept, never "at least once" then
  ck("  ...a sensor with no figures: the hour offline 22min striped as the figures', its tooltip when and how long, the whole hour a break",
     inside.some((x) => x.from <= off && x.to > off && x.within === "hour") && /^Unavailable · [^–]+–[^–]+ \(27min\)$/.test(fmtOutage(inside[0], now, 168))
     && breaks.some((x) => x.from <= gone + 30 * MIN && x.to > gone + 30 * MIN && x.actual), { inside, breaks, said: fmtOutage(inside[0], now, 168) });
  // a 50 ms drop (the villa's system reloading its virtual devices): the 24h chart shows it, so its hour and its day do
  // (owner, 2026-11-06: every outage seen at 24h is visible at 1w and 1m; architecture review 25 had hidden it)
  const blink = now - 5 * DAY + 14 * HOUR + 3 * MIN;   // a day with no other outage
  const reloaded = [...changes, { state: "unavailable", last_changed: iso(blink) }, { state: "20", last_changed: iso(blink + 50) }]
    .sort((a, b) => Date.parse(a.last_changed) - Date.parse(b.last_changed));
  const port2 = { ...plain, stateRows: async (e, from, to) => reloaded.filter((r) => { const t = Date.parse(r.last_changed); return t >= from && t <= to; }) };
  for (const [hours, period, B] of [[168, "hour", HOUR], [720, "day", DAY]]) {
    const gg = (await loadOne(port2, { kind: "trend", ids: ["sensor.x"], hours, period }, now))["sensor.x"].gaps;
    const mark = gg.find((x) => x.within && x.from <= blink && x.to > blink);
    ck(`  ...a reload's 50 ms drop marks its ${period}, said "under 1s" as on the 24h chart`,
       !!mark && /^Unavailable at [^,]+, under 1s$/.test(fmtOutage(mark, now, hours)) && gg.some((x) => x.within && x.from <= off && x.to > off),
       mark && fmtOutage(mark, now, hours));
  }
}

console.log("\n  every chart's (i): what it shows and what it may not (owner, 2026-11-05):");
{
  const { chartAbout } = await import("@/components/panels/chartUtils");
  const { PERIOD_MS } = await import("@/utils/statisticsSeries");
  // architecture review 24: a total's (i) says what its chart draws for a step with no total, the grey "No reading"
  const { barTipRows, barLayout } = await import("@/utils/barChart");
  const about = Object.fromEntries(RANGES.map((r) => [r.key, chartAbout("average", r.grainMs, now - r.hours * HOUR, kept)]));
  ck("1h and 24h: every reading in five-minute steps, a band over each five minutes an outage touched",
     about["1h"] === about["24h"] && about["24h"] === "Every reading, in 5min steps. Striped: unavailable at least once in those 5min."
     // as wide as drawn: a 0.46s drop is a band of the five minutes it touched (widenGaps), its tooltip the real length
     && widenGaps([{ from: 1_000_056_000, to: 1_000_056_460 }], 0, 2e9)[0].to - widenGaps([{ from: 1_000_056_000, to: 1_000_056_460 }], 0, 2e9)[0].from === PERIOD_MS["5minute"], about["24h"]);
  ck("  ...1w: hourly averages, an hour striped when unavailable part of it, every outage (the detail is kept)",
     about["1w"] === "Hourly averages. Striped: unavailable at least once that hour.", about["1w"]);
  const keptDay = (await import("@/utils/dateText")).docDate(kept);
  ck("  ...1m and 1y: days and weeks, and before what the villa's system keeps, only an outage of a whole hour (day)",
     about["1m"] === `Daily averages. Striped: unavailable at least once that day. Before ${keptDay}: only whole-hour outages show.`
     && about["1y"].startsWith("Weekly averages. Striped: unavailable at least once that week.") && about["1y"].endsWith(": only whole-day outages show."), [about["1m"], about["1y"]]);
  {
    // a sensor with no figures: before what is kept its month is the "No longer kept" band, and its (i) says so, never
    // "only an outage of a whole hour shows" of figures it has none of (architecture review 25)
    const { drawsUnkept } = await import("@/components/panels/chartUtils");
    const rows = []; for (let t = kept; t < now; t += 10 * MIN) rows.push({ state: "20", last_changed: new Date(t).toISOString() });
    const bare = { keptFrom: async () => kept, getStatisticsDuringPeriod: async () => ({}),
      stateRows: async (e, from, to) => rows.filter((r) => { const t = Date.parse(r.last_changed); return t >= from && t <= to; }) };
    const s = (await loadOne(bare, { kind: "trend", ids: ["sensor.t"], hours: 720, period: "day" }, now))["sensor.t"];
    const words = chartAbout("average", PERIOD_MS.day, now - 30 * DAY, kept, drawsUnkept([s]));
    ck("  ...a month with no figures, drawn \"No longer kept\" before what is kept, says so in its (i)",
       s.gaps.some((g) => g.notKept) && words.endsWith(`Before ${keptDay}: no longer kept.`)
       && !drawsUnkept([{ gaps: [{ from: 0, to: 1 }] }, undefined]), words);
  }
  ck("  ...a window inside what is kept says nothing of before",
     !chartAbout("average", PERIOD_MS.day, kept + DAY, kept).includes("Before"));
  ck("  ...a state band: each step's states, unavailable at any length; a total: why it shows no outage",
     chartAbout("states", PERIOD_MS.day, now - 30 * DAY, kept) === `Each day shows its states: striped when several, grey when unavailable. Before ${keptDay}: no longer kept.`
     && chartAbout("total", PERIOD_MS.hour) === `Hourly totals. Grey: no total, "${barTipRows({ t: 0, segs: null }, String)[0].text}". No outage shows: a meter keeps counting through it.`
     && barLayout([{ t: 0, segs: null }]).bars[0].missing,
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
    || (f === "historyRange.tsx" && /about=\{(about|`\$\{title\}, \$\{step\}\. \$\{about\}`)\}/.test(el))));
  ck("every chart with a title (derived from the tree) carries its (i), from the one text builder",
     charts.length >= 5 && untitled.length === 0 && noAbout.length === 0 && /about: string/.test(src("historyRange.tsx")), { charts, untitled, noAbout });
  // every chart of averages says what it draws before what is kept (drawsUnkept): its call, wherever it is
  const averages = files.flatMap((f) => [...src(f).matchAll(/chartAbout\("average",[^\n]*(\n[^\n]*)?/g)].map((m) => [f, m[0]]));
  ck("  ...every chart of averages tells its (i) whether it draws \"No longer kept\" (drawsUnkept)",
     averages.length >= 2 && averages.every(([, c]) => /drawsUnkept\(/.test(c)), averages);
}

done("✅ five periods, each in its step; older than kept is said");
