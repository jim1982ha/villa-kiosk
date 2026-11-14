// What "offline" means, and which offline device is red (owner, 2026-10-18 — architecture review, offline devices).
//
// #4: the Cockpit listed every "unknown" device as Unavailable — a wind chill on a warm day, a light switch's gesture
// sensor between gestures — while the VESTA Agent calls only "unavailable" lost (since 2026-10-04). One meaning now:
// lost contact = "unavailable", or an entity the villa's system does not have.
// #2: every offline device was red. ONE list of critical devices — the villa's "critical devices offline" rule's,
// read by the proxy (GET /critical-devices) — makes an offline device red; any other is amber, and the villa's
// health is danger only for an alarm or a critical device offline.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { isOffline, isUnavailable } = await import("@/utils/deviceHealth");
const { villaDevices, deviceFolding } = await import("@/config/deviceGroups");
const { attentionOf, groupAttention, villaHealthFrom, attentionTone } = await import("@/config/attention");
const { cockpitCard } = await import("@/config/cockpitCard");
// a problem's icons as its card draws them (cockpitCard: the card's lead icons are its first problem's)
const lineSources = (item) => cockpitCard(groupAttention([item])[0], null).lead;
const { parseCriticalDevices } = await import("@/ha/criticalDevices");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

const e = (id, state) => ({ entity_id: id, state, attributes: { friendly_name: id } });

console.log("  one meaning of offline:");
ck("unavailable is offline", isOffline(e("sensor.x", "unavailable")) === true);
ck("unknown is NOT offline (a sensor with no value to give)", isOffline(e("sensor.x", "unknown")) === false);
ck("an entity the villa's system does not have is offline", isOffline(undefined) === true);
ck("  ...and a value still cannot be shown for unknown (isUnavailable keeps that question)",
   isUnavailable(e("sensor.x", "unknown")) === true);

const entities = {
  "sensor.windchill": e("sensor.windchill", "unknown"),
  "sensor.th_humidity": e("sensor.th_humidity", "unavailable"),
  "lock.door": e("lock.door", "unavailable"),
  "sensor.door_battery": e("sensor.door_battery", "unavailable"),
};
const ids = Object.keys(entities);
const entityMap = Object.fromEntries(ids.map((id) => [id, { entityId: id, type: id.split(".")[0], label: id }]));
const folding = deviceFolding(entityMap, [], { "lock.door": "dev-door", "sensor.door_battery": "dev-door" });
const d = villaDevices({ entityMap, deviceGroups: [], hidden: new Set(), suppressed: new Set(), batteries: new Set(), dismissed: new Set(), mappedEntityIds: new Set(ids),
  entities, entityDeviceIds: { "lock.door": "dev-door", "sensor.door_battery": "dev-door" }, deviceUnits: {}, folding });
ck("the Cockpit's offline list leaves out the unknown sensor and keeps the lost ones",
   !d.unavailable.includes("sensor.windchill") && d.unavailable.includes("sensor.th_humidity") && d.unavailable.includes("lock.door"),
   d.unavailable);

console.log("  one list of critical devices:");
// the villa's devices with the rule's critical list — the device list answers which are critical (villaDevices.isCritical)
const build = (critical) => attentionOf({ devices: villaDevices({ entityMap, deviceGroups: [], hidden: new Set(), suppressed: new Set(), batteries: new Set(), dismissed: new Set(),
  mappedEntityIds: new Set(ids), entities, entityDeviceIds: { "lock.door": "dev-door", "sensor.door_battery": "dev-door" }, deviceUnits: {}, folding, critical }),
  entities, entityMap, resolvedRooms: {}, fmData: EMPTY_FM_DATA }).attentionItems;
// the rule names the lock's BATTERY sensor; the model shows the lock: the device is critical
const items = build(new Set(["sensor.door_battery"]));
const door = items.find((i) => i.entityId === "lock.door" || i.entityId === "sensor.door_battery");
const th = items.find((i) => i.entityId === "sensor.th_humidity");
ck("a device on the rule's list offline is critical, whichever of its entities the rule names", door?.critical === true, items);
ck("  ...one not on it is not", th?.critical === false, th);
ck("  ...red for the critical one, grey for the other (their icons' severity — owner, 2026-10-22: it was amber)",
   attentionTone(door) === "critical" && lineSources(th).severities[0] === "lost" && lineSources(door).severities[0] === "danger");
// ONE severity rule on every surface (architecture review, 2026-10-19): the Cockpit button already read it while the
// card's icon still painted every fault red — a fault is a warning (owner, 2026-10-18)
{
  const { attentionSeverity } = await import("@/config/attention");
  const fault = { kind: "fault", entityId: "sensor.x", title: "Pump offline", detail: "", source: "night" };
  const alarm = { kind: "alarm", entityId: "sensor.x", title: "Leak", detail: "" };
  const late = { kind: "schedule", title: "Pool filter", detail: "" };
  ck("a fault is a warning (amber), an alarm and a critical device offline danger (red), any other device offline grey, a late task a warning",
     attentionSeverity(fault) === "warn" && attentionSeverity(alarm) === "danger" && attentionSeverity(door) === "danger"
     && attentionSeverity(th) === "lost" && attentionSeverity(late) === "warn");
  const health = (i) => villaHealthFrom(groupAttention([i])).level;
  ck("  ...and the villa's health agrees, item by item: a fault alone is warn, an alarm alone danger",
     health(fault) === "warn" && health(alarm) === "danger" && health(door) === "danger" && health(th) === "warn", [health(fault), health(alarm)]);
}
ck("the villa's health: danger with a critical device offline",
   villaHealthFrom(groupAttention(items)).level === "danger");
ck("  ...a warning when only devices off the list are offline",
   villaHealthFrom(groupAttention(build(new Set()))).level === "warn");
ck("  ...and nothing is critical before the list is read (no guess)",
   build(undefined).every((i) => !i.critical));

console.log("  a critical device that lost contact is red everywhere, not only on the Cockpit (owner, 2026-10-19):");
// ⚠️ RED ON THE COCKPIT, AMBER EVERYWHERE ELSE (to 2.496.427): the map badge, its room chip, its list row and its window
// all showed the amber of any lost device. One fact (DeviceLook.critical), from the villa model's folded predicate.
{
  const { deviceLook, storeLookSource, mapLookSource } = await import("@/utils/deviceActivity");
  const { roomLook } = await import("@/babylon/summaryLook");
  const { panelHeader } = await import("@/components/panels/panelHeader");
  const { lockPill, readingOf, controlPill } = await import("@/config/reading");
  const { STATUS_PILL_CLASS, statusRule } = await import("@/utils/stateColors");
  const RED = statusRule({ critical: true, hidden: false }), PLAIN = statusRule({ critical: false, hidden: false });
  const { markSurface, categorySurface } = await import("@/config/EntityCategories");
  const crit = villaDevices({ entityMap, deviceGroups: [], hidden: new Set(), suppressed: new Set(), batteries: new Set(), dismissed: new Set(), mappedEntityIds: new Set(ids),
    entities, entityDeviceIds: { "lock.door": "dev-door", "sensor.door_battery": "dev-door" }, deviceUnits: {}, folding,
    critical: new Set(["sensor.door_battery"]) });
  const config = { entityMap, isCritical: crit.isCritical, isHidden: () => false, hasFault: () => false, partsOf: () => [] };
  const store = storeLookSource(entities, config);
  const map = mapLookSource(new Map(Object.entries(entities)), new Map(), () => config);
  const door = deviceLook("lock.door", store), th = deviceLook("sensor.th_humidity", store);
  // owner, 2026-10-22 (badge proposal 2): the problem is the corner mark — red "?" critical, grey "?" any other
  ck("the badge: a faded face and a RED \"?\" for the critical lost device",
     door.critical && door.face === "unavailable" && door.mark === "critical", door);
  ck("  ...an ordinary lost device: the grey \"?\"", !th.critical && th.mark === "lost", th);
  ck("  ...the map's source paints it the same", JSON.stringify(deviceLook("lock.door", map)) === JSON.stringify(door));
  ck("  ...drawn as the danger red's \"?\" over the faded face (no new picture to fetch: the same baked squircle)",
     markSurface(door.mark).fill === markSurface("alarm").fill && markSurface(door.mark).symbol === "?"
     && categorySurface("access_control", door.face).faded === true);
  ck("the room chip: its number red for a critical lost device, grey for an ordinary one",
     roomLook([door]).health === "alert" && roomLook([th]).health === "unavailable" && roomLook([door, th]).health === "alert");
  // the list rows read deviceLook over this same store (SummaryGroupPanel, pinned in device_look_source.mjs)
  const win = (id) => panelHeader({ panel: { entityId: id, mapping: entityMap[id] }, entities, config, canControl: false, linkedSwitch: null });
  // the window's lost notice paints its device's rule applied to lost contact (UnavailableNotice)
  const lostTone = (id) => STATUS_PILL_CLASS[win(id).badge.statusRule("unavailable")];
  ck("the window: its lost notice is the danger red for the critical device, grey for the other",
     lostTone("lock.door") === "danger" && lostTone("sensor.th_humidity") === "unavailable");
  // ⚠️ ONE RULE (architecture review item 6, 2026-11-13): a critical device's lost part kept the grey in the window
  // where its lock was red; every pill now takes the window's one fact, the critical list
  const lostReading = (rule) => readingOf("sensor.door_battery", e("sensor.door_battery", "unavailable"), "sensor", rule).pill;
  const lostBinary = (rule) => readingOf("binary_sensor.door_contact", e("binary_sensor.door_contact", "unavailable"), "binary_sensor", rule).pill;
  ck("  ...and a reading of it that lost contact, a number or an on/off one, red on the list and grey off it",
     lostReading(RED) === "danger" && lostBinary(RED) === "danger" && lostReading(PLAIN) === "unavailable" && lostBinary(PLAIN) === "unavailable");
  ck("  ...only lost contact and \"needs a look\": a critical device's other tones are its own",
     controlPill("switch.pump", e("switch.pump", "on"), "on", RED).tone === "active"
     && readingOf("sensor.door_battery", e("sensor.door_battery", "80"), "sensor", RED).pill === null);
  const back = deviceLook("lock.door", storeLookSource({ ...entities, "lock.door": e("lock.door", "locked") }, config));
  ck("a critical device that answers is not red (critical needs lost contact)", !back.critical && back.mark !== "critical", back);
  ck("  ...the window has that one fact, no second one for \"critical and lost\"",
     !("critical" in win("lock.door").badge));
  // owner, 2026-11-13: "a critical door unlocked" is red, an ordinary one amber; lost, red too (stateColors.criticalStatus)
  ck("a critical lock's window: unlocked red, lost red; an ordinary one's unlocked amber; locked green for both (owner, 2026-11-14)",
     lockPill("lock.door", "unlocked", win("lock.door").badge.statusRule).tone === "danger"
     && lockPill("sensor.th_humidity", "unlocked", win("sensor.th_humidity").badge.statusRule).tone !== "danger"
     && lockPill("lock.door", "unlocked", PLAIN).tone === "warn"
     && lockPill("lock.door", "unavailable", RED).tone === "danger"
     && lockPill("lock.door", "locked", RED).tone === "active" && lockPill("lock.door", "locked", PLAIN).tone === "active");
  ck("nothing is red before the list is read", !deviceLook("lock.door", storeLookSource(entities, { ...config, isCritical: () => false })).critical);
}

console.log("  a critical door UNLOCKED is red on every surface, an ordinary one calm (architecture review item 5, 2026-11-14):");
// ⚠️ ITS WINDOW AND ITS 3D OBJECT WERE RED; ITS BADGE WORE THE PLAIN "IN USE" DOT, ITS ROOM'S NUMBER STAYED QUIET, OPEN
// ISSUES HAD NO LINE AND THE VILLA'S HEALTH WAS NOT DANGER: each surface read "critical" its own way. The device's look
// carries one status, and every surface below projects it.
{
  const { deviceLook, meshLookFor, storeLookSource, lookMarks, marksOf } = await import("@/utils/deviceActivity");
  const { roomLook } = await import("@/babylon/summaryLook");
  const { attentionFor } = await import("@/config/attention");
  const { lookFacts } = await import("@/config/deviceGroups");
  const { lockPill } = await import("@/config/reading");
  const { buildReadiness } = await import("@/fm/readiness");
  const FRONT = "lock.example_front", BACK = "lock.example_back";
  const ents = { [FRONT]: e(FRONT, "unlocked"), [BACK]: e(BACK, "unlocked") };
  const map = { [FRONT]: { entityId: FRONT, type: "lock", label: "Front door" }, [BACK]: { entityId: BACK, type: "lock", label: "Back door" } };
  const fold = deviceFolding(map, [], {});
  const input = { entityMap: map, deviceGroups: [], hidden: new Set(), suppressed: new Set(), batteries: new Set(), dismissed: new Set(),
    mappedEntityIds: new Set([FRONT, BACK]), entities: ents, entityDeviceIds: {}, deviceUnits: {}, folding: fold, critical: new Set([FRONT]) };
  const facts = lookFacts(input, fold);
  const devices = villaDevices({ ...input, facts });
  const src = storeLookSource(ents, { entityMap: map, ...lookMarks(marksOf(facts, new Set())) });
  const front = deviceLook(FRONT, src), back = deviceLook(BACK, src);
  ck("its badge: the red \"!\" of an alarm; the ordinary door's the plain dot of a door in use",
     front.mark === "alarm" && back.mark === "active", { front: front.mark, back: back.mark });
  ck("  ...its room's number red; the ordinary door's room quiet",
     roomLook([front]).health === "alert" && roomLook([back]).health === "ok", [roomLook([front]).health, roomLook([back]).health]);
  ck("  ...its 3D object red, the ordinary one amber, as their windows' pills",
     meshLookFor(FRONT, src).tone === "alert" && meshLookFor(BACK, src).tone === "warn"
     && lockPill(FRONT, "unlocked", front.statusRule).tone === "danger" && lockPill(BACK, "unlocked", back.statusRule).tone === "warn");
  const view = attentionFor({ devices, attentionItems: attentionOf({ devices, entities: ents, entityMap: map, resolvedRooms: {},
    fmData: EMPTY_FM_DATA }).attentionItems }, () => true);
  const cards = view.attentionGroups.map((g) => `${g.title}: ${g.items.map((i) => `${i.kind} ${i.detail}`).join()}`);
  ck("  ...ONE Open issues card, \"Front door\", its line \"Unlocked\" an alarm; none for the ordinary door",
     cards.join(" | ") === "Front door: alarm Unlocked", cards);
  ck("  ...the villa's health danger, as for a leak", view.health.level === "danger", view.health);
  const recap = buildReadiness(ents, EMPTY_FM_DATA, view, map).checks.find((c) => c.id === "locks");
  ck("  ...and the Recap's \"Doors locked\" fails (red), its words unchanged",
     recap?.state === "fail" && recap.detail === "2 unlocked.", recap);
}

console.log("  a critical camera whose motion detection (its linked entity) lost contact (architecture review item 5, 2026-11-14):");
// its window's bar was red; its badge's "?" and its card were grey
{
  const { deviceLook, storeLookSource, lookMarks, marksOf } = await import("@/utils/deviceActivity");
  const { roomLook } = await import("@/babylon/summaryLook");
  const { attentionFor } = await import("@/config/attention");
  const { lookFacts } = await import("@/config/deviceGroups");
  const CAMERA = "camera.example_gate", MOTION = "binary_sensor.example_gate_motion";
  const ents = { [CAMERA]: e(CAMERA, "idle"), [MOTION]: { entity_id: MOTION, state: "unavailable", attributes: { device_class: "motion" } } };
  const map = { [CAMERA]: { entityId: CAMERA, type: "camera", label: "Gate camera", linkedEntityId: MOTION } };
  const registry = { [CAMERA]: "dev-gate", [MOTION]: "dev-gate" };
  const fold = deviceFolding(map, [], registry);
  const view = (critical) => {
    const input = { entityMap: map, deviceGroups: [], hidden: new Set(), suppressed: new Set(), batteries: new Set(), dismissed: new Set(),
      mappedEntityIds: new Set([CAMERA, MOTION]), entities: ents, entityDeviceIds: registry, deviceUnits: {}, folding: fold, critical };
    const facts = lookFacts(input, fold);
    const devices = villaDevices({ ...input, facts });
    const look = deviceLook(CAMERA, storeLookSource(ents, { entityMap: map, ...lookMarks(marksOf(facts, new Set())) }));
    const att = attentionFor({ devices, attentionItems: attentionOf({ devices, entities: ents, entityMap: map, resolvedRooms: {},
      fmData: EMPTY_FM_DATA }).attentionItems }, () => true);
    return { look, room: roomLook([look]).health, card: att.attentionGroups[0] && lineSources(att.attentionGroups[0].items[0]).severities[0],
      health: att.health.level };
  };
  const crit = view(new Set([CAMERA])), plain = view(new Set());
  ck("its badge's pill the RED \"?\", its room's number and its card red, the villa's health danger",
     crit.look.linkPill === "critical" && crit.room === "alert" && crit.card === "danger" && crit.health === "danger", crit);
  ck("  ...an ordinary camera's: the grey \"?\", its room grey, its card grey, a warning",
     plain.look.linkPill === "lost" && plain.room === "unavailable" && plain.card === "lost" && plain.health === "warn", plain);
}

console.log("  a hidden device is quiet in 3D too (architecture review item 6, 2026-11-14):");
// VillaDevices.isHidden: "never red or amber anywhere". Its object read the raw state: a hidden leak sensor pulsed red,
// a hidden lock unlocked glowed amber, while no list, badge or card named it.
{
  const { deviceLook, meshLookFor, storeLookSource } = await import("@/utils/deviceActivity");
  const LEAK = "binary_sensor.example_leak", LOCK = "lock.example_shed", PLUG = "switch.example_plug";
  const ents = { [LEAK]: { entity_id: LEAK, state: "on", attributes: { device_class: "moisture" } }, [LOCK]: e(LOCK, "unlocked"),
    [PLUG]: e(PLUG, "on") };
  const map = { [LEAK]: { entityId: LEAK, type: "binary_sensor" }, [LOCK]: { entityId: LOCK, type: "lock" }, [PLUG]: { entityId: PLUG, type: "switch" } };
  const cfg = (hidden) => ({ entityMap: map, isCritical: () => true, isHidden: () => hidden, hasFault: () => false, partsOf: () => [] });
  const shown = storeLookSource(ents, cfg(false)), hid = storeLookSource(ents, cfg(true));
  ck("shown: the leak pulses red, the critical lock unlocked is red, the plug glows",
     meshLookFor(LEAK, shown).on && meshLookFor(LEAK, shown).tone === "alert" && meshLookFor(LOCK, shown).tone === "alert"
     && meshLookFor(PLUG, shown).on);
  ck("hidden: no pulse, no glow, the lock its rest tint; its look never red or amber",
     !meshLookFor(LEAK, hid).on && meshLookFor(LOCK, hid).tone === "usual" && !meshLookFor(PLUG, hid).on
     && [LEAK, LOCK, PLUG].every((id) => !["alert", "warn"].includes(deviceLook(id, hid).status) && deviceLook(id, hid).mark === null),
     [LEAK, LOCK, PLUG].map((id) => [meshLookFor(id, hid), deviceLook(id, hid).status]));
}

console.log("  the proxy's answer:");
ck("its entity ids are read", JSON.stringify(parseCriticalDevices({ entities: ["lock.door", 3], rules: [], at: "x" })) === '["lock.door"]');
ck("  ...an answer that is not one is null, never an empty list taken as 'none critical'",
   parseCriticalDevices({ error: "x" }) === null && parseCriticalDevices(null) === null);
done("✅ offline means lost contact; red is the rule's list of critical devices");
