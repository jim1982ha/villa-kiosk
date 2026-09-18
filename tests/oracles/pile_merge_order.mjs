// Which devices share a card must not depend on the order the piles arrive in.
//
// ⚠️ THIS FIXTURE WAS WRONG AND THE ORACLE PASSED THE DEFECT FOR IT. The first
// version built each pile's box as a BOUNDING BOX over its members, which is
// monotone under merging — so all 24 orderings produced ONE partition and the
// eight "distinct outcomes" it reported were differences in member order
// INSIDE a pile. The caller re-sorts every surviving pile immediately
// afterwards (EntityVisuals.sortCardMembers), so that difference never reaches
// the screen. The oracle pinned a real order-dependence and not the one that
// shows.
//
// The real caller's box is centred on the pile's CENTROID with a size from
// `cardOf(pile.length)` — see EntityVisuals.ts:7645-7659. Fusing therefore
// MOVES the survivor instead of covering its parents, and monotonicity is
// exactly what makes a fixed point unique. That is the defect, and this is now
// the geometry that exposes it.
// ⚠️ `../../`, NOT `../../../` — `run-all.sh` cd's into THIS directory, and the
// path was written while this file lived in `open/`. Moving it up a level broke
// the import and the suite reported a FAILURE that was the oracle not loading
// rather than the rule not holding, which is the same shape as the cwd bug
// `fault_open_one_owner` records.
import { mergeCollidingPiles } from "../../src/babylon/badgePlacement.ts";

function* perms(a) {
  if (a.length <= 1) { yield a; return; }
  for (let i = 0; i < a.length; i++)
    for (const rest of perms([...a.slice(0, i), ...a.slice(i + 1)]))
      yield [a[i], ...rest];
}

/** The real caller's shape: centroid-centred, fixed half-extent per row. */
const centroidBox = (pile) => ({
  cx: 0,
  cy: pile.reduce((s, c) => s + c.cy, 0) / pile.length,
  hw: 5,
  hh: 5,
});

/** What the screen actually shows: which devices share a card. */
const partitionOf = (out) =>
  out.map((p) => p.map((c) => c.id).sort().join("+")).sort().join("  |  ");

function sweep(chips, boxOf) {
  const seen = new Map();
  for (const order of perms(chips)) {
    const piles = order.map((c) => [c]);
    mergeCollidingPiles(piles, boxOf);
    const key = partitionOf(piles);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return seen;
}

// Three badges 9 apart with half-extent 5: each overlaps its neighbour, the
// ends do not overlap each other. Exactly the configuration a ceiling fan, a
// floor lamp and a wall sensor on one spot produce, because the projection
// sums world height onto screen vertical.
const CHAIN = [
  { id: "a", cy: 0 },
  { id: "b", cy: 9 },
  { id: "c", cy: 18 },
];

const seen = sweep(CHAIN, centroidBox);
console.log(`  three chained badges, all ${[...seen.values()].reduce((a, b) => a + b, 0)} orderings`);
console.log(`  distinct PARTITIONS (who shares a card): ${seen.size}\n`);
for (const [p, n] of [...seen].sort((x, y) => y[1] - x[1])) {
  console.log(`     ${String(n).padStart(2)}x  ${p}`);
}

// A wider chain, to show it is not a three-element accident.
const WIDE = [0, 9, 18, 27].map((cy, i) => ({ id: "abcd"[i], cy }));
const wide = sweep(WIDE, centroidBox);
console.log(`\n  four chained badges: ${wide.size} distinct partition(s) over 24 orderings`);

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
console.log("\n  assertions:");
ck("one villa, one answer (three badges)", seen.size === 1);
ck("one villa, one answer (four badges)", wide.size === 1);

if (fail) {
  console.log("\n  FAIL — the same villa is grouped more than one way, decided by");
  console.log("         the order the piles happen to sit in. A value gaining a");
  console.log("         digit re-cuts which devices share a card.");
}
process.exit(fail ? 1 : 0);
