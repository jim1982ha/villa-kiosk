// Does the chip merge depend on the order rooms happen to be iterated in?
// Four mutually-overlapping chips, all 24 orderings, against the REAL function.
import { mergeCollidingPiles } from "../../../src/babylon/badgePlacement.ts";

const CHIPS = [
  { id: "camera.a", cx: 0,  cy: 0 },
  { id: "light.b",  cx: 6,  cy: 0 },
  { id: "lock.c",   cx: 12, cy: 0 },
  { id: "sensor.d", cx: 18, cy: 0 },
];
// hw 5 each: neighbours 6 apart overlap (|Δcx| 6 < 10); a and d are 18 apart
// and do NOT overlap directly — they join through the chain, which is exactly
// where the pairing order gets its freedom.
const boxOf = (pile) => {
  const xs = pile.map((c) => c.cx);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return { cx: (lo + hi) / 2, cy: 0, hw: (hi - lo) / 2 + 5, hh: 5 };
};

function* perms(a) {
  if (a.length <= 1) { yield a; return; }
  for (let i = 0; i < a.length; i++)
    for (const rest of perms([...a.slice(0, i), ...a.slice(i + 1)]))
      yield [a[i], ...rest];
}

const results = new Map();
for (const order of perms(CHIPS)) {
  const piles = order.map((c) => [c]);
  const out = mergeCollidingPiles(piles, boxOf);
  // The OBSERVABLE outcome: which chips ended in which pile, and in what order
  // each pile's members are listed — the card draws its cells in that order.
  const key = out.map((p) => p.map((c) => c.id).join("+")).join(" | ");
  results.set(key, (results.get(key) ?? 0) + 1);
}

console.log(`  4 mutually-chained chips, all ${[...results.values()].reduce((a, b) => a + b, 0)} orderings`);
console.log(`  distinct outcomes: ${results.size}\n`);
for (const [k, n] of [...results].sort((a, b) => b[1] - a[1]))
  console.log(`    ${String(n).padStart(2)}×  ${k}`);
console.log(`\n  ${results.size === 1 ? "PASS — order-independent" : `FAIL — ${results.size} different answers for one villa`}`);
process.exit(results.size === 1 ? 0 : 1);
