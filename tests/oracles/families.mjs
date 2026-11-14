// The device families (owner, 2026-11-14: "no Others family for now"): where a safety sensor goes, which family
// buttons the top bar draws, and the order of the bottom bar's tiles.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { effectiveCategory, subjectOf, CATEGORY_ORDER } = await import("@/config/EntityCategories");
const { occupiedCategories } = await import("@/config/villaVisibility");
const { deriveTiles } = await import("@/config/summaryTiles");

const fam = (id, type, dc, mapping = {}) => effectiveCategory(subjectOf(id, { type, ...mapping }, { attributes: dc ? { device_class: dc } : {} }));

console.log("  a sensor that watches over safety is security, never Others:");
ck("a leak, smoke, gas and carbon monoxide sensor: the access control family",
   ["moisture", "smoke", "gas", "carbon_monoxide"].every((dc) => fam("binary_sensor.<room>_sensor", "binary_sensor", dc) === "access_control"));
ck("  ...one that declares no class, by its name (a leak, a smoke detector)",
   fam("binary_sensor.<room>_leak", "binary_sensor") === "access_control" && fam("binary_sensor.<room>_smoke", "binary_sensor") === "access_control");
ck("  ...but a weather station's rain state, which reports \"moisture\" too, is the weather's (comfort)",
   fam("binary_sensor.<room>_weather_station_rain_state", "binary_sensor", "moisture") === "comfort");
ck("  ...and a family picked by hand still wins",
   fam("binary_sensor.<room>_leak", "binary_sensor", "moisture", { category: "energy", categoryPicked: true }) === "energy");
ck("a siren's switch is security; a pump's (a bore's) energy; a network's (a VPN) the network",
   fam("switch.<room>_siren_switch", "switch") === "access_control" && fam("switch.<room>_bore_relay", "switch") === "energy"
   && fam("switch.<room>_vpn", "switch") === "network");

ck("the owner's families (2026-11-14): a pump's problem sensor energy, a recorder's disk error the network, the villa's presence security, a TV comfort, a voice assistant the network",
   fam("binary_sensor.<room>_pump_overcurrent", "binary_sensor", "problem") === "energy"
   && fam("binary_sensor.<nvr>_disk_error", "binary_sensor", "problem") === "network"
   && fam("binary_sensor.<home>_empty", "binary_sensor") === "access_control"
   && fam("media_player.<room>_tv", "media_player") === "comfort" && fam("assist_satellite.<room>", "assist_satellite") === "network");
ck("  ...a problem sensor naming no device of its own stays where its type goes (Others)",
   fam("binary_sensor.<room>_status", "binary_sensor", "problem") === "others");

console.log("\n  the top bar draws a family's button only while something is in it:");
{
  const ctx = (map) => ({ entityMap: map, entities: Object.fromEntries(Object.keys(map).map((id) => [id, { entity_id: id, state: "off", attributes: {} }])),
    dismissed: new Set(), suppressed: new Set(), mapped: new Set(Object.keys(map)) });
  const map = { "light.<room>": { entityId: "light.<room>", type: "light", label: "L" }, "lock.<door>": { entityId: "lock.<door>", type: "lock", label: "D" } };
  const got = occupiedCategories("owner", ctx(map), true);
  ck("a light and a lock: the light and access control families, nothing else", [...got].join() === "light,access_control", [...got]);
  ck("  ...while the villa loads, every family (the bar never flashes empty)", occupiedCategories("owner", ctx({}), false) === null);
  ck("  ...loaded with nothing mapped: none", occupiedCategories("owner", ctx({}), true)?.size === 0);
}

console.log("\n  the bottom bar's tiles follow the top bar's family order:");
{
  const e = (id, state, attributes = {}) => ({ entity_id: id, state, attributes, last_changed: "", last_updated: "" });
  const entities = {
    "lock.<door>": e("lock.<door>", "locked"), "light.<room>": e("light.<room>", "on"),
    "climate.<room>": e("climate.<room>", "cool", { current_temperature: 24 }),
  };
  const map = Object.fromEntries(Object.keys(entities).map((id) => [id, { entityId: id, type: id.split(".")[0], label: id }]));
  const tiles = deriveTiles(entities, map, {}, () => true, null);
  const ranks = tiles.map((t) => CATEGORY_ORDER.indexOf(t.category));
  ck("comfort, then light, then access control: never a family before one the top bar puts first",
     tiles.length >= 3 && ranks.every((r, i) => i === 0 || ranks[i - 1] <= r), tiles.map((t) => `${t.title}:${t.category}`));
}

done("✅ every device in a family, and the families in one order");
