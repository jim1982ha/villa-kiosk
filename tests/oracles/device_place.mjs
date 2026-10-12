// A room's floor, ONE answer for every device list (config/devicePlace.ts — architecture review
// 2026-10-12, candidate 3), by value. It was decided per LIST, from the first device of the room
// that had a Home Assistant floor among that list's devices: the Cockpit and a category's list
// could file the same room on two floors.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const P = await import("@/config/devicePlace");
const C = await import("@/components/cockpit/cockpitData");
const { NO_ROOM_LABEL } = await import("@/config/roomKey");

ck("an HA floor named '2F' is storey 2, its level notwithstanding", P.haFloorNumber("2F", 7) === 2);
ck("  ...a name with no digit falls back to the level", P.haFloorNumber("Upstairs", 1) === 1);
ck("  ...neither: no floor", P.haFloorNumber("Roof", null) === null && P.haFloorNumber(undefined, undefined) === null);

const rooms = { "light.a": "Patio", "light.b": "Patio", "fan.c": "Patio", "light.d": "Hall", "light.e": "Pantry", "light.f": "" };
const ha = { "light.a": 1, "light.b": 2, "fan.c": 2 };                 // Patio: one device on 1F, two on 2F
const plan = [{ name: "Hall", floor: 2 }, { name: "Pantry" }];
const f = P.roomFloors(rooms, plan, ha);
ck("a room is on the floor MOST of its devices are on in Home Assistant", f.get("Patio") === 2, [...f]);
ck("  ...a tie goes to the lower floor", P.roomFloors({ x: "R", y: "R" }, [], { x: 2, y: 1 }).get("R") === 1);
ck("no HA floor: the floor plan's room", f.get("Hall") === 2);
ck("  ...a plan room with no floor is 1F (as before)", f.get("Pantry") === 1);
ck("no room: no floor ('Other')", f.get(NO_ROOM_LABEL) === null && P.floorOfRoom(f, "Unknown room") === null);

// THE defect: two lists, two subsets, one room — one floor.
const lights = C.buildRoomGroups(["light.a"], rooms, f);          // the list holding only the 1F light
const all = C.buildRoomGroups(Object.keys(rooms), rooms, f);
ck("the same room is on the same floor in every list, whatever devices the list holds",
   lights.find((g) => g.room === "Patio").floor === 2 && all.find((g) => g.room === "Patio").floor === 2);
const floors = C.buildFloorGroups(all);
ck("by floor: ascending, 'Other' last, every device once",
   floors.map((g) => String(g.floor)).join() === "1,2,null" && floors.reduce((n, g) => n + g.count, 0) === 6, floors.map((g) => [g.floor, g.count]));

const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
ck("the Cockpit and the category lists read the same answer (useRoomFloors), and nothing else decides a room's floor",
   /buildRoomGroups\(selectableIds, resolvedRooms, roomFloors\)/.test(read("components/cockpit/CockpitOverview.tsx"))
   && /floorOfRoom\(roomFloors, room\)/.test(read("components/panels/SummaryGroupPanel.tsx"))
   && !/haFloor|floorByRoom/.test(read("components/cockpit/cockpitData.ts"))
   && !/function resolveEntityFloor/.test(read("config/EntityMap.ts")));

done("✅ one floor per room, the same in every list");
