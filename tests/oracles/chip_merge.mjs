// Does the room-chip merge depend on room iteration order?
// OLD = the loop that was inline in EntityVisuals.deriveChips (replicated).
// NEW = the real src/babylon/boxMerge.ts.
// ⚠️ THE FIXTURE DOES NOT SORT ANYTHING. dev's own note records an oracle that
// reported "1 outcome" purely because it sorted the names it compared.
import { mergeOverlapping } from "../../src/babylon/boxMerge.ts";

const GAP = 2;
// Four chips on a grid, all one device each (so every rank ties), spaced so
// every adjacent pair overlaps by exactly the same amount (so every severity
// ties too). This is a villa laid out on a grid — not an exotic case.
const mk = () => [
  { n: "Kitchen",  x: 0,  y: 0,  halfW: 10, halfH: 5, ids: ["k"] },
  { n: "Hallway",  x: 16, y: 0,  halfW: 10, halfH: 5, ids: ["h"] },
  { n: "Study",    x: 0,  y: 8,  halfW: 10, halfH: 5, ids: ["s"] },
  { n: "Terrace",  x: 16, y: 8,  halfW: 10, halfH: 5, ids: ["t"] },
];
const foldInto = (keep, drop) => {
  const na = keep.ids.length, nb = drop.ids.length;
  keep.x = (keep.x * na + drop.x * nb) / (na + nb);
  keep.y = (keep.y * na + drop.y * nb) / (na + nb);
  keep.ids = keep.ids.concat(drop.ids);
  keep.n = `${keep.n}+${nb}`;
};

function OLD(chips) {
  for (;;) {
    let bi = -1, bj = -1, worst = 0;
    for (let i = 0; i < chips.length; i++)
      for (let j = i + 1; j < chips.length; j++) {
        const a = chips[i], b = chips[j];
        const ox = a.halfW + b.halfW + GAP - Math.abs(b.x - a.x);
        const oy = a.halfH + b.halfH + GAP - Math.abs(b.y - a.y);
        if (ox <= 0 || oy <= 0) continue;
        const severity = Math.min(ox, oy);
        if (severity > worst) { worst = severity; bi = i; bj = j; }   // ← tie → array order
      }
    if (bi < 0) break;
    const a = chips[bi], b = chips[bj];
    const keep = a.ids.length >= b.ids.length ? a : b;                // ← tie → array order
    foldInto(keep, keep === a ? b : a);
    chips.splice(chips.indexOf(keep === a ? b : a), 1);
  }
  return chips;                                                       // ← arrival order
}
const NEW = (chips) => mergeOverlapping(chips, GAP, (c) => c.ids.length, foldInto);

function* perms(a){ if(a.length<=1){yield a;return;} for(let i=0;i<a.length;i++) for(const r of perms([...a.slice(0,i),...a.slice(i+1)])) yield [a[i],...r]; }

function survey(rule) {
  const seen = new Map();
  for (const order of perms([0,1,2,3])) {
    const chips = order.map((i) => ({ ...mk()[i], ids: [...mk()[i].ids] }));
    const out = rule(chips);
    const key = out.map((c) => `${c.n}@${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" | ");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return seen;
}

const o = survey(OLD), n = survey(NEW);
console.log("  four one-device chips on a grid — every rank ties, every overlap ties");
console.log(`  all 24 room-iteration orders\n`);
console.log(`  OLD (inline loop)   distinct outcomes: ${o.size}`);
for (const [k, c] of [...o].sort((a,b)=>b[1]-a[1]).slice(0,4)) console.log(`      ${String(c).padStart(2)}×  ${k}`);
if (o.size > 4) console.log(`      … ${o.size - 4} more`);
console.log(`\n  NEW (boxMerge.ts)   distinct outcomes: ${n.size}`);
for (const [k, c] of n) console.log(`      ${String(c).padStart(2)}×  ${k}`);

let fail = 0;
const check = (name, ok) => { console.log(`    ${ok?"PASS":"FAIL"}  ${name}`); if(!ok) fail++; };
console.log("\n  assertions:");
check("the new rule gives ONE answer for all 24 orderings", n.size === 1);
check("the old rule did not", o.size > 1);
process.exit(fail ? 1 : 0);
