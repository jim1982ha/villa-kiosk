// src/babylon/badgeMetrics.ts
// Every dimension of an entity badge, in CSS PIXELS, chosen by pointer class.
// Pure: no Babylon, no scene, no state. `matchMedia` is touched only by the
// two detection helpers at the bottom.
//
// ── Why this file exists: the units were lying (2.232.0) ────────────────────
// The badge constants used to live as literals in EntityVisuals, and they were
// in RENDER pixels rather than CSS pixels — Babylon GUI's fullscreen layer is
// sized from `engine.getRenderWidth/Height()` (advancedDynamicTexture's
// `_onResize`), and SceneManager sets `setHardwareScalingLevel(1/min(dpr,2))`.
// So `BADGE_DIAMETER_PX = 44` painted:
//
//     dpr 2 iPad / phone   →  22 CSS px
//     dpr 1.6 laptop       →  27.5 CSS px
//     dpr 1 monitor        →  44 CSS px
//
// One number, three physical sizes — and the TOUCH devices got the smallest
// badge, which is exactly backwards. The constant's own comment described it
// as "the app-wide --touch-min … a wall tablet operated standing up, often by
// someone who has never seen it before", which is a fair description of the
// intent and was not what shipped: 22 CSS px is under Apple's 44pt hit region,
// under Material's 48dp, and barely over WCAG 2.5.8's 24px AA floor.
// `pickBadgeAt`'s slop rings rescued the tap AREA, but not the PITCH — two
// badges 25 CSS px apart have slop regions that overlap, so the tap lands on
// whichever the ring reached first.
//
// Everything here is therefore CSS px, and the conversion to the GUI layer's
// render-pixel space rides the scale chain that already exists
// (`iconUserScale × iconZoomScale × 1/hardwareScalingLevel` — see
// EntityVisuals.effectiveScale). That matters for more than tidiness: the
// layout path multiplies by exactly the same scale the renderer does, so the
// file's oldest rule — a layout decision may never use different geometry from
// the renderer — holds structurally instead of by discipline.
//
// ── Why POINTER TYPE and not viewport size ─────────────────────────────────
// 2.187.0 scaled a badge travel budget by viewport short edge and 2.190.0
// reverted it, correctly: "a badge is the same pixel size on a phone, so the
// clearance a pile needs there is identical". That reasoning still stands and
// nothing here reintroduces a viewport term — a phone and a desktop with the
// same pointer class get identical geometry. What legitimately differs is the
// INPUT DEVICE: a fingertip is 8–10 mm (MIT Touch Lab) and a mouse cursor is a
// pixel. So the painted size, and the clearance that follows from it, are a
// function of what is pointing at the screen.

/**
 * ── The one place a VIEWPORT term is legitimate ────────────────────────────
 * Everything else in this file is a function of the POINTER, not the screen,
 * and 2.190.0 reverted a viewport term for clearance with reasoning that still
 * stands: a badge is the same pixel size on a phone, so the clearance a pile
 * needs there is identical.
 *
 * These two are a different question. They do not size a badge; they bound how
 * much of the SCREEN a single composite object is allowed to consume. A room
 * chip prints a name, so its width follows the name rather than the badge; a
 * summary's arrangement of six cells is four badge boxes wide however big a
 * badge is. Both are ~45–60% of a phone's width and ~15–30% of a laptop's, and
 * "may I take up most of the screen" is not a question a constant in badge
 * units can answer.
 *
 * Fractions of the viewport WIDTH, not the short edge: both objects are
 * horizontal, so width is the dimension they actually spend. On a portrait
 * phone that IS the short edge; on a landscape screen it is correctly the
 * generous one.
 *
 * One rule, not two profiles. The cap binds on a small screen and is inert on
 * a large one — which is the whole argument against a phone build and a laptop
 * build, applied to the two places that genuinely needed a screen term.
 */
/** Widest a room chip may be drawn, as a fraction of the viewport width. Over
 *  this the room NAME is truncated with an ellipsis; the count pill never is,
 *  because the count is the part that cannot be inferred from context. */
export const CHIP_MAX_VIEWPORT_FRACTION = 0.5;
/** Widest a summary's card ARRANGEMENT may be drawn, same units. Over this the
 *  summary draws its count instead — never fewer cells, because a card that
 *  drops a member hides a device with no cell to tap (see drawnCells). */
export const CARD_MAX_VIEWPORT_FRACTION = 0.45;

/**
 * Widest CSS viewport that counts as a PHONE for badge layout.
 *
 * 720 because that is the breakpoint `styles.css` already uses for its phone
 * rules — one number for "this is a phone", not two that can drift. It sits
 * clear of every tablet posture (iPad portrait starts at 810), so the wall
 * tablet this app is built for keeps the full-size arrangements.
 *
 * CSS pixels, and that is load-bearing: the render width moves with the
 * resolution valve every time the camera starts and stops, so a threshold in
 * render pixels would make a phone stop being a phone mid-gesture. Same rule
 * as the focus-retention zoom — see quantisedPixelsPerWorldUnit.
 */
export const PHONE_MAX_CSS_WIDTH = 720;

/**
 * The most device pictograms one summary may show ON A PHONE.
 *
 * A 2×2 card is legible on a tablet held at arm's length and simply is not on
 * a phone: the cells are ~44 CSS px each on a 402 px-wide screen, so four of
 * them plus the card's own padding is most of the width, and each cell's tap
 * zone is right at the touch minimum with nothing between neighbours. Reported
 * from an iPhone as "the 4-group badges are not usable".
 *
 * Over this a summary draws its COUNT, not fewer cells — a card that drops a
 * member hides a device with no cell to tap, which is the regression `g.grid`
 * exists to prevent. So on a phone a pair is a card and anything larger is a
 * number that opens the room.
 */
export const PHONE_MAX_TOTAL_CHIPS = 2;

/** Which kind of pointer is PRIMARY on this device. */
export type PointerClass = "fine" | "coarse";

export interface BadgeMetrics {
  // ── Classic style ────────────────────────────────────────────────────────
  /** The squircle's control size. Also `pickBadgeAt`'s tap-target basis. */
  badgeDiameterPx: number;
  /** Container height: badge + spacing + value chip + clearance. */
  labelHeightPx: number;
  /** The value pill under the badge. */
  valueChipHeightPx: number;
  /** Horizontal padding inside the pill, per side. Must clear its own corner
   *  radius (height/2) or the text reads as touching the rounded ends. */
  pillPadXPx: number;
  pillValueFontPx: number;

  // ── Card style (config.badgeStyle === "card") ────────────────────────────
  cardHeightPx: number;
  cardPadLeftPx: number;
  cardValueFontPx: number;

  // ── Collision box, relative to the anchor ────────────────────────────────
  // MEASURED against the drawn art rather than derived from the control sizes:
  // both styles' squircle carries a baked-in inset, so the visible disc is a
  // little smaller than the control that holds it, and the layout has to agree
  // with what a person sees rather than with the box model.
  /** Classic half-height for a type that can never grow a pill. */
  classicHalfHPx: number;
  /** Classic half-height for a pill-CAPABLE type — reserved whether or not a
   *  pill is showing right now (see labelBoxes for the regression that rule
   *  came from). */
  classicHalfHWithPillPx: number;
  classicCyPx: number;
  classicCyWithPillPx: number;
  /** Per-character advance estimates for value text, plus that style's fixed
   *  padding. Estimates on purpose — the real width is resolved by Babylon GUI
   *  during layout and is not readable before the frame is drawn. */
  pillValueCharPx: number;
  pillValuePadPx: number;
  cardValueCharPx: number;
  cardValuePadPx: number;

  // ── Clearance ────────────────────────────────────────────────────────────
  /**
   * The state ring's stroke. A badge DIMENSION, so it belongs here and scales
   * with the rest: Babylon's Rectangle insets its children by this on all four
   * sides, so a fixed 3px cost 17.6% of a 34px touch card but 24.5% of a
   * 24.5px desktop one — the same defect, 40% worse in proportion, which is
   * why an icon that looked acceptable on a phone looked wrong on a desktop.
   */
  ringThicknessPx: number;
  /**
   * The card's icon box, as a fraction of the card's HEIGHT.
   *
   * Stated, rather than left to equal the card's inner box. It used to be the
   * inner box — card height minus twice the ring — which quietly made the icon
   * a function of the RING, so a thinner ring on a fine pointer produced a
   * different icon-to-card ratio than a thick one on a touch card (60% against
   * 66%, with the overflow clipped so the icon ran to the badge's edges). Two
   * devices on the same build drew visibly different badges. An icon's
   * breathing room is a design decision and now reads as one number, and the
   * ring can change thickness without touching it.
   */
  cardIconFraction: number;
  /** Clear space required between two drawn footprints. */
  minGapPx: number;
  /** Clear space required between two ROOM CHIPS before they are judged too
   *  close and MERGE (chips are never nudged — see EntityVisuals.updateClusters).
   *  Here rather than in the scene file for the reason every other number in
   *  this file is: a dimension written in the scene layer is in RENDER pixels
   *  and is therefore a different physical size per device. */
  chipGapPx: number;
  /** Floor on pickBadgeAt's hit-area expansion, so a badge already at or above
   *  --touch-min still forgives a slightly-off tap. */
  tapSlopMinPx: number;
  /**
   * Floor on centre-to-centre distance between two drawn badges.
   *
   * The principled cluster radius, and the reason it is here rather than
   * copied from a map library (Supercluster ships 40px, Mapbox GL JS 50,
   * Leaflet 80 — all tuned for a mouse): two controls stop being
   * independently tappable at exactly the point where their TOUCH TARGETS
   * merge, whatever their painted size.
   *
   * So it is the tap target, and nothing more. 2.232.0 shipped Material's
   * 56dp comfort PITCH (48dp target + 8dp spacing) and that was wrong twice
   * over: 56 exceeds the target `pickBadgeAt` actually resolves against, and
   * it dominated the badge-geometry term at every setting — so grouping was
   * driven by this constant rather than by how big the badges are, roughly
   * 1.8x more eagerly than 2.231.0. The fine value is WCAG 2.5.8's spacing
   * exception (an undersized target needs 24 CSS px between centres), which
   * is the real floor for a pointer that does not have a fingertip.
   */
  minCentrePitchPx: number;

  // ── Summaries: the room chip and the entity group ────────────────────────
  // Sized FROM the badge rather than independently. They stand in for badges,
  // so a summary that is visibly bigger than the things it replaces reads as
  // a different class of object — reported exactly that way. Their height is
  // the badge's own height and their text is the badge's own text size, so
  // the relationship holds at every zoom and icon-size setting by
  // construction rather than by two tables being kept in step.
  /** Diameter of the count pill on a room chip, as a fraction of chip height. */
  countPillFraction: number;
  /** The count pill's text, as a fraction of the chip's own text size. */
  countFontFraction: number;

  /**
   * Downward optical correction for badge text, as a fraction of its font
   * size. The value sits high in the card without it — reported repeatedly,
   * from a person looking at the real badge on real hardware.
   *
   * The honest history, because it is instructive. 2.234.0 added this at
   * 0.105em and it NEVER RAN: the offset was computed by reading `fontSize`
   * back off the control, which is a getter returning a string, so the result
   * was NaN and Babylon silently stopped drawing the text (2.235.0). 2.238.0
   * then removed the correction outright, on arithmetic saying Babylon's
   * `rootY = ascent + (height - fontHeight) / 2` already centres the ink
   * because `GetFontOffset`'s ascent is the ascender rather than the cap
   * height. That arithmetic is probably right in isolation and it does not
   * match what is on the screen — which means something else in the chain
   * (the line box `resizeToFit` produces, the wrap it is centred in, the
   * scale transform above it) contributes an offset the model does not
   * account for.
   *
   * So this is restored on the evidence rather than on the model. Half a
   * descender is the size of the correction a full line box needs when the
   * text has no descender, which every string a badge draws lacks — "0 W",
   * "98%", a count, a room name. If it now reads low, this is the one number.
   */
  textOpticalTopEm: number;
}

/**
 * Coarse pointer — finger or stylus. The wall tablet, and the target this app
 * was specified against.
 *
 * `badgeDiameterPx: 44` is Apple's hit region and the app's own `--touch-min`,
 * now true in CSS pixels rather than only in the render-pixel space nobody
 * sees.
 */
const COARSE: BadgeMetrics = {
  badgeDiameterPx: 44,
  labelHeightPx: 76,
  valueChipHeightPx: 18,
  pillPadXPx: 10,
  pillValueFontPx: 11,

  // The card IS the frame now (the glyph is baked at inset 0, like the Icon
  // style's), so this hugs the art instead of padding a second squircle
  // inside it: 28 = 22px of icon + the 3px ring each side.
  cardHeightPx: 28,
  cardPadLeftPx: 4,
  cardValueFontPx: 13,

  classicHalfHPx: 20,
  classicHalfHWithPillPx: 30.5,
  classicCyPx: -56,
  classicCyWithPillPx: -45.5,
  pillValueCharPx: 6.2,
  pillValuePadPx: 24,
  cardValueCharPx: 7.2,
  cardValuePadPx: 8,

  // The icon CHIP's control as a fraction of the card. The chip's own art is
  // inset 10% inside it (BADGE_INSET_CARD), so the drawn squircle is 0.8x
  // this and the card shows around it on every side. The GLYPH's fraction of
  // the chip, the gap to the value and the corner radius all come from the
  // shared chip tokens instead (config/chipProportions) — this is the one
  // proportion the bottom bar has no equivalent for, because its chip sits on
  // a transparent tile rather than inside a card.
  cardIconFraction: 22 / 28,
  ringThicknessPx: 3,
  // ⚠️ THIS IS THE "STILL ROOM BETWEEN THEM" DIAL, and it was 6 (2.412.0).
  // Measured from a field capture rather than argued: a Card badge's ink is
  // 30 CSS px tall, so a 6px demand is 20% of a badge height of EMPTY SPACE
  // required before two badges are called colliding. With the 15% depth
  // over-reserve (GROUP_OVERLAP_ALLOW_WIDTHS) on top, the pair in the report
  // grouped with 42% of a badge height still visibly between them —
  // `pair light.corridor… + cover.bedroom3_curtain dy=102/102`, where the ink
  // does not touch until 72. The 15% is a CORRECTNESS margin (placement is
  // orthographic at one pixels-per-world while the renderer divides by each
  // object's own depth) and stays; this one is legibility, and legibility is
  // what "not before they collide" trades against. At 2 the same pair needs
  // ~22% instead of 42%, which is the difference between "there is obviously
  // room" and "those are touching".
  //
  // It does NOT scale with badge size (see scaleGeometry), so it is a fixed
  // clear-space demand in CSS px — which is exactly why it dominates at the
  // small drawn sizes a zoomed-out villa uses. Raise it back toward 6 if
  // badges start reading as cramped rather than as separate.
  minGapPx: 2,
  chipGapPx: 6,
  tapSlopMinPx: 10,
  // Apple's 44pt hit region, which is also this app's --touch-min and exactly
  // what pickBadgeAt expands an undersized badge's slop to reach.
  minCentrePitchPx: 44,
  countPillFraction: 0.58,
  countFontFraction: 0.78,
  textOpticalTopEm: 0.105,
};

/** Smallest legible label text. Cartographic practice puts the floor for map
 *  labels at 9–10pt; below it the value stops being readable and the badge may
 *  as well drop it entirely (which is what tier 2 does anyway). */
const MIN_VALUE_FONT_PX = 10;

/**
 * Derive one metrics table from another by scaling the GEOMETRY only.
 *
 * Everything that describes drawn size scales together, because the collision
 * box has to keep agreeing with the art. Three things deliberately do not:
 * `minGapPx` (clear space between two badges is about legibility, not badge
 * size), `minCentrePitchPx` (an accessibility floor in real screen pixels),
 * and the value fonts, which are clamped so a smaller badge does not produce
 * unreadable text.
 */
function scaleGeometry(base: BadgeMetrics, k: number): BadgeMetrics {
  const px = (v: number) => Math.round(v * k * 2) / 2; // nearest half-pixel
  return {
    badgeDiameterPx: px(base.badgeDiameterPx),
    labelHeightPx: px(base.labelHeightPx),
    valueChipHeightPx: px(base.valueChipHeightPx),
    pillPadXPx: px(base.pillPadXPx),
    pillValueFontPx: Math.max(MIN_VALUE_FONT_PX, px(base.pillValueFontPx)),

    cardHeightPx: px(base.cardHeightPx),
    cardPadLeftPx: px(base.cardPadLeftPx),
    cardValueFontPx: Math.max(MIN_VALUE_FONT_PX, px(base.cardValueFontPx)),

    classicHalfHPx: px(base.classicHalfHPx),
    classicHalfHWithPillPx: px(base.classicHalfHWithPillPx),
    classicCyPx: px(base.classicCyPx),
    classicCyWithPillPx: px(base.classicCyWithPillPx),
    // Character advances track the font, which is clamped above — so derive
    // them from the clamped size rather than from k, or a clamped font would
    // be measured with an unclamped width and overlap its neighbour.
    pillValueCharPx: base.pillValueCharPx
      * (Math.max(MIN_VALUE_FONT_PX, px(base.pillValueFontPx)) / base.pillValueFontPx),
    pillValuePadPx: px(base.pillValuePadPx),
    cardValueCharPx: base.cardValueCharPx
      * (Math.max(MIN_VALUE_FONT_PX, px(base.cardValueFontPx)) / base.cardValueFontPx),
    cardValuePadPx: px(base.cardValuePadPx),

    // A fraction: identical on both classes by construction.
    cardIconFraction: base.cardIconFraction,
    ringThicknessPx: Math.max(1, px(base.ringThicknessPx)),
    minGapPx: base.minGapPx,
    chipGapPx: base.chipGapPx,
    tapSlopMinPx: base.tapSlopMinPx,
    minCentrePitchPx: base.minCentrePitchPx,
    countPillFraction: base.countPillFraction,
    countFontFraction: base.countFontFraction,
    textOpticalTopEm: base.textOpticalTopEm,
  };
}

/**
 * Fine pointer — mouse or trackpad.
 *
 * A cursor hits a 24 CSS px target reliably (WCAG 2.5.8 AA), so the painted
 * badge can be smaller and more of the villa stays directly clickable. The tap
 * target does NOT shrink with it: `pickBadgeAt` derives its slop from the
 * painted size to hold the effective target at `--touch-min`, which is the
 * same decoupling `styles.css` already applies to the HUD's icon buttons ("the
 * VISUAL size stays 32px and the TOUCH target is expanded to 44 … which is
 * what the accessibility guidance actually measures").
 *
 * 32 px painted with a 32 px pitch stays clear of the 24 px floor while fitting
 * roughly 1.9× the badges per unit area that the coarse table does.
 */
const FINE: BadgeMetrics = {
  ...scaleGeometry(COARSE, 32 / 44),
  // WCAG 2.5.8's spacing exception: an undersized target is acceptable when a
  // 24 CSS px circle centred on each does not intersect its neighbour's.
  minCentrePitchPx: 24,
};

export function badgeMetricsFor(pointer: PointerClass): BadgeMetrics {
  return pointer === "coarse" ? COARSE : FINE;
}

/** `(pointer: coarse)` is the PRIMARY pointer, which is the right question:
 *  `(any-pointer: coarse)` would pin a touchscreen laptop driven by its
 *  trackpad to the touch table forever. */
export function detectPointerClass(): PointerClass {
  return window.matchMedia?.("(pointer: coarse)").matches ? "coarse" : "fine";
}

/** Fires when the PRIMARY pointer changes — a mouse plugged into a tablet, or
 *  a 2-in-1 folded over. Returns an unsubscribe. */
export function observePointerClass(cb: (p: PointerClass) => void): () => void {
  const mq = window.matchMedia?.("(pointer: coarse)");
  if (!mq) return () => {};
  const onChange = () => cb(mq.matches ? "coarse" : "fine");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
