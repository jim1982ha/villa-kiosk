// A room chip stands for the right badges, and two chips merge into the right one.
//
// ⚠️ chip_merge.mjs TESTS THE MERGE LOOP WITH ITS OWN COMBINE RULE. The rule
// that actually runs — what a merged chip's members, centre, room names and
// ring become — was inline in EntityVisuals.deriveChips and never under test.
// roomChips.ts holds it now (the first slice of the tier resolution); this
// runs the real bucketing and the real combine, inside the real merge loop.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { bucketRoomChips, combineChips, chipSuffixOf, summaryRingRed, summaryRingOn } = await import("@/babylon/roomChips");
const { mergeOverlapping } = await import("@/babylon/boxMerge");

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
// owner, 2026-10-01: red is the legend's "Needs attention" — a device merely ON never rings red
ck("a member that is on gives the chip the neutral 'on' ring, NOT red", chips[0].ringOn === true && chips[0].ringRed === false);
{
  const alerting = bucketRoomChips([M("lock.d", "door", 0, "alert"), M("light.d", "door", 1, "on")], () => true, (k) => k);
  ck("a member that needs attention rings it red, and red wins over 'on'", alerting[0].ringRed === true && alerting[0].ringOn === false);
}
ck("an unavailable member dims it, and does NOT ring it", chips[1].unavailable === true && chips[1].ringRed === false);

console.log("\n  merging:");
{
  const [k, b] = bucketRoomChips(members, clustered, display);
  combineChips(k, b);
  ck("the merged chip holds both rooms' badges", k.ids.join() === "light.k1,light.k2,fan.bed", k.ids);
  ck("  ...its centre is weighted by members (2 at x=1, 1 at x=10 → 4)", Math.abs(k.centre.x - 4) < 1e-9, k.centre.x);
  ck("  ...it keeps the rooms' NAMES, so a tap can offer them", k.roomNames.join() === "Kitchen,Bedroom 1", k.roomNames);
  ck("  ...and every key it now stands for", k.keys.join() === "kitchen,bedroom", k.keys);
  ck("  ...and either one's ring and dimming", k.ringOn && !k.ringRed && k.unavailable);
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

console.log("\n  a summary's ring (2.496.141 — was inline in EntityVisuals, unchecked):");
{
  const alert = { ring: "alert" }, linked = { ring: "linked" }, on = { kind: "on" }, off = { kind: "off" }, na = { kind: "unavailable" };
  ck("showing its devices: red only when EVERY member alerts", summaryRingRed([alert, alert], true) && !summaryRingRed([alert, linked], true));
  ck("  ...three merely-connected cameras (kind 'on', ring not alert) do not ring the card",
     !summaryRingRed([{ kind: "on", ring: "linked" }, { kind: "on", ring: "linked" }, { kind: "on", ring: "linked" }], true));
  ck("  ...a member HA has not reported is not alerting", !summaryRingRed([alert, null], true));
  ck("drawing a count: red only when a member ALERTS, never because one is on",
     summaryRingRed([{ kind: "alert" }, on], false) && !summaryRingRed([off, on], false));
  ck("  ...a member on gives the neutral 'on' ring instead", summaryRingOn([off, on], false) && !summaryRingOn([{ kind: "alert" }, on], false));
  ck("  ...a card showing its devices has no 'on' ring (each chip carries its own)", !summaryRingOn([on, on], true));
  ck("  ...not for unavailable (dimming is its signal), off, or unreported", !summaryRingRed([na, off, null], false));
  ck("the room chip keeps the count rule", bucketRoomChips([M("a", "r", 0, "on"), M("b", "r", 1, "off")], () => true, (k) => k)[0].ringOn
     && bucketRoomChips([M("a", "r", 0, "alert"), M("b", "r", 1, "off")], () => true, (k) => k)[0].ringRed
     && !bucketRoomChips([M("a", "r", 0, "unavailable")], () => true, (k) => k)[0].ringRed);
  const ev = (await import("node:fs")).readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("the group card asks summaryRingRed and keeps no rule of its own",
     /summaryRingRed\(ringMembers, showingDevices\)/.test(ev) && /summaryRingOn\(ringMembers, showingDevices\)/.test(ev)
     && !/ringRed = true;|if \(ring !== "alert"\) ringRed = false/.test(ev));
}

done("✅ a room chip says who is in it, merged or not");

