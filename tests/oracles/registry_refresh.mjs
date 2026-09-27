// A registry refresh where one request FAILS (ha/registryResolve.placesAfterRefresh,
// and the state provider's use of it).
//
// Before 2.496.194 the provider's guard was `devices.length === 0 &&
// areas.length === 0` over three best-effort fetches that answered `[]` on
// failure — so the AREA registry failing alone re-derived every place from an
// empty area map and blanked every room name and floor number in the villa
// until the next registry event. The resolver was tested; its caller was not.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { placesAfterRefresh } = await import("@/ha/registryResolve");


const rows = [{ entity_id: "light.a", device_id: "d1", area_id: null }, { entity_id: "sensor.b", device_id: null, area_id: "a2" }];
const devices = [{ id: "d1", area_id: "a1" }];
const areas = [{ area_id: "a1", name: "Living", floor_id: "f1" }, { area_id: "a2", name: "Bedroom", floor_id: "f2" }];
const floors = [{ floor_id: "f1", name: "1F", level: null }, { floor_id: "f2", name: "2F", level: null }];
const prev = { areaNames: { "light.a": "Old room", "sensor.b": "Old bedroom" }, floorNumbers: { "light.a": 1, "sensor.b": 2 } };

const all = placesAfterRefresh(prev, rows, { devices, areas, floors });
ck("every registry answered: places re-derived", all.areaNames["light.a"] === "Living" && all.floorNumbers["sensor.b"] === 2, all);
ck("areas failed, devices fine: the previous places are KEPT (this is the blanking case)",
   placesAfterRefresh(prev, rows, { devices, areas: null, floors }) === prev);
ck("devices failed: kept too (a device-bound entity's area comes through its device)",
   placesAfterRefresh(prev, rows, { devices: null, areas, floors }) === prev);
const noFloors = placesAfterRefresh(prev, rows, { devices, areas, floors: null });
ck("only floors failed: room names re-derived, floor numbers kept", noFloors.areaNames["light.a"] === "Living" && noFloors.floorNumbers === prev.floorNumbers);
const empty = placesAfterRefresh(prev, rows, { devices: [], areas: [], floors: [] });
ck("an EMPTY answer is an answer: nothing is in an area, so nothing is placed", Object.keys(empty.areaNames).length === 0 && empty !== prev);

const st = readFileSync(new URL("../../src/ha/HAStateStore.tsx", import.meta.url), "utf8");
ck("the provider maps a failed fetch to null and asks placesAfterRefresh over what it holds",
   /const failed = \(\) => null;/.test(st) && /ws\.getAreaRegistry\(\)\.catch\(failed\)/.test(st)
   && /placesAfterRefresh\(prev, rows, \{ devices, areas, floors \}\)/.test(st) && /if \(places === prev\) return;/.test(st)
   && !/devices\.length === 0 && areas\.length === 0/.test(st));

done("✅ a failed registry keeps the rooms it had");

