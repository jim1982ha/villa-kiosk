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
const devices = { ids: [...villa], unavailable: ["climate.bed", "camera.pool", "sensor.door_battery"], has: (id) => villa.has(id), deviceOf: (id) => id, deviceOfRecord: (id) => id, isCritical: () => false };
const r = buildReadiness(entities, EMPTY_FM_DATA, devices, {});
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
   /fm-entity-chip/.test(html.split('<div class="fm-row ')[1]) && rowOf("Doors locked").includes("|back|") && rowOf("Cameras online").includes("|pool|"), rows);
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
  const crit = stateOf(buildReadiness(entities, EMPTY_FM_DATA, { ...devices, isCritical: (id) => id === "camera.pool" }, {}));
  ck("  ...one CRITICAL device not answering: red, in its own checks only",
     crit["devices-online"] === "fail" && crit.cameras === "fail" && crit.climate === "warn", crit);
  const rec = (id) => ({ id, title: id, status: "open", openedAt: "2026-10-19T08:00:00Z", entityId: `x.${id}`, photoIds: [] });
  const five = buildReadiness({}, { ...EMPTY_FM_DATA, tickets: ["a", "b", "c", "d", "e"].map(rec) }, { ...devices, unavailable: [] }, {});
  ck("  ...five faults: amber — a fault is a warning, however many", five.checks.find((c) => c.id === "tickets").state === "warn"
     && five.overall === "warn", five.checks.find((c) => c.id === "tickets"));
  ck("  ...and the critical rule is the Overview's: a critical entity stands for its device",
     (await import("@/config/deviceGroups")).criticalDevices(new Set(["sensor.lock_battery"]), new Map([["sensor.lock_battery", "lock.door"]])).has("lock.door"));
}

console.log("\n  one tinted card (fm/tone): each state says its tone, the stylesheet draws a tone once:");
{
  const { TONE_OF, toneClass } = await import("@/fm/tone");
  const drawnRow = (state) => draw(h(ReadinessChecks, { readiness: { ...r, checks: [{ ...r.checks[0], state }] }, label: (id) => id,
    onOpenEntity: () => {}, onOpenCheck: () => {}, startOpen: true }));
  ck("a Recap check drawn amber or red by its tone, never by the Schedule's words",
     /class="fm-row tone-warn"/.test(drawnRow("warn")) && /class="fm-row tone-danger"/.test(drawnRow("fail")) && !/state-/.test(drawnRow("fail")));
  ck("  ...the same three tones for a task, a check and the spending cap",
     [TONE_OF.due["due-soon"], TONE_OF.check.warn, TONE_OF.cap.approaching].every((t) => toneClass(t) === "tone-warn")
     && [TONE_OF.check.fail, TONE_OF.cap.exceeded].every((t) => toneClass(t) === "tone-danger") && toneClass(TONE_OF.check.pass) === "");
  const css = ["07-facility", "08-shared"].map((f) => readFileSync(new URL(`../../src/styles/${f}.css`, import.meta.url), "utf8")).join("\n");
  ck("  ...and the tinted frame is written once", (css.match(/color-mix\(in srgb, var\(--status-(warning|danger)\) [67]%, var\(--bg-card\)\)/g) ?? []).length === 0
     && (css.match(/color-mix\(in srgb, var\(--tone\) var\(--tone-fill\), var\(--bg-card\)\)/g) ?? []).length === 1);
}

done("✅ every readiness check opens its own devices, the same way");
