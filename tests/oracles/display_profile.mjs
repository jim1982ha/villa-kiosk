// The read-only Display profile (owner, 2026-11-24: "a read-only flavor of the app", the villa on a TV): it sees the
// villa and every state, switches nothing, presses no button and talks to no one. Driven by value through the app's own
// resolvers over the one role table (roles.json), and a device window drawn as that profile sees it.
import { register } from "node:module";
import { ck, done } from "../consistency/check.mjs";

// Runs before the alias hook (registered last, asked first): the store's actions context exported, as settings_cards
// does for its state, so a device window draws without a live socket
const HOOK = `
export async function load(url, context, next) {
  const r = await next(url, context);
  if (!url.endsWith("/src/ha/HAStateStore.tsx")) return r;
  return { ...r, source: String(r.source) + "\\nexport { HAActionsContext as __Actions };", shortCircuit: true };
}`;
register(`data:text/javascript,${encodeURIComponent(HOOK)}`);
const { h, draw } = await import("../consistency/screen.mjs");
const { roleCan, panelMapping, mayControlDevice } = await import("@/auth/permissions");
const { ROLE_ORDER, isRole } = await import("@/auth/roles");
const { deriveTiles, tilesForControl } = await import("@/config/summaryTiles");
const { quickSearch } = await import("@/config/quickSearch");
const { offeredButtons } = await import("@/messages/announcements");
const { talksToVesta } = await import("@/messages/conversation");
const { __Actions: HAActions } = await import("@/ha/HAStateStore");
const { PanelActionsProvider, NO_PANEL_ACTIONS } = await import("@/components/panels/PanelActionsContext");
const ControlFrame = (await import("@/components/panels/ControlFrame")).default;

const e = (id, state, attributes = {}) => ({ entity_id: id, state, attributes, last_changed: "", last_updated: "" });
const entities = Object.fromEntries([
  e("light.<room>", "on"), e("lock.<door>", "locked"), e("climate.<room>", "cool", { current_temperature: 24 }),
  e("camera.<gate>", "idle"),
].map((x) => [x.entity_id, x]));
const map = Object.fromEntries(Object.keys(entities).map((id) => [id, { entityId: id, type: id.split(".")[0], label: id }]));

console.log("  a profile among the others:");
ck("the Display is a profile, last on the picker", isRole("display") && ROLE_ORDER.at(-1) === "display");
ck("  ...that switches nothing", !roleCan("display", "controlEntities")
   && ["guest", "owner", "ops"].every((r) => roleCan(r, "controlEntities")));

console.log("\n  a tap on the map opens the device to look:");
// as the map's tap asks (Dashboard): to act when the profile switches devices, to look otherwise
const tap = (role, id) => panelMapping(id, map, role, entities[id], { control: roleCan(role, "controlEntities") });
ck("a light, a lock and an AC open their window for the Display", ["light.<room>", "lock.<door>", "climate.<room>"]
   .every((id) => tap("display", id)?.entityId === id));
ck("  ...a camera does not (no live view on a shared screen)", tap("display", "camera.<gate>") === null
   && tap("owner", "camera.<gate>")?.entityId === "camera.<gate>");
ck("  ...and no device is the Display's to switch from a list", Object.keys(entities)
   .every((id) => !mayControlDevice("display", id, map[id], entities[id])));

console.log("\n  the summary tiles show and count, and act on nothing:");
{
  const tiles = (role) => tilesForControl(deriveTiles(entities, map, {}, () => true, null), roleCan(role, "controlEntities"));
  const shown = tiles("display"), owners = tiles("owner");
  ck("the Display gets every tile the owner gets", shown.map((t) => t.id).join() === owners.map((t) => t.id).join()
     && shown.length >= 3, shown.map((t) => t.id));
  ck("  ...none of them able to act", shown.every((t) => !t.canControl) && owners.some((t) => t.canControl));
}

console.log("\n  a device window: its state, its controls greyed:");
{
  const frame = (control) => draw(h(HAActions.Provider, { value: { ws: null } }, h(PanelActionsProvider,
    { value: { ...NO_PANEL_ACTIONS, may: { ...NO_PANEL_ACTIONS.may, control } } },
    h(ControlFrame, { entity: entities["light.<room>"], mapping: map["light.<room>"], power: true },
      h("input", { type: "range", min: 1, max: 255, defaultValue: 100 })))));
  const ro = frame(false), rw = frame(true);
  const locked = /<fieldset[^>]*disabled[^>]*>[\s\S]*Turn off[\s\S]*type="range"[\s\S]*<\/fieldset>/.test(ro);
  ck("the Display's window says the state and greys its power button and its slider", locked && /On/.test(ro), ro);
  ck("  ...a profile that switches devices has them live", !/disabled/.test(rw) && /Turn off/.test(rw), rw);
}

console.log("\n  nothing pressed, nothing asked:");
const buttons = [{ label: "Unlock", command: "/unlock", acts: false }, { label: "Done", command: "i:1", acts: true }];
ck("an announcement offers the Display no button, the doorbell's Unlock included",
   offeredButtons(buttons, false, false).length === 0 && offeredButtons(buttons, false, true).length === 1);
ck("the Display does not talk to VESTA; the other three do", !talksToVesta("display")
   && ["guest", "owner", "ops"].every(talksToVesta));
{
  const found = quickSearch("room", { devices: Object.keys(entities), src: { entityMap: map, entities, resolvedRooms: {} },
    rooms: [], scenes: [{ entityId: "scene.<evening>", name: "Room evening", memberEntityIds: ["light.<room>"], rooms: [] }],
    mayControl: (id) => mayControlDevice("display", id, map[id], entities[id]), look: true });
  ck("its search finds devices to look at, and no scene to run",
     found.devices.includes("light.<room>") && found.scenes.length === 0, found);
}

done("✅ the Display shows the villa and switches nothing");
