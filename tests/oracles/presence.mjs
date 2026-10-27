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
const why = P.presenceWhy(S, ents, () => "loading", {});
ck("the people it lists, home or away, by name — never another person of the villa's system",
   why.people.map((p) => `${p.name}:${p.place}`).join() === "Ana:Away,Bea:Home", why.people);
ck("  ...the latest movement among ITS sensors — never a motion it does not read, moving or not",
   why.lastActivity?.entityId === "binary_sensor.hall_motion" && !why.lastActivity.moving && why.listsSensors, why.lastActivity);
ck("  ...a sensor that lists nothing: no people, no movement — said so, never everyone",
   (() => { const n = P.presenceWhy(S, { ...ents, [S]: e(S, "off") }, () => "loading", {}); return n.people === null && n.lastActivity === null && !n.listsSensors; })());
{
  const began = { "person.a": { at: 5, before: false }, "binary_sensor.server_activity": { at: Date.parse("2026-10-18T09:00:00Z"), before: false },
    "binary_sensor.hall_motion": { at: Date.parse("2026-10-18T07:00:00Z"), before: true } };
  const w = P.presenceWhy(S, ents, (id) => began[id] ?? null, {});
  ck("  ...each person and the movement say when their state REALLY began (the history's answer), not last_changed",
     w.people.find((p) => p.name === "Ana").since === began["person.a"] && w.people.find((p) => p.name === "Bea").since === null
     && w.lastActivity.at === began["binary_sensor.server_activity"], w);
  ck("  ...the latest movement is the one whose quiet REALLY began last (a restart re-stamped them all)",
     w.lastActivity.entityId === "binary_sensor.server_activity", w.lastActivity);
  ck("  ...the window reads the history of what the sensor lists, people and sensors",
     P.presenceWatched(S, ents).join() === "person.a,person.b,binary_sensor.hall_motion,binary_sensor.server_activity");
}
ck("  ...the settings named after the sensor (one prefix per feature), and no other",
   why.settings.map((s) => `${s.name}=${s.said}`).join() === "Grace=5min", why.settings);

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
   !/<button type="button" class="presence-row opens"><span>Hall<\/span>/.test(all)
   && /<div class="presence-row"><span class="with-tip"><span>Hall<\/span>/.test(all)
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
     && /useStateSince\(presenceWatched\(config\.presenceSensor, entities\)\)/.test(up) && /presenceWhy\(config\.presenceSensor, entities, sinceOf, config\.entityMap\)/.test(up)
     && /<PresenceButton presence=\{p\.presence\} when=\{p\.since\}/.test(tl) && /<PresencePanel presence=\{p\.presence\} when=\{p\.since\} why=\{why\}/.test(tl)
     && !/\.last_changed/.test(up + tl));
}
{
  const { presenceBand } = await import("@/components/hud/PresenceTile");
  const b = presenceBand(S, why);
  ck("  ...charted from the sensor picked in Settings, in the presence's words and colours (no stages named)",
     b.entityId === S && b.words("on") === "Empty" && b.words("off") === "Occupied"
     && b.colorFor("off") === STATUS_COLOR.active && b.colorFor("on") === STATUS_COLOR.idle, b.entityId);
  const placed = draw(h(PresencePanel, { presence: off, when: "x", why, showPeople: true, canOpen: () => false,
    onOpenEntity: () => {}, onClose: () => {}, presenceHistory: h("i", { "data-band": "1" }) }));
  ck("  ...drawn in the window right under its 'now'", /<div class="presence-now"[^>]*>(?:(?!<div)[\s\S])*?<\/div><i data-band="1">/.test(placed),
     placed.slice(0, 400));
}
console.log("\n  each setting explained, each stage charted (owner, 2026-10-24):");
ck("a setting's value in words: a time joined to its unit, a count bare, never \"5.0 min\"",
   [["5.0", "min", "5min"], ["1.0", "h", "1h"], ["90", "min", "1h 30min"], ["3.0", "", "3"], ["2.5", "kW", "2.5 kW"], ["abc", "min", "abc min"]]
     .every(([v, u, w]) => P.settingWords(v, u) === w), ["5.0", "1.0", "3.0"].map((v) => P.settingWords(v, v === "3.0" ? "" : "min")));
const G = "input_number.example_empty_grace", ST = "sensor.example_empty_stage";
const ORDER = [["home", "Someone home"], ["grace", "Away, grace"], ["wait", "Waiting"], ["empty", "Empty"]];
const NW = "input_number.example_empty_noise_window", NP = "input_number.example_empty_noise_pulses";
const told = { ...ents, [S]: e(S, "off", { ...ents[S].attributes, friendly_name: "Example empty", stage_sensor: ST, settings: [
    { label: "Away grace", entities: [G], explain: "How long. Example: with 5min." },
    { label: "Server room noise", value: "3 pulses in 5min", entities: [NP, NW], explain: "A burst of noise." }] }),
  [NP]: e(NP, "3", { friendly_name: "Example empty - noise pulses needed" }),
  [NW]: e(NW, "5", { friendly_name: "Example empty - noise window minutes", unit_of_measurement: "min" }),
  [ST]: e(ST, "wait", { stages: ORDER }) };
const w2 = P.presenceWhy(S, told, () => "loading", {});
// owner, 2026-10-25: the two noise settings as one line; "Villa empty - " off the names; the full names in the (i)
ck("  ...the lines the sensor lists (\"settings\"), in its order: its label, its value, its explanation, then the full names",
   w2.settings.map((s) => `${s.name}=${s.said}`).join() === "Away grace=5min,Server room noise=3 pulses in 5min"
   && w2.settings[0].explain === "How long. Example: with 5min.\n\nIn the villa's system: Grace."
   && w2.settings[1].entityIds.join() === `${NP},${NW}`
   && w2.settings[1].explain.endsWith("In the villa's system: Example empty - noise pulses needed, Example empty - noise window minutes."),
   w2.settings);
{
  const moved = P.presenceWhy(S, { ...told, "binary_sensor.server_activity": e("binary_sensor.server_activity", "on",
    { device_class: "occupancy", friendly_name: "Example empty - server activity" }) }, () => "loading", {}).lastActivity;
  ck("  ...the latest movement named without the sensor's name, its full name in its (i)",
     moved?.name === "Server activity" && moved.full === "In the villa's system: Example empty - server activity.", moved);
}
ck("  ...none listed: its own settings by prefix, each named without the sensor's name, its full name in the (i)",
   P.shortName("Villa empty - away grace minutes", "Villa empty") === "Away grace minutes"
   && P.shortName("Villa empty - server room activity", "villa empty") === "Server room activity"
   && P.shortName("Hall motion", "Villa empty") === "Hall motion" && why.settings[0].explain === "In the villa's system: Grace.",
   why.settings);
ck("  ...the stages are the ones the named stage sensor states, in its order; none named, none",
   w2.stages?.sensorId === ST && w2.stages.order.map(([s]) => s).join() === "home,grace,wait,empty" && why.stages === null, w2.stages);
const c = (s) => P.stageColor(w2.stages, s);
// owner, 2026-10-25: "the different levels of green are not clear enough … when occupied, the red \"active\" colour"
ck("  ...colours: someone home red, empty the other bands' green, each step between its own (amber, then teal), another state no contact's",
   c("home") === STATUS_COLOR.alert && c("empty") === STATUS_COLOR.active && c("grace") === "var(--status-warning)"
   && c("wait") === STATUS_COLOR.transitional && new Set(ORDER.map(([s]) => c(s))).size === 4
   && c("unavailable") === STATUS_COLOR.unavailable, ORDER.map(([s]) => c(s)));
{
  const drawnTip = draw(h(PresencePanel, { presence: off, when: "x", why: w2, showPeople: true, canOpen: () => true, onOpenEntity: () => {},
    onClose: () => {} }));
  ck("  ...drawn: an (i) after the setting's name, its value in words, and the (i) never inside the row's button",
     /About Away grace/.test(drawnTip) && />5min</.test(drawnTip) && />3 pulses in 5min</.test(drawnTip) && !/<button[^>]*>(?:(?!<\/button>).)*<button/s.test(drawnTip), drawnTip.slice(0, 400));
  const { presenceBand } = await import("@/components/hud/PresenceTile");
  const sb = presenceBand(S, w2);
  ck("  ...the band charts the stage sensor when there is one, in its words and colours",
     sb.entityId === ST && sb.words("grace") === "Away, grace" && sb.words("unavailable") === "Presence unknown"
     && sb.colorFor("wait") === P.stageColor(w2.stages, "wait") && sb.colorFor("home") === STATUS_COLOR.alert, sb.entityId);
}

console.log("\n  the heading, the words, the time before the first record (owner, 2026-10-24):");
{
  const { keptBand } = await import("@/ha/historySource");
  const { NO_RECORD, NOT_KEPT, NOT_KEPT_COLOR } = await import("@/utils/stateColors");
  const { chartColours } = await import("@/config/reading");
  const win = { from: 1_000_000, to: 5_000_000 };
  const later = keptBand([{ t: 3_000_000, state: "wait" }], win, undefined);
  ck("a first record later than the window's start: the window opens on \"No record yet\" until it, never blank",
     later[0]?.state === NO_RECORD && later[0].t === win.from && later[1]?.state === "wait", later);
  ck("  ...a record at the start (the state then): nothing added; older than the villa keeps: still \"No longer kept\"",
     keptBand([{ t: win.from, state: "wait" }], win, undefined).length === 1
     && keptBand([{ t: 3_000_000, state: "wait" }], win, 2_000_000)[0].state === NOT_KEPT && keptBand([], win, undefined).length === 0);
  ck("  ...painted as nothing to show, never the grey of a resting state", chartColours(() => "x")(NO_RECORD) === NOT_KEPT_COLOR);
  const sts = { ...w2.stages, now: "wait", since: { at: 7, before: false } };
  ck("a stage the sensor does not list is said in the presence's words, never raw",
     P.stageWords(sts, "unavailable") === "Presence unknown" && P.stageWords(sts, "grace") === "Away, grace");
  const sw = (s) => (s && s !== "loading" ? `T${s.at}` : "");
  const hw = P.presenceHeading(off, "18:11", sts, sw);
  ck("  ...the heading: the stage now, its colour and since when, while on the way to empty",
     hw.label === "Waiting" && hw.color === P.stageColor(sts, "wait") && hw.when === "T7", hw);
  ck("  ...empty, or no stages: the presence itself, with its own since",
     P.presenceHeading(on, "17:12", { ...sts, now: "empty" }, sw).label === "Empty" && P.presenceHeading(on, "17:12", { ...sts, now: "empty" }, sw).when === "17:12"
     && P.presenceHeading(on, "17:12", { ...sts, now: "empty" }, sw).color === STATUS_COLOR.active
     && P.presenceHeading(off, "x", null, sw).label === off.label);
  const drawnHead = draw(h(PresencePanel, { presence: off, when: "x", why: { ...w2, stages: sts }, showPeople: true, canOpen: () => false,
    onOpenEntity: () => {}, onClose: () => {} }));
  ck("  ...drawn: the heading says the stage", /<strong>Waiting<\/strong>/.test(drawnHead), drawnHead.slice(0, 300));
}

done("✅ the villa's presence, always in sight");
