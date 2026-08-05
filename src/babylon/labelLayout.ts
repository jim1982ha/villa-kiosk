// src/babylon/labelLayout.ts
// Pure 2-D geometry helpers for the on-screen label/chip layout. No Babylon,
// no scene, no state.
//
// This file also held relaxBoxes(), a force-relaxation solver that pushed
// overlapping room-cluster chips apart. It was removed in 2.120.0 along with
// its last caller: separating chips by DISPLACING them could fling one clear
// off the villa (see EntityVisuals.updateClusters), and chips now resolve an
// overlap by MERGING instead, which needs no solver.

/** Estimated on-screen width of a room-cluster chip, from its text length.
 *  An ESTIMATE on purpose: the real width is resolved by Babylon GUI during
 *  layout (adaptWidthToChildren), which isn't readable before the frame is
 *  drawn — this only has to be close enough to keep chips apart. */
const CLUSTER_CHAR_PX = 8.2;
const CLUSTER_TEXT_PAD_PX = 24;
export function chipWidthPx(text: string): number {
  return text.length * CLUSTER_CHAR_PX + CLUSTER_TEXT_PAD_PX;
}
