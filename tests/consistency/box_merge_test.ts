// tests/consistency/box_merge_test.ts
// Run: npm run test:box-merge   (node strips the types; no runner, no deps)
// Also run by `tests/py/test_villa_rules.py`, which parametrises every oracle
// in this directory.
//
// ⚠️ THE ORDER-INDEPENDENCE THIS PINS WAS CLAIMED IN PROSE AND WAS FALSE.
// `EntityVisuals.deriveChips` said "Merging is by worst overlap first and
// repeats until nothing overlaps, so the outcome does not depend on room
// iteration order", over a pairing written `if (severity > worst)` — which
// gives an exact tie to the first pair in ARRAY order, and array order is room
// iteration order. Same defect class as the badge placement order-dependence
// fixed in 2.366.0, in the subsystem that fix was written for.

import { mergeOverlapping, overlapSeverity, type MergeBox }
  from "../../src/babylon/boxMerge.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

interface Chip extends MergeBox { id: string; n: number; names: string[] }

const chip = (id: string, x: number, y: number, halfW = 10, halfH = 5,
              n = 1): Chip => ({ id, x, y, halfW, halfH, n, names: [id] });

/** The chip merge's own payload, so this measures the shape the renderer uses. */
function settle(boxes: Chip[], gap = 2): Chip[] {
  return mergeOverlapping(
    boxes, gap,
    (a, b) => (a.n >= b.n ? a : b),
    (keep, drop) => {
      const total = keep.n + drop.n;
      keep.x = (keep.x * keep.n + drop.x * drop.n) / total;
      keep.y = (keep.y * keep.n + drop.y * drop.n) / total;
      keep.names = [...keep.names, ...drop.names].sort();
      keep.n = total;
    });
}

const summary = (out: Chip[]) =>
  out.map((c) => c.names.join("+")).sort().join(" | ");

// ── the collision rule ──────────────────────────────────────────────────────
{
  const a = chip("a", 0, 0), b = chip("b", 100, 0);
  check("boxes clear on an axis do not overlap", overlapSeverity(a, b, 2) === 0);
  check("...and one gap of separation is still clear",
    overlapSeverity(chip("a", 0, 0), chip("b", 22, 0), 2) === 0);
  check("...while a hair closer is not",
    overlapSeverity(chip("a", 0, 0), chip("b", 21.9, 0), 2) > 0);
  check("clear VERTICALLY is clear, however much they share horizontally",
    overlapSeverity(chip("a", 0, 0), chip("b", 0, 50), 2) === 0);
}

// ── the property the renderer's comment claims ──────────────────────────────
{
  // ⚠️ A GRID OF EQUAL CHIPS AT EQUAL SPACING, which is what produces exact
  // ties — and is not exotic: a villa's rooms are frequently laid out this way,
  // and every chip here is the same width by construction.
  const layout = () => [
    chip("A", 0, 0), chip("B", 15, 0), chip("C", 30, 0), chip("D", 45, 0),
  ];

  const forward = summary(settle(layout()));
  const reversed = summary(settle(layout().reverse()));
  const rotated = summary(settle([...layout().slice(2), ...layout().slice(0, 2)]));

  check("the outcome does not depend on the order the chips arrive in",
    forward === reversed && forward === rotated,
    `\n    forward  ${forward}\n    reversed ${reversed}\n    rotated  ${rotated}`);

  // Every permutation, not a sample — four boxes is 24 orders and the whole
  // point is that none of them differs.
  const seen = new Set<string>();
  const permute = (rest: Chip[], acc: Chip[]) => {
    if (!rest.length) { seen.add(summary(settle(acc.map((c) => ({ ...c, names: [...c.names] }))))); return; }
    for (let i = 0; i < rest.length; i++) {
      permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
    }
  };
  permute(layout(), []);
  check("all 24 orderings of four tied chips settle the same way",
    seen.size === 1, `got ${seen.size}: ${[...seen].join("  //  ")}`);
}

// ── it terminates, and it finishes the job ──────────────────────────────────
{
  const out = settle([chip("A", 0, 0), chip("B", 5, 0), chip("C", 10, 0),
                      chip("D", 15, 0), chip("E", 20, 0)]);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      check("nothing overlaps when the fixpoint returns",
        overlapSeverity(out[i], out[j], 2) === 0,
        `${out[i].names} vs ${out[j].names}`);
    }
  }
  check("and no chip is lost on the way",
    out.reduce((n, c) => n + c.names.length, 0) === 5,
    JSON.stringify(out.map((c) => c.names)));
}

// ── the survivor and the anchor ─────────────────────────────────────────────
{
  // ⚠️ THE BUSIER ROOM KEEPS ITS NAME — it is the more informative one — and the
  // merged anchor is the DEVICE-COUNT-WEIGHTED centroid, so the chip still sits
  // among the devices it stands for rather than halfway to a room with one.
  const big = { ...chip("big", 0, 0), n: 9 };
  const small = { ...chip("small", 12, 0), n: 1 };
  const out = settle([big, small]);
  // ⚠️ IDENTITY, NOT THE COUNT. My first version asserted `n === 10`, and both
  // the count and the weighted centroid are SYMMETRIC in the pair — so
  // returning the wrong survivor passed. What the renderer reads off the
  // survivor is its NAME, which is the whole reason the busier one is kept.
  check("the busier room survives a merge",
    out.length === 1 && out[0].id === "big" && out[0].n === 10,
    `survivor ${out[0]?.id}`);
  check("...and it survives whichever way round they arrive",
    settle([{ ...chip("small", 12, 0), n: 1 },
            { ...chip("big", 0, 0), n: 9 }])[0].id === "big");
  check("the merged anchor is weighted by device count, not the midpoint",
    Math.abs(out[0].x - 1.2) < 1e-9, `got ${out[0].x}`);
}

// ── a merge that makes the survivor wider must be re-measured ───────────────
{
  // The merged chip carries a "+N" suffix, so it can grow — and a fixpoint that
  // does not re-measure would stop while the new box still overlaps a third.
  // ⚠️ C MUST BE CLEAR OF BOTH BEFORE THE MERGE AND CAUGHT BY THE RESULT, or
  // this measures nothing. A(±10 at 0) and B(±10 at 15) overlap; C(±10 at 33)
  // clears both by 3. The merged A+B sits at 7.5 with halfW 18, so its right
  // edge is 25.5 and C's left edge is 23 — an overlap that only exists because
  // the survivor grew. My first fixture put C at 40, where the grown box still
  // did not reach it, and the check passed for the wrong reason.
  const grow: Chip[] = [chip("A", 0, 0, 10), chip("B", 15, 0, 10),
                        chip("C", 33, 0, 10)];
  const out = mergeOverlapping(
    grow, 2,
    (a, b) => (a.n >= b.n ? a : b),
    (keep, drop) => {
      keep.x = (keep.x * keep.n + drop.x * drop.n) / (keep.n + drop.n);
      keep.names = [...keep.names, ...drop.names].sort();
      keep.n += drop.n;
      keep.halfW = 10 + 8 * (keep.n - 1);          // the "+N" suffix
    });
  check("a chip that grew on merging keeps merging until it is clear",
    out.length === 1, JSON.stringify(out.map((c) => c.names)));
}

// ── the empty and single cases ──────────────────────────────────────────────
{
  check("no chips settles to no chips", settle([]).length === 0);
  check("one chip never merges with itself", settle([chip("A", 0, 0)]).length === 1);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
