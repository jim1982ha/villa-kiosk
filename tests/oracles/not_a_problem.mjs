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
const { attentionOf } = await import("@/config/attention");
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
// a fault never taken on as a ticket says no state (owner, 2026-11-04: a state is a real ticket's alone)
ck("its pill: Not a problem by the person, no state (it was never a ticket)", faultLatest(held, (a) => a.slice(11, 16))?.text
   === "Not a problem by Owner, on 10:00", faultLatest(held, (a) => a.slice(11, 16)));

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
const live = (t, changed) => attentionOf({ devices: devicesOf({ ids: ["switch.pump"], unavailable: ["switch.pump"] }),
  entities: ent(changed), entityMap: { "switch.pump": { entityId: "switch.pump", type: "switch" } }, resolvedRooms: {},
  fmData: fm(t) }).attentionItems.filter((i) => i.kind === "unavailable");
ck("offline since before the close: no open issue while it lasts", live(held, "2026-11-01T01:00:00.000Z").length === 0);
ck("  ...offline again after it: a new problem", live(held, "2026-11-02T11:00:00.000Z").length === 1);
ck("  ...a plain close hides nothing (Watch does, from the Agent's cadence only)", live(plain, "2026-11-01T01:00:00.000Z").length === 1);

console.log("  the Recap's checks (owner, 2026-11-04: \"Doors locked · 1 unlocked\" of a door closed Not a problem):");
{
  const { attentionOf, attentionFor } = await import("@/config/attention");
  const { buildReadiness } = await import("@/fm/readiness");
  const recap = (t, changed) => {
    const devices = devicesOf({ ids: ["switch.pump"], unavailable: ["switch.pump"] });
    const entities = ent(changed);
    const problems = { devices, ...attentionOf({ devices, entities, entityMap: { "switch.pump": { entityId: "switch.pump", type: "switch" } },
      resolvedRooms: {}, fmData: fm(t) }) };
    const r = buildReadiness(entities, fm(t), attentionFor(problems, () => true), {});
    return r.checks.find((c) => c.id === "devices-online");
  };
  const before = recap(held, "2026-11-01T01:00:00.000Z"), after = recap(held, "2026-11-02T11:00:00.000Z");
  ck("held as not a problem: the Recap counts it in no check, as Open issues lists it nowhere",
     before.state === "pass" && before.entityIds.length === 0, before);
  // the owner's door: unlocked, its fault closed Not a problem; an unlocked lock is no open issue of its own
  const door = (state, changed) => {
    const devices = devicesOf({ ids: ["lock.door"] });
    const entities = { "lock.door": { entity_id: "lock.door", state, last_changed: changed, attributes: { friendly_name: "Door" } } };
    const t = { ...held, entityId: "lock.door" };
    const problems = { devices, ...attentionOf({ devices, entities, entityMap: { "lock.door": { entityId: "lock.door", type: "lock" } },
      resolvedRooms: {}, fmData: fm(t) }) };
    return buildReadiness(entities, fm(t), attentionFor(problems, () => true), {}).checks.find((c) => c.id === "locks");
  };
  ck("  ...the door closed Not a problem, unlocked since before: no \"1 unlocked\"; unlocked again after it: counted",
     door("unlocked", "2026-11-01T01:00:00.000Z")?.state !== "warn" && door("unlocked", "2026-11-02T11:00:00.000Z")?.detail === "1 unlocked.",
     [door("unlocked", "2026-11-01T01:00:00.000Z"), door("unlocked", "2026-11-02T11:00:00.000Z")?.detail]);
  ck("  ...offline again after the close: counted, as Open issues lists it again; a plain close holds nothing",
     after.state === "warn" && after.entityIds.join() === "switch.pump"
     && recap(plain, "2026-11-01T01:00:00.000Z").entityIds.join() === "switch.pump", [after, recap(plain, "2026-11-01T01:00:00.000Z")]);
}

console.log("  where a person says it:");
// owner, 2026-11-04: "show it directly next to `Done`, `Need Help`" — a button of its own, its label short ("the button
// label must be short"), no longer the second yes of Done's or No action needed's question
const lasting = Object.entries(WORK_ACTIONS).filter(([, a]) => a.step?.lasting).map(([n]) => n);
ck("one button closes as lasting: Not a problem, short, its meaning in its question, no work done",
   JSON.stringify(lasting) === JSON.stringify(["notAProblem"]) && WORK_ACTIONS.notAProblem.label === NOT_A_PROBLEM
   && NOT_A_PROBLEM === "Not a problem" && /while it lasts/.test(WORK_ACTIONS.notAProblem.step.question)
   && !WORK_ACTIONS.notAProblem.step.work, lasting);
const W = await import("@/fm/deviceWork");
const order = (acts) => acts.map((a) => a.kind).join(" · ");
ck("  ...after Need help on every card that offers Done on a record, never on a card with no record",
   order(W.overviewActions([{ id: "a", stage: "fault" }])) === "done · needHelp · notAProblem · openTicket"
   && order(W.ticketActions([{ id: "a", stage: "ticket" }])) === "ticketDone · needHelp · notAProblem · closeTicket"
   && !W.overviewActions([], "switch.pump").some((a) => a.kind === "notAProblem"),
   [order(W.overviewActions([{ id: "a", stage: "fault" }])), order(W.ticketActions([{ id: "a", stage: "ticket" }]))]);
const wb = parseTsx("components/fm/WorkButtons.tsx");
const confirm = elements(wb, "InlineConfirm")[0];
ck("  ...its question closes with lasting; no question offers a second yes any more", !!confirm
   && propText(confirm, "onConfirm") === "() => work.close(cardKey, confirming.ids, asWork, lasting)"
   && propText(confirm, "alternative") == null, confirm && propText(confirm, "onConfirm"));

done();
