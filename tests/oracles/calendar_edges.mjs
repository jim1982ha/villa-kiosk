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

done("✅ a day is midnight to midnight, a week Monday to Sunday, on both sides of a clock change");
