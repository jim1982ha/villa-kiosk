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
ck("on = empty (off/idle grey), off = occupied (active green) — the map's own colours",
   on.state === "empty" && on.tone === "idle" && off.state === "occupied" && off.tone === "active", { on, off });

console.log("\n  since when (owner, 2026-10-20: \"since 15:01\" was the time of a restart):");
const history = { at: Date.parse("2026-10-20T01:00:00Z"), before: false };
const stated = "2026-10-18T22:30:00Z";
const emptyStated = P.presenceOf(S, { [S]: e(S, "on", { empty_since: stated }) });
ck("empty, and the sensor states when it became empty: that moment — even when the history says otherwise or is short",
   P.presenceSince(emptyStated, history)?.at === Date.parse(stated) && P.presenceSince(emptyStated, "loading")?.at === Date.parse(stated)
   && P.presenceSince(emptyStated, { at: 0, before: true })?.before === false, P.presenceSince(emptyStated, history));
ck("  ...occupied: the history's start of the run, never the attribute (it says when it became EMPTY)",
   P.presenceSince(P.presenceOf(S, { [S]: e(S, "off", { empty_since: stated }) }), history) === history);
ck("  ...empty without the attribute (another villa), or with a null / not-a-time one: the history's start",
   [{}, { empty_since: null }, { empty_since: "soon" }].every((a) => P.presenceSince(P.presenceOf(S, { [S]: e(S, "on", a) }), history) === history));
ck("  ...never last_changed: the answer carries no restart time of its own",
   P.presenceSince(on, "loading") === "loading" && P.presenceSince(on, null) === null);
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
const why = P.presenceWhy(S, ents, () => "loading");
ck("the people it lists, home or away, by name — never another person of the villa's system",
   why.people.map((p) => `${p.name}:${p.place}`).join() === "Ana:Away,Bea:Home", why.people);
ck("  ...the latest movement among ITS sensors — never a motion it does not read, moving or not",
   why.lastActivity?.entityId === "binary_sensor.hall_motion" && !why.lastActivity.moving && why.listsSensors, why.lastActivity);
ck("  ...a sensor that lists nothing: no people, no movement — said so, never everyone",
   (() => { const n = P.presenceWhy(S, { ...ents, [S]: e(S, "off") }, () => "loading"); return n.people === null && n.lastActivity === null && !n.listsSensors; })());
{
  const began = { "person.a": { at: 5, before: false }, "binary_sensor.server_activity": { at: Date.parse("2026-10-18T09:00:00Z"), before: false },
    "binary_sensor.hall_motion": { at: Date.parse("2026-10-18T07:00:00Z"), before: true } };
  const w = P.presenceWhy(S, ents, (id) => began[id] ?? null);
  ck("  ...each person and the movement say when their state REALLY began (the history's answer), not last_changed",
     w.people.find((p) => p.name === "Ana").since === began["person.a"] && w.people.find((p) => p.name === "Bea").since === null
     && w.lastActivity.at === began["binary_sensor.server_activity"], w);
  ck("  ...the latest movement is the one whose quiet REALLY began last (a restart re-stamped them all)",
     w.lastActivity.entityId === "binary_sensor.server_activity", w.lastActivity);
  ck("  ...the window reads the history of what the sensor lists, people and sensors",
     P.presenceWatched(S, ents).join() === "person.a,person.b,binary_sensor.hall_motion,binary_sensor.server_activity");
}
ck("  ...the settings named after the sensor (one prefix per feature), and no other",
   why.settings.map((s) => `${s.name}=${s.value} ${s.unit}`).join() === "Grace=5 min", why.settings);

console.log("\n  in words:");
const dt = (t) => `D${t}`, dm = (t) => `M${t}`;
ck("since: always the day and time, today included",
   // owner, 2026-10-19: always with its day — today's time alone ("since 18:40") did not say which day
   P.sinceText({ at: 7, before: false }, dt, dm) === "D7" && P.sinceText(null, dt, dm) === "");
ck("  ...older than the villa keeps: \"before\" its first kept day — honest, not a made-up start",
   P.sinceText({ at: 9, before: true }, dt, dm) === "before M9");
ck("  ...while the history is read: a neutral mark, never a time", P.sinceText("loading", dt, dm) === P.SINCE_LOADING
   && !/\d/.test(P.SINCE_LOADING));
ck("the Recap's line", P.recapPresenceText(off, "14:20") === "Villa occupied since 14:20"
   && P.recapPresenceText(on, "") === "Villa empty" && P.recapPresenceText(P.presenceOf(S, {}), "x") === "Villa presence unknown");

console.log("\n  drawn:");
const { PresenceButton } = await import("@/components/hud/PresenceTile");
const tile = draw(h(PresenceButton, { presence: on, when: "19 Oct, 14:20", onClick: () => {} }));
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
const panel = draw(h(PresencePanel, { presence: off, when: "x", why, showPeople: true, canOpen: (id) => id === "person.a",
  onOpenEntity: () => {}, onClose: () => {} }));
ck("a row is a button only when it opens something; the others are plain text (no hover, no pointer)",
   (panel.match(/<button type="button" class="presence-row opens">/g) ?? []).length === 1
   && (panel.match(/<div class="presence-row">/g) ?? []).length === 3, panel.slice(0, 500));
const all = draw(h(PresencePanel, { presence: off, when: "x", why, showPeople: true, canOpen: () => true, onOpenEntity: () => {},
  onClose: () => {}, presenceHistory: h("i", { "data-presence": "band" }) }));
ck("the latest movement is never a button, and has no chart of its own: the villa's band replaces it (owner, 2026-10-20)",
   !/<button type="button" class="presence-row opens"><span>Hall<\/span>/.test(all) && /<div class="presence-row"><span>Hall<\/span>/.test(all)
   && !/data-history/.test(all) && /<\/div><i data-presence="band"><\/i>/.test(all), all);
ck("  ...a profile that may not see people gets no People at all",
   !/People/.test(draw(h(PresencePanel, { presence: off, when: "x", why, showPeople: false, canOpen: () => false, onOpenEntity: () => {}, onClose: () => {} }))));

// owner, 2026-10-20: the window's only band was the latest movement's ("Clear") — the villa's own, in its words
ck("the presence band says the villa's words, as its 'now' does: on Empty, off Occupied, else unknown — same colours",
   ["on", "off", "unavailable"].every((st) => {
     const now = P.presenceOf("binary_sensor.x", { "binary_sensor.x": { entity_id: "binary_sensor.x", state: st, attributes: {}, last_changed: null } });
     const w = P.presenceStateWords(st);
     return w.label === now.label && w.tone === now.tone;
   }));
{
  const up = src("config/usePresence.ts"), tl = src("components/hud/PresenceTile.tsx");
  ck("the screens say THAT since: the tile, the window and the Recap through usePresence; people and movement through usePresenceWhy — no last_changed",
     /const history = useStateSince\(presence && presence\.stated === null \? \[config\.presenceSensor\] : \[\]\);/.test(up)
     && /sinceWords\(presenceSince\(presence, history\(config\.presenceSensor\)\)\)/.test(up)
     && /useStateSince\(presenceWatched\(config\.presenceSensor, entities\)\)/.test(up) && /presenceWhy\(config\.presenceSensor, entities, sinceOf\)/.test(up)
     && /<PresenceButton presence=\{p\.presence\} when=\{p\.since\}/.test(tl) && /<PresencePanel presence=\{p\.presence\} when=\{p\.since\} why=\{why\}/.test(tl)
     && !/\.last_changed/.test(up + tl));
}
const tileSrc = readFileSync(new URL("../../src/components/hud/PresenceTile.tsx", import.meta.url), "utf8");
ck("  ...drawn in the window, right under its 'now', from the sensor picked in Settings",
   /: <LastDayTimeline entityId=\{p\.sensorId\} words=\{\(s\) => presenceStateWords\(s\)\.label\}/.test(tileSrc)
   && /presenceHistory=\{history\}/.test(tileSrc)
   && /<\/div>\s*\{presenceHistory\}/.test(tileSrc));
console.log("\n  each setting explained, each stage charted (owner, 2026-10-24):");
ck("a setting's value in words: a time joined to its unit, a count bare, never \"5.0 min\"",
   [["5.0", "min", "5min"], ["1.0", "h", "1h"], ["90", "min", "1h 30min"], ["3.0", "", "3"], ["2.5", "kW", "2.5 kW"], ["abc", "min", "abc min"]]
     .every(([v, u, w]) => P.settingWords(v, u) === w), ["5.0", "1.0", "3.0"].map((v) => P.settingWords(v, v === "3.0" ? "" : "min")));
const G = "input_number.example_empty_grace", ST = "sensor.example_empty_stage";
const ORDER = [["home", "Someone home"], ["grace", "Away, grace"], ["wait", "Waiting"], ["empty", "Empty"]];
const told = { ...ents, [S]: e(S, "off", { ...ents[S].attributes, stage_sensor: ST, explain: { [G]: "How long. Example: with 5min." } }),
  [ST]: e(ST, "wait", { stages: ORDER }) };
const w2 = P.presenceWhy(S, told, () => "loading");
ck("  ...its explanation is the sensor's own (\"explain\"), and none when it gives none",
   w2.settings[0].explain === "How long. Example: with 5min." && w2.settings[0].said === "5min" && why.settings[0].explain === "", w2.settings);
ck("  ...the stages are the ones the named stage sensor states, in its order; none named, none",
   w2.stages?.sensorId === ST && w2.stages.order.map(([s]) => s).join() === "home,grace,wait,empty" && why.stages === null, w2.stages);
const c = (s) => P.stageColor(w2.stages, s);
ck("  ...colours: someone home the occupied green, empty its grey, the steps between fading in order, another state no contact's",
   c("home") === STATUS_COLOR.active && c("empty") === STATUS_COLOR.idle && /67%/.test(c("grace")) && /33%/.test(c("wait"))
   && c("grace") !== c("wait") && c("unavailable") === STATUS_COLOR.unavailable, ORDER.map(([s]) => c(s)));
{
  const drawnTip = draw(h(PresencePanel, { presence: off, when: "x", why: w2, showPeople: true, canOpen: () => true, onOpenEntity: () => {},
    onClose: () => {} }));
  ck("  ...drawn: an (i) after the setting's name, its value in words, and the (i) never inside the row's button",
     /About Grace/.test(drawnTip) && />5min</.test(drawnTip) && !/<button[^>]*>(?:(?!<\/button>).)*<button/s.test(drawnTip), drawnTip.slice(0, 400));
  ck("  ...the band charts the stage sensor when there is one, in its words and colours (the window's caller)",
     /const st = why\.stages;/.test(tileSrc) && /<LastDayTimeline entityId=\{st\.sensorId\}/.test(tileSrc) && /colorFor=\{\(s\) => stageColor\(st, s\)\}/.test(tileSrc));
}

done("✅ the villa's presence, always in sight");
