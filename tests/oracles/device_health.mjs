// A DEVICE THAT WORKS WITH A DEAD PART (architecture review item 4, 2026-11-13). A camera streamed while its person
// detection had been unavailable for days, and no card, badge or sign said so: the offline list asked only the entity
// standing for each device. utils/deviceHealth answers over ALL of a device's parts: alive, partly lost (which parts),
// or lost. Driven by value through the shipped modules, from one villa: the fold (deviceGroups.deviceFolding) → the
// villa's devices (villaDevices) → the Cockpit's cards (attentionOf → attentionFor → cockpitCard), the window's sign
// (issueSeverity), the badge (deviceLook) and its room (roomLook).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceFolding, villaDevices, lookFacts, deviceReadings } = await import("@/config/deviceGroups");
const { buildReadiness } = await import("@/fm/readiness");
const { attentionOf, attentionFor, issueSeverity } = await import("@/config/attention");
const { cockpitCard, cardTop } = await import("@/config/cockpitCard");
const { deviceLook, storeLookSource, lookMarks, marksOf } = await import("@/utils/deviceActivity");
const { roomLook } = await import("@/babylon/summaryLook");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { buildMonthlyRecap } = await import("@/fm/fmDocuments");
const { UnavailableByDesign } = await import("@/ha/unavailableByDesign");

const SINCE = "2026-11-10T10:02:00.000Z";
const ent = (id, state, name, at = "2026-11-13T08:00:00.000Z") =>
  ({ entity_id: id, state, attributes: { friendly_name: name }, last_changed: at, last_updated: at });
const CAM = "camera.shed", PERSON = "binary_sensor.shed_person", SIGNAL = "sensor.shed_signal",
  PRIVACY = "switch.shed_privacy", RESTART = "button.shed_restart", PET = "binary_sensor.shed_pet", BATTERY = "sensor.shed_battery", PRESET = "select.shed_move_to_preset";
// one camera in the villa's system: its stream (placed on the map), a person detection, a signal strength filed as
// diagnostic, a privacy switch a person hid, a restart button filed as configuration, and a pet detection switched off
// there (in the registry, no state at all)
// and a battery, filed as diagnostic too (most integrations do): a level to act on
const registry = Object.fromEntries([CAM, PERSON, SIGNAL, PRIVACY, RESTART, PET, BATTERY, PRESET].map((id) => [id, "dev-shed"]));
const entityMap = { [CAM]: { entityId: CAM, type: "camera", label: "Shed camera" } };
const suppressed = new Set([SIGNAL, PRIVACY, RESTART, BATTERY]), hidden = new Set([PRIVACY]);
const folding = deviceFolding(entityMap, [], registry);

function villa(states, fmData = EMPTY_FM_DATA, may = () => true) {
  const entities = Object.fromEntries(states.map((e) => [e.entity_id, e]));
  const input = { entityMap, deviceGroups: [], dismissed: new Set(), hidden, suppressed, batteries: new Set([BATTERY]), mappedEntityIds: new Set([CAM]),
    entities, entityDeviceIds: registry, deviceUnits: {}, folding };
  const facts = lookFacts(input, folding);
  const devices = villaDevices({ ...input, facts });
  const view = attentionFor({ devices, attentionItems: attentionOf({ devices, entities, entityMap,
    resolvedRooms: { [CAM]: "Shed" }, fmData }).attentionItems }, may);
  const look = deviceLook(CAM, storeLookSource(entities, { entityMap, ...lookMarks(marksOf(facts, new Set())) }));
  const card = view.attentionGroups[0] ? cardTop(cockpitCard(view.attentionGroups[0], null)) : null;
  return { devices, view, look, card, sign: issueSeverity(view.attentionGroups, [CAM], devices.deviceOf),
    // what its window lists under "Also on this device", and the Recap's "All devices reporting"
    also: deviceReadings(CAM, folding, facts.partsOf, entities),
    recap: buildReadiness(entities, fmData, view, entityMap).checks.find((c) => c.id === "devices-online"),
    // the monthly recap's "Device availability" section, made from the same readiness
    monthly: monthlySection(buildMonthlyRecap({ fm: fmData, month: "2026-11", villaName: "V", now: Date.parse("2026-11-14T10:00:00Z"),
      readiness: buildReadiness(entities, fmData, view, entityMap), cardOfRecord: () => undefined })) };
}
const monthlySection = (doc) => {
  const lines = doc.split("\n"), at = lines.findIndex((l) => l.startsWith("## 4. Device availability"));
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && l.trim() === "");
  return lines.slice(at + 1, end < 0 ? undefined : end);
};

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

// ⚠️ THE RECAP SAID "Every configured device is reporting." BESIDE THE CARD (architecture review item 8, 2026-11-14)
ck("  ...the Recap's \"All devices reporting\" says so, a warning naming the camera: \"1 device partly unavailable.\"",
   dead.recap.state === "warn" && dead.recap.detail === "1 device partly unavailable." && dead.recap.entityIds.join() === CAM
     && dead.recap.goes[0]?.word === "device", dead.recap);
// ⚠️ THE MONTHLY RECAP STILL COUNTED ONLY OFFLINE DEVICES (2.496.800): its "Device availability" said all was well
// while the weekly check above named the camera
ck("  ...the monthly recap's \"Device availability\" names it too, its parts in the card's words, still counted as reporting",
   dead.monthly.join("\n") === ["- **1 of 1** devices reporting (100.0%)",
     "- 1 device partly unavailable, listed under \"Open issues\" in the Cockpit's Inbox:",
     "  - Shed camera: Person detection unavailable"].join("\n"), dead.monthly);
const notShown = villa([ent(CAM, "idle", "Shed camera"), ent(PERSON, "unavailable", "Shed camera Person detection", SINCE)],
  EMPTY_FM_DATA, () => false);
ck("  ...a profile that may not open the camera: nothing partly unavailable in its monthly recap",
   !notShown.monthly.some((l) => /partly|Shed camera/.test(l)), notShown.monthly);
// a profile that may open only what is on the map (listedDevices without listUnmappedDevices): the dead part is not on
// the map, its device is, and the map shows everyone the device's "?"
const placedOnly = villa([ent(CAM, "idle", "Shed camera"), ent(PERSON, "unavailable", "Shed camera Person detection", SINCE)],
  EMPTY_FM_DATA, (id) => id === CAM);
ck("  ...a profile that may open only what is on the map is told too: the question is asked of the device, not of its part",
   placedOnly.view.attentionGroups.length === 1 && placedOnly.view.attentionGroups[0].entityId === CAM,
   placedOnly.view.attentionGroups.map((g) => g.entityId));

console.log("  one set of parts: what the window lists is what the health asks (a battery filed as diagnostic included):");
const flat = villa([ent(CAM, "idle", "Shed camera"), ent(PERSON, "off", "Shed camera Person detection"),
  ent(BATTERY, "unavailable", "Shed camera Battery", SINCE)]);
ck("its dead battery is listed under \"Also on this device\" AND is the card, the \"?\" and the room's number",
   flat.also.includes(BATTERY) && JSON.stringify(flat.devices.healthOf(CAM)) === JSON.stringify({ kind: "partly", lost: [BATTERY] })
     && flat.card?.status.map((x) => x.text).join() === "Battery unavailable" && flat.look.mark === "lost",
   { also: flat.also, health: flat.devices.healthOf(CAM), card: flat.card, mark: flat.look.mark });
ck("  ...and the parts it never asks are never listed: no signal strength, no restart button, no hidden switch",
   [SIGNAL, RESTART, PRIVACY].every((id) => !flat.also.includes(id)), flat.also);

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

// A CAMERA'S CONTROL IT NEVER USES (owner, 2026-11-14: "Move to Preset", no preset saved, unavailable since it
// appeared, listed both Tapo cameras as partly lost): put on Advanced Settings' "Unavailable by design", the lens the
// store applies (ha/unavailableByDesign) hands it over as "unknown", and the camera reads alive, no card, no "?"
const lens = new UnavailableByDesign();
lens.setIds(new Set([PRESET]), {});
const unused = (preset) => villa([ent(CAM, "idle", "Shed camera"), ent(PERSON, "off", "Shed camera Person detection"), preset]);
const offList = unused(ent(PRESET, "unavailable", "Shed camera Move to Preset"));
const onList = unused(lens.see(ent(PRESET, "unavailable", "Shed camera Move to Preset")));
ck("a control never used counts as a dead part until it is put on \"Unavailable by design\"",
   offList.devices.healthOf(CAM).kind === "partly" && offList.card !== null, offList.devices.healthOf(CAM));
ck("  ...on the list: the camera alive, no card, no partly-unavailable line in the Recap",
   onList.devices.healthOf(CAM).kind === "alive" && onList.card === null && onList.devices.partlyLost.length === 0
     && onList.recap.state !== "warn", { health: onList.devices.healthOf(CAM), recap: onList.recap });

done("✅ one health per device: a dead part of a live device is its card, its grey sign and its grey \"?\"");
