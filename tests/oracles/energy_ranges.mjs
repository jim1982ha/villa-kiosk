// The Energy window's periods, one row each (src/components/panels/
// energyRanges.ts, round 7, 2.496.124) — they were five parallel maps.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const R = await import("@/components/panels/energyRanges");
const E = await import("@/config/energyModel");


console.log("  the table:");
// the app's five periods (owner, 2026-10-20): 24h, 1w, 1m, 1y here; 1h greyed in its toggle (figures are hourly)
const { RANGE_KEYS } = await import("@/utils/historyRanges");
ck("24h, 1w, 1m, 1y, in the picker's order", R.ENERGY_RANGES.map((r) => r.label).join() === "24h,1w,1m,1y");
ck("  ...the app's periods but 1h, which the window shows greyed",
   RANGE_KEYS.filter((k) => !R.ENERGY_RANGES.some((r) => r.key === k)).join() === "1h");
const now = new Date(2026, 8, 26, 15, 30).getTime();
for (const r of R.ENERGY_RANGES) {
  const n = E.periodStarts(r.kind, now).length;
  const t = r.ticks(n);
  ck(`${r.label}: its x labels are buckets it shows (${n})`, t.length >= 2 && t.every((i) => Number.isInteger(i) && i >= 0 && i < n), t);
}
ck("a bucket is an hour of a day, a day of a week or month, a month of a year",
   R.ENERGY_RANGES.map((r) => `${r.period}/${r.unit}`).join() === "hour/hour,day/day,day/day,month/month");
ck("  ...and each shows the buckets its period is read in: 24 hours, 7 and 30 days, 12 months",
   R.ENERGY_RANGES.map((r) => E.periodStarts(r.kind, now).length).join() === "24,7,30,12");
ck("a month's label is its short name; a day's names its weekday", /Sep|sept/i.test(R.energyRange("1y").bucketLabel(new Date(2026, 8, 1).getTime())) && /\d/.test(R.energyRange("1w").bucketLabel(now)));
{
  const h = E.periodStarts("last24Hours", now);
  ck("24h is the last 24 hours, this one included — not today's", h.length === 24 && h[23] === Math.floor(now / 3_600_000) * 3_600_000
     && h[0] === h[23] - 23 * 3_600_000, [h[0], h[23]]);
}

console.log("\n  the callers:");
const panel = readFileSync(new URL("../../src/components/panels/EnergyPanel.tsx", import.meta.url), "utf8");
ck("no range ternary or second map left in the window", !/range === "(day|week|month|year)"/.test(panel) && !/const (RANGES|KIND)\b/.test(panel));
// The key is the history source's (historyKey), derived from the request —
// the period's start and bucket, never a row object.
const { historyKey } = await import("@/ha/historySource");
const { energyRequest } = await import("@/ha/HAEnergyAPI");
const setup = { gridIn: ["sensor.grid"], gridOut: [], solar: [], devices: [], costOf: {} };
const keys = R.ENERGY_RANGES.map((r) => historyKey({ p: energyRequest(setup, E.periodStarts(r.kind, now)[0], r.period) }));
ck("each period's history is its own request (a row object there once keyed every period '[object Object]')",
   new Set(keys).size === keys.length && !keys.some((k) => k.includes("[object")), keys);
ck("  ...and the window asks for exactly that request", /useHistorySource\(\{ p: energyRequest\(setup, starts\[0\], range\.period\) \}\)/.test(panel));
ck("today's hour-by-hour chart is the 24h row's labels too", /energyRange\("24h"\)\.ticks\(hours\.length\)/.test(panel));
ck("the picker greys what the window has no row for", /disabled: !ENERGY_RANGES\.some\(\(r\) => r\.key === k\)/.test(panel));

done("✅ one row a period");
