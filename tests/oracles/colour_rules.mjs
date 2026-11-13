// ONE COLOUR PER MEANING, ON EVERY SURFACE (owner, 2026-11-13: "one colour code for every status"). The table is
// utils/stateColors STATUS_COLOR: usual green ("the device is alive, and reporting the usual state"), active purple,
// moving teal, needs a look amber, alarm red, lost contact a light grey, nothing to show the empty track. This drives
// the states of every kind of device through it by value, holds the 3D object's colours, the pills and the theme
// tokens to the same seven meanings, and a device type nobody has seen yet to a sensible answer.
//
// ⚠️ IT GUARDS THE DEVICES TO COME: a new domain or a new state word lands on a meaning here (or falls back to "usual"),
// and a new surface reads STATUS_COLOR — the scan at the end refuses a status colour written anywhere else.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync } from "node:fs";
import { ck, done, tsFiles } from "../consistency/check.mjs";
const { h, draw } = await import("../consistency/screen.mjs");
const {
  STATUS_COLOR, STATUS_PILL_CLASS, NOT_KEPT_COLOR, statusKeyFor, binaryStatus, historyStateColor, powerStatus,
  criticalStatus, paletteColorFor,
} = await import("@/utils/stateColors");
const { STATUS_COLOR3 } = await import("@/babylon/colors");
const { windowStatusOf } = await import("@/config/deviceCondition");
const { presenceOf, presenceStateWords, stageStatus, stageColor } = await import("@/config/presence");
const { default: PowerToggle } = await import("@/components/panels/PowerToggle");

const KEYS = ["usual", "active", "transitional", "warn", "alert", "unavailable", "noValue"];
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");

console.log("  every kind of device, its usual state green and its on/open state purple:");
// [domain or entity id, state, meaning]
const TABLE = [
  ["light", "off", "usual"], ["light", "on", "active"],
  ["fan", "off", "usual"], ["fan", "on", "active"],
  ["switch", "off", "usual"], ["switch", "on", "active"],
  ["humidifier", "off", "usual"], ["humidifier", "on", "active"],
  ["cover", "closed", "usual"], ["cover", "open", "active"], ["cover", "opening", "transitional"], ["cover", "closing", "transitional"],
  ["valve", "closed", "usual"], ["valve", "open", "active"],
  ["lock", "locked", "usual"], ["lock", "unlocked", "warn"], ["lock", "open", "warn"], ["lock", "locking", "transitional"],
  ["lock", "unlocking", "transitional"], ["lock", "jammed", "alert"],
  ["alarm_control_panel", "disarmed", "usual"], ["alarm_control_panel", "armed_away", "active"],
  ["alarm_control_panel", "arming", "transitional"], ["alarm_control_panel", "triggered", "alert"],
  ["media_player", "off", "usual"], ["media_player", "idle", "usual"], ["media_player", "paused", "usual"],
  ["media_player", "playing", "active"], ["media_player", "buffering", "transitional"],
  ["vacuum", "docked", "usual"], ["vacuum", "cleaning", "active"], ["vacuum", "returning", "transitional"],
  ["climate", "off", "usual"], ["climate", "cool", "active"],
  ["person", "not_home", "usual"], ["person", "home", "active"],
  ["sensor", "fault", "alert"], ["sensor", "21.5", "usual"],
];
const bad = TABLE.filter(([d, s, want]) => statusKeyFor(s, d) !== want).map(([d, s, want]) => ({ d, s, want, got: statusKeyFor(s, d) }));
ck("each domain's states read the meaning the rule gives them", bad.length === 0, bad);
ck("  ...the same by a full entity id as by its domain (a lock's \"open\" is not a cover's)",
   statusKeyFor("open", "lock.<room>_door") === "warn" && statusKeyFor("open", "cover.<room>_blind") === "active");

// [device class, state, meaning]: a problem class's problem state red and its other state green; a class in use
// (motion, occupancy, a door) on purple and off green, never red
const BINARY = [
  ["motion", "on", "active"], ["motion", "off", "usual"],
  ["occupancy", "on", "active"], ["occupancy", "off", "usual"],
  ["door", "on", "active"], ["door", "off", "usual"],
  ["moisture", "on", "alert"], ["moisture", "off", "usual"],
  ["smoke", "on", "alert"], ["gas", "on", "alert"], ["tamper", "on", "alert"],
  ["connectivity", "off", "alert"], ["connectivity", "on", "usual"],
  ["plug", "on", "active"], ["plug", "off", "usual"],
];
const binBad = BINARY.map(([dc, s, want]) => ({ dc, s, want,
  got: windowStatusOf({ entity_id: "binary_sensor.<room>_sensor", state: s, attributes: { device_class: dc } }) }))
  .filter((r) => r.got !== r.want);
ck("a binary sensor: a problem marked by its class is red, its other state green; in use purple, at rest green",
   binBad.length === 0, binBad);
ck("  ...the problem state is the alert whichever state it is (\"off\" for a lost link)",
   binaryStatus("off", "off") === "alert" && binaryStatus("on", "off") === "usual" && binaryStatus("on", "on") === "alert");

console.log("\n  no contact, no value, and a device nobody has seen yet:");
const anyDomain = ["light", "lock", "cover", "binary_sensor", "sensor", "lawn_mower", "water_heater", undefined];
ck("\"unavailable\" is lost contact, for every domain", anyDomain.every((d) => statusKeyFor("unavailable", d) === "unavailable"));
ck("\"unknown\", a blank, \"none\" and a missing value are no value, for every domain",
   anyDomain.every((d) => ["unknown", "", "none", null, undefined].every((s) => statusKeyFor(s, d) === "noValue")));
let threw = null, unseen = [];
try {
  unseen = [statusKeyFor("mowing", "lawn_mower"), statusKeyFor("returning", "lawn_mower"), statusKeyFor("error", "lawn_mower"),
    statusKeyFor("unknown", "water_heater"), statusKeyFor("some_vendor_word", "a_domain_nobody_has")];
} catch (e) { threw = String(e); }
ck("a domain never seen falls back to a meaning, never throws: mowing active, returning moving, error red, unknown "
   + "no value, any other word usual", !threw && unseen.join() === "active,transitional,alert,noValue,usual", threw ?? unseen);
ck("  ...and a history bar paints it in a colour of the table", Object.values(STATUS_COLOR).includes(historyStateColor("lawn_mower.x")("docked")));

console.log("\n  the table: seven meanings, seven colours, none a category's:");
ck("STATUS_COLOR has exactly the seven meanings", JSON.stringify(Object.keys(STATUS_COLOR).sort()) === JSON.stringify([...KEYS].sort()),
   Object.keys(STATUS_COLOR));
const tokens = Object.values(STATUS_COLOR);
ck("  ...seven distinct theme tokens", new Set(tokens).size === 7 && tokens.every((t) => /^var\(--[\w-]+\)$/.test(t)), tokens);
ck("  ...none of them a category colour (--cat-*): a category is a device's identity, never a state",
   tokens.every((t) => !t.includes("--cat-")), tokens);
ck("  ...history no longer kept is the empty track, as no value", NOT_KEPT_COLOR === STATUS_COLOR.noValue);
ck("the 3D object's colours have the same seven keys, seven distinct colours",
   JSON.stringify(Object.keys(STATUS_COLOR3).sort()) === JSON.stringify([...KEYS].sort())
   && new Set(Object.values(STATUS_COLOR3).map((c) => c.toHexString())).size === 7, Object.keys(STATUS_COLOR3));
ck("the pills have the same seven keys, seven distinct classes, each drawn by the stylesheet",
   JSON.stringify(Object.keys(STATUS_PILL_CLASS).sort()) === JSON.stringify([...KEYS].sort())
   && new Set(Object.values(STATUS_PILL_CLASS)).size === 7
   && Object.values(STATUS_PILL_CLASS).every((c) => src("styles/03-panels.css").includes(`.status-pill.${c} {`)),
   STATUS_PILL_CLASS);

// Each theme block of the tokens: every status token has a value, the seven are seven colours, and active's purple
// is not the Access control category's (2.496.792 borrowed it for a closed curtain)
const css = src("styles/01-base.css");
const block = (sel) => { const i = css.indexOf(`${sel} {`); return css.slice(i, css.indexOf("\n}", i)); };
const val = (b, name) => (b.match(new RegExp(`--${name}:\\s*([^;]+);`)) ?? [])[1]?.trim();
const BASE = block(":root"), THEMES = { light: BASE, dark: block(':root[data-theme="dark"]'), night: block(':root[data-theme="night"]') };
const themeBad = [];
for (const [name, b] of Object.entries(THEMES)) {
  const own = (t) => val(b, t) ?? val(BASE, t);
  const vals = tokens.map((t) => own(t.slice(6, -1)));
  const cats = [...BASE.matchAll(/--(cat-[\w-]+):/g)].map((m) => own(m[1]));
  if (vals.some((v) => !v) || new Set(vals).size !== 7 || cats.includes(own("status-usual"))) themeBad.push({ name, vals, cats });
}
ck("every theme gives the seven meanings seven colours, its purple none of its category colours", themeBad.length === 0, themeBad);

console.log("\n  the villa's presence, the On button, a critical device:");
const st = { sensorId: "sensor.<villa>_stage", order: [["home", "Someone home"], ["quiet", "Waiting for indoor quiet"],
  ["settle", "Settling"], ["empty", "Empty"]], now: "home", since: null };
ck("presence stages: someone home active, every stage on its way moving, empty usual",
   ["home", "quiet", "settle", "empty"].map((s) => stageStatus(st, s)).join() === "active,transitional,transitional,usual"
   && stageColor(st, "home") === STATUS_COLOR.active, ["home", "quiet", "settle", "empty"].map((s) => stageStatus(st, s)));
ck("  ...a stage it does not list: lost contact grey when unavailable, else no value",
   stageStatus(st, "unavailable") === "unavailable" && stageStatus(st, "unknown") === "noValue");
const villa = (s) => presenceOf("binary_sensor.<villa>_empty", { "binary_sensor.<villa>_empty": { entity_id: "binary_sensor.<villa>_empty", state: s, attributes: {} } });
ck("  ...the villa empty usual, occupied active, lost grey, unknown no value; its band says the same",
   villa("on").tone === "usual" && villa("off").tone === "active" && villa("unavailable").tone === "unavailable"
   && villa("unknown").tone === "noValue" && presenceStateWords("on").tone === "usual" && presenceStateWords("off").tone === "active");
ck("the On button's meaning comes from the table: on active, off usual, no value or moving its state's",
   powerStatus("on", "on", "light.x") === "active" && powerStatus("off", "off", "fan.x") === "usual"
   && powerStatus("on", "on", "switch.x") === "active" && powerStatus("unknown", "unknown", "light.x") === "noValue"
   && powerStatus("unknown", "opening", "cover.x") === "transitional");
// owner, 2026-11-13: the window's pill says the state; the power button names its action in the colour of where it leads
const { actionColor: leadsTo } = await import("@/utils/stateColors");
const { controlPill } = await import("@/config/reading");
const button = (on) => draw(h(PowerToggle, { on, leads: leadsTo("light.x", on ? "off" : "on"), onClick: () => {} }));
ck("  ...the power button says what a tap does, in the colour of where it leads (Turn off: usual; Turn on: active), never a category's",
   button(true).includes("Turn off") && button(true).includes(STATUS_COLOR.usual) && button(false).includes("Turn on")
   && button(false).includes(STATUS_COLOR.active) && !/--cat-|--device-/.test(button(true)), button(true));
const light = (state) => ({ entity_id: "light.x", state, attributes: {} });
ck("  ...and every window's pill says the state the same way: On active, Off usual, an A/C's mode in its words",
   JSON.stringify(controlPill("light.x", light("on"), "on")) === JSON.stringify({ text: "On", tone: STATUS_PILL_CLASS.active })
   && JSON.stringify(controlPill("fan.x", light("off"), "off")) === JSON.stringify({ text: "Off", tone: STATUS_PILL_CLASS.usual })
   && controlPill("climate.x", { entity_id: "climate.x", state: "cool", attributes: {} }, null).tone === STATUS_PILL_CLASS.active);
ck("a critical device: needs a look and lost contact become the alarm; every other meaning stays",
   criticalStatus("warn", true) === "alert" && criticalStatus("unavailable", true) === "alert"
   && criticalStatus("warn", false) === "warn" && KEYS.filter((k) => k !== "warn" && k !== "unavailable").every((k) => criticalStatus(k, true) === k));
ck("a text sensor's words: a word the table knows takes its meaning (\"disconnected\" red), others a series colour, "
   + "never a status", (() => {
     const p = paletteColorFor(["sunny", "disconnected", "cloudy"]);
     return p("disconnected") === STATUS_COLOR.alert && !tokens.includes(p("sunny")) && !tokens.includes(p("cloudy"))
       && p("unavailable") === STATUS_COLOR.unavailable && p("unknown") === STATUS_COLOR.noValue;
   })());

console.log("\n  one table: no status colour written anywhere else:");
// ⚠️ A SCAN, BECAUSE THE OWNER ASKED FOR A DEFINITION FUTURE CODE CANNOT BYPASS (owner, 2026-11-13). These read the
// tokens by name on purpose: the table itself, its 3D twin's comments, and the badge bake resolving them for a canvas.
const ALLOWED = new Set(["utils/stateColors.ts", "babylon/colors.ts", "config/EntityCategories.ts"]);
const root = new URL("../../src/", import.meta.url).pathname;
const leaks = [];
for (const f of tsFiles(root)) {
  const rel = f.slice(root.length);
  if (ALLOWED.has(rel)) continue;
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    const code = line.trim();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
    if (/var\(--status-|var\(--cat-|["'`]--status-/.test(code)) leaks.push(`${rel}:${i + 1}`);
  });
}
ck("no .ts/.tsx outside the table names a status or category token as a colour: read STATUS_COLOR "
   + "(utils/stateColors) for a state, categoryColor for a device's identity", leaks.length === 0, leaks);

// a room's glow: an alarm red, a room in use purple (owner, 2026-11-13)
{
  const { motionRouting, motionLit, motionChanges, NOTHING_LIT } = await import("@/babylon/motionRouting");
  const at = (entityId, deviceClass) => motionRouting({ entityId, deviceClass, on: true, type: "binary_sensor", room: "Laundry",
    cameras: [], hasBeam: () => false, cameraRoom: () => undefined, denied: false, enabled: true });
  const leak = at("binary_sensor.example_leak", "moisture"), motion = at("binary_sensor.example_motion", "motion");
  const calm = motionLit([motion]), wet = motionLit([motion, leak]);
  const again = motionChanges(calm, wet).rooms;
  ck("a leak's room glows as an alarm, a detection's as in use; a lit room whose alarm comes is lit again in red",
     leak.rooms[0]?.alarm === true && !motion.rooms[0]?.alarm && again.length === 1 && again[0].on && again[0].alarm === true
     && motionChanges(NOTHING_LIT, calm).rooms[0]?.alarm === undefined, { leak, motion, again });
}
// an action wears the state it leads to (owner, 2026-11-13: "Unlock door" in the unlocked colour)
{
  const { actionColor, STATUS_COLOR: C } = await import("@/utils/stateColors");
  ck("a button that moves a device is the colour of where it leads: unlock amber (red for a critical door), lock and close the usual colour, open the active one",
     actionColor("lock.example_door", "unlocked") === C.warn && actionColor("lock.example_door", "unlocked", true) === C.alert
     && actionColor("lock.example_door", "locked") === C.usual && actionColor("cover.example_blind", "open") === C.active
     && actionColor("cover.example_blind", "closed") === C.usual);
}
done("✅ one colour per meaning, on every surface, for every device");
