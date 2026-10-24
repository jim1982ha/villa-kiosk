// One answer per device (review L, owner 2026-10-25: "fix the recommended ones"): the map's badge mark, the device
// window's warning sign and the Cockpit's card say the same thing about a device. 2.496.525 read two predicates — the
// badge the fault RECORDS (faultDevices), the sign the Overview's cards — and they disagreed: an offline sensor with its
// fault was an amber "!" on the map and a grey sign in its window (the fault sat inside its "Unavailable" line); a pump
// with only late maintenance had an amber sign and no mark. Driven by value through the shipped modules, from the same
// villa state: buildAttentionItems → attentionFor (the Overview) → deviceIssues (the badge) / issueSeverity (the sign)
// / cockpitCard (the card's icons).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");
const { buildAttentionItems, attentionFor, deviceIssues, issueSeverity } = await import("@/config/attention");
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
  const items = buildAttentionItems({ devices, entities, entityMap, resolvedRooms: {}, fmData });
  const att = attentionFor({ devices, attentionItems: items }, () => true);
  const issues = deviceIssues(att.attentionGroups);
  const mark = deviceLook(id, storeLookSource(entities, { entityMap, isHidden: () => false,
    isCritical: devices.isCritical, hasFault: (x) => issues.amber.has(x) })).mark;
  const sign = issueSeverity(att.attentionGroups, [id], (x) => x);
  const group = att.attentionGroups.find((g) => g.entityId === id);
  const card = group && cockpitCard(group, { checkMinutes: 5, nightlyAt: "02:00" });
  const cardTone = !card ? null : worstOf([...(card.lead?.severities ?? []), ...card.lines.flatMap((l) => l.icons?.severities ?? [])]);
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
ck("  ...an unlocked door with its alert's fault: red everywhere (the alarm outranks the fault)",
   C.mark === "alarm" && C.markTone === "danger" && C.sign === "danger" && C.cardTone === "danger", C);

const D = seen("light.hall", { state: "unavailable", unavailable: ["light.hall"] });
ck("  ...a lamp offline and nothing else: grey everywhere, no amber",
   D.mark === "lost" && D.sign === "lost" && D.cardTone === "lost", D);

const E = seen("light.ok", { state: "on" });
ck("  ...nothing wrong: no mark, no sign, no card", E.mark === null && E.sign === null && E.cardTone === null, E);

done("✅ one answer per device: the badge, the window's sign and the Cockpit's card agree");
