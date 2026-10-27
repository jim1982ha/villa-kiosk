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
const { openDevice } = await import("@/components/panels/openDevice");
// The open device as it is set NOW (openDevice): the screen holds only which device is open.
const desk = openDevice({ entityId: "light.desk" }, live.entityMap, "owner", entities);
const h = (o) => panelHeader({ panel: desk, entities, config: live, canControl: true, linkedSwitch: { isOn: false, known: true }, ...o });

ck("the badge reads the device's colour as it is set now", h().badge.color === "#ff0000");
ck("  ...its category and glyph, as on the map", h().badge.category === "light" && h().badge.iconKey === "lightbulb");
// the linked DOT since 2026-10-22 (owner: badge proposal 2) — it was the ring
ck("the linked dot follows the linked switch AS JUST PRESSED (the optimistic state), not the confirmed one",
   h({ linkedSwitch: { isOn: true, known: true } }).badge.linkPill === "on" && h().badge.linkPill === "off" && entities["switch.plug"].state === "off");
ck("the linked switch: named, its position, and whether HA knows it", JSON.stringify(h().linked) === JSON.stringify({ label: "Plug", isOn: false, known: true })
   && h({ linkedSwitch: { isOn: false, known: false } }).linked.known === false);
ck("  ...not offered to a profile that may not control it", h({ canControl: false }).linked === null);
const cam = panelHeader({ panel: openDevice({ entityId: "camera.gate" }, live.entityMap, "owner", entities), entities, config: live, canControl: false, linkedSwitch: null });
// owner, 2026-10-22: a camera's motion sensor is its LINKED entity when that detects presence (cameraMotionId)
ck("a camera linked to a motion sensor: named, its id for its band — shown to any profile, and no second band for it",
   cam.motion && cam.motion.entityId === "binary_sensor.cam_motion" && /Motion/.test(cam.motion.label) && cam.linkedSensor === null);
const yard = panelHeader({ panel: openDevice({ entityId: "camera.yard" }, live.entityMap, "owner", entities), entities, config: live, canControl: true, linkedSwitch: { isOn: false, known: true } });
ck("  ...a camera linked to a switch: no motion, its switch offered as any device's", yard.motion === null && yard.linked?.label === "Plug");
ck("  ...and a light has none", h().motion === null);

// ⚠️ A LINKED SENSOR IS NOT A SWITCH (owner, 2026-10-21): a lock's door sensor was drawn as a toggle that cannot move it
const sensed = { ...live, entityMap: { ...live.entityMap,
  "lock.door": { entityId: "lock.door", type: "lock", label: "Door", linkedEntityId: "binary_sensor.door_contact" } } };
const withSensor = { ...entities, "lock.door": ent("lock.door", "locked"),
  "binary_sensor.door_contact": ent("binary_sensor.door_contact", "off", { device_class: "door" }) };
const door = (o) => panelHeader({ panel: openDevice({ entityId: "lock.door" }, sensed.entityMap, "owner", withSensor),
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
     && /<HistoryRangeShare device=\{entityId\}[\s\S]*<LinkedSensorRow[\s\S]*<\/HistoryRangeShare>/.test(src)
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
// owner, 2026-10-22: the header icon's "edit" pill sat at its bottom-right, over the linked entity's pill — it is at
// the TOP-LEFT now, the one corner neither of the badge's pills uses (top-right the mark, bottom-right the link)
{
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../src/styles/03-panels.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const edit = /\.panel-badge-btn::after \{([^}]*)\}/.exec(css)?.[1] ?? "";
  ck("the header icon's edit pill: top-left, clear of both right-hand pills",
     /left: -3px;/.test(edit) && /top: -3px;/.test(edit) && !/right:|bottom:/.test(edit), edit);
}

// ── THE WINDOW IS THE DEVICE AS IT IS SET NOW (architecture review P, 2026-10-27) ───────────────────────────────
// The open panel kept a copy of its mapping: a device renamed and set to "ask before switching" in Advanced Settings
// came back under its old name and switched at once, while the map used the new settings.
console.log("\n  the window reads the device as it is set now:");
{
  const { START, screenReducer } = await import("@/pages/screen");
  const { deviceSwitch } = await import("@/utils/devicePower");
  const { readFileSync } = await import("node:fs");
  const OWNER = { settings: true, editDevices: true, facility: true, agent: true, updates: true };
  const lamp = { entityId: "switch.plug", type: "switch", label: "Lamp" };
  const before = { "switch.plug": lamp };
  // open the lamp, Edit (Advanced Settings), then close it: the window comes back (pages/screen panelReturn)
  const s = [{ type: "openDevice", panel: { entityId: "switch.plug" } }, { type: "editDevice" },
    { type: "closeWindow", window: "configEditor" }].reduce((x, a) => screenReducer(x, a, OWNER), START);
  ck("the screen holds which device is open, never its settings", s.nav.panel && !("mapping" in s.nav.panel) && s.nav.panel.entityId === "switch.plug");
  const edited = { "switch.plug": { ...lamp, label: "Reading lamp", requireConfirm: true } };
  const back = openDevice(s.nav.panel, edited, "owner", entities);
  ck("a rename made in Advanced Settings is the restored window's title", back.label === "Reading lamp" && openDevice(s.nav.panel, before, "owner", entities).label === "Lamp");
  ck("  ...and its power button asks first, as just set (ControlFrame's deviceSwitch reads this mapping)",
     !!deviceSwitch(entities["switch.plug"], "switch.plug", back.mapping).ask && !deviceSwitch(entities["switch.plug"], "switch.plug", lamp).ask);
  ck("  ...a stored name is kept; an untouched raw one gives way to the device's own name",
     openDevice({ entityId: "light.desk" }, { "light.desk": { ...live.entityMap["light.desk"], label: "desk" } }, "owner",
       { ...entities, "light.desk": ent("light.desk", "off", { friendly_name: "Desk lamp" }) }).label === "Desk lamp");
  ck("a device removed, or one this profile may not see: none (the window closes)",
     openDevice({ entityId: "nothing.gone" }, {}, "owner", entities) === null && openDevice({ entityId: "switch.plug" }, before, null, entities) === null
     && openDevice(null, before, "owner", entities) === null);
  ck("  ...a camera's details flag is kept", openDevice({ entityId: "camera.gate", detail: true }, live.entityMap, "owner", entities).detail === true);
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const db = strip(readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8"));
  const pr = strip(readFileSync(new URL("../../src/components/panels/PanelRouter.tsx", import.meta.url), "utf8"));
  const oa = strip(readFileSync(new URL("../../src/components/panels/useOpenPanelActions.ts", import.meta.url), "utf8"));
  ck("the page resolves the open device on every render and hands it to the window and its actions (pin the caller)",
     /const activePanel = useMemo\(\s*\(\) => openDevice\(screen\.nav\.panel, config\.entityMap, role, entities\)/.test(db)
     && /useOpenPanelActions\(\{\s*screen, open: activePanel,/.test(db) && /<PanelRouter\s+active=\{activePanel\}/.test(db)
     && /if \(panelGone\) closePanel\(\)/.test(db) && !/screen\.nav\.panel\.mapping/.test(db));
  ck("  ...the window's title and its actions read it, with no copy of their own",
     /const mapping = \{ \.\.\.active\.mapping, label: active\.label \};/.test(pr) && !/displayLabelFor/.test(pr)
     && /const linkedEntityId = activePanel\?\.mapping\.linkedEntityId;/.test(oa) && !/config\.entityMap\[activePanel\.entityId\]/.test(oa));
}

done("✅ the panel's header, derived once");
