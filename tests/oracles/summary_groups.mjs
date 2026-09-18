// tests/oracles/summary_groups.mjs
//
// Does a light that is not the villa's get counted?
//
// ⚠️ THIS FILE USED TO ANSWER THAT QUESTION ABOUT ITSELF. It declared its own
// `lights`/`locks` lambdas, ran them over a fixture, and compared the two — a
// decision record with no import of anything, so `summaryGroups.ts` could have
// been rewritten freely without one line going red. And it had ALREADY drifted
// without being able to say so: the real `locksGroup` takes three parameters
// with `allowed` third and returns `null` for a villa with no locks, and the
// replica modelled neither.
//
// The real functions are imported now. The replica is gone.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { lightsGroup, locksGroup } = await import("@/config/summaryGroups");

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};

const E = (id, state) => [id, { entity_id: id, state, attributes: {} }];
const ents = Object.fromEntries([
  E("light.lounge", "on"), E("light.terrace", "off"),
  E("light.wled_helper", "on"),      // config debris, not a villa device
  E("light.neighbour_shed", "on"),   // someone else's
  E("lock.front", "locked"),
  E("lock.test_lock", "unlocked"),   // a test fixture, not a door
]);
// Only `.has` is ever called, so a plain Set stands in for villaDevices(...).
const villa = new Set(["light.lounge", "light.terrace", "lock.front"]);

console.log("  the villa's own devices, and only those:");
eq("two of four lights are the villa's",
   lightsGroup(ents, villa)?.entityIds, ["light.lounge", "light.terrace"]);
eq("one of two locks is a real door",
   locksGroup(ents, {}, villa)?.entityIds, ["lock.front"]);
// ⚠️ THE ARGUMENT ORDER IS THE PART A REPLICA GETS WRONG. locksGroup takes
// entityMap SECOND and the allow-set THIRD; lightsGroup takes the set second.
// Passing the set where the map belongs silently allows everything, because
// a plain object has no `.has` and the filter falls through to "no allow-list".
eq("...and passing the set in the map's place would count them all",
   locksGroup(ents, villa)?.entityIds.length, 2);

console.log("\n  with no allow-list, every matching entity counts:");
eq("all four lights", lightsGroup(ents)?.entityIds.length, 4);
eq("both locks", locksGroup(ents)?.entityIds.length, 2);

console.log("\n  a villa with none of a kind gets no tile at all:");
// ⚠️ `null`, NOT AN EMPTY GROUP — the replica modelled a length and could not
// have noticed. SummaryBar renders on truthiness, so returning an empty group
// would put a "Lights" tile reading 0 on a villa with no lights.
eq("no lights → no group", lightsGroup({}, villa), null);
eq("no locks → no group", locksGroup({}, {}, villa), null);
eq("...and an allow-list that matches nothing is the same answer",
   lightsGroup(ents, new Set()), null);

console.log("\n  what the lock tile says:");
eq("all locked reads as one state",
   locksGroup(ents, {}, new Set(["lock.front"]))?.title, "Front");
eq("more than one lock is titled collectively",
   locksGroup(ents, {}, new Set(["lock.front", "lock.test_lock"]))?.title, "Locks");

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ the tiles count the villa's own devices"}`);
process.exit(fail ? 1 : 0);
