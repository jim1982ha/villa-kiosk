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

console.log("\n  why — only what the sensor itself watches (owner, 2026-10-18):");
const ents = {
  [S]: e(S, "off", { people: ["person.a", "person.b"], sensors: ["binary_sensor.hall_motion", "binary_sensor.server_activity"] }),
  "person.b": e("person.b", "home", { friendly_name: "Bea" }), "person.a": e("person.a", "not_home", { friendly_name: "Ana" }),
  "person.service": e("person.service", "unknown", { friendly_name: "service-account" }),
  "binary_sensor.hall_motion": e("binary_sensor.hall_motion", "off", { device_class: "motion", friendly_name: "Hall" }, "2026-10-18T07:00:00+00:00"),
  "binary_sensor.server_activity": e("binary_sensor.server_activity", "off", { device_class: "occupancy" }, "2026-10-18T05:00:00+00:00"),
  "binary_sensor.parking_motion": e("binary_sensor.parking_motion", "on", { device_class: "motion", friendly_name: "Parking" }, "2026-10-18T08:00:00+00:00"),
  "input_number.example_empty_grace": e("input_number.example_empty_grace", "5", { friendly_name: "Grace", unit_of_measurement: "min" }),
  "input_number.other": e("input_number.other", "1"),
};
const why = P.presenceWhy(S, ents);
ck("the people it lists, home or away, by name — never another person of the villa's system",
   why.people.map((p) => `${p.name}:${p.place}`).join() === "Ana:Away,Bea:Home", why.people);
ck("  ...the latest movement among ITS sensors — never a motion it does not read, moving or not",
   why.lastActivity?.entityId === "binary_sensor.hall_motion" && !why.lastActivity.moving && why.listsSensors, why.lastActivity);
ck("  ...a sensor that lists nothing: no people, no movement — said so, never everyone",
   (() => { const n = P.presenceWhy(S, { ...ents, [S]: e(S, "off") }); return n.people === null && n.lastActivity === null && !n.listsSensors; })());
ck("  ...the settings named after the sensor (one prefix per feature), and no other",
   why.settings.map((s) => `${s.name}=${s.value} ${s.unit}`).join() === "Grace=5 min", why.settings);

console.log("\n  in words:");
ck("since: always the day and time, today included",
   // owner, 2026-10-19: always with its day — today's time alone ("since 18:40") did not say which day
   P.sinceText(new Date().toISOString(), () => "D") === "D" && P.sinceText(at, () => "D") === "D" && P.sinceText("2026-10-16T06:20:00+00:00", () => "D") === "D"
   && P.sinceText(null, () => "D") === "");
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
   && /\{shown\("presence"\) && \(\s*<PresenceWindow onClose=\{\(\) => closeSurface\("presence"\)\} onOpenEntity=\{\(id\) => handOver\("presence", id\)\}\s*canOpen=\{\(id\) => devicePanel\(id\) !== null\} \/>/.test(src("pages/Dashboard.tsx"))
   && /<EntityPicker value=\{config\.presenceSensor\} domains=\{\["binary_sensor"\]\}/.test(src("components/settings/ConfigEditorModal.tsx"))
   && /presenceSensor: villaText,/.test(src("config/deviceConfig.ts")));

const { PresencePanel } = await import("@/components/hud/PresenceTile");
const panel = draw(h(PresencePanel, { presence: off, why, showPeople: true, canOpen: (id) => id === "person.a",
  onOpenEntity: () => {}, onClose: () => {} }));
ck("a row is a button only when it opens something; the others are plain text (no hover, no pointer)",
   (panel.match(/<button type="button" class="presence-row opens">/g) ?? []).length === 1
   && (panel.match(/<div class="presence-row">/g) ?? []).length === 3, panel.slice(0, 500));
const all = draw(h(PresencePanel, { presence: off, why, showPeople: true, canOpen: () => true, onOpenEntity: () => {},
  onClose: () => {}, presenceHistory: h("i", { "data-presence": "band" }) }));
ck("the latest movement is never a button, and has no chart of its own: the villa's band replaces it (owner, 2026-10-20)",
   !/<button type="button" class="presence-row opens"><span>Hall<\/span>/.test(all) && /<div class="presence-row"><span>Hall<\/span>/.test(all)
   && !/data-history/.test(all) && /<\/div><i data-presence="band"><\/i>/.test(all), all);
ck("  ...a profile that may not see people gets no People at all",
   !/People/.test(draw(h(PresencePanel, { presence: off, why, showPeople: false, canOpen: () => false, onOpenEntity: () => {}, onClose: () => {} }))));

// owner, 2026-10-20: the window's only band was the latest movement's ("Clear") — the villa's own, in its words
ck("the presence band says the villa's words, as its 'now' does: on Empty, off Occupied, else unknown — same colours",
   ["on", "off", "unavailable"].every((st) => {
     const now = P.presenceOf("binary_sensor.x", { "binary_sensor.x": { entity_id: "binary_sensor.x", state: st, attributes: {}, last_changed: null } });
     const w = P.presenceStateWords(st);
     return w.label === now.label && w.tone === now.tone;
   }));
const tileSrc = readFileSync(new URL("../../src/components/hud/PresenceTile.tsx", import.meta.url), "utf8");
ck("  ...drawn in the window, right under its 'now', from the sensor picked in Settings",
   /presenceHistory=\{<LastDayTimeline entityId=\{p\.sensorId\} words=\{\(s\) => presenceStateWords\(s\)\.label\}/.test(tileSrc)
   && /<\/div>\s*\{presenceHistory\}/.test(tileSrc));
done("✅ the villa's presence, always in sight");
