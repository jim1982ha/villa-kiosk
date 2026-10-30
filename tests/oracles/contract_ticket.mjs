// The fault the VESTA Agent writes and reads, as the agreement declares it (agent-contract.json `ticket`, architecture
// review 2026-10-15): the Kiosk side of the check — the agent host's tests hold the other side against the same file.
// Its stamp and source are what the proxy writes, every origin has its icon, the sample reads as the alert it is, and
// "Open Ticket" in the Kiosk writes exactly the step the agreement calls a take-on (the agent stops chasing on it).
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

const contract = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
const T = contract.ticket;
const { AGENT_ORIGINS, AGENT_SOURCE } = await import("@/fm/fmTypes");
const { faultSource, ISSUE_SOURCES } = await import("@/fm/issueSource");
const E = await import("@/fm/fmEngine");
const proxy = readFileSync(new URL("../../rootfs/usr/bin/supervisor-proxy.py", import.meta.url), "utf8");

ck("the agreement declares the agent's fault: stamp, source, origins, the take-on step and a sample",
   T && T.agentStamp && T.source && Array.isArray(T.origins) && T.takenStep && T.sample, Object.keys(T || {}));
ck("the proxy stamps the agreement's words, never its own copy",
   /AGENT_SOURCE = str\(_AGENT_TICKET\.get\("source"\)/.test(proxy) && /AGENT_NAME = str\(_AGENT_TICKET\.get\("agentStamp"\)/.test(proxy));
// the app reads the agreement's list, and a check the agreement does not declare (an older Agent's retired "day", owner
// 2026-10-20) reads as its source's usual clock (never a time from nowhere)
{
  const { AGENT_CHECKS } = await import("@/fm/fmTypes");
  const { nextCheck } = await import("@/fm/faultTiming");
  ck("the app reads the agreement's checks — every look and the nightly check, no \"day\" any more; a Kiosk without the list was told the same two",
     JSON.stringify(AGENT_CHECKS) === JSON.stringify(T.checks) && JSON.stringify(T.checks) === JSON.stringify(["minutes", "nightly"])
     && JSON.stringify(T.checksBeforeList) === JSON.stringify(["minutes", "nightly"]) && T.checksBeforeList.every((c) => T.checks.includes(c)));
  const C = { checkMinutes: 5, nightlyAt: "02:00" }, NOW = new Date(2026, 9, 19, 13, 10);
  ck("  ...an undeclared check falls back to its source's clock",
     nextCheck([{ source: "alert", check: "weekly" }], C, NOW) === "Next check: within 5min"
     && nextCheck([{ source: "night", check: "day" }], C, NOW) === "Next check: within 5min");
  ck("  ...the proxy lists them to the Agent from the agreement (by value: tests/agent-interface.py)",
     /"ticket_checks": list\(\(AGENT_CONTRACT_TABLE\.get\("ticket"\) or \{\}\)\.get\("checks"\) or \[\]\)/.test(proxy));
}
ck("the app reads the same source and origins", AGENT_SOURCE === T.source && JSON.stringify(AGENT_ORIGINS) === JSON.stringify(T.origins));
ck("every declared origin is a source with its own icon (none falls back to the generic VESTA Agent one)",
   T.origins.every((o) => ISSUE_SOURCES.includes(o) && faultSource({ ...T.sample, origin: o }) === o));
ck("the sample — made from an alert — reads as an alert, its number kept", faultSource(T.sample) === "alert" && T.sample.alertNumber === 33);
// "Open Ticket" on a fault, through the engine every Kiosk write goes through
const k = { now: "2026-10-15T01:09:00.000Z", id: (p) => `${p}-1` };
const fault = { ...T.sample, status: "open", updates: T.sample.updates.slice(0, 2) };
const data = { schedules: [], completions: [], costs: [], tickets: [fault], savedDocuments: [] };
const after = E.withTicketsAdvanced(data, [fault.id], "in_progress", { who: "Jean-Marie", photoIds: [] }, undefined, k, "owner");
const step = after.tickets[0].updates.at(-1);
ck("\"Open Ticket\" writes the agreement's take-on step: in progress, no kind, not the agent's stamp",
   step.status === T.takenStep.status && !step.kind && step.by !== T.agentStamp && step.by === "Owner" && step.role === "owner", step);
// the sample's person's step is the shape a Kiosk writes since 2.496.623: the profile's id beside its words
ck("  ...the agreement's sample step carries the profile's id and words, as the Kiosk writes them",
   T.sample.updates.some((u) => u.role === "owner" && u.by === after.tickets[0].updates.at(-1).by));
ck("  ...and the sample's own take-on step is one too",
   T.sample.updates.filter((u) => u.status === "in_progress" && !u.kind && u.by !== T.agentStamp).length === 1);

// what an older Kiosk took before /agent/v1/info listed kinds and fields (the VESTA Agent writes only these to it)
const U = contract.ticketUpdate;
ck("the kinds a Kiosk took before it listed them are kinds this Kiosk knows",
   Array.isArray(U.kindsBeforeList) && U.kindsBeforeList.length > 0 && U.kindsBeforeList.every((k) => U.kinds.includes(k)), U.kindsBeforeList);
ck("  ...and the fields too",
   Array.isArray(T.fieldsBeforeList) && T.fieldsBeforeList.length > 0
   && T.fieldsBeforeList.every((f) => Object.keys(T.fields).includes(f)), T.fieldsBeforeList);

done("✅ the Kiosk holds the agent's fault as the agreement declares it");
