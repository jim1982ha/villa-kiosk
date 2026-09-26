// A room chip stands for the right badges, and two chips merge into the right one.
//
// ⚠️ chip_merge.mjs TESTS THE MERGE LOOP WITH ITS OWN COMBINE RULE. The rule
// that actually runs — what a merged chip's members, centre, room names and
// ring become — was inline in EntityVisuals.deriveChips and never under test.
// roomChips.ts holds it now (the first slice of the tier resolution); this
// runs the real bucketing and the real combine, inside the real merge loop.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { bucketRoomChips, combineChips, chipSuffixOf } = await import("@/babylon/roomChips");
const { mergeOverlapping } = await import("@/babylon/boxMerge");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const M = (id, room, x, kind) => ({ id, room, pos: { x, y: 1, z: 0 }, kind });
const members = [
  M("light.k1", "kitchen", 0, "on"), M("light.k2", "kitchen", 2, "off"),
  M("fan.bed", "bedroom", 10, "unavailable"),
  M("light.hall", "hall", 20, "off"),                  // hall is NOT clustered
];
const clustered = (k) => k !== "hall";
const display = (k) => ({ kitchen: "Kitchen", bedroom: "Bedroom 1" }[k] ?? k);

console.log("  bucketing:");
const chips = bucketRoomChips(members, clustered, display);
ck("one chip per CLUSTERED room, in first-seen order", chips.map((c) => c.key).join() === "kitchen,bedroom", chips.map((c) => c.key));
ck("a chip prints the room's own spelling, not its key", chips[1].room === "Bedroom 1" && chips[1].label === "Bedroom 1");
ck("its centre is its members' mean position", chips[0].centre.x === 1, chips[0].centre);
ck("a member that is on rings the chip red", chips[0].ringRed === true);
ck("an unavailable member dims it, and does NOT ring it", chips[1].unavailable === true && chips[1].ringRed === false);

console.log("\n  merging:");
{
  const [k, b] = bucketRoomChips(members, clustered, display);
  combineChips(k, b);
  ck("the merged chip holds both rooms' badges", k.ids.join() === "light.k1,light.k2,fan.bed", k.ids);
  ck("  ...its centre is weighted by members (2 at x=1, 1 at x=10 → 4)", Math.abs(k.centre.x - 4) < 1e-9, k.centre.x);
  ck("  ...it keeps the rooms' NAMES, so a tap can offer them", k.roomNames.join() === "Kitchen,Bedroom 1", k.roomNames);
  ck("  ...and every key it now stands for", k.keys.join() === "kitchen,bedroom", k.keys);
  ck("  ...and either one's ring and dimming", k.ringRed && k.unavailable);
  ck("  ...and prints \"+1\" for the room it swallowed", k.rooms === 2 && chipSuffixOf(k) === "+1");
}
{
  // The real loop with the real rule: three chips crowded together on screen.
  const cs = bucketRoomChips([M("a", "a", 0), M("b", "b", 1), M("c", "c", 2), M("c2", "c", 2)], () => true, (k) => k.toUpperCase());
  cs.forEach((c, i) => { c.x = i * 5; c.y = 0; c.halfW = 10; c.halfH = 5; });
  const out = mergeOverlapping(cs, 2, (c) => c.ids.length, (keep, drop) => combineChips(keep, drop));
  ck("inside the real merge loop, crowded chips become one holding every badge",
     out.length === 1 && [...out[0].ids].sort().join() === "a,b,c,c2", out.map((c) => c.ids));
  ck("  ...named for every room it covers", [...out[0].roomNames].sort().join() === "A,B,C" && out[0].rooms === 3);
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ a room chip says who is in it, merged or not");
process.exit(fail ? 1 : 0);
