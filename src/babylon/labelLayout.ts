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

/**
 * Shorten a room name until the chip that prints it fits `maxPx`.
 *
 * A chip's width follows its TEXT — `chipWidthPx` above is length times a
 * character advance — so a long room name, or a merged chip carrying a "+N"
 * suffix, produces a chip sized by the name rather than by anything on screen.
 * On a laptop that is unremarkable; on a phone the same chip is around half
 * the width of the device, and one anchored near the villa's edge runs off it.
 *
 * The COUNT is never truncated. A name can be recognised from a fragment and a
 * count cannot be inferred from anything, so the budget is spent on the count
 * first and whatever is left goes to the name.
 *
 * Pure and estimate-based, exactly like `chipWidthPx`, and it must be: the
 * caller measures the chip with the string this returns, so the width the
 * layout reserves and the width the renderer draws are the same string put
 * through the same function. Truncating at draw time instead would reserve one
 * width and paint another, which is this subsystem's oldest rule broken.
 */
const CHIP_ELLIPSIS = "…";
/** Below this a name is no longer recognisable, so the chip keeps it and
 *  overflows rather than printing a stub nobody can read. */
const CHIP_MIN_NAME_CHARS = 4;
export function fitChipLabel(name: string, countText: string, maxPx: number): string {
  if (!(maxPx > 0)) return name;
  const fits = (s: string) => chipWidthPx(`${s}  ${countText}`) <= maxPx;
  if (fits(name)) return name;
  for (let n = name.length - 1; n >= CHIP_MIN_NAME_CHARS; n--) {
    const cut = name.slice(0, n).trimEnd() + CHIP_ELLIPSIS;
    if (fits(cut)) return cut;
  }
  return name.slice(0, CHIP_MIN_NAME_CHARS).trimEnd() + CHIP_ELLIPSIS;
}
