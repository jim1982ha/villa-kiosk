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
 * its box may change, and the next round measures it again. `keep` is chosen by
 * `prefer`, which returns the survivor of a pair.
 *
 * ⚠️ THE OUTCOME DOES NOT DEPEND ON THE ORDER THE BOXES ARRIVE IN, and that is
 * asserted rather than described. Where two pairs overlap by exactly the same
 * amount, the tie is broken on the boxes' own coordinates — a fact about where
 * they are, not about where they sit in the array. The comparison being `>`
 * rather than a real tie-break is what made the original claim untrue.
 */
export function mergeOverlapping<T extends MergeBox>(
  boxes: T[],
  gap: number,
  prefer: (a: T, b: T) => T,
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
        const key = [
          Math.min(boxes[i].x, boxes[j].x), Math.min(boxes[i].y, boxes[j].y),
          Math.max(boxes[i].x, boxes[j].x), Math.max(boxes[i].y, boxes[j].y),
        ];
        if (severity > worst
            || (severity === worst && bi >= 0 && lexLess(key, tie))) {
          worst = severity;
          tie = key;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) return boxes;             // nothing overlaps — done
    const a = boxes[bi];
    const b = boxes[bj];
    const keep = prefer(a, b);
    const drop = keep === a ? b : a;
    merge(keep, drop);
    boxes.splice(boxes.indexOf(drop), 1);
  }
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}
