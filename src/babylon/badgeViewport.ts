// src/babylon/badgeViewport.ts
//
// HOW BIG A THING IS ON THE GLASS, AND HOW MANY OF THEM FIT.
//
// ⚠️ THE WHOLE CLUSTER'S CONTACT WITH BABYLON WAS TWO SCALARS — the engine's
// render width and its hardware scaling level — and everything else was
// arithmetic over already-pure metrics. It nonetheless lived as a ~250-line
// ribbon threaded through positions 4006, 6758 and 7794 of a 9,858-line class,
// which meant FIVE stated invariants, every one of them a past field defect,
// could not be executed:
//
//   1. The measure and the draw must clamp through the SAME cap, or a producer
//      that asks for more than the cap is MEASURED at one size and DRAWN at
//      another. That is this file's oldest rule, and it was broken quietly.
//   2. The cap is MEASURED, by asking the function that lays the card out —
//      not guessed. A second, screen-blind ceiling in front of it is how a
//      count badge survived on a phone even at three members.
//   3. "Phone" is read in CSS px, never render px. The resolution valve moves
//      the render width whenever the camera starts and stops, and a device that
//      stopped being a phone mid-gesture would regroup its badges for no
//      reason.
//   4. A pill-CAPABLE badge reserves the with-pill footprint even while it has
//      no pill, or two neighbours drift apart when one drops its readout.
//   5. Down to 2 cells and no further: a pair card is two badge boxes, which
//      fits any screen this app can run on, and stopping there keeps the "a
//      group of two is ALWAYS the full-size card" promise the one-pass
//      placement rests on.
//
// ⚠️ IMPORTS NOTHING AT RUNTIME. `npm run test:placement` loads it with bare
// `node`; an `@/`-aliased import would end that silently.

/** The two engine scalars this cluster actually depends on, plus the two
 *  user/camera multipliers. Everything else is metrics, which are already
 *  pure. */
export interface BadgeViewport {
  /** `engine.getRenderWidth()` — DEVICE pixels. */
  renderWidthPx: number;
  /** `engine.getHardwareScalingLevel()` — moved by the resolution valve. */
  hardwareScaling: number;
  /** The size stepper. */
  iconUserScale: number;
  /** The bird's-eye zoom rung. */
  iconZoomScale: number;
}

/**
 * CSS px → GUI units.
 *
 * ⚠️ READ LIVE, NEVER CACHED. The resolution valve changes hardware scaling
 * mid-session on a slow device, and a cached value leaves the badges sized for
 * a resolution the engine has stopped using.
 */
export function cssToGui(v: BadgeViewport): number {
  return 1 / (v.hardwareScaling || 1);
}

/**
 * The ONE multiplier every badge dimension passes through.
 *
 * Both the renderer and the layout use this exact value, which is what makes
 * "a layout decision may never use different geometry from the renderer"
 * structural rather than a rule to remember.
 */
export function effectiveScale(v: BadgeViewport): number {
  return v.iconUserScale * v.iconZoomScale * cssToGui(v);
}

/** The viewport width in CSS px — see invariant 3. */
export function cssWidthPx(v: BadgeViewport): number {
  return v.renderWidthPx * v.hardwareScaling;
}

/** Is this a PHONE, in CSS pixels — the one reading of that question. */
export function isPhoneWidth(v: BadgeViewport, phoneMaxCssWidth: number): boolean {
  const w = cssWidthPx(v);
  return w > 0 && w <= phoneMaxCssWidth;
}

/**
 * How wide a summary may be DRAWN, in the arrangement's own units.
 *
 * The render width carries `cssToGui` and so does `scale`, so the device pixel
 * ratio cancels and this is a pure fraction of the screen.
 */
export function cardBudget(v: BadgeViewport, maxViewportFraction: number): number {
  const scale = effectiveScale(v);
  return scale > 0 && v.renderWidthPx > 0
    ? (v.renderWidthPx * maxViewportFraction) / scale
    : 0;
}

/**
 * The most cells an arrangement may draw before it exceeds its share of the
 * viewport.
 *
 * ⚠️ MEASURED, NOT GUESSED (invariant 2). `widthOf` is the caller's own
 * arrangement function — the same one that lays the card out — so there is no
 * second width formula to keep in step. The floor of 2 is invariant 5.
 */
export function cellCapFor(
  budget: number, max: number, widthOf: (cells: number) => number,
): number {
  if (!(budget > 0)) return max;
  let cells = max;
  while (cells > 2 && widthOf(cells) > budget) cells--;
  return cells;
}

// ── The per-badge box ───────────────────────────────────────────────────────

/** The metrics a badge box is measured from. Structurally satisfied by
 *  `BadgeMetrics`. */
export interface BoxMetrics {
  badgeDiameterPx: number;
  classicHalfHPx: number;
  classicHalfHWithPillPx: number;
  classicCyPx: number;
  classicCyWithPillPx: number;
  pillValueCharPx: number;
  pillValuePadPx: number;
  cardHeightPx: number;
  cardPadLeftPx: number;
  cardValueCharPx: number;
  cardValuePadPx: number;
}

/** What the renderer knows about one badge's current text. */
export interface BadgeText {
  /** Is a value chip visible RIGHT NOW. Governs WIDTH only. */
  hasValue: boolean;
  /** Characters in that value. */
  valueLen: number;
  /** ⚠️ Can this type EVER grow a pill — see invariant 4. Governs HEIGHT and
   *  CENTRE, and deliberately not `hasValue`. */
  pillCapable: boolean;
}

export interface Box {
  halfW: number;
  halfH: number;
  cy: number;
}

/**
 * One badge's collision box, in GUI units at `scale`.
 *
 * ⚠️ INVARIANT 4 LIVES HERE. Reserve the WITH-PILL footprint for any type that
 * can EVER grow one, even while it currently has none. Two fixtures mounted
 * close together (a ceiling fan and its own temperature sensor) sit fine while
 * both are pill-less — but the moment the fan turns off and drops its pill, its
 * box shrinks while the sensor's does not, so they get pushed apart less than
 * before and end up nearly touching. Reported exactly that way, and read by the
 * owner as "the badge got smaller" when it was really "got less clearance".
 * Only the WIDTH still adapts to the actual pill text.
 *
 * ⚠️ WRITES INTO `out` rather than returning a fresh object: this runs per
 * badge per frame off a grow-only pool, and allocating here was measurable.
 */
export function badgeBox(
  out: Box, text: BadgeText, m: BoxMetrics, scale: number, card: boolean,
): Box {
  if (card) {
    const valW = text.hasValue
      ? text.valueLen * m.cardValueCharPx + m.cardValuePadPx
      : 0;
    const cardW = m.cardPadLeftPx + m.cardHeightPx + valW;
    out.halfW = (cardW / 2) * scale;
    out.halfH = (m.cardHeightPx / 2 + 1) * scale;
    // The card IS the container, so its centre is the container's centre:
    // exactly half a card above the anchor. No magic constant to approximate a
    // gap that no longer exists.
    out.cy = -(m.cardHeightPx / 2) * scale;
    return out;
  }
  const pillHalfW = text.hasValue
    ? (text.valueLen * m.pillValueCharPx + m.pillValuePadPx) / 2
    : 0;
  out.halfW = Math.max(m.badgeDiameterPx / 2, pillHalfW) * scale;
  out.halfH = (text.pillCapable ? m.classicHalfHWithPillPx : m.classicHalfHPx) * scale;
  out.cy = (text.pillCapable ? m.classicCyWithPillPx : m.classicCyPx) * scale;
  return out;
}
