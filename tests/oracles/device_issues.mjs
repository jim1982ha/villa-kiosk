// One answer per device (review L, owner 2026-10-25: "fix the recommended ones"): the map's badge mark, the device
// window's warning sign and the Cockpit's card say the same thing about a device. 2.496.525 read two predicates — the
// badge the fault RECORDS (faultDevices), the sign the Overview's cards — and they disagreed: an offline sensor with its
// fault was an amber "!" on the map and a grey sign in its window (the fault sat inside its "Unavailable" line); a pump
// with only late maintenance had an amber sign and no mark. Driven by value through the shipped modules, from the same
// villa state: attentionOf → attentionFor (the Overview) → deviceIssues (the badge) / issueSeverity (the sign)
// / cockpitCard (the card's icons).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");
const { attentionOf, attentionFor, deviceIssues, issueSeverity, faultsFor } = await import("@/config/attention");
const { cockpitCard } = await import("@/config/cockpitCard");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { devicesOf } = await import("../consistency/devices.mjs");

const ent = (id, state) => ({ entity_id: id, state, attributes: {}, last_changed: "2026-10-25T08:00:00Z", last_updated: "" });
const old = new Date(Date.now() - 400 * 864e5).toISOString();
const ticket = (id, entityId, title) => ({ id, title, status: "open", openedAt: old, entityId, photoIds: [] });
const RANK = { danger: 0, warn: 1, lost: 2 };
const worstOf = (list) => list.reduce((w, s) => (w === null || RANK[s] < RANK[w] ? s : w), null);
// the colour a mark is drawn in, as the map draws it: red act now, amber check soon, grey no contact
const MARK_TONE = { critical: "danger", alarm: "danger", fault: "warn", lost: "lost" };

function seen(id, { state, unavailable = [], tickets = [], schedules = [] }) {
  const entities = { [id]: ent(id, state) };
  const entityMap = { [id]: { entityId: id, type: id.split(".")[0] } };
  const devices = devicesOf({ ids: [id], unavailable });
  const fmData = { ...EMPTY_FM_DATA, tickets, schedules };
  const items = attentionOf({ devices, entities, entityMap, resolvedRooms: {}, fmData }).attentionItems;
  const att = attentionFor({ devices, attentionItems: items }, () => true);
  const issues = deviceIssues(att.attentionGroups);
  const mark = deviceLook(id, storeLookSource(entities, { entityMap, isHidden: () => false,
    isCritical: devices.isCritical, hasFault: (x) => issues.amber.has(x) })).mark;
  const sign = issueSeverity(att.attentionGroups, [id], (x) => x);
  const group = att.attentionGroups.find((g) => g.entityId === id);
  const card = group && cockpitCard(group, { checkMinutes: 5, nightlyAt: "02:00" });
  const cardTone = !card ? null : worstOf([...(card.lead?.severities ?? []), ...card.lines.flatMap((l) => l.own?.severities ?? [])]);
  return { mark, markTone: MARK_TONE[mark] ?? null, sign, cardTone };
}

const A = seen("sensor.cellar_temp", { state: "unavailable", unavailable: ["sensor.cellar_temp"],
  tickets: [ticket("t1", "sensor.cellar_temp", "Cellar temp has been offline for 9 h")] });
ck("an offline sensor with its fault: amber on the map, amber sign, amber on its card — one answer",
   A.mark === "fault" && A.markTone === "warn" && A.sign === "warn" && A.cardTone === "warn", A);

const B = seen("switch.pool_pump", { state: "on",
  schedules: [{ id: "s1", title: "Clean pool pump filter", everyDays: 30, entityId: "switch.pool_pump", enabled: true, createdAt: old }] });
ck("  ...a pump with only late maintenance: its badge carries the amber \"!\" too, as its sign and card",
   B.mark === "fault" && B.sign === "warn" && B.cardTone === "warn", B);

const C = seen("lock.front", { state: "unlocked", tickets: [ticket("t2", "lock.front", "Front door unlocked")] });
// owner, 2026-10-26: an unlocked door is in use, not an alarm — its alert is the one problem, amber everywhere
ck("  ...an unlocked door with its alert's fault: amber everywhere (in use is no alarm; the alert is the fault)",
   C.mark === "fault" && C.markTone === "warn" && C.sign === "warn" && C.cardTone === "warn", C);
const J = seen("lock.front", { state: "jammed", tickets: [ticket("t3", "lock.front", "Front door jammed")] });
ck("  ...a jammed lock with its fault: red everywhere (the alarm outranks the fault)",
   J.mark === "alarm" && J.markTone === "danger" && J.sign === "danger" && J.cardTone === "danger", J);

const D = seen("light.hall", { state: "unavailable", unavailable: ["light.hall"] });
ck("  ...a lamp offline and nothing else: grey everywhere, no amber",
   D.mark === "lost" && D.sign === "lost" && D.cardTone === "lost", D);

const E = seen("light.ok", { state: "on" });
ck("  ...nothing wrong: no mark, no sign, no card", E.mark === null && E.sign === null && E.cardTone === null, E);

{
  // architecture review item 5 (2026-11-13): a hidden device takes no card, badge or sign with it, and its findings
  // stay. Until then "hidden means hidden everywhere" (owner, 2026-10-25) dropped its fault and its late task too, so
  // a VESTA finding about a hidden, offline device, which exists BECAUSE it is hidden, was never seen.
  const id = "lock.old", entities = { [id]: ent(id, "locked") }, entityMap = { [id]: { entityId: id, type: "lock" } };
  const devices = devicesOf({ ids: [], hidden: new Set([id]) });
  const fmData = { ...EMPTY_FM_DATA, tickets: [ticket("t9", id, "Old lock battery low")],
    schedules: [{ id: "s1", title: "Service the old lock", entityId: id, everyDays: 30, enabled: true, createdAt: old }] };
  const problems = { devices, attentionItems: attentionOf({ devices, entities, entityMap, resolvedRooms: { [id]: "Cellar" }, fmData }).attentionItems };
  const att = attentionFor(problems, () => true);
  const cards = att.attentionGroups.map((g) => ({ title: g.title, room: g.room, opens: g.entityId ?? null }));
  ck("a hidden device: its fault and its late task are still Cockpit cards, each on its own, under \"Other\", opening nothing",
     JSON.stringify(cards.map((c) => c.title).sort()) === JSON.stringify(["Old lock battery low", "Service the old lock"])
       && cards.every((c) => c.room === "Other" && c.opens === null), cards);
  ck("  ...counted as any problem, and still no badge mark and no window sign: the hidden device itself has none",
     att.health.level === "warn" && !deviceIssues(att.attentionGroups).amber.has(id)
       && issueSeverity(att.attentionGroups, [id], (x) => x) === null, { health: att.health, amber: [...deviceIssues(att.attentionGroups).amber] });
  ck("  ...and never listed: the profile's device list and its pickers leave it out (shows), its problems do not (raises)",
     !att.shows(id) && att.raises(id) && !att.devices.ids.includes(id));
  ck("  ...a profile that may not open it is told nothing of it",
     attentionFor(problems, (x) => x !== id).attentionGroups.length === 0);
}

console.log("\n  every window as its profile sees the villa (architecture review N, card 5)");
{
  const id = "sensor.cellar_temp";
  const entities = { [id]: ent(id, "on") };
  const entityMap = { [id]: { entityId: id, type: "sensor" } };
  const devices = devicesOf({ ids: [id], unavailable: [] });
  const fmData = { ...EMPTY_FM_DATA, tickets: [ticket("t9", id, "Cellar temp reads wrong")] };
  const problems = { devices, attentionItems: attentionOf({ devices, entities, entityMap, resolvedRooms: {}, fmData }).attentionItems };
  const guest = (x) => x !== id, owner = () => true;
  const sign = (may) => issueSeverity(attentionFor(problems, may).attentionGroups, [id], (x) => x);
  ck("a profile that may see the device: its window's badge carries the \"!\" and its sign is amber",
     faultsFor(problems, owner).has(id) && sign(owner) === "warn");
  ck("  ...one that may not: no \"!\" in its windows, as no sign and no card in its Cockpit (they disagreed)",
     !faultsFor(problems, guest).has(id) && sign(guest) === null);
  ck("  ...the map, the same for everyone, still carries it",
     deviceIssues(attentionFor(problems, owner).attentionGroups).amber.has(id));
}

console.log("\n  a camera and its motion sensor (owner, 2026-11-07, visit #148-P1: two amber \"!\" on a camera with nothing wrong)");
{
  // the camera's detection is its linked entity, folded onto the camera's device; the fault names the detection
  const cam = "camera.cam_a", motion = "binary_sensor.cam_a_motion";
  const entities = { [cam]: ent(cam, "idle"), [motion]: ent(motion, "on") };
  const entityMap = { [cam]: { entityId: cam, type: "camera", linkedEntityId: motion } };
  const devices = devicesOf({ ids: [cam], folding: new Map([[motion, cam]]) });
  const look = (t) => {
    const fmData = { ...EMPTY_FM_DATA, tickets: [t] };
    const att = attentionFor({ devices, attentionItems: attentionOf({ devices, entities, entityMap, resolvedRooms: {}, fmData }).attentionItems }, () => true);
    const amber = deviceIssues(att.attentionGroups).amber;
    const l = deviceLook(cam, storeLookSource(entities, { entityMap, isHidden: () => false, isCritical: () => false, hasFault: (x) => amber.has(x) }));
    return { mark: l.mark, linkPill: l.linkPill, cards: att.attentionGroups.length };
  };
  const fault = { ...ticket("t1", motion, "Camera A detection stuck"), source: "vesta_agent", origin: "alert", alertNumber: 91 };
  const F = look(fault);
  ck("a device fault on the camera's detection: ONE amber \"!\" (top-right); the other corner says the detection is on",
     F.mark === "fault" && F.linkPill === "on", F);
  const V = look({ ...fault, title: "Activity while the villa is empty", monitoredUntil: "2026-11-07T06:40:00Z" });
  ck("  ...an open visit naming the detection: no \"!\" at all, the detection's plain on pill; its card still listed",
     V.mark !== "fault" && V.linkPill === "on" && V.cards === 1, V);
}

done("✅ one answer per device: the badge, the window's sign and the Cockpit's card agree");
