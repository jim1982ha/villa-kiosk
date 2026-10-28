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
const P = (entityId) => ({ entityId });
const run = (doors, ...acts) => acts.reduce((s, a) => screenReducer(s, a, doors), START);
const label = (s) => backLabel(s, (id) => `dev:${id}`, (c) => `cat:${c}`);

console.log("  handing a device over from a window");
{
  const s = run(OWNER, { type: "openWindow", window: "cockpit", tab: "faults" }, { type: "handOver", from: "cockpit", panel: P("light.a") });
  ck("the device opens and the Cockpit closes; Back says 'Cockpit'", s.nav.panel.entityId === "light.a" && !s.windows.cockpit && label(s) === "Cockpit");
  const b = screenReducer(s, { type: "back" }, OWNER);
  ck("  ...Back reopens the Cockpit on the tab it left", b.windows.cockpit && b.cockpitTab === "faults" && b.nav.panel === null);
  const none = run(OWNER, { type: "openWindow", window: "cockpit" }, { type: "handOver", from: "cockpit", panel: null });
  ck("⚠️ a device this profile may not see: NOTHING changes — the window stays open (2.496.274)", none.windows.cockpit && none.nav.panel === null && none.nav.back.length === 0);
}

console.log("\n  Close returns to where the device came from (owner, 2026-10-20)");
{
  const s = run(OWNER, { type: "openWindow", window: "cockpit", tab: "faults" }, { type: "handOver", from: "cockpit", panel: P("fan.all") });
  const c = screenReducer(s, { type: "closePanel" }, OWNER);
  ck("a device the Cockpit handed over: Close closes the device and the Cockpit is back, on its tab",
     c.nav.panel === null && c.windows.cockpit && c.cockpitTab === "faults", c.windows);
  const deep = run(OWNER, { type: "openWindow", window: "cockpit" }, { type: "handOver", from: "cockpit", panel: P("switch.pump") },
    { type: "openReading", panel: P("sensor.pump_power") }, { type: "closePanel" });
  ck("  ...from a reading opened inside it too: every panel closes, the Cockpit is back", deep.nav.panel === null && deep.windows.cockpit);
  const room = { kind: "room", room: "Kitchen", entityIds: ["light.a"] };
  const l = run(OWNER, { type: "openList", list: room }, { type: "openFromList", panel: P("light.a") }, { type: "closePanel" });
  ck("  ...a device from a room's list: Close gives the list back", l.nav.panel === null && l.list && l.list.room === "Kitchen");
  const m = run(OWNER, { type: "openDevice", panel: P("light.a") }, { type: "closePanel" });
  ck("  ...a device opened from the map: Close opens nothing", m.nav.panel === null && !m.windows.cockpit && m.list === null);
  const e = run(OWNER, { type: "openWindow", window: "cockpit" }, { type: "handOver", from: "cockpit", panel: P("light.a") },
    { type: "editDevice" }, { type: "closeWindow", window: "configEditor" });
  ck("Advanced Settings opened from a device: closing it gives the device back, with its own Back",
     e.nav.panel && e.nav.panel.entityId === "light.a" && label(e) === "Cockpit" && !e.windows.configEditor, e.nav);
  const f = run(OWNER, { type: "openDevice", panel: P("light.a") }, { type: "reportFault" }, { type: "closeWindow", window: "cockpit" });
  ck("the Cockpit's fault form opened from a device: closing the Cockpit gives the device back", f.nav.panel && f.nav.panel.entityId === "light.a");
  const g = run(GUEST, { type: "openDevice", panel: P("light.a") }, { type: "reportFault" }, { type: "closeGuestReport" });
  ck("a guest's report from a device: closing it gives the device back", g.nav.panel && g.nav.panel.entityId === "light.a");
  const plain = run(OWNER, { type: "openWindow", window: "cockpit" }, { type: "closeWindow", window: "cockpit" });
  ck("a window opened on its own: closing it opens no device", plain.nav.panel === null);
  const stale = run(OWNER, { type: "openDevice", panel: P("light.a") }, { type: "reportFault" },
    { type: "handOver", from: "cockpit", panel: P("light.b") }, { type: "back" }, { type: "closeWindow", window: "cockpit" });
  ck("  ...a device the Cockpit handed over since: the old one is not brought back", stale.nav.panel === null, stale.nav);
  const map = run(OWNER, { type: "openDevice", panel: P("light.a") }, { type: "reportFault" },
    { type: "openDevice", panel: P("light.b") }, { type: "back" }, { type: "closeWindow", window: "cockpit" });
  ck("  ...nor after a device opened from the map", map.nav.panel === null, map.nav);
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
  ck("a profile that manages faults: the Cockpit's Messages, \"Open a ticket\" pointed at the device, the panel closed",
     fm.windows.cockpit && fm.cockpitTab === "messages" && fm.faultFor === "light.a" && fm.nav.panel === null && fm.guestReportFor === null);
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
  ck("a window this profile may not open never opens", !run(GUEST, { type: "openWindow", window: "configEditor" }).windows.configEditor && !run(GUEST, { type: "openWindow", window: "settings" }).windows.settings);
  ck("the top bar opens the Cockpit on Messages", run(OWNER, { type: "cockpitTab", tab: "faults" }, { type: "openWindow", window: "cockpit", tab: "messages" }).cockpitTab === "messages");
}

console.log("\n  Settings' tabs (ticket 16 of \"One inbox\"): the profile button opens General, the Cockpit's gear Messages");
{
  const gear = run(OWNER, { type: "openWindow", window: "cockpit", tab: "messages" }, { type: "openWindow", window: "settings", settingsTab: "messages" });
  ck("the Cockpit's gear opens Settings on Messages, over the Cockpit", gear.windows.settings && gear.windows.cockpit && gear.settingsTab === "messages", gear);
  const again = run(OWNER, { type: "openWindow", window: "settings", settingsTab: "messages" }, { type: "closeWindow", window: "settings" },
    { type: "openWindow", window: "settings" });
  ck("  ...the profile button opens it on General, wherever it was left", again.settingsTab === "general", again.settingsTab);
  ck("  ...a tab chosen in the strip is kept", run(OWNER, { type: "openWindow", window: "settings" }, { type: "settingsTab", tab: "messages" }).settingsTab === "messages");
}
done("✅ every move between windows, panels and lists, by value");
