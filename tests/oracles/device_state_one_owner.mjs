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
  alertState: alertStateFor(e.attributes.device_class, undefined),
});

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };

/* ── 1. one motion sensor, three surfaces, one answer ─────────────────── */
const motion = ent("binary_sensor.hall", "on", "motion");
const motionBadge = badgeFaceAndRing(read("binary_sensor", motion));
const motionHistory = statusKeyFor("on", "binary_sensor");
const motionIsFault = alertStateFor("motion", undefined) === "on";

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

/* ── 4b. the villa's own override outranks the device_class default ───── */
// This is why `alertState` is a REQUIRED argument. An owner who decides that
// motion in a closed wing IS a fault sets it per entity, and the map badge has
// to honour it — before this, only the panel could see it at all.
const overridden = badgeFaceAndRing({
  type: "binary_sensor", entity: motion, linkedOn: false,
  alertState: alertStateFor("motion", "on"),
});
const overrideWins = alertStateFor("motion", "on") === "on"
  && alertStateFor("moisture", "off") === "off";
console.log(`  motion + per-entity override "on" -> badge ${overridden.face}`);

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
const bothMembersAgree = ["unavailable", "unknown"].every((st) =>
  UNKNOWN_STATES.has(st)
  && badgeFaceAndRing(read("lock", ent("lock.a", st))).face === "unavailable"
  && statusKeyFor(st, "lock") === "unavailable"
  && isUnavailable(ent("lock.a", st)) === true);

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
ck("a per-entity override outranks the device_class default", overrideWins);
ck("  ...and it reaches the map badge, not just the panel", overridden.face === "alert");
ck("the status table's alert words now reach the badge", nowAlerts);
ck("no second alert word-list in the tree", privateLists.length === 0);
ck("the device_class override is combined in exactly one module", overrideCombos.length === 0);
ck("the device_class table is still consulted", binarySensorClassInfo("moisture").alarmState === "on");
ck("both members of UNKNOWN_STATES reach every reader the same way", bothMembersAgree);
ck("no reader spells the pair out for itself", strayPairs.length === 0);
ck("  ...and the deliberately wider set is still wider",
   OFF_STATES.has("off") && OFF_STATES.has("") && !UNKNOWN_STATES.has("off"));
process.exit(fail ? 1 : 0);
