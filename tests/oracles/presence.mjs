// Is the villa seen as empty or occupied (config/presence, components/hud/PresenceTile — owner, 2026-10-18: "always
// be able to see when the villa is seen as occupied or not"). By value, then drawn. The sensor is the villa's own,
// picked in Settings: nothing here names one.
import { readFileSync } from "node:fs";
import { React, h, draw } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const P = await import("@/config/presence");
const { STATUS_COLOR } = await import("@/utils/stateColors");
const { DEFAULT_CONFIG } = await import("@/config/AppConfig");

const at = "2026-10-18T06:20:00+00:00";
const e = (id, state, attrs = {}, lc = at) => ({ entity_id: id, state, attributes: attrs, last_changed: lc });
const S = "binary_sensor.example_empty";

console.log("  what the tile says:");
ck("nothing picked: no answer, so no tile — and nothing is picked by default",
   P.presenceOf("", {}) === null && DEFAULT_CONFIG.presenceSensor === "");
const on = P.presenceOf(S, { [S]: e(S, "on") }), off = P.presenceOf(S, { [S]: e(S, "off") });
ck("on = empty (off/idle grey), off = occupied (active green) — the map's own colours, since when it changed",
   on.state === "empty" && on.tone === "idle" && off.state === "occupied" && off.tone === "active" && on.since === at, { on, off });
ck("  ...unavailable, unknown or a sensor gone: \"Presence unknown\", amber — never read as empty",
   ["unavailable", "unknown"].every((st) => P.presenceOf(S, { [S]: e(S, st) }).state === "unknown")
   && P.presenceOf(S, {}).state === "unknown" && P.presenceOf(S, {}).tone === "unavailable");

console.log("\n  why:");
const ents = {
  [S]: e(S, "off"),
  "person.b": e("person.b", "home", { friendly_name: "Bea" }), "person.a": e("person.a", "not_home", { friendly_name: "Ana" }),
  "binary_sensor.hall_motion": e("binary_sensor.hall_motion", "off", { device_class: "motion", friendly_name: "Hall" }, "2026-10-18T07:00:00+00:00"),
  "binary_sensor.kitchen_motion": e("binary_sensor.kitchen_motion", "on", { device_class: "occupancy", friendly_name: "Kitchen" }, "2026-10-18T05:00:00+00:00"),
  "binary_sensor.door": e("binary_sensor.door", "on", { device_class: "door" }),
  "input_number.example_empty_grace": e("input_number.example_empty_grace", "5", { friendly_name: "Grace", unit_of_measurement: "min" }),
  "input_number.other": e("input_number.other", "1"),
};
const why = P.presenceWhy(S, ents);
ck("every person, home or away, by name", why.people.map((p) => `${p.name}:${p.place}`).join() === "Ana:Away,Bea:Home", why.people);
ck("  ...the latest movement: a sensor moving NOW first, a door is not movement",
   why.lastActivity?.entityId === "binary_sensor.kitchen_motion" && why.lastActivity.moving, why.lastActivity);
ck("  ...the settings named after the sensor (one prefix per feature), and no other",
   why.settings.map((s) => `${s.name}=${s.value} ${s.unit}`).join() === "Grace=5 min", why.settings);

console.log("\n  in words:");
const now = new Date("2026-10-18T09:00:00+00:00");
ck("since: a time today, the day and time otherwise",
   P.sinceText(at, () => "T", () => "D", now) === "T" && P.sinceText("2026-10-16T06:20:00+00:00", () => "T", () => "D", now) === "D"
   && P.sinceText(null, () => "T", () => "D", now) === "");
ck("the Recap's line", P.recapPresenceText(off, "14:20") === "Villa occupied since 14:20"
   && P.recapPresenceText(on, "") === "Villa empty" && P.recapPresenceText(P.presenceOf(S, {}), "x") === "Villa presence unknown");

console.log("\n  drawn:");
const { PresenceButton } = await import("@/components/hud/PresenceTile");
const tile = draw(h(PresenceButton, { presence: on, onClick: () => {} }));
ck("the tile: its icon in the state's colour, its short word, and in full for a screen reader and the mouse",
   tile.includes(`--tone:${STATUS_COLOR.idle}`) && />Empty<\/span>/.test(tile) && /aria-label="Empty since [^"]+\. Tap to see why\."/.test(tile), tile);
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
ck("under the floors on every screen, picked in Settings › Villa from on/off sensors, shared by every screen",
   /<PresenceTile onOpen=\{onOpenPresence\} \/>/.test(src("components/hud/HUD.tsx"))
   // its window is the Dashboard's, as every window over the map (pages/surfaces)
   && /\{shown\("presence"\) && \(\s*<PresenceWindow onClose=\{\(\) => closeSurface\("presence"\)\} onOpenEntity=\{\(id\) => handOver\("presence", id\)\} \/>/.test(src("pages/Dashboard.tsx"))
   && /<EntityPicker value=\{config\.presenceSensor\} domains=\{\["binary_sensor"\]\}/.test(src("components/settings/ConfigEditorModal.tsx"))
   && /presenceSensor: villaText,/.test(src("config/deviceConfig.ts")));

done("✅ the villa's presence, always in sight");
