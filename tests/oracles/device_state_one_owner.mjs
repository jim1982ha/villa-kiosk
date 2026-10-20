// "What state is this device in" must have ONE owner.
//
// ⚠️ THIS ORACLE RUNS THE SHIPPED MODULES, not a transcription of them. A copy
// written for the test would agree with itself forever while the app moved —
// the exact failure this repo has recorded. The alias hook next door lets plain
// `node` import the real `src/` TypeScript.
//
// Three surfaces described one motion sensor three ways: the map badge rang
// RED, the panel pill said "Motion detected" in its calm category colour, and
// the history bar under that pill painted the same instant GREEN — while the
// Map-colours legend told the resident red means "needs attention". And a lock
// Home Assistant had lost contact with rendered its switch as UNLOCKED.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

register("../consistency/alias-hook.mjs", import.meta.url);

const { classifyDeviceActivity, badgeFaceAndRing } = await import("@/utils/deviceActivity");
const { alertStateFor, binarySensorClassInfo } = await import("@/config/BinarySensorClasses");
const { switchPosition, OFF_STATES } = await import("@/utils/entityState");
const { statusKeyFor, STATUS_COLOR, UNKNOWN_STATES, isUnavailable } =
  await import("@/utils/stateColors");

const ent = (id, state, dc) => ({
  entity_id: id, state, attributes: dc ? { device_class: dc } : {},
});
/** A badge reading with no per-entity override configured. */
const read = (type, e) => ({
  type, entity: e, linkedOn: false,
  alertState: alertStateFor(e.attributes.device_class),
});

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };

/* ── 1. one motion sensor, three surfaces, one answer ─────────────────── */
const motion = ent("binary_sensor.hall", "on", "motion");
const motionBadge = badgeFaceAndRing(read("binary_sensor", motion));
const motionHistory = statusKeyFor("on", "binary_sensor");
const motionIsFault = alertStateFor("motion") === "on";

console.log("  a motion sensor reading `on`:");
console.log(`      badge face   : ${motionBadge.face}`);
console.log(`      history bar  : ${motionHistory}`);
console.log(`      panel alerts : ${motionIsFault}`);

/* ── 2. a real hazard still shouts ────────────────────────────────────── */
const leak = ent("binary_sensor.tank", "on", "moisture");
const leakKind = classifyDeviceActivity(read("binary_sensor", leak));

/* ── 3. connectivity is inverted, and used to be read backwards ───────── */
const connUp = classifyDeviceActivity(read("binary_sensor", ent("binary_sensor.ap", "on", "connectivity")));
const connDown = classifyDeviceActivity(read("binary_sensor", ent("binary_sensor.ap", "off", "connectivity")));

/* ── 4. a lock nobody can see has no switch position ──────────────────── */
const lockPositions = {
  locked: switchPosition(ent("lock.front", "locked"), "lock"),
  unlocked: switchPosition(ent("lock.front", "unlocked"), "lock"),
  unavailable: switchPosition(ent("lock.front", "unavailable"), "lock"),
  unknown: switchPosition(ent("lock.front", "unknown"), "lock"),
  jammed: switchPosition(ent("lock.front", "jammed"), "lock"),
  locking: switchPosition(ent("lock.front", "locking"), "lock"),
};
console.log("  lock switch positions:", JSON.stringify(lockPositions));

/* ── 5. the two alert word-lists became one ───────────────────────────── */
// `jammed` and `triggered` were in the status table and NOT in the private set
// deviceActivity carried, so a sensor reporting them drew a red history
// segment under a badge that did not ring.
const wasMissing = ["jammed", "triggered"];
const nowAlerts = wasMissing.every(
  (w) => classifyDeviceActivity(read("sensor", ent("sensor.x", w))) === "alert");

/* ── 6. and no second word-list survives in the tree ──────────────────── */
const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const FILES = walk(SRC);
// A DECLARATION, not a mention: the tombstone comments that name the deleted
// set are the record of why it went, and must not read as a second copy.
const privateLists = FILES.filter((f) =>
  /SENSOR_ALERT_STATES\s*=/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length + 1));
// "which state of this binary_sensor is a fault" must be composed in one place
const overrideCombos = FILES.filter((f) =>
  /alertState\s*\?\?\s*|\?\?\s*defaultAlarmState/.test(readFileSync(f, "utf8"))
  && !f.endsWith("BinarySensorClasses.ts")).map((f) => f.slice(SRC.length + 1));

console.log(`\n  scanned ${FILES.length} source files`);
if (privateLists.length) console.log(`      second alert list in: ${privateLists.join(", ")}`);
if (overrideCombos.length) console.log(`      override re-combined in: ${overrideCombos.join(", ")}`);

/* ── 7. "the value is not known" has ONE owner, and it is a SET ────────── */
// The pair `"unavailable"`/`"unknown"` was spelled out in SEVEN places on this
// branch. Two of them held a `HassEntity` and could have called `isUnavailable`
// and did not; the other four read a bare state STRING — a history point, a
// merged status map, a camera's own status — where that predicate does not fit
// at all. So the shared thing has to be the SET.
//
// ⚠️ THE BEHAVIOURAL HALF ALONE WOULD NOT CATCH THE REGRESSION. Every reader
// agrees today whether or not they share a definition; what breaks is the
// EIGHTH reader, written next year, spelling the pair out again and then
// diverging. So the scan below is the real assertion and the calls above it
// only prove the set is the one actually in use.
const unknownReaders = [
  ["badgeKindFor (map badge)", badgeFaceAndRing(read("lock", ent("lock.a", "unavailable"))).face],
  ["statusKeyFor (history bar)", statusKeyFor("unavailable", "lock")],
  ["isUnavailable (panels)", isUnavailable(ent("lock.a", "unknown"))],
];
// Both members show no value (isUnavailable: a panel has nothing to print); only "unavailable" is LOST CONTACT — the
// map's amber badge, as the Cockpit's offline lists (stateColors.contactOf; architecture review scan 1, 2026-10-19:
// an "unknown" sensor rang amber on the map, and a lock in "unknown" was painted red, while the Cockpit called it fine)
const { contactOf } = await import("@/utils/stateColors");
// ⚠️ AND THE HISTORY BAR SPLITS THEM TOO (owner, 2026-10-19): statusKeyFor read "unknown" as "unavailable", so an
// unknown stretch was painted the amber of lost contact under a quiet badge. "unknown" is idle now.
const bothMembersAgree = ["unavailable", "unknown"].every((st) =>
  UNKNOWN_STATES.has(st) && isUnavailable(ent("lock.a", st)) === true)
  && statusKeyFor("unavailable", "lock") === "unavailable" && statusKeyFor("unknown", "lock") === "idle"
  && statusKeyFor("", "sensor") === "unavailable" && statusKeyFor("none", "sensor") === "unavailable"
  && badgeFaceAndRing(read("lock", ent("lock.a", "unavailable"))).face === "unavailable"
  && contactOf("unavailable") === "lost" && contactOf(undefined) === "lost" && contactOf("unknown") === "no-value"
  && contactOf("locked") === "ok";
const unknownIsQuiet = !["unavailable", "alert"].includes(badgeFaceAndRing(read("lock", ent("lock.a", "unknown"))).face)
  && !["unavailable", "alert"].includes(badgeFaceAndRing(read("sensor", ent("sensor.x", "unknown", "temperature"))).face);

// A line of CODE (not a comment) naming both members, anywhere but the owner.
const OWNER = "utils/stateColors.ts";
const inlinePairs = FILES.filter((f) => {
  const rel = f.slice(SRC.length + 1);
  if (rel === OWNER) return false;
  return readFileSync(f, "utf8").split("\n").some((ln) => {
    const code = ln.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    return /"unavailable"/.test(code) && /"unknown"/.test(code);
  });
}).map((f) => f.slice(SRC.length + 1));

// ⚠️ `OFF_STATES` IS NOT ONE OF THESE AND MUST NOT BECOME ONE. It is wider on
// purpose — it carries `"off"` and `""` as well — so it answers "is this thing
// not on", which is a different question from "is this thing unreachable".
// Same reason `statusKeyFor`'s blank branch keeps `""`/`"none"` spelled out.
const WIDER_ON_PURPOSE = ["utils/entityState.ts"];
const strayPairs = inlinePairs.filter((f) => !WIDER_ON_PURPOSE.includes(f));

console.log(`\n  unknown-state readers: ${unknownReaders.map(([n, v]) => `${n}=${v}`).join(", ")}`);
if (strayPairs.length) console.log(`      pair spelled out again in: ${strayPairs.join(", ")}`);

console.log("\n  assertions:");
ck("the scan reached the source tree", FILES.length > 100);
ck("a motion sensor does not ring as a fault", motionBadge.face === "active");
ck("  ...and its history bar agrees", STATUS_COLOR[motionHistory] === STATUS_COLOR.active);
ck("  ...and the panel does not flag it", motionIsFault === false);
ck("a leak sensor still alerts", leakKind === "alert");
ck("connectivity alerts when DOWN, not when up", connDown === "alert" && connUp !== "alert");
ck("a locked door reads off, an unlocked one on",
   lockPositions.locked === "off" && lockPositions.unlocked === "on");
ck("an unavailable lock claims NO position",
   lockPositions.unavailable === "unknown" && lockPositions.unknown === "unknown");
// A jammed lock DID report: the door is not secured, and the person wants the
// retry. Only an unobserved state withholds the control.
ck("a jammed lock reads not-secured, and keeps its retry", lockPositions.jammed === "on");
ck("a lock in motion claims no position", lockPositions.locking === "unknown");
ck("the status table's alert words now reach the badge", nowAlerts);
ck("no second alert word-list in the tree", privateLists.length === 0);
ck("the device_class override is combined in exactly one module", overrideCombos.length === 0);
ck("the device_class table is still consulted", binarySensorClassInfo("moisture").alarmState === "on");
// The LINKED ring (2.496.239): the badge's own colour, never the
// "Needs attention" red the legend reserves for alarms.
{
  const { categorySurfaceRinged } = await import("@/config/EntityCategories");
  const power = ent("sensor.x", "12", "power");
  const linked = badgeFaceAndRing({ ...read("sensor", power), linkedOn: true });
  const rest = badgeFaceAndRing(read("sensor", power));
  ck("a linked entity on rings the badge, the face unchanged", linked.face === rest.face && linked.ring !== rest.ring);
  ck("  ...in the badge's category colour (the 'active' ring), not the alarm red", linked.ring === "active");
  const leakLinked = badgeFaceAndRing({ ...read("binary_sensor", ent("binary_sensor.tank", "on", "moisture")), linkedOn: true });
  ck("  ...while a face that IS alerting keeps its red ring", leakLinked.ring === "alert");
  const s = categorySurfaceRinged("energy", linked.face, linked.ring, "#123456");
  ck("  ...and a per-badge colour is the ring's colour", s.ring === "#123456");
  // 2.496.240: the KIND a room chip or a count card reads — linked on is "on", never "alert"
  const { badgeKindFor } = await import("@/utils/deviceActivity");
  ck("a linked entity on counts as ON for a room chip, never as needs-attention", badgeKindFor({ ...read("sensor", power), linkedOn: true }) === "on");
}
ck("both members of UNKNOWN_STATES show no value; only \"unavailable\" is lost contact (contactOf) — on the history bar too", bothMembersAgree);
ck("  ...an \"unknown\" device is quiet on the map — never the amber of lost contact, never a lock's red", unknownIsQuiet);
ck("no reader spells the pair out for itself", strayPairs.length === 0);
ck("  ...and the deliberately wider set is still wider",
   OFF_STATES.has("off") && OFF_STATES.has("") && !UNKNOWN_STATES.has("off"));
// ONE READING OF A LOCK (architecture review scan 2, 2026-10-19: five answers — the window's header showed an open
// padlock for a jammed, locking or unavailable lock beside a closed one on its pill)
{
  const { lockBolt } = await import("@/config/reading");
  const { switchPosition } = await import("@/utils/entityState");
  const { lockFacts } = await import("@/config/villaSummary");
  const STATES = ["locked", "unlocked", "open", "jammed", "locking", "unlocking", "unavailable", "unknown"];
  const ents = Object.fromEntries(STATES.map((st) => [`lock.${st}`, { entity_id: `lock.${st}`, state: st, attributes: {} }]));
  const facts = lockFacts(ents);
  const agree = STATES.every((st) => {
    const b = lockBolt(st), sw = switchPosition(ents[`lock.${st}`]), id = `lock.${st}`;
    const counted = facts.locked.includes(id) ? "thrown" : facts.unlocked.includes(id) ? "open" : "neither";
    return (b === "thrown") === (sw === "off") && (b === "open" || b === "jammed") === (sw === "on")
      && counted === (b === "thrown" || b === "open" ? b : "neither");
  });
  ck("every lock state reads the same to the switch, the summary's counts and the bolt", agree,
     STATES.map((st) => [st, lockBolt(st), switchPosition(ents[`lock.${st}`])]));
  ck("  ...an open padlock only where the lock says it is not secured",
     STATES.filter((st) => lockBolt(st) === "open").join() === "unlocked,open");
  const panel = readFileSync(new URL("../../src/components/panels/LockPanel.tsx", import.meta.url), "utf8");
  ck("  ...and the lock window's header and pill draw the same padlock",
     /const PadIcon = bolt === "open" \? Unlock : Lock;/.test(panel) && (panel.match(/<PadIcon size=/g) ?? []).length === 2
     && !/entity\?\.state === "(un)?locked"/.test(panel));     // its buttons keep their own icons: they say what they do
}
process.exit(fail ? 1 : 0);
