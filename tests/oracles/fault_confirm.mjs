// A FAULT BEING CONFIRMED (owner, 2026-10-23): "keep the Fault card visible in the Cockpit when a fault is still being
// monitored … until VESTA finally closes it" — in the same Open issues list, LAST, never counted as a problem; its look
// is the owner's to choose (one marker, `fault-watched`). A person closed it (Done on Telegram, Close in the Cockpit);
// the VESTA Agent wrote `confirmsBy` on the resolved fault (agent-contract.json ticket.fields) and takes it away once it
// has read it again. Driven through the real modules: which faults are being confirmed and their line
// (fm/faultConfirm), the open-issue counts and the map's fault marks that must NOT take them (config/attention), their
// cards drawn (cockpitCard → CockpitOverview) and where the Overview puts them.
import { h, draw } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { confirmingFaults, confirmLine, confirmParts, shownUntil } = await import("@/fm/faultConfirm");
const { buildAttentionItems, attentionFor, deviceIssues } = await import("@/config/attention");
const { confirmingCards, cockpitCard } = await import("@/config/cockpitCard");
const { AttentionCard } = await import("@/components/cockpit/CockpitOverview");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { fmAttention } = await import("@/fm/fmEngine");
const { clockTime } = await import("@/utils/dateText");
const { devicesOf } = await import("../consistency/devices.mjs");
const { parseTsx, elements, propText, guardsOf } = await import("../consistency/jsx.mjs");

const contract = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
ck("the agreement declares confirmsBy among the fault's fields (the proxy lists it in /agent/v1/info ticket_fields)",
   typeof contract.ticket.fields.confirmsBy === "string" && !contract.ticket.fieldsBeforeList.includes("confirmsBy"));

const NOW = new Date(2026, 9, 23, 14, 58).getTime();
const at = (min) => new Date(NOW + min * 60_000).toISOString();
const CADENCE = { checkMinutes: 5, nightlyAt: "02:00" };
const opened = { at: at(-60), status: "open", photoIds: [], by: "VESTA Agent" };
// a Done on Telegram: the agent's completion step names the person (`who`), the Kiosk stamps it the agent's
const doneOn = (id, entityId, confirmsBy, extra = {}) => ({ id, title: "Door unlocked", status: "resolved", openedAt: at(-60),
  resolvedAt: at(-2), entityId, photoIds: [], alertNumber: 65, origin: "alert", check: "minutes", source: "vesta_agent",
  ...(confirmsBy ? { confirmsBy } : {}),
  updates: [opened, { at: at(-2), status: "resolved", photoIds: [], who: "JM", note: "Done on Telegram (JM).", by: "VESTA Agent" }],
  ...extra });
// the Cockpit's Close: nothing done (kind cleared), by the profile
const closedIn = (id, entityId, confirmsBy) => ({ id, title: "Pump offline", status: "resolved", openedAt: at(-60),
  resolvedAt: at(-1), entityId, photoIds: [], confirmsBy,
  updates: [opened, { at: at(-1), status: "resolved", kind: "cleared", note: "Closed without action", photoIds: [], by: "Owner" }] });
const active = { id: "a1", title: "Leak under sink", status: "open", openedAt: at(-30), entityId: "binary_sensor.leak", photoIds: [],
  updates: [opened] };

const watched = doneOn("w1", "lock.door", at(8));               // VESTA confirms by 15:06
const kiosk = closedIn("w2", "switch.pump", at(9));              // closed in the Cockpit, confirmed by 15:07
const due = doneOn("w3", "lock.back", at(-3));                    // its moment past, the verdict at the next look
const stale = doneOn("w4", "lock.gate", at(-11));                 // past by more than two looks: let go
const plain = doneOn("w5", "lock.side", undefined);              // no field (an older Agent): resolved as before
const data = { ...EMPTY_FM_DATA, tickets: [active, watched, kiosk, due, stale, plain] };

console.log("  which faults are being confirmed:");
const conf = confirmingFaults(data, CADENCE, NOW);
ck("a resolved fault with confirmsBy is being confirmed, the soonest verdict first; an open one, one without the field and one past its grace are not",
   JSON.stringify(conf.map((c) => c.ticket.id)) === JSON.stringify(["w3", "w1", "w2"]), conf.map((c) => c.ticket.id));
const line = (id, list = conf) => confirmLine(list.find((c) => c.ticket.id === id));
ck("  ...its line: \"Done (JM) · VESTA confirms by 15:06\" (the villa's clock)",
   line("w1") === `Done (JM) · VESTA confirms by ${clockTime(NOW + 8 * 60_000)}` && clockTime(NOW + 8 * 60_000).includes("06"),
   line("w1"));
ck("  ...a close in the Cockpit says Closed and the profile", line("w2") === `Closed (Owner) · VESTA confirms by ${clockTime(NOW + 9 * 60_000)}`,
   line("w2"));
{
  // ⚠️ EVERY CLOSE ALIKE (owner, 2026-10-25): an alert the VESTA Agent cleared itself is watched too, said "Cleared"
  const { AGENT_STAMP } = await import("@/agent/agentApi");
  const cleared = { ...closedIn("w6", "lock.porch", at(60)), updates: [opened,
    { at: at(-1), status: "resolved", kind: "cleared", note: "Cleared: back to normal.", photoIds: [], by: AGENT_STAMP }] };
  const c = confirmingFaults({ ...EMPTY_FM_DATA, tickets: [cleared] }, CADENCE, NOW);
  ck("  ...an alert the VESTA Agent cleared itself says Cleared, no name", c.length === 1
     && confirmLine(c[0]) === `Cleared · VESTA confirms by ${clockTime(NOW + 60 * 60_000)}`, c.map(confirmLine));
}
ck("  ...its moment past: at the Agent's next check, never a time gone by", line("w3") === "Done (JM) · VESTA confirms it at its next look",
   line("w3"));
{
  // its pill, as the open issues' next-check pill says it (owner, 2026-10-23): the time, then "within 5min" once past
  const parts = (id) => confirmParts(confirmingFaults(data, CADENCE, NOW).find((c) => c.ticket.id === id));
  ck("  ...its pill: the time it confirms by, then the Agent's next look once past ('within 5min')",
     parts("w1").when === clockTime(NOW + 8 * 60_000) && parts("w3").when === `within ${CADENCE.checkMinutes}min`,
     [parts("w1").when, parts("w3").when]);
}
ck("  ...shown at most two of the Agent's looks past its moment; with the Agent offline (no cadence), not past it",
   shownUntil(0, CADENCE) === 10 * 60_000 && shownUntil(0, null) === 0
   && JSON.stringify(confirmingFaults(data, null, NOW).map((c) => c.ticket.id)) === JSON.stringify(["w1", "w2"]));

console.log("\n  never an open problem:");
const ids = ["lock.door", "switch.pump", "lock.back", "lock.gate", "lock.side", "binary_sensor.leak"];
const entities = Object.fromEntries(ids.map((id) => [id, { entity_id: id, state: id === "binary_sensor.leak" ? "off" : "locked",
  attributes: { friendly_name: id.split(".")[1] }, last_changed: at(-5) }]));
const devices = devicesOf({ ids });
const villa = { devices, attentionItems: buildAttentionItems({ devices, entities, entityMap: {}, resolvedRooms: {}, fmData: data }) };
const att = attentionFor(villa, () => true);
ck("the open issues, their count and the health line hold only the active fault",
   att.attentionGroups.length === 1 && att.attentionGroups[0].items.every((i) => i.ticketId === "a1")
   && fmAttention(data).unresolved.map((t) => t.id).join() === "a1" && att.health.summary === "1 thing needs attention.",
   att.attentionGroups.map((g) => g.key));
ck("  ...and the map's fault marks (the amber \"!\") only its device",
   [...deviceIssues(att.attentionGroups).amber].join() === "binary_sensor.leak");

console.log("\n  in the Open issues list, last, uncounted, marked:");
const cards = confirmingCards(conf, { devices, entities, entityMap: {}, resolvedRooms: { "lock.door": "Hall" }, may: () => true });
ck("one card per fault, titled by its device, its fault's title its line, the confirm line under it, no buttons",
   cards.length === 3 && cards.every((c) => c.look === "watched" && c.actions.length === 0 && c.nextCheck?.when)
   && cards[1].title === "door" && cards[1].room === "Hall" && cards[1].lines[0].text === "#65 · Door unlocked"
   && cards[1].lines[0].closing === "Done (JM)" && cards[1].nextCheck.tip === line("w1").split(" · ")[1], cards[1]);
ck("  ...only the faults whose device the profile may open (as the open issues)",
   confirmingCards(conf, { devices, entities, entityMap: {}, resolvedRooms: {}, may: (id) => id !== "lock.door" })
     .map((c) => c.key).join() === "watched:w3,watched:w2");
const drawn = draw(h(AttentionCard, { card: cards[1], onOpenEntity: () => {} }));
// ⚠️ THE SAME CARD AS AN OPEN ISSUE'S (owner, 2026-10-23: "the same piece of code … same style and same card layout"):
// RecordCard's frame (marked), its title and room pill, the open issues' next-check pill, the check as its lead
ck("  ...drawn by the open issues' own card: marked frame, a check, its device and room pill, its fault, who closed it",
   /^<div class="fm-record-card fault-watched">/.test(drawn) && /class="[^"]*fault-watched-icon/.test(drawn)
   && /<strong>door<\/strong><span class="fm-entity-chip fm-chip-static">Hall<\/span>/.test(drawn)
   && /#65 · Door unlocked/.test(drawn) && /<span class="cockpit-attention-latest">Done \(JM\)<\/span>/.test(drawn), drawn.slice(0, 900));
ck("  ...its pill is the open issues' next-check pill (CheckPill), saying when VESTA confirms",
   /<span class="fm-entity-chip fm-chip-static fm-record-check" aria-label="VESTA confirms by [^"]+">/.test(drawn), drawn.slice(-600));
ck("  ...no Close and no Open Ticket: it is closed", !/fm-record-actions/.test(drawn));
const activeCard = draw(h(AttentionCard, { card: cockpitCard(att.attentionGroups[0], CADENCE, new Date(NOW)), onOpenEntity: () => {} }));
ck("an active fault keeps its look: no marker", /^<div class="fm-record-card">/.test(activeCard) && !/fault-watched/.test(activeCard));
{
  // the Overview's own markup (the component needs the app's contexts to render)
  const tree = parseTsx("components/cockpit/CockpitOverview.tsx");
  const overview = tree.statements.find((s) => s.name?.getText() === "CockpitOverview");
  const listDiv = elements(overview, "div").find((d) => propText(d, "className") === '"cockpit-attention-list"');
  const [row] = elements(overview, "CockpitAttentionRow");
  const watchedCard = elements(overview, "AttentionCard").find((e) => propText(e, "card") === "card");
  const within = (n, outer) => !!n && !!outer && n.getStart() >= outer.getStart() && n.getEnd() <= outer.getEnd();
  ck("  ...the Overview draws them INSIDE the open issues' list, after every open issue",
     within(row, listDiv) && within(watchedCard, listDiv) && watchedCard.getStart() > row.getEnd(),
     [!!listDiv, !!row, !!watchedCard]);
  const title = elements(overview, "div").find((d) => propText(d, "className") === '"settings-section-title"');
  const head = elements(overview, "div").find((d) => propText(d, "className") === '"cockpit-issues-head"');
  ck("  ...the count stays the open issues' (attentionGroups), and the list and its head show when only watched faults are",
     !!title && /attentionGroups\.length/.test(title.getText()) && !/watched/.test(title.getText())
     && guardsOf(head).some((g) => /watched\.length > 0/.test(g)) && guardsOf(listDiv).some((g) => /watched\.length > 0/.test(g)),
     [title?.getText(), guardsOf(head), guardsOf(listDiv)]);
}

console.log("\n  gone or back as the Agent says:");
const without = (t) => { const { confirmsBy: _c, ...rest } = t; return rest; };
const right = { ...data, tickets: data.tickets.map((t) => (t.id === "w1" ? without(t) : t)) };
ck("the watch ended right (the Agent took confirmsBy away): it goes, still resolved, still no open problem",
   !confirmingFaults(right, CADENCE, NOW).some((c) => c.ticket.id === "w1") && fmAttention(right).unresolved.map((t) => t.id).join() === "a1");
const reopened = { ...data, tickets: data.tickets.map((t) => (t.id !== "w1" ? t : without({ ...t, status: "open", resolvedAt: undefined,
  updates: [...t.updates, { at: at(9), status: "open", kind: "reopened", note: "Still there after the close.", photoIds: [], by: "VESTA Agent" }] }))) };
ck("  ...still bad (reopened): an open fault again, counted, off the watched cards",
   !confirmingFaults(reopened, CADENCE, NOW).some((c) => c.ticket.id === "w1")
   && fmAttention(reopened).unresolved.map((t) => t.id).sort().join() === "a1,w1");
ck("  ...the field left on a reopened fault (before the Agent's repair) never makes it a confirming one",
   !confirmingFaults({ ...data, tickets: [{ ...watched, status: "open" }] }, CADENCE, NOW).length);

console.log("\n  a reopen in the Kiosk takes the watch away (architecture review i_k1, 2026-10-23: fmEngine withoutClose):");
{
  // ⚠️ The Kiosk's Reopen kept confirmsBy (every field but resolvedAt rode along): a Cockpit Close a minute later showed
  // "Closed (Owner) · VESTA confirms it at its next look" with the EARLIER close's watch time, while the Agent watched
  // nothing. Driven through the one way in for every change (fmCommands applyFmCommand), as the store runs it.
  const { applyFmCommand } = await import("@/fm/fmCommands");
  const { CLOSE_ONLY_FIELDS } = await import("@/fm/fmEngine");
  let n = 0;
  const k = (min) => ({ now: at(min), id: (p) => p + (++n), by: "Owner" });
  const doneW1 = doneOn("w1", "lock.front_door", at(2));
  const start = { ...EMPTY_FM_DATA, tickets: [doneW1] };
  ck("before: the Done on Telegram is being confirmed", confirmingFaults(start, CADENCE, NOW).length === 1);
  const reopenedHere = applyFmCommand(start, { type: "advanceTickets", ids: ["w1"], to: "open", step: { photoIds: [], note: "still dripping" } }, k(1));
  const r = reopenedHere.tickets[0];
  ck("Reopen: open, with neither the close's time nor its watch",
     r.status === "open" && !("confirmsBy" in r) && !("resolvedAt" in r) && r.updates.at(-1).kind === "reopened",
     { status: r.status, confirmsBy: r.confirmsBy, resolvedAt: r.resolvedAt });
  ck("  ...every other field kept (its alert number, its device, its steps)",
     r.alertNumber === 65 && r.entityId === "lock.front_door" && r.updates.length === 3 && r.check === "minutes");
  const closedAgain = applyFmCommand(reopenedHere, { type: "closeTickets", ids: ["w1"] }, k(2));
  ck("  ...a Cockpit Close a minute later: resolved, and NO confirming row until the Agent writes one",
     closedAgain.tickets[0].status === "resolved" && confirmingFaults(closedAgain, CADENCE, NOW + 2 * 60_000).length === 0,
     confirmingFaults(closedAgain, CADENCE, NOW + 2 * 60_000).map(confirmLine));
  const agentWatches = { ...closedAgain, tickets: closedAgain.tickets.map((t) => ({ ...t, confirmsBy: at(9) })) };
  ck("  ...the Agent writes its watch on THIS close: the row is back, with its time",
     confirmingFaults(agentWatches, CADENCE, NOW + 2 * 60_000).map((c) => c.at).join() === String(Date.parse(at(9))));
  const started = applyFmCommand(start, { type: "advanceTickets", ids: ["w1"], to: "in_progress", step: { photoIds: [] } }, k(1));
  ck("Mark in progress on the closed fault: the watch goes too",
     started.tickets[0].status === "in_progress" && !("confirmsBy" in started.tickets[0]) && !("resolvedAt" in started.tickets[0]));
  const patched = applyFmCommand(start, { type: "updateTicket", id: "w1", patch: { status: "open" } }, k(1));
  ck("a status patch that reopens it: the watch goes too",
     patched.tickets[0].status === "open" && !("confirmsBy" in patched.tickets[0]) && !("resolvedAt" in patched.tickets[0]));
  const retitled = applyFmCommand(start, { type: "updateTicket", id: "w1", patch: { title: "Front door unlocked" } }, k(1));
  ck("  ...a rename of the closed fault leaves the close and its watch as they are",
     retitled.tickets[0].confirmsBy === at(2) && retitled.tickets[0].resolvedAt === at(-2));
  const legacy = { ...EMPTY_FM_DATA, tickets: [{ ...doneW1, status: "open", resolvedAt: undefined,
    updates: [...doneW1.updates, { at: at(-1), status: "open", kind: "reopened", photoIds: [], by: "Owner" }] }] };
  const legacyClosed = applyFmCommand(legacy, { type: "closeTickets", ids: ["w1"] }, k(1));
  ck("a fault reopened by an older build (its watch left on it), closed now: no confirming row",
     !("confirmsBy" in legacyClosed.tickets[0]) && confirmingFaults(legacyClosed, CADENCE, NOW + 60_000).length === 0);
  const resolvedNow = applyFmCommand(legacy, { type: "advanceTickets", ids: ["w1"], to: "resolved", step: { photoIds: [] } }, k(1));
  ck("  ...or marked resolved: none either, and its resolution time is this one",
     !("confirmsBy" in resolvedNow.tickets[0]) && resolvedNow.tickets[0].resolvedAt === at(1));
  ck("the fields a reopen takes away are the Agent's reopen's (kiosk.py reopen_ticket drops resolvedAt and confirmsBy)",
     [...CLOSE_ONLY_FIELDS].sort().join() === "confirmsBy,resolvedAt", CLOSE_ONLY_FIELDS);
  ck("the agreement says it: a reopen by either side removes the watch",
     /A reopen by either side removes it\./.test(contract.ticket.fields.confirmsBy));
}

done("✅ a fault being confirmed is listed last among the open issues, marked, never counted, and goes as the Agent says");
