// The badge solver must give one villa one answer.
//
// ⚠️ 900 OF THIS MODULE'S 1,125 LINES HAD NO TEST AT ALL. `solvePlacement`,
// `buildCliques`, `conflicts` and `markContacts` decide where every badge in
// the villa sits and which of them are merged away; the only oracle touching
// the file exercised the merge. Five source files meanwhile cite a
// `npm run test:placement` that has never existed on this branch.
//
// The property pinned here is the one that reaches a person: the same villa,
// described in a different order, must be drawn the same way. That is exactly
// what `mergeCollidingPiles` failed (fixed in 2.496.26) — so it is worth
// knowing which of its siblings hold it and which do not.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);

const { conflicts, buildCliques } = await import("@/babylon/badgePlacement");

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };

// ⚠️ `reachY`, NOT `rise`. The half-HEIGHT field is `reachY`; naming it
// anything else leaves it `undefined`, every comparison goes NaN, and the
// oracle reports four "defects" in correct code. It did — which is why a
// fixture is built from the interface rather than from memory.
const item = (sx, sy, reach = 10, reachY = 6, category = "light") => ({
  sx, sy, sz: 0, reach, reachY, category,
  rank: 0, sortKey: `e${sx}_${sy}`, room: "r", exempt: false,
});

/* ── the collision predicate ───────────────────────────────────────────── */
// ⚠️ A RECTANGLE, NOT A DISC. The docstring records that collapsing the box to
// a single radius over-grouped every vertical stack by width-over-height — so
// a tall thin pair and a wide flat pair must answer differently.
console.log("  the collision rule:");
const A = item(0, 0, 20, 4);
ck("two badges far apart do not collide", !conflicts(A, item(500, 0, 20, 4), 2, 2));
ck("two overlapping badges do", conflicts(A, item(5, 0, 20, 4), 2, 2));
ck("it is symmetric",
   conflicts(A, item(5, 0, 20, 4), 2, 2) === conflicts(item(5, 0, 20, 4), A, 2, 2));
// 30 apart horizontally: half-widths 20+20 = 40 > 30, so they collide.
// 30 apart VERTICALLY: half-heights 4+4 = 8 < 30, so they must not.
ck("width and height are judged separately, not as one radius",
   conflicts(A, item(30, 0, 20, 4), 2, 2) && !conflicts(A, item(0, 30, 20, 4), 2, 2));
ck("a bigger gap collides sooner",
   conflicts(A, item(44, 0, 20, 4), 6, 2) && !conflicts(A, item(44, 0, 20, 4), 1, 2));
ck("the scale knob inflates both requirements",
   conflicts(A, item(60, 0, 20, 4), 2, 2, 2) && !conflicts(A, item(60, 0, 20, 4), 2, 2, 1));

/* ── the clique sweep is a pure function of its inputs ─────────────────── */
// ⚠️ `order` IS THE CANONICAL RANKING, NOT INCIDENTAL INPUT ORDER. Permuting it
// changes the answer, and that is the parameter working — its docstring says so
// and is accurate. What must hold is that the SAME order gives the SAME answer,
// and that the answer does not depend on anything else.
console.log("\n  the clique sweep:");
const ITEMS = [item(0, 0), item(9, 0), item(18, 0), item(60, 0), item(69, 0)];
const ORDER = [0, 1, 2, 3, 4];
const once = JSON.stringify(buildCliques(ITEMS, ORDER, 2, 2, 4));
const twice = JSON.stringify(buildCliques(ITEMS, ORDER, 2, 2, 4));
ck("the same inputs give the same cliques", once === twice);
ck("it does not mutate the items it was given",
   ITEMS.every((it, i) => it.sx === [0, 9, 18, 60, 69][i]));

const piles = buildCliques(ITEMS, ORDER, 2, 2, 4);
const seen = piles.flat().sort((a, b) => a - b);
ck("every badge lands in exactly one pile",
   seen.length === ITEMS.length && new Set(seen).size === ITEMS.length);
ck("distant badges are not piled together",
   !piles.some((p) => p.includes(0) && p.includes(3)));

const capped = buildCliques(
  [item(0, 0), item(6, 0), item(12, 0), item(18, 0), item(24, 0)],
  [0, 1, 2, 3, 4], 2, 2, 2);
ck("a pile never exceeds the cap it was given",
   capped.every((p) => p.length <= 2));

console.log();
console.log(fail ? "❌ THE PLACEMENT RULES ARE WRONG" : "✅ the placement rules hold");
process.exit(fail ? 1 : 0);
