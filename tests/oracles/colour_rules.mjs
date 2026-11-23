// ONE COLOUR PER MEANING, ON EVERY SURFACE (owner, 2026-11-13: "one colour code for every status"). The table is
// utils/stateColors STATUS_COLOR: usual green ("the device is alive, and reporting the usual state"), active red,
// moving blue, needs attention amber (an alarm included since 2026-11-15: urgency is a pulse, never a colour), lost
// contact a light grey, nothing to show the empty track. This drives the states of every kind of device through it by
// value, holds the 3D object's colours, the pills and the theme tokens to the same six meanings, and a device type
// nobody has seen yet to a sensible answer.
//
// ⚠️ IT GUARDS THE DEVICES TO COME: a new domain or a new state word lands on a meaning here (or falls back to "usual"),
// and a new surface reads STATUS_COLOR — the scan at the end refuses a status colour written anywhere else.
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

const KEYS = ["usual", "active", "transitional", "warn", "unavailable", "noValue"];
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");

console.log("  every kind of device, its usual state green and its on/open state red:");
// [domain or entity id, state, meaning]
const TABLE = [
  ["light", "off", "usual"], ["light", "on", "active"],
  ["fan", "off", "usual"], ["fan", "on", "active"],
  ["switch", "off", "usual"], ["switch", "on", "active"],
  ["humidifier", "off", "usual"], ["humidifier", "on", "active"],
  ["cover", "closed", "usual"], ["cover", "open", "active"], ["cover", "opening", "transitional"], ["cover", "closing", "transitional"],
  ["valve", "closed", "usual"], ["valve", "open", "active"],
  ["cover", "partially_open", "transitional"],
  ["lock", "locked", "usual"], ["lock", "unlocked", "active"], ["lock", "open", "active"], ["lock", "locking", "transitional"],
  ["lock", "unlocking", "transitional"], ["lock", "jammed", "warn"],
  ["alarm_control_panel", "disarmed", "usual"], ["alarm_control_panel", "armed_away", "active"],
  ["alarm_control_panel", "arming", "transitional"], ["alarm_control_panel", "triggered", "warn"],
  ["media_player", "off", "usual"], ["media_player", "idle", "usual"], ["media_player", "paused", "usual"],
  ["media_player", "playing", "active"], ["media_player", "buffering", "transitional"],
  ["vacuum", "docked", "usual"], ["vacuum", "cleaning", "active"], ["vacuum", "returning", "transitional"],
  ["climate", "off", "usual"], ["climate", "cool", "active"],
  ["person", "not_home", "usual"], ["person", "home", "active"],
  ["sensor", "fault", "warn"], ["sensor", "21.5", "usual"],
];
const bad = TABLE.filter(([d, s, want]) => statusKeyFor(s, d) !== want).map(([d, s, want]) => ({ d, s, want, got: statusKeyFor(s, d) }));
ck("each domain's states read the meaning the rule gives them", bad.length === 0, bad);
{
  // owner, 2026-11-15: a cover part of the way open is its own state, in the moving colour; fully open active, closed usual
  const { coverState } = await import("@/utils/panelRules");
  const { coverPill } = await import("@/config/reading");
  ck("a cover open at 47% is partially open, in the moving colour; at 100% open; closed closed; one with no position as it says",
     coverState("open", 47) === "partially_open" && coverState("open", 100) === "open" && coverState("closed", 0) === "closed"
     && coverState("open", undefined) === "open"
     && coverPill("cover.<room>_curtain", "open", 47).tone === STATUS_PILL_CLASS.transitional
     && coverPill("cover.<room>_curtain", "open", 100).tone === STATUS_PILL_CLASS.active
     && coverPill("cover.<room>_curtain", "closed", 0).tone === STATUS_PILL_CLASS.usual);
}
ck("  ...the same by a full entity id as by its domain (a lock's \"open\", its latch held, is in use as a cover's open)",
   statusKeyFor("open", "lock.<room>_door") === "active" && statusKeyFor("open", "cover.<room>_blind") === "active"
   && statusKeyFor("locked", "lock.<room>_door") === "usual");

// [device class, state, meaning]: a problem class's problem state amber and its other state green; a class in use
// (motion, occupancy, a door) on red and off green, never amber
const BINARY = [
  ["motion", "on", "active"], ["motion", "off", "usual"],
  ["occupancy", "on", "active"], ["occupancy", "off", "usual"],
  ["door", "on", "active"], ["door", "off", "usual"],
  ["moisture", "on", "warn"], ["moisture", "off", "usual"],
  ["smoke", "on", "warn"], ["gas", "on", "warn"], ["tamper", "on", "warn"],
  ["connectivity", "off", "warn"], ["connectivity", "on", "usual"],
  ["plug", "on", "active"], ["plug", "off", "usual"],
];
const binBad = BINARY.map(([dc, s, want]) => ({ dc, s, want,
  got: windowStatusOf({ entity_id: "binary_sensor.<room>_sensor", state: s, attributes: { device_class: dc } }) }))
  .filter((r) => r.got !== r.want);
ck("a binary sensor: a problem marked by its class is amber, its other state green; in use red, at rest green",
   binBad.length === 0, binBad);
ck("  ...the problem state needs attention whichever state it is (\"off\" for a lost link)",
   binaryStatus("off", "off") === "warn" && binaryStatus("on", "off") === "usual" && binaryStatus("on", "on") === "warn");

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
ck("a domain never seen falls back to a meaning, never throws: mowing active, returning moving, error amber, unknown "
   + "no value, any other word usual", !threw && unseen.join() === "active,transitional,warn,noValue,usual", threw ?? unseen);
ck("  ...and a history bar paints it in a colour of the table", Object.values(STATUS_COLOR).includes(historyStateColor("lawn_mower.x")("docked")));

console.log("\n  the table: six meanings, six colours, none a category's:");
ck("STATUS_COLOR has exactly the six meanings (owner, 2026-11-15: the alarm is amber)", JSON.stringify(Object.keys(STATUS_COLOR).sort()) === JSON.stringify([...KEYS].sort()),
   Object.keys(STATUS_COLOR));
const tokens = Object.values(STATUS_COLOR);
ck("  ...six distinct theme tokens", new Set(tokens).size === 6 && tokens.every((t) => /^var\(--[\w-]+\)$/.test(t)), tokens);
ck("  ...none of them a category colour (--cat-*): a category is a device's identity, never a state",
   tokens.every((t) => !t.includes("--cat-")), tokens);
ck("  ...history no longer kept is the empty track, as no value", NOT_KEPT_COLOR === STATUS_COLOR.noValue);
ck("the 3D object's colours have the same six keys, six distinct colours",
   JSON.stringify(Object.keys(STATUS_COLOR3).sort()) === JSON.stringify([...KEYS].sort())
   && new Set(Object.values(STATUS_COLOR3).map((c) => c.toHexString())).size === 6, Object.keys(STATUS_COLOR3));
ck("the pills have the same six keys, six distinct classes, each drawn by the stylesheet",
   JSON.stringify(Object.keys(STATUS_PILL_CLASS).sort()) === JSON.stringify([...KEYS].sort())
   && new Set(Object.values(STATUS_PILL_CLASS)).size === 6
   && Object.values(STATUS_PILL_CLASS).every((c) => src("styles/03-panels.css").includes(`.status-pill.${c} {`)),
   STATUS_PILL_CLASS);

// Each theme block of the tokens: every status token has a value, the six are six colours, and the usual colour is
// no category's (2.496.792 borrowed the Access control category's for a closed curtain)
const css = src("styles/01-base.css");
const block = (sel) => { const i = css.indexOf(`${sel} {`); return css.slice(i, css.indexOf("\n}", i)); };
const val = (b, name) => (b.match(new RegExp(`--${name}:\\s*([^;]+);`)) ?? [])[1]?.trim();
const BASE = block(":root"), THEMES = { light: BASE, dark: block(':root[data-theme="dark"]'), night: block(':root[data-theme="night"]') };
const themeBad = [];
for (const [name, b] of Object.entries(THEMES)) {
  const own = (t) => val(b, t) ?? val(BASE, t);
  const vals = tokens.map((t) => own(t.slice(6, -1)));
  const cats = [...BASE.matchAll(/--(cat-[\w-]+):/g)].map((m) => own(m[1]));
  if (vals.some((v) => !v) || new Set(vals).size !== 6 || cats.includes(own("status-usual"))) themeBad.push({ name, vals, cats });
}
ck("every theme gives the six meanings six colours, its usual colour none of its category colours", themeBad.length === 0, themeBad);
{
  // owner, 2026-11-15: every colour of a meaning defined ONE time — the light theme's tokens, and the one mirror the 3D
  // colours, the baked pills and the badge marks read (stateColors.STATUS_HEX), the same values
  // ...and every theme's (owner, 2026-11-22, colour code rule 7: the 3D villa and the room numbers in each theme's shade)
  const { STATUS_HEX, STATUS_HEX_BY_THEME } = await import("@/utils/stateColors");
  const TOKEN = { usual: "status-usual", active: "status-active", transitional: "status-pending", warn: "status-warning",
    unavailable: "status-lost", noValue: "status-off" };
  const blocks = { light: BASE, ...THEMES };
  const off = Object.entries(blocks).flatMap(([name, b]) => Object.entries(TOKEN)
    .filter(([k, t]) => (val(b, t) ?? val(BASE, t))?.toLowerCase() !== STATUS_HEX_BY_THEME[name]?.[k]?.toLowerCase())
    .map(([k, t]) => ({ name, k, token: val(b, t) ?? val(BASE, t), mirror: STATUS_HEX_BY_THEME[name]?.[k] })));
  ck("the table's one hex mirror equals each theme's tokens, theme by theme, meaning by meaning",
     off.length === 0 && Object.keys(STATUS_HEX_BY_THEME).sort().join() === Object.keys(blocks).sort().join()
     && STATUS_HEX === STATUS_HEX_BY_THEME.light, off);
}

// ...and no status colour is the alarm's old violet (owner, 2026-11-15: the alarm merged into amber, urgency is a pulse):
// every status token of every theme a hue at least 30° from the three old values, the token itself gone
const hue = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const apart = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d); };
const OLD_ALARM = ["#6E57B8", "#A48BE0", "#8C76C8"];
const violet = [];
for (const [name, b] of Object.entries(THEMES)) {
  const own = (t) => val(b, t) ?? val(BASE, t);
  if (own("status-alarm")) violet.push({ name, token: "status-alarm", colour: own("status-alarm") });
  for (const m of BASE.matchAll(/--(status-[\w-]+):/g)) {
    const c = own(m[1]);
    if (/^#[0-9a-f]{6}$/i.test(c) && OLD_ALARM.some((o) => apart(c, o) < 30)) violet.push({ name, token: m[1], colour: c });
  }
}
ck("no status colour is the alarm's old violet, in any theme: the alarm is the amber of needs attention", violet.length === 0, violet);

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
// owner, 2026-11-13: the window's pill says the state; the power button names its action. Since 2026-11-22 (colour
// code) its colour is where it leads, as "Lock door" the locked green (owner, 2026-11-22), tinted, never filled
const { controlPill } = await import("@/config/reading");
const { stateFill, pillKey, leadsTo } = await import("@/utils/stateColors");
const button = (on) => draw(h(PowerToggle, { on, leads: leadsTo("light.x", on ? "off" : "on"), onClick: () => {} }));
ck("  ...the power button says what a tap does in words, in the colour of where it leads, never a category's",
   button(true).includes("Turn off") && button(false).includes("Turn on")
   && [button(true), button(false)].every((b) => /class="big-toggle action"/.test(b) && !/--cat-|--device-/.test(b))
   && button(true).includes(`--leads:${STATUS_COLOR.usual}`) && button(false).includes(`--leads:${STATUS_COLOR.active}`), button(true));
ck("  ...every action wears where it leads: Lock door and Close green, Unlock door and Open red",
   leadsTo("lock.x", "locked")["--leads"] === STATUS_COLOR.usual && leadsTo("lock.x", "unlocked")["--leads"] === STATUS_COLOR.active
   && leadsTo("cover.x", "closed")["--leads"] === STATUS_COLOR.usual && leadsTo("cover.x", "open")["--leads"] === STATUS_COLOR.active);
ck("  ...a window's controls read the state from its pill: stateFill of the pill's meaning, white ink on the strong fills, dark on amber",
   pillKey(STATUS_PILL_CLASS.active) === "active" && pillKey(STATUS_PILL_CLASS.warn) === "warn"
   && stateFill("usual")["--state"] === STATUS_COLOR.usual && stateFill("active")["--state-ink"] === "#ffffff"
   && stateFill("warn")["--state-ink"] === "#17191A");
const light = (state) => ({ entity_id: "light.x", state, attributes: {} });
ck("  ...and every window's pill says the state the same way: On active, Off usual, an A/C's mode in its words",
   JSON.stringify(controlPill("light.x", light("on"), "on")) === JSON.stringify({ text: "On", tone: STATUS_PILL_CLASS.active })
   && JSON.stringify(controlPill("fan.x", light("off"), "off")) === JSON.stringify({ text: "Off", tone: STATUS_PILL_CLASS.usual })
   && controlPill("climate.x", { entity_id: "climate.x", state: "cool", attributes: {} }, null).tone === STATUS_PILL_CLASS.active);
{
  // ONE rule per device (architecture review item 5, 2026-11-14): the look carries it, every surface applies it
  const { statusRule } = await import("@/utils/stateColors");
  const crit = statusRule({ critical: true, hidden: false }), hid = statusRule({ critical: true, hidden: true }),
    plain = statusRule({ critical: false, hidden: false });
  ck("a device's rule: critical, its lost contact needs attention; hidden, never amber; plain, every meaning as it is",
     KEYS.every((k) => crit(k) === criticalStatus(k, true) && plain(k) === k && hid(k) !== "warn")
     && hid("unavailable") === "unavailable" && hid("active") === "active", KEYS.map((k) => [k, crit(k), hid(k)]));
}
ck("a critical device: lost contact needs attention (amber); every other meaning stays",
   criticalStatus("unavailable", true) === "warn" && criticalStatus("unavailable", false) === "unavailable"
   && KEYS.filter((k) => k !== "unavailable").every((k) => criticalStatus(k, true) === k));
ck("a text sensor's words: a word the table knows takes its meaning (\"disconnected\" amber), others a series colour, "
   + "never a status", (() => {
     const p = paletteColorFor(["sunny", "disconnected", "cloudy"]);
     return p("disconnected") === STATUS_COLOR.warn && !tokens.includes(p("sunny")) && !tokens.includes(p("cloudy"))
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

// a room's glow: an alarm amber, a room in use red (owner, 2026-11-13; the alarm amber since 2026-11-15)
{
  const { motionRouting, motionLit, motionChanges, NOTHING_LIT } = await import("@/babylon/motionRouting");
  const at = (entityId, deviceClass) => motionRouting({ entityId, deviceClass, on: true, type: "binary_sensor", room: "Laundry",
    cameras: [], hasBeam: () => false, cameraRoom: () => undefined, denied: false, enabled: true });
  const leak = at("binary_sensor.example_leak", "moisture"), motion = at("binary_sensor.example_motion", "motion");
  const calm = motionLit([motion]), wet = motionLit([motion, leak]);
  const again = motionChanges(calm, wet).rooms;
  ck("a leak's room glows as an alarm, a detection's as in use; a lit room whose alarm comes is lit again as an alarm",
     leak.rooms[0]?.alarm === true && !motion.rooms[0]?.alarm && again.length === 1 && again[0].on && again[0].alarm === true
     && motionChanges(NOTHING_LIT, calm).rooms[0]?.alarm === undefined, { leak, motion, again });
}
// ⚠️ THE COLOUR CODE'S RULES (owner, 2026-11-22): a colour says what is true now (1), red only "in use" (2), a control
// quiet at rest (3), brand green never a state (6)
{
  const read = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
  const css = ["01-base.css", "02-hud.css", "03-panels.css", "07-facility.css", "08-shared.css"].map((f) => read(`styles/${f}`)).join("\n");
  ck("rule 1: a button that acts wears where it leads, tinted and outlined (.action, --leads); what is chosen now is filled in the state",
     /\.btn\.action \{\s*background: color-mix\(in srgb, var\(--leads\) 18%/.test(css)
     && /stateFill\(pillKey\(shown\.tone\)\)/.test(read("components/panels/ControlFrame.tsx"))
     && (read("components/panels/CoverPanel.tsx").match(/look="action"/g) ?? []).length === 2
     && /look="action"/.test(read("components/panels/MediaPanel.tsx")) && /big-toggle action/.test(read("components/panels/LockPanel.tsx")));
  ck("rule 2: red is only \"in use\": no app red (--status-danger), no second green (--status-on), no red button",
     !/--status-danger|--status-on\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")) && !/\.btn\.danger|\.danger:hover/.test(css));
  ck("rule 3 (option B): a switch and a padlock filled in their state's colour, green at rest, red in use",
     /\.summary-entity-toggle \{[^}]*background: var\(--status-usual\)/.test(css) && /\.summary-entity-toggle\.on \{ background: var\(--status-active\); \}/.test(css)
     && /\.summary-entity-lock \{[^}]*background: var\(--status-usual\); color: #fff/.test(css) && /\.summary-entity-lock\.open \{ background: var\(--status-active\);/.test(css));
  ck("rule 6: a strip that reports a state takes the status colours: all well green, in between blue, never the brand's",
     /\.strip-ok \{ --strip: var\(--status-usual\); \}/.test(css) && /\.strip-moving \{ --strip: var\(--status-pending\); \}/.test(css));
}
{
  // an error message is amber, as every problem (owner, 2026-11-22, colour code rule 2; it was the app's red, 2026-11-15)
  const { NoticeView } = await import("@/components/hud/Notice");
  const { default: ProblemLine } = await import("@/components/common/ProblemLine");
  const notice = draw(h(NoticeView, { tone: "error", children: "Could not save" }));
  ck("an error notice wears the amber of every problem, never a red",
     notice.includes("var(--status-warning)") && !/--status-(danger|active)/.test(notice), notice);
  const css = readFileSync(new URL("../../src/styles/08-shared.css", import.meta.url), "utf8");
  const line = draw(h(ProblemLine, { children: "Could not save" }));
  ck("  ...and so does an error line (ProblemLine)",
     /class="problem-line"/.test(line) && /\.problem-line \{[^}]*color: var\(--status-warning\)/.test(css), line);
}

console.log("\n  one amber for every problem, urgency by a pulse (owner, 2026-11-15):");
{
  const { markSurface } = await import("@/config/EntityCategories");
  const { healthPill } = await import("@/babylon/colors");
  const { isUrgent, URGENT_MARKS } = await import("@/utils/deviceActivity");
  const { readingOf } = await import("@/config/reading");
  const { statusRule, STATUS_HEX } = await import("@/utils/stateColors");
  const [alarm, fault, critical] = ["alarm", "fault", "critical"].map((m) => markSurface(m).fill);
  ck("a badge's alarm \"!\", its fault \"!\" and a critical device's \"?\" are one amber", alarm === fault && critical === fault
     && !["#6E57B8", "#A48BE0", "#8C76C8"].includes(alarm.toUpperCase()), { alarm, fault, critical });
  ck("  ...and a room's number is that amber for an alarm as for a fault", healthPill("alert").fill === healthPill("fault").fill
     && healthPill("fault").fill === STATUS_HEX.warn, [healthPill("alert"), healthPill("fault")]);
  const leak = readingOf("binary_sensor.<room>_leak", { entity_id: "binary_sensor.<room>_leak", state: "on",
    attributes: { device_class: "moisture" } }, "binary_sensor");
  const silent = readingOf("binary_sensor.<room>_door", { entity_id: "binary_sensor.<room>_door", state: "unavailable",
    attributes: { device_class: "door" } }, "binary_sensor", statusRule({ critical: true, hidden: false }));
  ck("  ...a leak's pill and a critical device's silent pill are amber, the urgent pill",
     leak.status === "warn" && silent.status === "warn" && leak.pill === silent.pill, { leak: leak.pill, silent: silent.pill });
  ck("only an alarm or a critical device silent is urgent (pulses), on either corner of its badge; an open fault does not",
     isUrgent({ mark: "alarm", linkPill: null }) && isUrgent({ mark: "critical", linkPill: null })
     && isUrgent({ mark: null, linkPill: "alarm" }) && !isUrgent({ mark: "fault", linkPill: "fault" })
     && !isUrgent({ mark: "lost", linkPill: "on" }) && URGENT_MARKS.size === 2);

  // what the stylesheet does with an urgent mark: the rules that name a selector, outside and inside reduced motion
  const sheet = ["01-base.css", "02-hud.css", "03-panels.css", "04-modals.css", "07-facility.css", "08-shared.css"]
    .map((f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
  const reduced = [...sheet.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
  const plain = sheet.replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g, "");
  const animation = (css, sel) => {
    let found = null;
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = m[1].split(",").map((x) => x.trim());
      const a = /(?:^|;|\s)animation:\s*([^;]+)/.exec(m[2]);
      if (a && sels.includes(sel)) found = a[1].trim();
    }
    return found;
  };
  const URGENT = [".status-pill.danger", ".icon-btn.has-alert", ".cockpit-attention-danger", ".urgent"];
  const CALM = [".status-pill.warn", ".icon-btn.has-warn", ".cockpit-attention-warn"];
  const moves = URGENT.map((sel) => [sel, animation(plain, sel)]);
  ck("an urgent pill, the alert button, the Cockpit's urgent icon pulse with the one shared pulse",
     moves.every(([, a]) => /^urgent-pulse\b/.test(a ?? "")), moves);
  ck("  ...their amber twins that are not urgent (a fault, a warning) stay still",
     CALM.every((sel) => !animation(plain, sel)), CALM.map((sel) => [sel, animation(plain, sel)]));
  ck("  ...and with reduced motion asked for, nothing pulses: the amber stays",
     URGENT.every((sel) => animation(reduced, sel) === "none !important"), URGENT.map((sel) => [sel, animation(reduced, sel)]));
}
done("✅ one colour per meaning, on every surface, for every device");
