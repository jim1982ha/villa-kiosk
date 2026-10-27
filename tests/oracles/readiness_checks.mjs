// What each Readiness check opens (fm/readiness.ts CheckTarget): every check that is about devices carries its own
// list and its button's words, and the Recap draws them all the same way — no screen knows a check by its name.
// ⚠️ Until 2.496.403 the button words and lists were chosen by check id in ReadinessTab and FacilitySections: Air
// conditioning and Cameras had no button, and "View unavailable devices" left Recap for the Overview (architecture
// review round two, 2026-10-17). By value, then drawn.
import { readFileSync } from "node:fs";
import { h, draw, text } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const { buildReadiness } = await import("@/fm/readiness");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { ReadinessChecks } = await import("@/components/fm/ReadinessTab");

const E = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
const entities = Object.fromEntries([
  E("lock.front", "locked"), E("lock.back", "unlocked"), E("light.hall", "on"), E("light.bed", "off"),
  E("climate.living", "cool"), E("climate.bed", "unavailable"), E("camera.gate", "idle"), E("camera.pool", "unavailable"),
  E("sensor.door_battery", "unavailable"),
].map((e) => [e.entity_id, e]));
const villa = new Set(Object.keys(entities));
const devices = { ids: [...villa], unavailable: ["climate.bed", "camera.pool", "sensor.door_battery"], has: (id) => villa.has(id), deviceOf: (id) => id, deviceOfRecord: (id) => id, isCritical: () => false, isHidden: () => false };
const r = buildReadiness(entities, EMPTY_FM_DATA, { devices: devices, attentionItems: [] }, {});
const opens = (c) => c.opens ? `${c.opens.label} → ${c.opens.group.title} [${c.opens.group.entityIds.join(",")}]${c.opens.health ? " (health)" : ""}` : "-";

console.log("  each check's own list, by value:");
const said = Object.fromEntries(r.checks.map((c) => [c.id, opens(c)]));
ck("devices not reporting: their own list, a health list (every device, no \"turn all\")",
   said["devices-online"] === "View unavailable devices → Unavailable devices [climate.bed,camera.pool,sensor.door_battery] (health)", said["devices-online"]);
ck("doors and lights: EVERY lock and light, as the summary tiles open them",
   said.locks === "View doors → Locks [lock.front,lock.back]" && said.lights === "View lights → Lights [light.hall,light.bed]", [said.locks, said.lights]);
ck("air conditioning and cameras: their own lists too", said.climate === "View air conditioning → Air conditioning [climate.living,climate.bed]"
   && said.cameras === "View cameras → Cameras [camera.gate,camera.pool]", [said.climate, said.cameras]);
ck("the faults and tickets check is about no device: nothing to open", said.tickets === "-");

console.log("\n  the Recap, drawn:");
const opened = [];
const html = draw(h(ReadinessChecks, { readiness: r, label: (id) => id.split(".")[1], onOpenEntity: () => {}, onOpenCheck: (t) => opened.push(t), startOpen: true }));
const rows = html.split('<div class="fm-row ').slice(1).map(text);
const rowOf = (title) => rows.find((x) => x.includes(`|${title}|`)) ?? "";
ck("every failing check about devices has its button, with its own words",
   rowOf("All devices reporting").includes("|View unavailable devices [icon]|") && rowOf("Doors locked").includes("|View doors [icon]|")
   && rowOf("Lights off before arrival").includes("|View lights [icon]|") && rowOf("Air conditioning reachable").includes("|View air conditioning [icon]|")
   && rowOf("Cameras online").includes("|View cameras [icon]|"), rows);
// (owner, 2026-10-18: the devices not reporting as pills, "the same way the unlocked device or on lights are shown")
ck("  ...every check names its devices as chips — the devices not reporting too",
   /fm-entity-chip/.test(html.split('<div class="fm-row ').find((x) => x.includes("All devices reporting")) ?? "") && rowOf("Doors locked").includes("|back|") && rowOf("Cameras online").includes("|pool|"), rows);
ck("  ...and nothing in it leaves Recap: no Overview link", !/Overview/.test(rowOf("All devices reporting")));
const fs = readFileSync(new URL("../../src/components/fm/FacilitySections.tsx", import.meta.url), "utf8");
// The wiring a drawing cannot reach (it needs the Facility data): the button's list opens in Recap, as a list.
ck("Recap opens the list a check names (SummaryGroupPanel), its health flag deciding the filters",
   /onOpenCheck=\{setCheckList\}/.test(fs) && /<SummaryGroupPanel group=\{checkList\.group\}/.test(fs)
   && /hideBulkToggle=\{checkList\.health\} filterSuppressed=\{!checkList\.health\}/.test(fs) && !/check\.id ===|c\.id ===|"devices-online"/.test(fs));
ck("  ...and the Recap screen knows no check by its name", !/c\.id ===|check\.id ===|"devices-online"|"locks"|"lights"/.test(
   readFileSync(new URL("../../src/components/fm/ReadinessTab.tsx", import.meta.url), "utf8")));

console.log("\n  how bad, as the top bar says it (review \"One answer per question\" #3, 2026-10-19):");
{
  const stateOf = (rr) => Object.fromEntries(rr.checks.map((c) => [c.id, c.state]));
  const plain = stateOf(r);
  ck("devices not answering, none critical: amber, however many (3 here) — air conditioning and cameras alike",
     plain["devices-online"] === "warn" && plain.climate === "warn" && plain.cameras === "warn" && r.overall === "warn", plain);
  const crit = stateOf(buildReadiness(entities, EMPTY_FM_DATA, { devices: { ...devices, isCritical: (id) => id === "camera.pool" }, attentionItems: [] }, {}));
  ck("  ...one CRITICAL device not answering: red, in its own checks only",
     crit["devices-online"] === "fail" && crit.cameras === "fail" && crit.climate === "warn", crit);
  const rec = (id) => ({ id, title: id, status: "open", openedAt: "2026-10-19T08:00:00Z", entityId: `x.${id}`, photoIds: [] });
  const fiveData = { ...EMPTY_FM_DATA, tickets: ["a", "b", "c", "d", "e"].map(rec) };
  const { buildAttentionItems } = await import("@/config/attention");
  const calmDevices = { ...devices, unavailable: [] };
  const five = buildReadiness({}, fiveData, { devices: calmDevices, attentionItems: buildAttentionItems({ devices: calmDevices, entities: {},
    entityMap: {}, resolvedRooms: {}, fmData: fiveData }) }, {});
  ck("  ...five faults: amber — a fault is a warning, however many", five.checks.find((c) => c.id === "tickets").state === "warn"
     && five.overall === "warn", five.checks.find((c) => c.id === "tickets"));
  ck("  ...and the critical rule is the Overview's: a critical entity stands for its device",
     (await import("@/config/deviceGroups")).criticalDevices(new Set(["sensor.lock_battery"]), new Map([["sensor.lock_battery", "lock.door"]])).has("lock.door"));
  // owner, 2026-10-21: two pumps placed on one relay box, the box listed by its relay — one pump red, the other amber.
  // As the villa's system files it: three devices, each pump's meter hanging under the relay's (via_device, deviceUnits).
  {
    const { criticalDevices, villaDevices } = await import("@/config/deviceGroups");
    const reg = { "switch.box_relay": "relay", "sensor.a_pump_power": "meter_a", "sensor.b_pump_power": "meter_b", "sensor.other": "o" };
    const units = { meter_a: "relay", meter_b: "relay" };
    const fold = new Map([["switch.box_relay", "sensor.a_pump_power"]]);
    const c = criticalDevices(new Set(["switch.box_relay"]), fold, reg, units);
    ck("  ...every device placed on the critical entity's box is critical, not only the first by name",
       c.has("sensor.a_pump_power") && c.has("sensor.b_pump_power") && !c.has("sensor.other"), [...c]);
    const ent = (id) => ({ entity_id: id, state: "unavailable", attributes: {} });
    const entityMap = { "sensor.a_pump_power": { entityId: "sensor.a_pump_power", type: "sensor" }, "sensor.b_pump_power": { entityId: "sensor.b_pump_power", type: "sensor" } };
    const v = villaDevices({ entityMap, deviceGroups: [], dismissed: new Set(), hidden: new Set(), mappedEntityIds: new Set(Object.keys(entityMap)),
      entities: Object.fromEntries(Object.keys(reg).map((id) => [id, ent(id)])), entityDeviceIds: reg, critical: new Set(["switch.box_relay"]), deviceUnits: units });
    // 2.496.477 marked upward too: a critical leak sensor hangs under its Zigbee bridge, as every Zigbee device does
    const zreg = { "binary_sensor.leak": "leak", "sensor.motion": "pir", "switch.bridge_permit": "bridge" };
    const z = criticalDevices(new Set(["binary_sensor.leak"]), new Map(), zreg, { leak: "bridge", pir: "bridge" });
    ck("  ...but a critical PART marks only itself: a leak sensor never makes its bridge's other devices critical",
       z.has("binary_sensor.leak") && !z.has("sensor.motion") && !z.has("switch.bridge_permit"), [...z]);
    ck("  ...as the villa's devices answer it (VillaDevices.isCritical): both pumps",
       v.isCritical("sensor.a_pump_power") && v.isCritical("sensor.b_pump_power") && !v.isCritical("sensor.other"));
  }
}

console.log("\n  one tinted card (fm/tone): each state says its tone, the stylesheet draws a tone once:");
{
  const { TONE_OF, toneClass } = await import("@/fm/tone");
  const { DUE_WORDS } = await import("@/fm/fmEngine");
  const { CHECK_WORDS } = await import("@/fm/readiness");
  const drawnRow = (state) => draw(h(ReadinessChecks, { readiness: { ...r, checks: [{ ...r.checks[0], state }] }, label: (id) => id,
    onOpenEntity: () => {}, onOpenCheck: () => {}, startOpen: true }));
  ck("a Recap check drawn amber or red by its tone, never by the Schedule's words",
     /class="fm-record-card tone-warn"/.test(drawnRow("warn")) && /class="fm-record-card tone-danger"/.test(drawnRow("fail")) && !/state-/.test(drawnRow("fail")));
  ck("  ...the same three tones for a task, a check and the spending cap",
     [DUE_WORDS["due-soon"].tone, CHECK_WORDS.warn.tone, TONE_OF.cap.approaching].every((t) => toneClass(t) === "tone-warn")
     && [CHECK_WORDS.fail.tone, TONE_OF.cap.exceeded].every((t) => toneClass(t) === "tone-danger") && toneClass(CHECK_WORDS.pass.tone) === "");
  const css = ["07-facility", "08-shared"].map((f) => readFileSync(new URL(`../../src/styles/${f}.css`, import.meta.url), "utf8")).join("\n");
  ck("  ...and the tinted frame is written once", (css.match(/color-mix\(in srgb, var\(--status-(warning|danger)\) [67]%, var\(--bg-card\)\)/g) ?? []).length === 0
     && (css.match(/color-mix\(in srgb, var\(--tone\) var\(--tone-fill\), var\(--bg-card\)\)/g) ?? []).length === 1);
}


console.log("\n  an alarm makes the villa not ready, as it makes the top bar red (review, 2026-10-19 evening):");
{
  const alarm = { id: "alarm:binary_sensor.kitchen_leak", kind: "alarm", title: "Kitchen leak", detail: "Leak detected",
    source: "live", entityId: "binary_sensor.kitchen_leak" };
  const late = { id: "schedule:pool", kind: "schedule", title: "Pool filter", detail: "Overdue", source: "schedule" };
  const calm = buildReadiness({}, EMPTY_FM_DATA, { devices: { ...devices, unavailable: [] }, attentionItems: [late] }, {});
  const leak = buildReadiness({}, EMPTY_FM_DATA, { devices: { ...devices, unavailable: [] }, attentionItems: [late, alarm] }, {});
  const row = (res) => res.checks.find((c) => c.id === "alarms");
  ck("no alarm: the check passes, and a late task is no alarm", row(calm).state === "pass" && row(calm).label === "No alarm");
  ck("  ...a leak sounding: the check fails, names it, and the verdict is NOT READY",
     row(leak).state === "fail" && row(leak).detail === "Kitchen leak: Leak detected" && leak.overall === "fail"
     && row(leak).entityIds.join() === "binary_sensor.kitchen_leak", row(leak));
  const { villaHealthFrom } = await import("@/config/attention");
  // the level is attention's; the class is the top bar's own (HUD.HEALTH_CLASS)
  const { HEALTH_CLASS } = await import("@/components/hud/HUD");
  const healthClass = (health) => HEALTH_CLASS[health.level];
  const g = (items) => [{ items }];
  ck("the top bar's Cockpit button: red for an alarm, amber for a late task, plain when all is fine",
     healthClass(villaHealthFrom(g([alarm]))) === " has-alert" && healthClass(villaHealthFrom(g([late]))) === " has-warn"
     && healthClass(villaHealthFrom([])) === "");
  const hud = readFileSync(new URL("../../src/components/hud/HUD.tsx", import.meta.url), "utf8");
  ck("  ...the button takes that class, and the Recap is given the Cockpit's own alarms",
     /\$\{HEALTH_CLASS\[health\.level\]\}/.test(hud) && !/attentionGroups\.length > 0 \? " has-alert"/.test(hud)
     && /const view = useVillaAttention\(\);/.test(fs) && /buildReadiness\(entities, data, view, config\.entityMap\)/.test(fs));
  ck("  ...and attention keeps no class name: it gives the level only", !("healthClass" in (await import("@/config/attention"))));
}

console.log("\n  a jammed lock is ONE line of the recap, under \"Doors locked\" (owner, 2026-10-28):");
{
  const { buildAttentionItems } = await import("@/config/attention");
  const ents = Object.fromEntries([E("lock.front", "jammed"), E("lock.back", "locked"),
    E("binary_sensor.kitchen_leak", "on", { device_class: "moisture" })].map((e) => [e.entity_id, e]));
  const ids = new Set(Object.keys(ents));
  const devs = { ...devices, ids: [...ids], unavailable: [], has: (id) => ids.has(id) };
  const items = buildAttentionItems({ devices: devs, entities: ents, entityMap: {}, resolvedRooms: {}, fmData: EMPTY_FM_DATA });
  ck("the Cockpit lists the jammed lock and the leak as alarms (the fixture reaches the rule)",
     items.filter((i) => i.kind === "alarm").map((i) => i.entityId).sort().join() === "binary_sensor.kitchen_leak,lock.front",
     items.map((i) => `${i.kind}:${i.entityId}`));
  const rr = buildReadiness(ents, EMPTY_FM_DATA, { devices: devs, attentionItems: items }, {});
  const named = rr.checks.filter((c) => (c.entityIds ?? []).includes("lock.front")).map((c) => c.id);
  ck("  ...the recap names the lock in ONE check, \"Doors locked\", as jammed", named.join() === "locks"
     && rr.checks.find((c) => c.id === "locks").detail === "1 jammed.", rr.checks.map((c) => [c.id, c.detail]));
  const al = rr.checks.find((c) => c.id === "alarms");
  ck("  ...and \"Alarms\" keeps every other device in alarm: the leak alone", al.label === "1 alarm" && al.state === "fail"
     && al.entityIds.join() === "binary_sensor.kitchen_leak", al);
}

console.log("\n  one word per check state and one verdict, on the tab, in the recap and in the snapshot (review, 2026-10-19):");
{
  const { CHECK_WORDS, VERDICT_WORDS } = await import("@/fm/readiness");
  const R = await import("@/fm/fmDocuments");
  const one = (state) => ({ checks: [{ id: "c", label: `Check ${state}`, state, detail: "what was found" }], passed: state === "pass" ? 1 : 0, total: 1, overall: state });
  const wordOf = (state) => (CHECK_WORDS[state].tone === "danger" ? `**${CHECK_WORDS[state].word}**` : CHECK_WORDS[state].word);
  ck("three states, three words: Pass, Warning, Fail", Object.entries(CHECK_WORDS).map(([k, w]) => `${k}:${w.word}/${w.tone}`).join() === "pass:Pass/ok,warn:Warning/warn,fail:Fail/danger");
  for (const state of ["pass", "warn", "fail"]) {
    const res = one(state);
    const tab = text(draw(h(ReadinessChecks, { readiness: res, label: (id) => id, onOpenEntity: () => {}, onOpenCheck: () => {}, startOpen: true })));
    const snap = R.buildReadinessSnapshot(res, "V", "2026-09");
    const recap = R.buildMonthlyRecap({ fm: EMPTY_FM_DATA, month: "2026-09", villaName: "V", readiness: res, deviceOfRecord: (id) => id });
    const row = `| Check ${state} | ${wordOf(state)} | what was found |`;
    ck(`${state}: the tab's verdict is VERDICT_WORDS', the snapshot's the same sentence; the check's row is the same in the recap and the snapshot`,
       tab.includes(`|${VERDICT_WORDS[state]}|${res.passed} of 1 checks passing|`) && snap.includes(`**${VERDICT_WORDS[state]}**, ${res.passed} of 1 checks passing.`)
       && snap.includes(row) && recap.includes(row) && snap.includes("| Check | Result | Finding |") && recap.includes("| Check | Result | Finding |"),
       { tab, snap: snap.split("\n").filter((l) => l.startsWith("|") || l.startsWith("**")), recap: recap.split("## 5.")[1] });
  }
  const snap = R.buildReadinessSnapshot(one("warn"), "V", "2026-09");
  ck("the snapshot opens with the documents' shared header (its Generated stamp is the moment taken), no \"Taken\" line, nothing shouted",
     snap.startsWith("# V: readiness snapshot\n**Period:** ") && /^\*\*Generated:\*\* \d{4}-\d{2}-\d{2} \d{2}:\d{2}  $/m.test(snap) && /^\*\*Scope:\*\* /m.test(snap)
     && !/Taken |READY|Attention/.test(snap), snap.split("\n").slice(0, 5));
  const code = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  ck("  ...and neither the tab nor the documents spell a verdict or a check word themselves",
     !/Ready for the next guest|Not ready|worth fixing/.test(code("components/fm/ReadinessTab.tsx"))
     && !/"Pass"|"Warning"|"Attention"|"Fail"|READY|"Detail"/.test(code("fm/fmDocuments.ts")) && /readinessTable\(readiness\)/.test(code("fm/fmDocuments.ts")));
}


console.log("\n  the Recap counts what the profile is shown (architecture review, 2026-10-19):");
{
  const { buildAttentionItems, attentionFor } = await import("@/config/attention");
  const { devicesOf } = await import("../consistency/devices.mjs");
  const R = await import("@/fm/fmDocuments");
  const villaDev = devicesOf({ ids: [...villa], unavailable: ["climate.bed", "camera.pool", "sensor.door_battery"] });
  const rec = (id, entityId) => ({ id, title: id, status: "open", openedAt: "2026-10-19T08:00:00Z", entityId, photoIds: [] });
  const data = { ...EMPTY_FM_DATA, tickets: [rec("cam", "camera.pool"), rec("ac", "climate.bed")] };
  const problems = { devices: villaDev, attentionItems: buildAttentionItems({ devices: villaDev, entities, entityMap: {},
    resolvedRooms: {}, fmData: data }) };
  const owner = buildReadiness(entities, data, attentionFor(problems, () => true), {});
  const noCams = buildReadiness(entities, data, attentionFor(problems, (id) => !id.startsWith("camera.")), {});
  const check = (res, id) => res.checks.find((c) => c.id === id);
  ck("a profile shown no camera: the camera is not among its devices not reporting, nor its fault among its faults",
     check(owner, "devices-online").entityIds.includes("camera.pool") && !check(noCams, "devices-online").entityIds.includes("camera.pool")
     && check(owner, "tickets").label === "2 detected faults (0 open tickets)" && check(noCams, "tickets").label === "1 detected fault (0 open tickets)"
     && !check(noCams, "cameras"), [check(noCams, "devices-online").entityIds, check(noCams, "tickets").label]);
  ck("  ...its device count is its own: the recap's availability section says the profile's figures",
     owner.availability.total === villa.size && noCams.availability.total === villa.size - 2
     && noCams.availability.offline.join() === "climate.bed,sensor.door_battery", noCams.availability);
  const recap = R.buildMonthlyRecap({ fm: data, month: "2026-10", villaName: "V", readiness: noCams, deviceOfRecord: (id) => id });
  const s4 = recap.split("## 4.")[1]?.split("##")[0] ?? "";
  ck("  ...and the recap's §4 is the readiness' devices, pointing where they are listed (no \"faults section\")",
     s4.includes(`**${villa.size - 4} of ${villa.size - 2}** devices reporting`)
     && s4.includes('2 device(s) currently offline, listed under "Open issues" on the Overview, and under "All devices reporting" below.')
     && !/faults section/.test(recap), s4);
}

console.log("\n  a device the villa's system no longer has is in its own checks, named \"Missing\" as the card names it:");
{
  const { NOT_IN_HA } = await import("@/utils/stateColors");
  const { devicesOf } = await import("../consistency/devices.mjs");
  const ghosts = ["camera.ghost", "climate.ghost"];
  const dev = devicesOf({ ids: [...villa, ...ghosts], unavailable: ["climate.bed", "camera.pool", "sensor.door_battery", ...ghosts] });
  const res = buildReadiness(entities, EMPTY_FM_DATA, { devices: dev, attentionItems: [] }, {});
  const c = (id) => res.checks.find((x) => x.id === id);
  const missing = NOT_IN_HA.toLowerCase();
  ck("cameras: the missing one is in the list, and named apart",
     c("cameras").entityIds.join() === "camera.pool,camera.ghost" && c("cameras").detail === `1 offline, 1 ${missing}.`
     && c("cameras").opens.group.entityIds.includes("camera.ghost"), c("cameras"));
  ck("  ...air conditioning too", c("climate").entityIds.join() === "climate.bed,climate.ghost"
     && c("climate").detail === `1 not responding, 1 ${missing}, cannot pre-cool.`, c("climate"));
  ck("  ...and the devices not reporting say how many are missing", c("devices-online").detail === `3 devices offline or not reporting, 2 devices ${missing}.`,
     c("devices-online").detail);
  const noHa = buildReadiness({}, EMPTY_FM_DATA, { devices: dev, attentionItems: [] }, {});
  ck("  ...while the villa's system is not read yet, nothing is called missing", !noHa.checks.some((x) => x.id === "cameras" || x.id === "climate")
     && !/missing/.test(noHa.checks.find((x) => x.id === "devices-online").detail), noHa.checks.map((x) => x.detail));
}

done("✅ every readiness check opens its own devices, the same way, for the profile looking");
