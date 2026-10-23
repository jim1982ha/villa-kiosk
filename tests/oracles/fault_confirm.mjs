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
const { confirmingFaults, confirmLine, shownUntil } = await import("@/fm/faultConfirm");
const { buildAttentionItems, attentionFor, faultDevices } = await import("@/config/attention");
const { confirmingCards, cockpitCard } = await import("@/config/cockpitCard");
const { AttentionCard, WatchedRow } = await import("@/components/cockpit/CockpitOverview");
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
ck("  ...its moment past: at the Agent's next check, never a time gone by", line("w3") === "Done (JM) · VESTA confirms it at its next check",
   line("w3"));
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
   [...faultDevices(data, (id) => id in entities, new Map())].join() === "binary_sensor.leak");

console.log("\n  in the Open issues list, last, uncounted, marked:");
const cards = confirmingCards(conf, { devices, entities, entityMap: {}, resolvedRooms: { "lock.door": "Hall" }, may: () => true });
ck("one card per fault, titled by its device, its fault's title its line, the confirm line under it, no buttons",
   cards.length === 3 && cards.every((c) => c.look === "watched" && c.actions.length === 0 && c.nextCheck === null)
   && cards[1].title === "door" && cards[1].room === "Hall" && cards[1].lines[0].text === "#65 · Door unlocked"
   && cards[1].lines[0].closing === line("w1"), cards[1]);
ck("  ...only the faults whose device the profile may open (as the open issues)",
   confirmingCards(conf, { devices, entities, entityMap: {}, resolvedRooms: {}, may: (id) => id !== "lock.door" })
     .map((c) => c.key).join() === "watched:w3,watched:w2");
const drawn = draw(h(WatchedRow, { card: cards[1], onOpenEntity: () => {} }));
// owner, 2026-10-23, option 4 "One compact row": a check, its device · its fault · who closed it, and a pill saying when
ck("  ...drawn as ONE compact row marked `fault-watched`: a check, its device, its fault, who closed it, and when in a pill",
   /^<button type="button" class="fault-watched">/.test(drawn) && /class="[^"]*fault-watched-icon/.test(drawn)
   && /<span class="fault-watched-text"><span class="fault-watched-head"><b class="fault-watched-title">[^<·]+<\/b><span class="fm-entity-chip fm-chip-static">Hall<\/span><\/span><span class="fault-watched-detail">#65 · Door unlocked · Done \(JM\)<\/span><\/span>/.test(drawn)
   && /<span class="fault-watched-when">VESTA confirms by [^<]+<\/span>/.test(drawn), drawn.slice(0, 500));
ck("  ...no card, no Close and no next-check pill: it is closed, its pill says when",
   !/fm-record-card|fm-record-actions|fm-record-check/.test(drawn));
const activeCard = draw(h(AttentionCard, { card: cockpitCard(att.attentionGroups[0], CADENCE, new Date(NOW)), onOpenEntity: () => {} }));
ck("an active fault keeps its look: no marker", /^<div class="fm-record-card">/.test(activeCard) && !/fault-watched/.test(activeCard));
{
  // the Overview's own markup (the component needs the app's contexts to render)
  const tree = parseTsx("components/cockpit/CockpitOverview.tsx");
  const overview = tree.statements.find((s) => s.name?.getText() === "CockpitOverview");
  const listDiv = elements(overview, "div").find((d) => propText(d, "className") === '"cockpit-attention-list"');
  const [row] = elements(overview, "CockpitAttentionRow");
  const watchedCard = elements(overview, "WatchedRow").find((e) => propText(e, "card") === "card");
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

done("✅ a fault being confirmed is listed last among the open issues, marked, never counted, and goes as the Agent says");
