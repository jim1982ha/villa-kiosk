// "NOT A PROBLEM WHILE IT LASTS" (owner, 2026-11-02: a pump stopped on purpose, flagged every night; "allow the user to
// tell the Agent that this issue shall not be seen as an issue"). The second answer of a Done or a No action needed:
// the close (kind cleared) carries `lasting` (the agreement's ticketUpdate), the VESTA Agent never reads it again, it
// is watched by nothing (straight to Closed), its pill says so, and the device's live state of it, begun before that
// close, is no open issue; begun after, it is new. Driven through the real modules.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { applyFmCommand } = await import("@/fm/fmCommands");
const { closedAsLasting } = await import("@/fm/fmEngine");
const { faultLatest } = await import("@/fm/faultNotes");
const { confirmingFaults, watchedRecords } = await import("@/fm/faultConfirm");
const { buildAttentionItems } = await import("@/config/attention");
const { WORK_ACTIONS, NOT_A_PROBLEM } = await import("@/fm/deviceWork");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { devicesOf } = await import("../consistency/devices.mjs");
const { parseTsx, elements, propText } = await import("../consistency/jsx.mjs");

const NOW = "2026-11-02T10:00:00.000Z";
const k = { now: NOW, id: (p) => `${p}1`, by: "owner" };
const fault = { id: "va-1", title: "Pump offline", status: "open", openedAt: "2026-11-01T02:00:00.000Z", entityId: "switch.pump",
  photoIds: [], updates: [{ at: "2026-11-01T02:00:00.000Z", status: "open", photoIds: [], by: "Owner", role: "owner" }] };
const data = { ...EMPTY_FM_DATA, tickets: [fault] };
const held = applyFmCommand(data, { type: "closeTickets", ids: ["va-1"], lasting: true }, k).tickets[0];
const plain = applyFmCommand(data, { type: "closeTickets", ids: ["va-1"] }, k).tickets[0];

console.log("  the close:");
const step = held.updates.at(-1);
ck("closed as not a problem: resolved, kind cleared, lasting, by the profile", held.status === "resolved"
   && step.kind === "cleared" && step.lasting === true && step.by === "Owner" && closedAsLasting(held), step);
ck("  ...a plain close says nothing of lasting", !("lasting" in plain.updates.at(-1)) && !closedAsLasting(plain));
ck("  ...the agreement tells the VESTA Agent what lasting means",
   /`lasting`: true/.test(JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"))._ticketUpdate));
ck("its pill: Not a problem by the person, Resolved", faultLatest(held, (a) => a.slice(11, 16))?.text
   === "Not a problem by Owner, on 10:00 · Resolved", faultLatest(held, (a) => a.slice(11, 16)));

console.log("  nothing watches it:");
const cadence = { checkMinutes: 5, nightlyAt: "02:00" };
const at = Date.parse(NOW) + 60_000;
const fm = (t) => ({ ...EMPTY_FM_DATA, tickets: [t] });
ck("a plain close is on Watch until the next night; one that lasts is not, even with a time written on it", confirmingFaults(fm(plain), cadence, at).length === 1
   && confirmingFaults(fm(held), cadence, at).length === 0 && watchedRecords(fm(held), cadence).length === 0
   && confirmingFaults(fm({ ...held, confirmsBy: NOW }), cadence, at).length === 0);

const { closedFaults, closedWords } = await import("@/fm/faultConfirm");
ck("  ...it is Closed at once, said as it was closed", closedWords(closedFaults(fm(held), cadence, at)[0]).startsWith("Not a problem on "),
   closedFaults(fm(held), cadence, at).map(closedWords));

console.log("  the device's live state:");
const ent = (changed) => ({ "switch.pump": { entity_id: "switch.pump", state: "unavailable", last_changed: changed, attributes: { friendly_name: "Pump" } } });
const live = (t, changed) => buildAttentionItems({ devices: devicesOf({ ids: ["switch.pump"], unavailable: ["switch.pump"] }),
  entities: ent(changed), entityMap: { "switch.pump": { entityId: "switch.pump", type: "switch" } }, resolvedRooms: {},
  fmData: fm(t) }).filter((i) => i.kind === "unavailable");
ck("offline since before the close: no open issue while it lasts", live(held, "2026-11-01T01:00:00.000Z").length === 0);
ck("  ...offline again after it: a new problem", live(held, "2026-11-02T11:00:00.000Z").length === 1);
ck("  ...a plain close hides nothing (Watch does, from the Agent's cadence only)", live(plain, "2026-11-01T01:00:00.000Z").length === 1);

console.log("  where a person says it:");
ck("Done and No action needed both offer it, nothing else does",
   JSON.stringify(Object.entries(WORK_ACTIONS).filter(([, a]) => a.step?.lasting === NOT_A_PROBLEM).map(([n]) => n).sort())
   === JSON.stringify(["closeTicket", "done"]));
const wb = parseTsx("components/fm/WorkButtons.tsx");
const confirm = elements(wb, "InlineConfirm")[0];
ck("the question draws it as its second yes, closing with lasting", !!confirm
   && /work\.close\(cardKey, confirming\.ids, false, true\)/.test(propText(confirm, "alternative") ?? ""), confirm && propText(confirm, "alternative"));

done();
