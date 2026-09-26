// What the Energy window says (src/config/energyObservations.ts, round 7,
// 2.496.125): the headline, the cards and the history's figures — rules that
// lived in the view, where no test reached them. Driven with the villa's
// measured week (Friday 75 kWh against a typical 30) and generic ids.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const E = await import("@/config/energyModel");
const O = await import("@/config/energyObservations");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

const setup = { ...E.energySetup({
  energy_sources: [{ type: "grid", stat_energy_from: "sensor.grid_in" }],
  device_consumption: [
    { stat_consumption: "sensor.c", name: "Phase C" }, { stat_consumption: "sensor.b", name: "Phase B" },
    { stat_consumption: "sensor.pool", name: "Pool Pump", included_in_stat: "sensor.c" },
    { stat_consumption: "sensor.spa", name: "Spa Pump", included_in_stat: "sensor.b" },
  ],
}, (x) => x), costOf: { "sensor.grid_in": "sensor.cost" } };

const D = 86_400_000, H = 3_600_000;
const now = new Date(2026, 8, 26, 13, 0).getTime();
const days = E.periodStarts("last7Complete", now), hours = E.periodStarts("hoursToday", now);
const series = (starts, vals) => ({ points: vals.flatMap((v, i) => (v === null ? [] : [{ t: starts[i], v }])) });
const week = [26.49, 29.89, 30.99, 30.99, 27.47, 28.76, 75.46];
const weekP = E.energyPeriod(setup, {
  "sensor.grid_in": series(days, week),
  "sensor.c": series(days, week.map((v) => v * 0.6)), "sensor.b": series(days, week.map((v) => v * 0.4)),
  "sensor.pool": series(days, [5, 5, 5, 5, 5, 5, 5.4]),
  "sensor.spa": series(days, [0, 0, 0, 0, 0, 0, 18]),
  "sensor.cost": series(days, week.map((v) => v * 1700)),
}, days, D, now);
// Today to 13:00: 11.7 kWh, a third on no device meter.
const todayVals = (k) => hours.map((_, h) => (h < 13 ? k : null));
const todayP = E.energyPeriod(setup, {
  "sensor.grid_in": series(hours, todayVals(0.9)),
  "sensor.c": series(hours, todayVals(0.4)), "sensor.b": series(hours, todayVals(0.2)),
  "sensor.pool": series(hours, todayVals(0.35)), "sensor.spa": series(hours, todayVals(0)),
  "sensor.cost": series(hours, todayVals(1530)),
}, hours, H, now);
const T = O.energyToday(setup, todayP, weekP, now, "13:00", "IDR", "en-US");

console.log("  today:");
ck("the headline: a quiet day, measured against the typical one", /^A quiet day — 39% of a typical one by 13:00\.$/.test(T.headline), T.headline);
ck("the week's total and its typical day (the median, Friday does not move it)", Math.abs(T.weekTotal - 250.05) < 0.01 && T.typical === 29.89, [T.weekTotal, T.typical]);

console.log("\n  the cards, in order, at most three:");
ck("1. Friday stood out: its ratio, kWh, cost and the device that rose",
   /: 2\.5× usual$/.test(T.cards[0]?.title) && /75\.5 kWh, IDR/.test(T.cards[0]?.detail) && /Spa Pump ran more than usual\./.test(T.cards[0]?.detail), T.cards[0]);
ck("2. the leading device of the ones with nothing inside them", T.cards[1]?.title === "Pool Pump leads" && /39% of the villa/.test(T.cards[1]?.detail), T.cards[1]);
ck("3. a third of the day on no device meter is said (over 25%)", T.cards[2]?.title === "33% untracked", T.cards[2]);
ck("never more than three", T.cards.length <= O.MAX_CARDS);
const lapped = E.energySplit(setup, (id) => ({ "sensor.grid_in": 10, "sensor.c": 8, "sensor.b": 3 })[id]);
ck("devices over the meter by more than 5% say so — and that card wins over 'untracked'", O.overlapShows(lapped) && !O.overlapShows(E.energySplit(setup, (id) => ({ "sensor.grid_in": 10, "sensor.c": 7, "sensor.b": 3.4 })[id])));
const quiet = O.energyToday(setup, todayP, E.energyPeriod(setup, { "sensor.grid_in": series(days, [30, 30, 30, 30, 30, 30, 31]) }, days, D, now), now, "13:00", "IDR", "en-US");
ck("a week with no stand-out day has no stand-out card", !quiet.cards.some((c) => /usual$/.test(c.title)), quiet.cards.map((c) => c.title));

console.log("\n  the history's figures:");
const gappy = E.energyPeriod(setup, { "sensor.grid_in": series(hours.slice(0, 6), [1, 2, null, 4, 1, 1]) }, hours.slice(0, 6), H, hours[6] + H);
const F = O.historyFigures(gappy, "hour", (t) => `${new Date(t).getHours()}:00`, "IDR", "en-US");
ck("Energy, Cost, Per hour, Busiest hour", F.map((f) => f.label).join() === "Energy,Cost,Per hour,Busiest hour");
ck("per hour over the hours WITH a reading (9 kWh / 5), not the six shown", F[2].value === "1.80 kWh", F[2]);
ck("the busiest hour names its time and kWh", F[3].value === "3:00 · 4.00", F[3]);
ck("no cost statistic: a dash, not 0", F[1].value === "—");
ck("a share is a whole percent, and 0 of nothing (never NaN)", O.share(1, 3) === 33 && O.share(5, 0) === 0);

console.log("\n  the callers:");
const panel = readFileSync(new URL("../../src/components/panels/EnergyPanel.tsx", import.meta.url), "utf8");
ck("the first screen renders energyToday's words", /const T = energyToday\(setup, todayP, weekP, now, fmtChartTime\(now\), costUnit\);/.test(panel) && /<ObservationCards cards=\{T\.cards\} \/>/.test(panel) && /\{T\.headline\}/.test(panel));
ck("the overlap note and card are one rule", /\{overlapShows\(split\) && \(/.test(panel) && !/split\.overlap > split\.used \* 0\.05/.test(panel));
ck("no card, threshold or percent rule is left in the view", !/cards\.push/.test(panel) && !/Math\.round\(\([^)]*\) \* 100\)/.test(panel));
ck("the history figures are historyFigures'", /historyFigures\(p, unit, label, costUnit\)\.map/.test(panel));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ what the Energy window says, as rules");
