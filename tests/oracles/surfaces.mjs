// The windows over the map, one owner (src/pages/surfaces.ts, 2.496.268),
// driven by value; then the callers pinned. The Cockpit was opened and mounted
// inside the top bar while the other windows lived in the Dashboard, "close,
// then open that device" was written four times, and "may this profile open
// it?" was asked at some openers only.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const S = await import("@/pages/surfaces");

const all = { settings: true, facility: true, agent: true, updates: true };
const guest = { settings: false, facility: false, agent: false, updates: false };
const open = (st, s, d) => S.surfacesReducer(st, { type: "open", surface: s, doors: d });

console.log("  what may open:");
ck("a profile without the door never opens it — whichever opener asks",
   ["settings", "configEditor", "agent"].every((s) => !open(S.NO_SURFACES, s, guest)[s]));
ck("  ...the Cockpit and the Rooms list are open to every profile",
   open(S.NO_SURFACES, "cockpit", guest).cockpit && open(S.NO_SURFACES, "rooms", guest).rooms);
const stacked = open(open(S.NO_SURFACES, "settings", all), "configEditor", all);
ck("Advanced Settings opens OVER Settings (both open), and closing it leaves Settings",
   stacked.settings && stacked.configEditor && S.surfacesReducer(stacked, { type: "close", surface: "configEditor" }).settings);
ck("  ...an unchanged state is the same object (no re-render for nothing)",
   open(stacked, "settings", all) === stacked && S.surfacesReducer(S.NO_SURFACES, { type: "close", surface: "agent" }) === S.NO_SURFACES);

ck("a window open when the profile switches to one without its door is no longer shown",
   S.shown(open(S.NO_SURFACES, "agent", all), "agent", all) && !S.shown(open(S.NO_SURFACES, "agent", all), "agent", guest));

console.log("\n  a chip's rooms and its chooser:");
ck("a chip's rooms: distinct, no blanks; none named → its own room",
   S.chipRooms(["Bed", "", "Bed", "Bath"], "Bed").join() === "Bed,Bath" && S.chipRooms([], "Hall").join() === "Hall");
const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");
const ents = { "light.a": { entity_id: "light.a", state: "on", attributes: {} }, "lock.b": { entity_id: "lock.b", state: "unlocked", attributes: {} },
               "light.c": { entity_id: "light.c", state: "unavailable", attributes: {} } };
const src = storeLookSource(ents, { entityMap: {}, alertThresholds: {} });
const where = { "light.a": "Bed", "lock.b": "bath ", "light.c": "Bath" };
const rows = S.roomChoicesFor(["Bed", "Bath"], ["light.a", "lock.b", "light.c", "light.ghost"], (id) => where[id],
  (id) => (ents[id] ? deviceLook(id, src) : undefined));
ck("each row counts its own room's devices (rooms matched by roomKey) and wears its chip's look",
   rows[0].count === 1 && rows[0].frame === "active" && rows[0].health === "ok"
   && rows[1].count === 2 && rows[1].health === "alert", rows);

console.log("\n  the rooms after a refit:");
const fit = [{ name: "Bed", floor: 1, position: { x: 1, y: 0, z: 0 } }];
const saved = [{ name: "Bed", floor: 1, position: { x: 9, y: 0, z: 0 } }, { name: "Landing", floor: 2, position: { x: 0, y: 3, z: 0 } }];
const next = S.mergeTeleportPoints(fit, saved);
ck("fitted rooms refresh, a room the owner added is kept", next.map((p) => `${p.name}:${p.position.x}`).join() === "Bed:1,Landing:0");
ck("  ...nothing moved: null, so nothing is written", S.mergeTeleportPoints(fit, [...fit, saved[1]]) === null);

console.log("\n  the callers:");
const rd = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const dash = rd("pages/Dashboard.tsx"), hud = rd("components/hud/HUD.tsx");
ck("the Dashboard holds the windows in ONE reducer — no window flag of its own",
   /useReducer\(surfacesReducer, NO_SURFACES\)/.test(dash) && !/set(Teleport|Settings|ConfigEditor|Facility|Agent)Open/.test(dash));
ck("  ...the Cockpit (Facility's tabs included) and the Agent hand a device over the same way",
   (dash.match(/onOpenEntity=\{\(id\) => handOver\("(cockpit|agent)", id\)\}/g) ?? []).length === 2);
ck("the top bar mounts no window: it asks the Dashboard to open the Cockpit",
   !/CockpitModal|cockpitOpen/.test(hud) && /onClick=\{onOpenCockpit\}/.test(hud) && !/onOpenAgent|onOpenEntity/.test(hud));
done("✅ one owner for the windows over the map");
