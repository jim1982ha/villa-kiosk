// WHAT MADE A CARD (owner, 2026-11-21: "in all fault card, … a dedicated (?) pill icon on the left of the next checked
// pill, so the tooltip indicates what has generated this fault card (name the automation when relevant, mention the
// skill when relevant, etc..)"). Every kind of card the Cockpit lists, drawn: its (?) pill stands at the left of its
// next check, and its words say what made it, never a guess.
import { h, draw, inside } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const { AttentionCard } = await import("@/components/cockpit/IssueCard");
const { OriginPill } = await import("@/components/fm/RecordCard");
const { cockpitCard } = await import("@/config/cockpitCard");
const { attentionOf, groupAttention } = await import("@/config/attention");
const { villaAlertCards } = await import("@/messages/messagesModel");
const { ORIGIN_UNKNOWN } = await import("@/fm/faultOrigin");

const CADENCE = { checkMinutes: 5, nightlyAt: "02:00" };
const AGENT = { source: "vesta_agent" };
const ticket = (id, extra) => ({ id, title: `fault ${id}`, status: "open", openedAt: "2026-11-21T08:00:00.000Z", photoIds: [], ...extra });
const entities = {
  "lock.room": { entity_id: "lock.room", state: "locked", attributes: { friendly_name: "Room lock" } },
  "automation.critical_condition_room_unlocked": { entity_id: "automation.critical_condition_room_unlocked", state: "on",
    attributes: { friendly_name: "critical_condition---room_unlocked" } },
};
const devices = {
  unavailable: [], partlyLost: [], ids: [], isCritical: () => false, isHidden: () => false, deviceOf: (id) => id,
  recordCard: (t) => ({ entityId: t.entityId, opens: t.entityId }),
};
// what a fault's card says on its (?): its line's words, as the card hands them to its pill
const saidOf = (t) => {
  const { attentionItems } = attentionOf({ devices, entities, entityMap: {}, resolvedRooms: {},
    fmData: { schedules: [], completions: [], costs: [], tickets: [t], savedDocuments: [] } });
  return attentionItems.find((i) => i.ticketId === t.id)?.origin;
};

console.log("  what each kind of fault says:");
ck("an alert names the villa's automation, its own name and its id in the villa's system",
   saidOf(ticket("a", { ...AGENT, origin: "alert", alertNumber: 9, raisedBy: { automation: "automation.critical_condition_room_unlocked" } }))
   === "Raised by the villa's automation \"Room unlocked\" (critical_condition---room_unlocked), which sent its alert to VESTA.");
ck("  ...an automation the villa no longer has: its id, read as words",
   saidOf(ticket("a2", { ...AGENT, origin: "alert", raisedBy: { automation: "automation.pool_leak" } }))
   === "Raised by the villa's automation \"Pool leak\" (automation.pool_leak), which sent its alert to VESTA.");
ck("a maintenance finding names the skill and its check, never when it looks again (its next-check pill says it)",
   saidOf(ticket("n", { ...AGENT, origin: "night", check: "minutes",
     raisedBy: { skill: "preventive maintenance", check: "PM-MISSING", name: "Missing device" } }))
   === "Found by VESTA's preventive maintenance check \"Missing device\" (PM-MISSING).");
ck("an older fault with no maker written says so, never a guess",
   /not recorded/.test(saidOf(ticket("o", { ...AGENT, origin: "alert", alertNumber: 3 })))
   && /not recorded/.test(saidOf(ticket("o2", { ...AGENT, origin: "night" }))));
ck("a person's fault names who opened it in the Cockpit",
   saidOf(ticket("p", { updates: [{ at: "2026-11-21T08:00:00.000Z", status: "open", photoIds: [], role: "owner", by: "Owner" }] }))
   === "Opened by Owner in the Cockpit.");
ck("a chat's and a guest's say where they came from",
   /chat/.test(saidOf(ticket("c", { ...AGENT, origin: "chat" }))) && /guest/.test(saidOf(ticket("g", { reportedBy: "guest" }))));

// a device's live state (owner, 2026-11-21: "clearly mention who has opened the fault, not adding a redundant
// description of the fault itself ... and when the card will clear itself"): who shows it, never the problem again
const liveSaid = attentionOf({ devices: { ...devices, unavailable: ["lock.room"] }, entities, entityMap: {}, resolvedRooms: {},
  fmData: { schedules: [], completions: [], costs: [], tickets: [], savedDocuments: [] } }).attentionItems
  .find((i) => i.id === "unavailable:lock.room")?.origin;
ck("a device offline right now names its maker, the VESTA UI's own check, and nothing more",
   liveSaid === "Created by the VESTA UI's own live device check.", liveSaid);

console.log("\n  the pill, drawn:");
const [group] = groupAttention([{ id: "fault:a", kind: "fault", title: "Room unlocked", entityId: "lock.room", ticketId: "a",
  stage: "fault", source: "alert", check: "minutes", origin: "Raised by x.", device: { key: "lock.room", label: "Room lock" } }]);
const drawn = draw(h(AttentionCard, { card: cockpitCard(group, CADENCE), onOpenEntity: () => {} }));
const pills = inside(drawn, "fm-record-pills");
ck("a (?) pill at the left of the card's next check, on its first line",
   /What made this card[\s\S]*fm-record-check/.test(pills), pills);
const live = draw(h(AttentionCard, { card: cockpitCard(groupAttention([{ id: "unavailable:lock.room", kind: "unavailable",
  title: "Room lock", detail: "Unavailable", source: "live", entityId: "lock.room", device: { key: "lock.room", label: "Room lock" } }])[0], CADENCE),
  onOpenEntity: () => {} }));
ck("a card with nothing said of its maker still has its pill (its words: \"Source not recorded.\")",
   /What made this card/.test(live) && cockpitCard(groupAttention([{ id: "x", kind: "fault", title: "x", source: "person" }])[0], CADENCE)
     .lines[0].origin.length === 0);
const visit = villaAlertCards([{ seq: 1, at: "2026-11-21T08:00:00Z", title: "Visit", to: "", text: "Door opened", status: "⚠️ New alert",
  photos: [], key: "visit:1", buttons: [] }]).open[0];
ck("the villa's own alert card says the villa's system sent it", /villa's system itself/.test(visit?.lines[0].origin?.[0] ?? ""), visit?.lines[0]);
const tip = draw(h(OriginPill, { origin: [ORIGIN_UNKNOWN] }));
ck("the pill is a button a tap opens (its words in the one (i) card, on hover or a tap)",
   /<button type="button" class="info-trigger" aria-label="What made this card" aria-expanded="false"/.test(tip), tip);

done("✅ every card says what made it");
