// A device the villa's system no longer has says so on its Inbox card, whatever else the card holds (owner,
// 2026-10-31: a lock the villa's system dropped at night, its hub no longer sharing it, showed only its old alert —
// "#…-P1 (new)", VESTA's Status lines, "Ticket opened in the Cockpit" — while its window on the map said MISSING; "the
// same way the LED strip is seen unavailable"). The card's line held the device's "Missing" with the alert folded onto
// it (one problem, one line), and the alert's card named the line by VESTA's title alone, so the word went.
//
// Driven by value through the production path: the villa's devices (villaDevices, over a states fixture), the items
// (buildAttentionItems), the cards (groupAttention → cockpitCard), the Inbox's alert card drawn (AlertIssueCard), and
// the counts (attentionFor's health). Placeholder ids.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { h, draw } from "../consistency/screen.mjs";
const { villaDevices } = await import("@/config/deviceGroups");
const { buildAttentionItems, attentionFor } = await import("@/config/attention");
const { cockpitCard } = await import("@/config/cockpitCard");
const { NOT_IN_HA } = await import("@/utils/stateColors");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { AlertIssueCard } = await import("@/components/cockpit/IssueCard");
const { messageOfLine } = await import("@/messages/messagesModel");
const { parseVestaMessage } = await import("@/messages/announcements");

const ent = (id, state) => ({ entity_id: id, state, attributes: { friendly_name: id } });
const LOCK = "lock.placeholder_door", STRIP = "light.placeholder_strip", LAMP = "light.placeholder_lamp";
// the 3D model names all three; the villa's system has the strip (unavailable) and the lamp, not the lock any more
const mapped = new Set([LOCK, STRIP, LAMP]);
const live = { [STRIP]: ent(STRIP, "unavailable"), [LAMP]: ent(LAMP, "on") };
const alertTicket = { id: "t-1", title: "Door unlocked while vacant", status: "open", openedAt: "2026-10-30T22:00:00Z",
  photoIds: [], updates: [], entityId: LOCK, alertNumber: 7 };
const alert = parseVestaMessage({ seq: 1, key: "incident:7", title: "#7-P1 (new)", to: "Owner",
  body: "The door was unlocked while the villa was vacant.", status: ["⚠️ New alert"], buttons: [] });

function cockpit(entities, tickets = []) {
  const devices = villaDevices({ entityMap: {}, deviceGroups: [], dismissed: new Set(), hidden: new Set(),
    mappedEntityIds: mapped, entities, entityDeviceIds: {} });
  const problems = { devices, attentionItems: buildAttentionItems({ devices, entities, entityMap: {}, resolvedRooms: {},
    fmData: { ...EMPTY_FM_DATA, tickets } }) };
  const view = attentionFor(problems, () => true);
  return { view, cards: view.attentionGroups.map((g) => cockpitCard(g, null)) };
}
const cardOf = (cards, id) => cards.find((c) => c.entityId === id);
const words = (card) => card?.lines.map((l) => l.text) ?? [];

console.log("  a device the villa's system no longer has:");
{
  const { cards, view } = cockpit(live);
  ck(`its card carries the "${NOT_IN_HA}" line`, words(cardOf(cards, LOCK)).join("|") === NOT_IN_HA, words(cardOf(cards, LOCK)));
  ck("  ...beside the strip's \"Unavailable\", unchanged", words(cardOf(cards, STRIP)).join("|") === "Unavailable",
     words(cardOf(cards, STRIP)));
  ck("  ...and the counts count it: two things need attention", view.health.summary === "2 things need attention.",
     view.health.summary);
}
{
  const { cards } = cockpit(live, [alertTicket]);
  const card = cardOf(cards, LOCK);
  ck("  ...its alert rides on that line (one problem, one line), which still says it", card?.lines.length === 1
     && card.lines[0].text.startsWith(`${NOT_IN_HA}, `), words(card));
  const drawn = draw(h(AlertIssueCard, { card, messages: (l) => messageOfLine(l, [alert]), onOpenEntity() {},
    canManage: false, onEditTicket() {}, onRaiseTicket() {} }));
  ck(`  ...and the Inbox's alert card says "${NOT_IN_HA}" before VESTA's title, VESTA's message under it`,
     drawn.includes(`${NOT_IN_HA}, #7-P1 (new)`) && drawn.includes("The door was unlocked while the villa was vacant."), drawn);
  const strip = cockpit(live, [{ ...alertTicket, id: "t-2", entityId: STRIP, alertNumber: 8, title: "Strip offline" }]).cards;
  const alert8 = { ...alert, key: "incident:8", title: "#8-P2 (new)" };
  const stripDrawn = draw(h(AlertIssueCard, { card: cardOf(strip, STRIP), messages: (l) => messageOfLine(l, [alert8]),
    onOpenEntity() {}, canManage: false, onEditTicket() {}, onRaiseTicket() {} }));
  ck("  ...an unavailable device's alert card unchanged: its alert says it is offline, no second word",
     stripDrawn.includes("#8-P2 (new)") && !stripDrawn.includes("Unavailable, #8"), stripDrawn);
}
console.log("  before the villa's system has sent its states:");
{
  const { cards, view } = cockpit({});
  ck("no device is Missing or Unavailable, and nothing is counted", cards.length === 0 && view.health.level === "ok",
     cards.map((c) => `${c.title}: ${words(c)}`));
}

done("✅ a device the villa's system no longer has says so on its card, like an unavailable one");
