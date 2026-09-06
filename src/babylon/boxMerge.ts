// src/babylon/boxMerge.ts
//
// Merge overlapping boxes until none overlap. The fixpoint only — nothing
// about chips, badges, rooms or the screen.
//
// ── Why this file exists ──────────────────────────────────────────────────
// `badgePlacement.ts` already says it: "Lives here — a module that imports
// nothing — rather than inline in the renderer, because it is a pure fixpoint
// over boxes and this is the THIRD fixpoint in this subsystem to ship wrong.
// It is now testable without a browser, which is the only reason the bug below
// could be pinned." The pile merge took that treatment; the room-chip merge,
// a hundred lines away in `EntityVisuals.deriveChips`, kept its own hand-
// written copy with a different pairing rule and no test at all.
//
// ⚠️ AND ITS ORDER-INDEPENDENCE CLAIM WAS FALSE. `deriveChips` says "Merging is
// by worst overlap first and repeats until nothing overlaps, so the outcome
// does not depend on room iteration order" — and the pairing was
// `if (severity > worst)`, so on an exact TIE the first pair in array order
// won, and array order is room iteration order. That is the same defect class
// as the badge placement order-dependence fixed in 2.366.0, in the subsystem
// that fix was written for. Ties are not exotic here: two equal-width chips at
// equal spacing produce them, and a villa's rooms are frequently laid out on a
// grid.
//
// The tie-break is now the boxes' own geometry, so a caller cannot change the
// answer by handing the same boxes in a different order.

export interface MergeBox {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}

/** How deeply two boxes overlap once each is inflated by half a gap, or 0 when
 *  they are clear on at least one axis.
 *
 *  ⚠️ THE SAME COLLISION RULE AS EVERY OTHER TIER: two things collide when
 *  their drawn boxes, inflated by ONE gap, intersect. A second dial here is
 *  what once made room chips merge at three times the clear space two badges
 *  need — reported as "aggregating together too soon". */
export function overlapSeverity(a: MergeBox, b: MergeBox, gap: number): number {
  const ox = a.halfW + b.halfW + gap - Math.abs(b.x - a.x);
  const oy = a.halfH + b.halfH + gap - Math.abs(b.y - a.y);
  if (ox <= 0 || oy <= 0) return 0;       // clear on at least one axis
  return Math.min(ox, oy);
}

/**
 * Repeatedly merge the worst-overlapping pair until nothing overlaps.
 *
 * `merge(keep, drop)` folds `drop` into `keep` and must leave `keep` measured —
 * its box may change, and the next round measures it again. `rank` scores a
 * box; the higher score survives, and EQUAL SCORES ARE BROKEN HERE, on the
 * boxes' own coordinates.
 *
 * ⚠️ THE OUTCOME DOES NOT DEPEND ON THE ORDER THE BOXES ARRIVE IN — asserted
 * over all 24 orderings of four tied boxes, with the caller's real payload and
 * no sorting in the fixture, because a fixture that normalises the thing under
 * test cannot see it. THREE things had to be total for that to hold: which
 * PAIR merges, which of the pair SURVIVES, and the order the survivors come
 * back in. The first shipped alone in 2.964.0 under a comment claiming all
 * three, and the other two still carried the arrival order.
 */
export function mergeOverlapping<T extends MergeBox>(
  boxes: T[],
  gap: number,
  rank: (box: T) => number,
  merge: (keep: T, drop: T) => void,
): T[] {
  for (;;) {
    let bi = -1;
    let bj = -1;
    let worst = 0;
    let tie: number[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const severity = overlapSeverity(boxes[i], boxes[j], gap);
        if (severity <= 0) continue;
        // ⚠️ THE TIE-BREAK IS GEOMETRY, NOT POSITION IN THE ARRAY. Left-most,
        // then top-most, then the same for the partner: a total order over the
        // pair's own coordinates, so two callers holding the same boxes in
        // different orders settle on the same pair.
        const key = pairKey(boxes[i], boxes[j]);
        if (severity > worst
            || (severity === worst && bi >= 0 && lexLess(key, tie))) {
          worst = severity;
          tie = key;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) return boxes.sort(byPosition);
    const a = boxes[bi];
    const b = boxes[bj];
    // ⚠️ THE SURVIVOR IS CHOSEN THE SAME WAY THE PAIR IS, and for one release
    // it was not: the caller passed `(a, b) => a.n >= b.n ? a : b`, where `a`
    // is whichever box sits earlier in the ARRAY, so two equally-ranked boxes —
    // two rooms with one device each, the common case — handed the merge to
    // whoever arrived first. Measured over all 24 orderings of four tied
    // boxes with the renderer's own payload: EIGHT distinct outcomes, while
    // the oracle reported one because its fixture sorted the names.
    //
    // `rank` is a number rather than a chooser precisely so this module can
    // break the tie. A caller cannot express "these two are equal" through a
    // function that must return one of them.
    const keep = pickSurvivor(a, b, rank);
    const drop = keep === a ? b : a;
    merge(keep, drop);
    boxes.splice(boxes.indexOf(drop), 1);
  }
}

function pickSurvivor<T extends MergeBox>(
  a: T, b: T, rank: (box: T) => number,
): T {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra > rb ? a : b;
  return lexLess([a.x, a.y], [b.x, b.y]) ? a : b;
}

/** Left-most, then top-most. ⚠️ THE RETURNED ORDER IS CANONICAL TOO, because
 *  the survivors' POSITIONS still carried the arrival order even once the
 *  right boxes won — and a caller that renders or lists them in array order
 *  would still show two answers for one villa. */
function byPosition(a: MergeBox, b: MergeBox): number {
  return a.x - b.x || a.y - b.y;
}

function pairKey(a: MergeBox, b: MergeBox): number[] {
  return [
    Math.min(a.x, b.x), Math.min(a.y, b.y),
    Math.max(a.x, b.x), Math.max(a.y, b.y),
  ];
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}
