// src/babylon/labelLayout.ts
// Pure 2-D geometry helpers for the on-screen label/chip layout. No Babylon,
// no scene, no state.
//
// This file also held relaxBoxes(), a force-relaxation solver that pushed
// overlapping room-cluster chips apart. It was removed in 2.120.0 along with
// its last caller: separating chips by DISPLACING them could fling one clear
// off the villa (see EntityVisuals.updateClusters), and chips now resolve an
// overlap by MERGING instead, which needs no solver.

/**
 * Estimated on-screen width of a room-cluster chip, from its TEXT ALONE.
 *
 * ── THE COUNT IS NOT TEXT, AND CHARGING FOR IT TWICE WAS THE BUG (2.421.0) ──
 * The count once rendered inline in the chip's row, so callers passed
 * `"<name>  <count>"` in here and the estimate covered both. `ensureCluster`
 * later made it a fixed-size CORNER OVERLAY, sitting inside a right padding
 * reserved for it (`paddingRight = countSize + 12`) — at which point the count
 * stopped having a text width at all. Every caller went on concatenating it,
 * so each chip reserved roughly four phantom characters, ~33 px, and the merge
 * fired while two pills were still visibly clear.
 *
 * The scale of that against the dial it hid behind: 2.419.0 cut the merge's
 * gap from 6 CSS px to 2 precisely to stop chips merging early, while this was
 * quietly adding ~33 to every width — sixteen times the correction, the other
 * way. Checked against three chips in a v2.420.1 phone capture, label-only
 * lands within 4% of the width Babylon actually laid out (a 7-character name
 * 81.4 est / 80.4 drawn; a 14-character one 138.8 / 133.7); with the count
 * folded in it over-estimated by 25-30%.
 *
 * Still an ESTIMATE on purpose: the real width is resolved by Babylon GUI
 * during layout (adaptWidthToChildren), which is not readable before the frame
 * is drawn — this only has to be close enough to keep chips apart.
 */
const CLUSTER_CHAR_PX = 8.2;
/** Left padding PLUS the whole right-hand reserve the count overlay sits in —
 *  not a bare text margin. This term is why the count must never also be
 *  concatenated into the string handed to `chipWidthPx`.
 *
 *  ⚠️ These two ARE chip dimensions in CSS px, and CLAUDE.md says those live
 *  only in badgeMetrics. Deliberately not moved (2.421.0): they model a TEXT
 *  advance and a padding sum that `ensureCluster` writes as literal strings
 *  (`paddingLeft 12`, `paddingRight countSize + 12`), so converging them means
 *  deriving both from summaryMetrics — worth doing, but it changes every
 *  chip's measured width and this release is already changing that once. Note
 *  left here per /dry-audit rather than a silent divergence. */
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
 * The COUNT does not compete for the budget at all (2.421.0). It is a
 * fixed-size corner overlay drawn inside the right-hand padding `chipWidthPx`
 * already reserves, so it has no text width to spend and cannot be truncated
 * however tight the budget gets. It used to be inline, and this function used
 * to spend the budget on it first — see chipWidthPx for what that cost once
 * the two stopped agreeing.
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
export function fitChipLabel(
  name: string,
  /** The merged-rooms marker ("+2"), or "" for a chip that names one room.
   *  Passed SEPARATELY and never truncated — see below. */
  suffix: string,
  maxPx: number,
): string {
  const join = (n: string) => (suffix ? `${n} ${suffix}` : n);
  // ⚠️ THE SUFFIX IS NOT PART OF THE NAME, and folding it in was a real bug.
  // Until 2.304.0 the caller pre-joined them and handed "Living Room +1" over
  // as the name, so the truncation loop — which cuts from the END — ate the
  // "+1" first and printed "Living Room…". A chip that has swallowed other
  // rooms then looked exactly like one that had not, while its tap did
  // something entirely different (frame several rooms, not one), and its count
  // pill silently included devices from rooms it no longer admitted to
  // covering. The name is the only part a fragment still identifies; "+1" and
  // the count are not recoverable from anything, so they are spent first and
  // the name gets what is left. Same rule the count already followed.
  const whole = join(name);
  if (!(maxPx > 0)) return whole;
  const fits = (s: string) => chipWidthPx(s) <= maxPx;
  if (fits(whole)) return whole;
  for (let n = name.length - 1; n >= CHIP_MIN_NAME_CHARS; n--) {
    const cut = join(name.slice(0, n).trimEnd() + CHIP_ELLIPSIS);
    if (fits(cut)) return cut;
  }
  return join(name.slice(0, CHIP_MIN_NAME_CHARS).trimEnd() + CHIP_ELLIPSIS);
}
