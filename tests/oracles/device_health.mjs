// A DEVICE THAT WORKS WITH A DEAD PART (architecture review item 4, 2026-11-13). A camera streamed while its person
// detection had been unavailable for days, and no card, badge or sign said so: the offline list asked only the entity
// standing for each device. utils/deviceHealth answers over ALL of a device's parts: alive, partly lost (which parts),
// or lost. Driven by value through the shipped modules, from one villa: the fold (deviceGroups.deviceFolding) → the
// villa's devices (villaDevices) → the Cockpit's cards (attentionOf → attentionFor → cockpitCard), the window's sign
// (issueSeverity), the badge (deviceLook) and its room (roomLook).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceFolding, villaDevices, lookFacts } = await import("@/config/deviceGroups");
const { attentionOf, attentionFor, issueSeverity } = await import("@/config/attention");
const { cockpitCard, cardTop } = await import("@/config/cockpitCard");
const { deviceLook, storeLookSource, lookMarks, marksOf } = await import("@/utils/deviceActivity");
const { roomLook } = await import("@/babylon/summaryLook");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

const SINCE = "2026-11-10T10:02:00.000Z";
const ent = (id, state, name, at = "2026-11-13T08:00:00.000Z") =>
  ({ entity_id: id, state, attributes: { friendly_name: name }, last_changed: at, last_updated: at });
const CAM = "camera.shed", PERSON = "binary_sensor.shed_person", SIGNAL = "sensor.shed_signal",
  PRIVACY = "switch.shed_privacy", RESTART = "button.shed_restart", PET = "binary_sensor.shed_pet";
// one camera in the villa's system: its stream (placed on the map), a person detection, a signal strength filed as
// diagnostic, a privacy switch a person hid, a restart button filed as configuration, and a pet detection switched off
// there (in the registry, no state at all)
const registry = Object.fromEntries([CAM, PERSON, SIGNAL, PRIVACY, RESTART, PET].map((id) => [id, "dev-shed"]));
const entityMap = { [CAM]: { entityId: CAM, type: "camera", label: "Shed camera" } };
const suppressed = new Set([SIGNAL, PRIVACY, RESTART]), hidden = new Set([PRIVACY]);
const folding = deviceFolding(entityMap, [], registry);

function villa(states, fmData = EMPTY_FM_DATA) {
  const entities = Object.fromEntries(states.map((e) => [e.entity_id, e]));
  const input = { entityMap, deviceGroups: [], dismissed: new Set(), hidden, suppressed, mappedEntityIds: new Set([CAM]),
    entities, entityDeviceIds: registry, deviceUnits: {}, folding };
  const facts = lookFacts(input, folding);
  const devices = villaDevices({ ...input, facts });
  const view = attentionFor({ devices, attentionItems: attentionOf({ devices, entities, entityMap,
    resolvedRooms: { [CAM]: "Shed" }, fmData }).attentionItems }, () => true);
  const look = deviceLook(CAM, storeLookSource(entities, { entityMap, ...lookMarks(marksOf(facts, new Set())) }));
  const card = view.attentionGroups[0] ? cardTop(cockpitCard(view.attentionGroups[0], null)) : null;
  return { devices, view, look, card, sign: issueSeverity(view.attentionGroups, [CAM], devices.deviceOf) };
}

const dead = villa([ent(CAM, "idle", "Shed camera"), ent(PERSON, "unavailable", "Shed camera Person detection", SINCE),
  ent(SIGNAL, "unavailable", "Shed camera Signal"), ent(PRIVACY, "unavailable", "Shed camera Privacy"),
  ent(RESTART, "unavailable", "Shed camera Restart")]);
console.log("  a camera streaming, its person detection unavailable since 10/11 10:02:");
ck("its health is partly lost, the person detection only: never a diagnostic, configuration, hidden or switched-off part",
   JSON.stringify(dead.devices.healthOf(CAM)) === JSON.stringify({ kind: "partly", lost: [PERSON] }), dead.devices.healthOf(CAM));
ck("  ...the device itself still reads alive: not on the offline list, its badge's face not faded",
   !dead.devices.unavailable.includes(CAM) && dead.devices.partlyLost.join() === CAM
     && !dead.look.unavailable && dead.look.face !== "unavailable", { look: dead.look.face, unavailable: dead.devices.unavailable });
ck("  ...ONE Cockpit card, the camera's, in its room, saying \"Person detection unavailable\" in the grey of lost contact, since 10/11 10:02",
   dead.view.attentionGroups.length === 1 && dead.view.attentionGroups[0].title === "Shed camera"
     && dead.view.attentionGroups[0].room === "Shed" && dead.view.attentionGroups[0].entityId === CAM
     && dead.card.status.map((s) => `${s.text}|${s.tone}`).join() === "Person detection unavailable|tone-quiet"
     && dead.view.attentionGroups[0].items[0].openedAt === SINCE,
   { groups: dead.view.attentionGroups.map((g) => [g.title, g.room, g.entityId]), card: dead.card });
ck("  ...its window's warning sign grey, its badge's corner the grey \"?\", its room's number grey",
   dead.sign === "lost" && dead.look.mark === "lost" && dead.look.partLost && roomLook([dead.look]).health === "unavailable",
   { sign: dead.sign, mark: dead.look.mark, room: roomLook([dead.look]).health });
ck("  ...counted as a thing that needs attention, never the villa's danger: the device answers",
   dead.view.health.level === "warn");

const told = villa([ent(CAM, "idle", "Shed camera"), ent(PERSON, "unavailable", "Shed camera Person detection", SINCE)],
  { ...EMPTY_FM_DATA, tickets: [{ id: "t1", title: "Shed camera Person detection offline for 3 days", status: "open",
    openedAt: SINCE, entityId: PERSON, photoIds: [], updates: [] }] });
ck("  ...a fault about that part is the same problem: one card, one line, the fault inside it",
   told.view.attentionGroups.length === 1 && told.view.attentionGroups[0].items.length === 1
     && told.view.attentionGroups[0].items[0].fault?.ticketId === "t1", told.view.attentionGroups.map((g) => g.items.map((i) => i.id)));

const back = villa([ent(CAM, "idle", "Shed camera"), ent(PERSON, "off", "Shed camera Person detection"),
  ent(SIGNAL, "unavailable", "Shed camera Signal"), ent(RESTART, "unavailable", "Shed camera Restart")]);
ck("the person detection back: alive, no card, no sign, no mark (the diagnostic signal still unavailable makes no noise)",
   back.devices.healthOf(CAM).kind === "alive" && back.view.attentionGroups.length === 0 && back.sign === null && back.look.mark === null,
   { health: back.devices.healthOf(CAM), groups: back.view.attentionGroups.length, mark: back.look.mark });
const quiet = villa([ent(CAM, "idle", "Shed camera"), ent(PERSON, "unknown", "Shed camera Person detection")]);
ck("  ...a part with no value to give (\"unknown\") answers: alive", quiet.devices.healthOf(CAM).kind === "alive" && quiet.look.mark === null);
const gone = villa([ent(CAM, "unavailable", "Shed camera"), ent(PERSON, "unavailable", "Shed camera Person detection")]);
ck("the camera itself unavailable: lost, its one \"Unavailable\" line, no second line for its parts",
   gone.devices.healthOf(CAM).kind === "lost" && gone.devices.unavailable.join() === CAM && gone.devices.partlyLost.length === 0
     && gone.view.attentionGroups.length === 1 && gone.card.status.map((s) => s.text).join() === "Unavailable",
   { health: gone.devices.healthOf(CAM), card: gone.card });

done("✅ one health per device: a dead part of a live device is its card, its grey sign and its grey \"?\"");
