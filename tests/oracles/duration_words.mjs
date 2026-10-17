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

done("✅ the Kiosk words every agreed duration as the agreement says");
