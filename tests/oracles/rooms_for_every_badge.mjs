// Every entity the kiosk shows gets a room (config/EntityMap.resolveRooms and
// Dashboard's id set) — 2.496.202.
//
// The resolver walked the STORED mappings only. A device the model carries
// through a mesh binding has no stored mapping (its mapping is built on the
// fly), so it got no room: "Other", the one bucket the placement pass will
// not fold into a chip. The owner's TV — in the Living Room in Home Assistant
// through its device — sat drawn on top of the collapsed "Living Room 18".
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { resolveRooms } = await import("@/config/EntityMap");

console.log("  the rule:");
{
  const areas = { "media_player.tv": "Living Room", "light.a": "Kitchen" };
  const geo = (id) => (id === "sensor.wall" ? "Bedroom 1" : null);
  const r = resolveRooms(["media_player.tv", "light.a", "sensor.wall", "switch.nowhere", "light.a"], areas, geo);
  ck("Home Assistant's Area wins", r["media_player.tv"] === "Living Room" && r["light.a"] === "Kitchen");
  ck("  ...else the room the anchor is in", r["sensor.wall"] === "Bedroom 1");
  ck("  ...else no room (empty, which reads as 'Other')", r["switch.nowhere"] === "");
  ck("an id given twice is resolved once", Object.keys(r).length === 4);
  // every entity is asked now (2026-10-15): the model is asked only for one Home Assistant gives no area
  const asked = [];
  resolveRooms(["media_player.tv", "sensor.wall"], areas, (id) => { asked.push(id); return null; });
  ck("  ...the model asked only where Home Assistant has no area", asked.join() === "sensor.wall", asked);
}
console.log("\n  the set:");
{
  const dash = readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  ck("the model's own entities (mesh-bound included) AND the stored mappings",
     /new Set<string>\(\[\.\.\.mappedEntityIds, \.\.\.Object\.keys\(config\.entityMap\),/.test(dash));
  // owner, 2026-10-15: a fault on a sensor the model does not draw ("House & Pool Relay Temperature") had no room line —
  // architecture review the same day: not one more source to join, EVERY entity Home Assistant has
  ck("  ...and every entity Home Assistant has, re-run only when that id set changes",
     /const haIdsKey = useMemo\(\(\) => Object\.keys\(entities\)\.sort\(\)\.join\("\\n"\), \[entities\]\);/.test(dash)
     && /\.\.\.\(haIdsKey \? haIdsKey\.split\("\\n"\) : \[\]\)\]\);/.test(dash));
  ck("  ...and every linked/motion target", /if \(mapping\.linkedEntityId\) ids\.add\(mapping\.linkedEntityId\);\s*if \(mapping\.motionEntityId\) ids\.add\(mapping\.motionEntityId\);/.test(dash));
  ck("  ...through the one rule, re-run when the model's entity set changes",
     /resolveRooms\(ids, entityAreaNames, \(id\) => manager\.roomForEntity\(id\)\)/.test(dash) && /\[manager, entityAreaNames, config\.entityMap, mappedEntityIds, haIdsKey, setResolvedRooms\]/.test(dash));
}
done("✅ every badge has a room to fold into");
