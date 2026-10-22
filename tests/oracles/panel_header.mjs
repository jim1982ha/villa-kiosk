// The open device panel's header — its badge, linked switch and motion line
// (components/panels/panelHeader, 2.496.305), driven by value.
//
// It was ~80 lines of derivation inline in the Dashboard's JSX, two IIFEs
// deep, pinned only by matching the page's source text.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { panelHeader } = await import("@/components/panels/panelHeader");

const ent = (id, state, attributes = {}) => ({ entity_id: id, state, attributes, last_changed: "", last_updated: "" });
const entities = {
  "light.desk": ent("light.desk", "off"), "switch.plug": ent("switch.plug", "off"),
  "binary_sensor.cam_motion": ent("binary_sensor.cam_motion", "on", { device_class: "motion" }), "camera.gate": ent("camera.gate", "idle"),
};
const live = { entityMap: {
  "light.desk": { entityId: "light.desk", type: "light", label: "Desk", linkedEntityId: "switch.plug", badgeColor: "#ff0000" },
  "camera.gate": { entityId: "camera.gate", type: "camera", label: "Gate", linkedEntityId: "binary_sensor.cam_motion" },
  "camera.yard": { entityId: "camera.yard", type: "camera", label: "Yard", linkedEntityId: "switch.plug" },
}, deviceGroups: [], isHidden: () => false };
// The panel's mapping as it was when the panel OPENED — no colour yet, no link.
const desk = { entityId: "light.desk", mapping: { entityId: "light.desk", type: "light", label: "Desk" } };
const h = (o) => panelHeader({ panel: desk, entities, config: live, canControl: true, linkedSwitch: { isOn: false, known: true }, ...o });

ck("the badge reads the LIVE colour, not the snapshot taken when the panel opened", h().badge.color === "#ff0000");
ck("  ...its category and glyph, as on the map", h().badge.category === "light" && h().badge.iconKey === "lightbulb");
// the linked DOT since 2026-10-22 (owner: badge proposal 2) — it was the ring
ck("the linked dot follows the linked switch AS JUST PRESSED (the optimistic state), not the confirmed one",
   h({ linkedSwitch: { isOn: true, known: true } }).badge.linkPill === "on" && h().badge.linkPill === "off" && entities["switch.plug"].state === "off");
ck("the linked switch: named, its position, and whether HA knows it", JSON.stringify(h().linked) === JSON.stringify({ label: "Plug", isOn: false, known: true })
   && h({ linkedSwitch: { isOn: false, known: false } }).linked.known === false);
ck("  ...not offered to a profile that may not control it", h({ canControl: false }).linked === null);
const cam = panelHeader({ panel: { entityId: "camera.gate", mapping: { entityId: "camera.gate", type: "camera", label: "Gate" } }, entities, config: live, canControl: false, linkedSwitch: null });
// owner, 2026-10-22: a camera's motion sensor is its LINKED entity when that detects presence (cameraMotionId)
ck("a camera linked to a motion sensor: named, its id for its band — shown to any profile, and no second band for it",
   cam.motion && cam.motion.entityId === "binary_sensor.cam_motion" && /Motion/.test(cam.motion.label) && cam.linkedSensor === null);
const yard = panelHeader({ panel: { entityId: "camera.yard", mapping: { entityId: "camera.yard", type: "camera", label: "Yard" } }, entities, config: live, canControl: true, linkedSwitch: { isOn: false, known: true } });
ck("  ...a camera linked to a switch: no motion, its switch offered as any device's", yard.motion === null && yard.linked?.label === "Plug");
ck("  ...and a light has none", h().motion === null);

// ⚠️ A LINKED SENSOR IS NOT A SWITCH (owner, 2026-10-21): a lock's door sensor was drawn as a toggle that cannot move it
const sensed = { ...live, entityMap: { ...live.entityMap,
  "lock.door": { entityId: "lock.door", type: "lock", label: "Door", linkedEntityId: "binary_sensor.door_contact" } } };
const withSensor = { ...entities, "lock.door": ent("lock.door", "locked"),
  "binary_sensor.door_contact": ent("binary_sensor.door_contact", "off", { device_class: "door" }) };
const door = (o) => panelHeader({ panel: { entityId: "lock.door", mapping: { entityId: "lock.door", type: "lock", label: "Door" } },
  entities: withSensor, config: sensed, canControl: true, linkedSwitch: { isOn: false, known: true }, ...o });
ck("a linked binary_sensor is no switch: no toggle, its band instead — named",
   door().linked === null && door().linkedSensor?.entityId === "binary_sensor.door_contact" && typeof door().linkedSensor.label === "string");
ck("  ...shown to any profile (a reading, not a control)", door({ canControl: false }).linkedSensor?.entityId === "binary_sensor.door_contact");
ck("  ...and a linked switch keeps its toggle, with no band", h().linked !== null && h().linkedSensor === null);
const { readFileSync } = await import("node:fs");
const { parseTsx, elements, guardsOf, propText, childTags } = await import("../consistency/jsx.mjs");
const base = parseTsx("components/panels/BasePanel.tsx");
const band = elements(base, "LinkedSensorRow");
ck("the window draws a band under `linkedSensor` and under `motion`, the toggle only under `linked`",
   band.length === 2 && band.map((b) => guardsOf(b).join()).join() === "linkedSensor,motion"
   && elements(base, "div").filter((d) => childTags(d).includes("button") && /panel-linked-row/.test(propText(d, "className") ?? ""))
     .map((d) => guardsOf(d).join()).join() === "linked",
   band.map(guardsOf));
const row = parseTsx("components/panels/LinkedSensorRow.tsx");
const tl = elements(row, "StateTimeline");
ck("  ...the band is the windows' own StateTimeline (LINKED_BAND_PX), coloured by the reading's one binary rule",
   tl.length === 1 && propText(tl[0], "height") === "LINKED_BAND_PX" && /reading\.stateColor/.test(propText(tl[0], "colorFor") ?? "")
   && elements(row, "button").length === 0);
// owner, 2026-10-21: "the thinner status bar … taking the same width as the bigger bar … the same scale" — under the
// device's history, over the window's one range
{
  const src = readFileSync(new URL("../../src/components/panels/BasePanel.tsx", import.meta.url), "utf8");
  const rowSrc = readFileSync(new URL("../../src/components/panels/LinkedSensorRow.tsx", import.meta.url), "utf8");
  ck("  ...drawn right under the device's own history, inside the window's one range — a camera's motion sensor too, each named with what it is",
     /\(history \?\? <LastDayTimeline entityId=\{entityId\} \/>\)\}[\s\S]{0,300}\{linkedSensor && <LinkedSensorRow /.test(src)
     && /<HistoryRangeShare>[\s\S]*<LinkedSensorRow[\s\S]*<\/HistoryRangeShare>/.test(src)
     && /\{motion && <LinkedSensorRow entityId=\{motion\.entityId\} label=\{motion\.label\} role="motion sensor" \/>\}/.test(src)
     && !/conn-dot/.test(src) && /\{label\} <span className="muted">\(\{role\}\)<\/span>/.test(rowSrc)
     && /const range = useSharedRange\(\);/.test(rowSrc) && propText(tl[0], "hours") === "range.hours"
     && /"History range", className, useContext\(SharedRange\)\)/.test(readFileSync(new URL("../../src/components/panels/historyRange.tsx", import.meta.url), "utf8")));
}
// architecture review, 2026-10-21: the camera's video window (its own frame, not BasePanel) showed nothing for a
// linked sensor — the switch gone in 2.496.465, the band only in the other windows
{
  const cam = parseTsx("components/panels/CameraPanel.tsx");
  const strip = elements(cam, "StateTimeline").filter((t) => propText(t, "height") === "CAMERA_LINKED_STRIP_PX");
  const box = elements(cam, "div").filter((d) => propText(d, "className") === '"camera-linked-strip"');
  ck("the camera's video window draws the linked sensor's strip under its bar, under `linkedSensor`, coloured by the reading",
     strip.length === 1 && box.length === 1 && guardsOf(box[0]).join().includes("linkedSensor")
     && childTags(box[0]).includes("StateTimeline")
     && /reading|readingOf/.test(propText(strip[0], "colorFor") ?? ""), box.map(guardsOf));
}
done("✅ the panel's header, derived once");
