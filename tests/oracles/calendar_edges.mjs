// A day is midnight to midnight, a week Monday to Sunday — everywhere (owner, 2026-10-20), and across a summer-time
// change too: the edges were 24 h × n from the first midnight, so after the clocks moved every day began at 01:00 or
// 23:00, and a week's outage was widened on the 1970 Thursday (utils/timelineCells.cellEdges, trendInterval.widenGaps).
// Run in a zone that changes its clocks; CI's own zone may not.
process.env.TZ = "Europe/Paris";
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { cellEdges, timelineCells } = await import("@/utils/timelineCells");
const { intervalSeries, widenGaps } = await import("@/utils/trendInterval");
const { fmtStepStamp } = await import("@/components/panels/chartUtils");
const { dayMonth } = await import("@/utils/dateText");

const DAY = 86_400_000, WEEK = 7 * DAY;
const midnight = (t) => { const d = new Date(t); return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0; };
const monday = (t) => midnight(t) && new Date(t).getDay() === 1;
// the two clock changes of 2026 in Paris: 29 March (an hour less), 25 October (an hour more)
const spring = new Date(2026, 2, 26, 15).getTime(), autumn = new Date(2026, 9, 22, 15).getTime();

ck("the zone this check runs in does change its clocks", new Date(2026, 2, 30).getTimezoneOffset() !== new Date(2026, 2, 28).getTimezoneOffset());
for (const [name, t] of [["spring", spring], ["autumn", autumn]]) {
  const days = cellEdges(t, t + 8 * DAY, DAY), weeks = cellEdges(t - 3 * WEEK, t + 3 * WEEK, WEEK);
  ck(`${name}: every day begins at midnight, also after the change`, days.length >= 9 && days.every(midnight), days.map((e) => new Date(e).toString()));
  ck(`${name}: every week begins on a Monday at midnight`, weeks.length >= 6 && weeks.every(monday), weeks.map((e) => new Date(e).toString()));
  const cells = timelineCells([{ t: t - 20 * DAY, state: "on" }], t + 8 * DAY, 30 * 24, DAY);
  ck(`${name}: a band's daily cells run midnight to midnight`, cells.length > 0 && cells.every((c) => midnight(c.from) && midnight(c.to)));
  const s = intervalSeries({ points: [{ t: t - 30 * DAY, v: 1 }], gaps: [], window: { from: t - 30 * DAY, to: t + 8 * DAY } }, DAY);
  ck(`${name}: a line's daily values sit on midnight`, s.points.slice(1).every((p) => midnight(p.t)), s.points.map((p) => new Date(p.t).toString()));
  const w = intervalSeries({ points: [{ t: t - 200 * DAY, v: 1 }], gaps: [], window: { from: t - 200 * DAY, to: t + 8 * DAY } }, WEEK);
  ck(`${name}: a line's weekly values sit on Mondays`, w.points.slice(1).every((p) => monday(p.t)));
}
const g = widenGaps([{ from: spring, to: spring + 3_600_000 }], spring - 60 * DAY, spring + 60 * DAY, WEEK)[0];
ck("an outage in a weekly chart widens to its Monday-to-Monday week", monday(g.from) && monday(g.to) && g.to - g.from <= WEEK, [new Date(g.from).toString(), new Date(g.to).toString()]);
const d = widenGaps([{ from: autumn + 3 * DAY, to: autumn + 3 * DAY + 60_000 }], autumn - 9 * DAY, autumn + 9 * DAY, DAY)[0];
ck("an outage in a daily chart widens to its midnight-to-midnight day, the change's day included", midnight(d.from) && midnight(d.to), [new Date(d.from).toString(), new Date(d.to).toString()]);
const mon = cellEdges(spring, spring + 1, WEEK)[0];
ck("a week's tooltip names its Monday and its Sunday, also in the week the clocks change",
   fmtStepStamp(mon, WEEK, 8760) === `${dayMonth(mon)} – ${dayMonth(new Date(2026, 2, 29, 12).getTime())}`, fmtStepStamp(mon, WEEK, 8760));

const { scheduleStatus } = await import("@/fm/fmEngine");
const at9 = new Date(2026, 2, 25, 9).getTime();
const due = (createdAt) => scheduleStatus({ id: "s", everyDays: 7, createdAt: new Date(createdAt).toISOString() }, [], at9).dueAt;
const dueCompleted = scheduleStatus({ id: "s", everyDays: 7 }, [{ scheduleId: "s", at: new Date(at9).toISOString() }], at9).dueAt;
ck("a task every 7 days keeps its clock time across a clock change (09:00 stays 09:00)",
   new Date(due(at9)).getHours() === 9 && new Date(due(at9)).getDate() === 1 && new Date(dueCompleted).getHours() === 9,
   [new Date(due(at9)).toString(), new Date(dueCompleted).toString()]);

// ⚠️ THE GATE (retro, 2026-10-20): a calendar edge is never made from a fixed day length. Every file that holds a day's
// length is classified here — a NEW one fails until someone says why its use is a duration, not a calendar step — and
// flooring a time to a day or a week (Math.floor(t / DAY) …, t % DAY) is refused outside the one owner of the edges.
const { readdirSync, readFileSync, statSync } = await import("node:fs");
const { join } = await import("node:path");
const DAY_LENGTH = /\b(DAY_MS|WEEK_MS)\b|86_?400_?000|864e5|24 \* 3_?600 \* 1_?000|24 \* 60 \* 60 \* 1_?000|1_?000 \* 60 \* 60 \* 24|3_?600_?000 \* 24/;
const DAY_FLOOR = /Math\.(floor|ceil|round)\([^;\n]*\/\s*\(?\s*(\d+ \* )?(DAY_MS|WEEK_MS|86_?400_?000)|%\s*\(?\s*(\d+ \* )?(DAY_MS|WEEK_MS|86_?400_?000)/;
const CLASSIFIED = {
  "utils/timelineCells.ts": "THE owner of a chart's step edges (cellEdges): compares a step against a day, steps on the calendar",
  "utils/statisticsSeries.ts": "the recorder periods' nominal lengths (PERIOD_MS) — sizes and comparisons, edges come from cellEdges",
  "utils/sunCalc.ts": "astronomy: Julian days are fixed 86 400 s days by definition",
  "components/panels/chartUtils.ts": "compares a step against a day and a week to choose words",
  "components/panels/StateTimeline.tsx": "compares a step against a day to choose the tooltip's form",
  "fm/fmEngine.ts": "\"due in N days\" as a duration figure; the due date itself is addLocalDays",
  "components/fm/TicketsTab.tsx": "the server's retention, a duration in days",
  "ha/unavailableByDesign.ts": "how far back a device asleep by design's last report is looked for: a duration in days",
};
const srcRoot = new URL("../../src/", import.meta.url).pathname;
const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : []; });
const code = (f) => readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const all = files(srcRoot).map((f) => [f.slice(srcRoot.length), code(f)]);
const unclassified = all.filter(([f, c]) => DAY_LENGTH.test(c) && !(f in CLASSIFIED)).map(([f]) => f);
ck("every file holding a day's length is classified (a calendar edge comes from localDay / cellEdges)", unclassified.length === 0, unclassified);
const stale = Object.keys(CLASSIFIED).filter((f) => !all.some(([g, c]) => g === f && DAY_LENGTH.test(c)));
ck("  ...and no classified file has stopped holding one (the list shrinks with the code)", stale.length === 0, stale);
const floors = all.filter(([f, c]) => f !== "utils/timelineCells.ts" && DAY_FLOOR.test(c)).map(([f]) => f);
ck("  ...and nothing floors a time to a day or a week outside timelineCells", floors.length === 0, floors);

done("✅ a day is midnight to midnight, a week Monday to Sunday, on both sides of a clock change");
