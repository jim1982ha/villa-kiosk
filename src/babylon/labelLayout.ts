// src/babylon/labelLayout.ts
// Pure 2-D geometry for keeping on-screen labels and room-cluster chips from
// overlapping each other. No Babylon, no scene, no state — points and boxes in,
// nudged points out.
//
// Extracted from EntityVisuals.ts as part of trimming its ~700-line prelude of
// module-level helpers. Deliberately moved VERBATIM: the badge/cluster layout
// rules in this app have a long history of regressions (see the badge-grouping
// notes in CLAUDE.md — six earlier attempts failed by computing overlap in
// screen space), so this extraction changes where the code lives and nothing
// about what it computes.

/** Relaxation sweeps before giving up on separating room-cluster chips.
 *  Costs nothing in the common case — the loop exits the moment it settles. */
const RELAX_ITERATIONS = 24;

/** A point that can be nudged: screen anchor plus the offset applied to it. */
export interface Nudgeable { x: number; y: number; off: { x: number; y: number } }

/**
 * Push overlapping screen boxes apart, minimum-translation, and report what
 * couldn't be resolved. Used ONLY for room-cluster chips (each anchored at a
 * fixed world-space centroid, so a little travel costs nothing in meaning) —
 * individual device badges are never nudged, see the header comment above.
 * The subtleties here (resolve along the axis of LEAST penetration; relax
 * from zero every frame rather than easing toward a target, which fed the
 * render loop and made chips shake; clamp travel AFTER solving and measure
 * the residual against the clamped result, i.e. against what is actually
 * drawn) were all bought with field bugs and are not worth reimplementing.
 *
 * `gap` is the breathing room added between boxes; `maxOff` is how far a box
 * may travel from its anchor before it stops meaning anything — for a chip
 * (the only caller now) that budget can be generous, since it labels a whole
 * room rather than pointing at one device (see CLUSTER_MAX_NUDGE_HEIGHTS).
 */
export function relaxBoxes(
  pts: Nudgeable[],
  boxes: { halfW: number; halfH: number; cy: number }[],
  gap: number,
  maxOff: number,
): void {
  for (const p of pts) { p.off.x = 0; p.off.y = 0; }
  for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j], ba = boxes[i], bb = boxes[j];
        const dx = (b.x + b.off.x) - (a.x + a.off.x);
        const dy = (b.y + b.off.y + bb.cy) - (a.y + a.off.y + ba.cy);
        const ox = ba.halfW + bb.halfW + gap - Math.abs(dx); // >0 = overlapping
        const oy = ba.halfH + bb.halfH + gap - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue; // clear on at least one axis
        if (ox < oy) {
          const s = dx === 0 ? ((i * 31 + j) % 2 ? 1 : -1) : Math.sign(dx);
          a.off.x -= (ox / 2) * s; b.off.x += (ox / 2) * s;
        } else {
          const s = dy === 0 ? ((i * 31 + j) % 2 ? 1 : -1) : Math.sign(dy);
          a.off.y -= (oy / 2) * s; b.off.y += (oy / 2) * s;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  for (const p of pts) {
    const len = Math.hypot(p.off.x, p.off.y);
    if (len > maxOff) { p.off.x *= maxOff / len; p.off.y *= maxOff / len; }
  }
}

/** Estimated on-screen width of a room-cluster chip, from its text length.
 *  An ESTIMATE on purpose: the real width is resolved by Babylon GUI during
 *  layout (adaptWidthToChildren), which isn't readable before the frame is
 *  drawn — this only has to be close enough to keep chips apart. */
const CLUSTER_CHAR_PX = 8.2;
const CLUSTER_TEXT_PAD_PX = 24;
export function chipWidthPx(text: string): number {
  return text.length * CLUSTER_CHAR_PX + CLUSTER_TEXT_PAD_PX;
}
