// What is on screen over the map, and every move between them (pages/screen,
// 2.496.305), driven by value.
//
// The rules JOINING the windows, the device panel and the room/category lists
// lived in the Dashboard as callbacks and six loose states, checked only by
// matching the page's source; a hand-over closed its window before asking
// whether the device could open (2.496.274). Each move is an action now.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { START, screenReducer, backLabel } = await import("@/pages/screen");

const OWNER = { settings: true, facility: true, agent: true, updates: true };
const GUEST = { settings: false, facility: false, agent: false, updates: false };
const P = (entityId) => ({ entityId, mapping: { entityId, type: "light", label: entityId } });
const run = (doors, ...acts) => acts.reduce((s, a) => screenReducer(s, a, doors), START);
const label = (s) => backLabel(s, (id) => `dev:${id}`, (c) => `cat:${c}`);

console.log("  handing a device over from a window");
{
  const s = run(OWNER, { type: "openWindow", window: "cockpit", tab: "faults" }, { type: "handOver", from: "cockpit", panel: P("light.a") });
  ck("the device opens and the Cockpit closes; Back says 'Cockpit'", s.nav.panel.entityId === "light.a" && !s.windows.cockpit && label(s) === "Cockpit");
  const b = screenReducer(s, { type: "back" }, OWNER);
  ck("  ...Back reopens the Cockpit on the tab it left", b.windows.cockpit && b.cockpitTab === "faults" && b.nav.panel === null);
  const none = run(OWNER, { type: "openWindow", window: "agent" }, { type: "handOver", from: "agent", panel: null });
  ck("⚠️ a device this profile may not see: NOTHING changes — the window stays open (2.496.274)", none.windows.agent && none.nav.panel === null && none.nav.back.length === 0);
}

console.log("\n  the panel's own moves");
{
  const s = run(OWNER, { type: "openDevice", panel: P("switch.pump") }, { type: "openReading", panel: P("sensor.pump_power") });
  ck("a reading opened from its device: Back names the device and returns to it",
     s.nav.panel.entityId === "sensor.pump_power" && label(s) === "dev:switch.pump" && screenReducer(s, { type: "back" }, OWNER).nav.panel.entityId === "switch.pump");
  const sw = screenReducer(s, { type: "switchPanel", panel: P("sensor.other") }, OWNER);
  ck("  ...a sideways move (a camera's next) keeps the same Back", sw.nav.panel.entityId === "sensor.other" && label(sw) === "dev:switch.pump");
  ck("a fresh open from the map or bottom bar: no Back", label(run(OWNER, { type: "openDevice", panel: P("light.a") })) === null);
  ck("closing the panel clears it and its Back", run(OWNER, { type: "openDevice", panel: P("light.a") }, { type: "closePanel" }).nav.panel === null);
}

console.log("\n  room and category lists");
{
  const room = { kind: "room", room: "Kitchen", entityIds: ["light.a", "light.b"] };
  const s = run(OWNER, { type: "openList", list: room }, { type: "openFromList", panel: P("light.b") });
  ck("a device from a room's list: the list closes, the device opens, Back says the room", s.list === null && s.nav.panel.entityId === "light.b" && label(s) === "Kitchen");
  const b = screenReducer(s, { type: "back" }, OWNER);
  ck("  ...Back reopens that list", b.list && b.list.kind === "room" && b.list.room === "Kitchen" && b.nav.panel === null);
  const cat = run(OWNER, { type: "openList", list: { kind: "category", category: "light" } }, { type: "openFromList", panel: P("light.a") });
  ck("  ...a category's list the same way, named by its category", label(cat) === "cat:light" && screenReducer(cat, { type: "back" }, OWNER).list.category === "light");
  const stay = run(OWNER, { type: "openList", list: room }, { type: "openFromList", panel: null });
  ck("  ...a row this profile may not open: the list stays", stay.list && stay.nav.panel === null);
}

console.log("\n  report a fault, edit this device");
{
  const fm = run(OWNER, { type: "openDevice", panel: P("light.a") }, { type: "reportFault" });
  ck("a profile that manages faults: the Cockpit on Faults, the device filled in, the panel closed",
     fm.windows.cockpit && fm.cockpitTab === "faults" && fm.faultFor === "light.a" && fm.nav.panel === null && fm.guestReportFor === null);
  const opened = screenReducer(fm, { type: "faultFormOpened" }, OWNER);
  ck("  ...the form takes it once; reopening the Cockpit later does not resurrect it", opened.faultFor === null);
  ck("  ...closing the Cockpit forgets it too", screenReducer(fm, { type: "closeWindow", window: "cockpit" }, OWNER).faultFor === null);
  const g = run(GUEST, { type: "openDevice", panel: P("light.a") }, { type: "reportFault" });
  ck("a guest: the one-screen report for that device, no Cockpit", g.guestReportFor === "light.a" && !g.windows.cockpit && g.nav.panel === null);
  ck("  ...closed, it is gone", screenReducer(g, { type: "closeGuestReport" }, GUEST).guestReportFor === null);
  const e = run(OWNER, { type: "openDevice", panel: P("light.a") }, { type: "editDevice" });
  ck("edit this device: Advanced Settings on its row, the panel closed", e.windows.configEditor && e.editorFocus === "light.a" && e.nav.panel === null);
  ck("  ...closing it forgets the row; opened from Settings it has none", screenReducer(e, { type: "closeWindow", window: "configEditor" }, OWNER).editorFocus === null
     && run(OWNER, { type: "openWindow", window: "settings" }, { type: "openWindow", window: "configEditor" }).editorFocus === null);
  ck("  ...a profile without Settings: nothing happens (the panel stays)", run(GUEST, { type: "openDevice", panel: P("light.a") }, { type: "editDevice" }).nav.panel.entityId === "light.a");
}

console.log("\n  the doors");
{
  ck("a window this profile may not open never opens", !run(GUEST, { type: "openWindow", window: "agent" }).windows.agent && !run(GUEST, { type: "openWindow", window: "settings" }).windows.settings);
  ck("the top bar opens the Cockpit on Overview", run(OWNER, { type: "cockpitTab", tab: "faults" }, { type: "openWindow", window: "cockpit", tab: "overview" }).cockpitTab === "overview");
}
done("✅ every move between windows, panels and lists, by value");
