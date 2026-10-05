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
  "camera.gate": { entityId: "camera.gate", type: "camera", label: "Gate", motionEntityId: "binary_sensor.cam_motion" },
}, alertThresholds: {}, deviceGroups: [] };
// The panel's mapping as it was when the panel OPENED — no colour yet, no link.
const desk = { entityId: "light.desk", mapping: { entityId: "light.desk", type: "light", label: "Desk" } };
const h = (o) => panelHeader({ panel: desk, entities, config: live, canControl: true, linkedSwitch: { isOn: false, known: true }, ...o });

ck("the badge reads the LIVE colour, not the snapshot taken when the panel opened", h().badge.color === "#ff0000");
ck("  ...its category and glyph, as on the map", h().badge.category === "light" && h().badge.iconKey === "lightbulb");
ck("the ring follows the linked switch AS JUST PRESSED (the optimistic state), not the confirmed one",
   h({ linkedSwitch: { isOn: true, known: true } }).badge.ringState === "active" && h().badge.ringState === "off" && entities["switch.plug"].state === "off");
ck("the linked switch: named, its position, and whether HA knows it", JSON.stringify(h().linked) === JSON.stringify({ label: "Plug", isOn: false, known: true })
   && h({ linkedSwitch: { isOn: false, known: false } }).linked.known === false);
ck("  ...not offered to a profile that may not control it", h({ canControl: false }).linked === null);
const cam = panelHeader({ panel: { entityId: "camera.gate", mapping: { entityId: "camera.gate", type: "camera", label: "Gate" } }, entities, config: live, canControl: false, linkedSwitch: null });
ck("a camera's motion line: its sensor named and detecting — shown to any profile", cam.motion && cam.motion.isOn === true && /Motion/.test(cam.motion.label));
ck("  ...and a light has none", h().motion === null);
done("✅ the panel's header, derived once");
