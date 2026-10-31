// How long something lasted, ONE rule on both apps (architecture review round 2, 2026-10-16). The agreement's
// `duration.cases` (agent-contract.json) are the words; the VESTA Agent's timeutil.lasting is tested against the
// same cases from its copy of the file. Before: the Kiosk said "1 min" for 89 s, the Agent "89 s"; 1 h 29 min 30 s
// was "1 h 30 min" here and "1 h 29 min" there; the weekly report's "Lasted" column said "2.5 h".
// Driven through every place the Kiosk words a duration: the chart tooltip's outage, the Weather "ago" and a fault's
// title worded from its `since` (fmEngine.faultTitle) — the helper alone would stay green with a caller of its own.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

const contract = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
const cases = contract.duration?.cases;
const { fmtDuration, fmtOutage } = await import("@/components/panels/chartUtils");
const { faultTitle } = await import("@/fm/fmEngine");

ck("the agreement holds the duration cases both apps read", Array.isArray(cases) && cases.length >= 20, contract.duration);
const now = Date.parse("2026-10-16T12:00:00Z");
for (const c of cases ?? []) {
  const ms = c.seconds * 1000;
  const label = `${c.seconds} s → "${c.words}"${c._ ? ` (${c._})` : ""}`;
  ck(label, fmtDuration(ms) === c.words, fmtDuration(ms));
  // a closed outage in a chart tooltip, and a fault titled from its `since`
  const outage = fmtOutage({ from: now - ms, to: now }, now + 1);
  const title = faultTitle({ title: "x", titlePattern: "Pump offline for {since}", since: new Date(now - ms).toISOString() }, now);
  ck("  ...and the outage tooltip and a fault's title say it so",
    outage.endsWith(`(${c.words})`) && title === `Pump offline for ${c.words}`, { outage, title });
}

// ⚠️ THE OTHER PLACES (architecture review K, 2026-10-24): the Agent's look, the list's refresh, a confirming fault's
// pill and the mean resolution were worded by hand ("every 90 minutes", "1.5 hours", "2h" for 1h 30min)
console.log("\n  every other place a duration is said:");
const { faultTiming, confirmingRow, nextCheckWhen } = await import("@/fm/faultTiming");
const { confirmParts } = await import("@/fm/faultConfirm");
const { buildMonthlyRecap } = await import("@/fm/fmDocuments");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } = await import("@/hooks/useStoreRefresh");
for (const checkMinutes of [1, 15, 90]) {
  const cadence = { checkMinutes, nightlyAt: "04:30" }, words = fmtDuration(checkMinutes * 60_000);
  const note = faultTiming(true, cadence).note;
  ck(`the Agent's look every ${checkMinutes} minutes: "${words}" in the (i), the confirming row and a card's pill`,
    note.includes(`it checks every ${words},`) && confirmingRow(cadence).goes.includes(`, within ${words} once that time is past,`)
    && nextCheckWhen([{ source: "alert", check: "minutes" }], cadence, new Date(now)) === `within ${words}`,
    { note, goes: confirmingRow(cadence).goes, pill: nextCheckWhen([{ source: "alert", check: "minutes" }], cadence, new Date(now)) });
  const pill = confirmParts({ at: new Date(now).toISOString(), word: "Done", who: null, due: true, lookMinutes: checkMinutes });
  ck("  ...and on a cleared fault's \"Closes\" pill", pill.when === `Closes within ${words}`, pill);
}
ck("the list's refresh in the same words", faultTiming(false).note.includes(
  `every ${fmtDuration(STORE_ACTIVE_MS)} while it is open (every ${fmtDuration(STORE_HEARTBEAT_MS)} otherwise)`), faultTiming(false).note);
const fixed = { id: "t1", title: "Pump", status: "resolved", openedAt: "2026-09-10T08:00:00Z", resolvedAt: "2026-09-10T09:30:00Z",
  photoIds: [], updates: [] };
const recap = buildMonthlyRecap({ fm: { ...EMPTY_FM_DATA, tickets: [fixed] }, month: "2026-09", villaName: "V", readiness: null,
  deviceOfRecord: (id) => id, now });
ck("the monthly report's mean resolution: 1h 30min", recap.includes("Mean time to resolution this month: **1h 30min**"),
  recap.split("\n").find((l) => /resolution/.test(l)));
const tickets = readFileSync(new URL("../../src/components/fm/TicketsTab.tsx", import.meta.url), "utf8");
ck("the Tickets tab's mean resolution in the same words",
  /meanResolutionHours === null \? "—" : fmtDuration\(stats\.meanResolutionHours \* 3_600_000\)/.test(tickets));
// no number, no words (architecture review K: "NaNd", "Infinityd")
ck("no number: no words", [NaN, Infinity, -Infinity].every((v) => fmtDuration(v) === ""), [NaN, Infinity].map(fmtDuration));

done("✅ the Kiosk words every agreed duration as the agreement says, in every place it says one");
