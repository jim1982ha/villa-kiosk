// src/babylon/badgeControls.ts
// THE CONTROLS A BADGE IS DRAWN WITH — built here, for the map AND for the test
// that lays them out on a real (Null) engine. Babylon GUI only; no scene logic.
//
// ⚠️ THE TEST DREW A COPY (until 2.496.269). tests/oracles/badge_drawn.mjs —
// the only check that runs Babylon's own layout over a badge — rebuilt the card
// and the group card by hand, "with EntityVisuals' recipe": a twin that could
// drift silently from what ships, in the drawing code where the last owner-
// visible defects lived. Both now call these builders, so the oracle measures
// what the map draws.

import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { StackPanel } from "@babylonjs/gui/2D/controls/stackPanel";
import { Image } from "@babylonjs/gui/2D/controls/image";
import { DashableRectangle } from "./dashableRectangle";
import { cardStruts, type CardArrangement } from "./badgeCard";
import type { BadgeMetrics } from "./badgeMetrics";
import { BADGE_CORNER_FRACTION } from "./badgeLook";

/** A card badge's controls. The caller paints them (background, frame,
 *  shadow), mounts the badge and puts the value's text in `valueWrap`. */
export interface CardControls {
  badge: DashableRectangle;
  row: StackPanel;
  /** The left margin of a bare icon, and the one beside a value — one shown at
   *  a time (EntityVisuals.setValueVisible). */
  barePad: Rectangle;
  padL: Rectangle;
  /** The icon-to-value gap, the value's box and its right-hand margin — all
   *  shown and hidden with the value. */
  valueSpacer: Rectangle;
  valueWrap: Rectangle;
  valueTail: Rectangle;
}

/**
 * The card: a DashableRectangle hugging one horizontal row of struts, the
 * glyph and the value — every gap a sized control (cardStruts), because a
 * StackPanel lays children out by their widths and Babylon's padding does not.
 * The value starts hidden. `name` suffixes every control's name.
 */
export function buildCardBadge(name: string, m: BadgeMetrics, glyphPx: number, glyph: Image): CardControls {
  const st = cardStruts(m.cardHeightPx, glyphPx, 1);
  const badge = new DashableRectangle(`lbl_badge_${name}`);
  badge.height = `${m.cardHeightPx}px`;
  badge.cornerRadius = m.cardHeightPx * BADGE_CORNER_FRACTION;
  badge.thickness = 0;
  // The card hugs its icon+value row. Top/bottom breathing room is the
  // glyph image's baked-in margin (BADGE_INSET_CARD); left/right come
  // from the padding below.
  badge.adaptWidthToChildren = true;
  // ── PADDING IN BABYLON GUI SUBTRACTS. THIS FLAG IS WHAT ADDS IT ────
  // The single defect behind ~15 releases of "the icon and the text have
  // no padding and are not centred in the card", and it is not a number
  // anywhere — it is which side of the box the padding lands on.
  //
  // Babylon's default is an INSET: control.js:1645-1674 subtracts a
  // control's own padding from its own _currentMeasure. Meanwhile
  // container.js:369 ADDS that same padding to the width PROPERTY when
  // adaptWidthToChildren is on. The two cancel at a stable fixed point
  // that is silently wrong — the property read 28 while the card was
  // DRAWN 22 wide against a fixed 28 height. Portrait, 0.79 aspect, with
  // cornerRadius computed off the height (7.9px = 36% of the 22 actually
  // drawn) so it rounded like a vertical capsule instead of a squircle.
  // Inside it, the chip sat flush on the left border with 0px of margin
  // and 3px on the right of the value: exactly the report, and exactly
  // why adjusting the icon's SIZE, the ring, the inset or the fraction
  // never helped. Every one of those fixes computed a correct number
  // that was then subtracted instead of added.
  //
  // descendantsOnlyPadding is Babylon's CSS-padding mode
  // (control.js:1536-1541): the padding is applied to the measure handed
  // to the CHILDREN and left out of this control's own box. The property
  // and the drawing now agree, so a bare-icon card is 28x28 — square by
  // construction at any icon size, on either pointer class — and a card
  // with a value reads pad | chip | gap | value | pad.
  badge.descendantsOnlyPadding = true;
  // Half the card's leftover height, so the chip's clear space is the
  // same on all four sides and width equals height when there is no
  // value. The icon-to-text gap is a different measurement and lives on
  // the value below.
  // ⚠️ ZERO. THE CARD'S OUTER MARGINS ARE SPACER CONTROLS TOO (2.452.0),
  // and this is measurement, not another theory. The `badge` line printed
  // `glyph.left === badge.left` EXACTLY while the badge's width still
  // included both paddings (1 + 16 + 3 + 17 + 2.25 = 39.25, drawn 39) — so
  // under `descendantsOnlyPadding` + `adaptWidthToChildren` the padding
  // sizes the box and does NOT offset the children. Every pixel of it
  // therefore piled up as dead space on the RIGHT: visL=1.60, which is only
  // the baked ink, against visR=3.00, which was all the padding. Five
  // attempts at this bug were five different padding values feeding a
  // mechanism that never positioned anything.
  //
  // The gap spacer, by contrast, measured EXACTLY the 3 px it was set to —
  // a StackPanel lays children out by their widths and gets it right. So
  // the outer margins become spacers as well, and the whole card is now
  // positioned by one mechanism that is proven to work.
  badge.paddingLeft = "0px";
  badge.paddingRight = "0px";

  const row = new StackPanel(`lbl_row_${name}`);
  row.isVertical = false;
  // ONE height for everything inside the card, and it is the glyph's
  // own size. It used to be `cardHeightPx - 2 * ringThicknessPx`
  // computed separately here and again for the value box — two
  // derivations of one quantity that happened to agree, and that stopped
  // describing the drawn card at all in 2.252.0, when the ring became
  // 0px, 1px or ringThicknessPx depending on state. The glyph is what
  // this box exists to hold, so the glyph is what sizes it.
  row.height = `${glyphPx}px`;
  row.adaptWidthToChildren = true;
  badge.addControl(row);

  glyph.width = `${glyphPx}px`;
  glyph.height = `${glyphPx}px`;
  glyph.stretch = Image.STRETCH_UNIFORM;
  /** A transparent, sized gap — the ONE mechanism in this row that measures
   *  what it is set to (see the badge's zeroed padding above). */
  const strut = (part: string, w: number): Rectangle => {
    const r = new Rectangle(`lbl_${part}_${name}`);
    r.thickness = 0;
    r.background = "";
    r.width = `${Math.max(0, w)}px`;
    r.height = `${glyphPx}px`;
    r.isPointerBlocker = false;
    return r;
  };
  // The LEFT margin is short by the baked ink the chip already contributes,
  // so the two VISIBLE margins match: visL = padL + ink, visR = padR.
  // Whole pixels (cardStruts, 2.496.137): Babylon floors every width, so
  // the fractional struts this once kept "unrounded" drew a pixel short —
  // a 0.8 left margin drew as 0 (measured on a real GUI).
  // Two left margins, one shown at a time (setValueVisible): a bare
  // icon's is the SAME number as its right margin, so the chip is
  // centred whatever Babylon's whole-pixel flooring does; beside a value
  // it is short by the ink — see cardStruts.
  const barePad = strut("barepad", st.barepad);
  row.addControl(barePad);
  const padL = strut("padl", st.padl);
  padL.isVisible = false;
  row.addControl(padL);
  row.addControl(glyph);

  const valueWrap = new Rectangle(`lbl_valwrap_${name}`);
  valueWrap.thickness = 0;
  valueWrap.adaptWidthToChildren = true;
  // An adaptWidthToChildren container with its own padding cancels it to
  // nothing unless the padding is the children's (see the badge above).
  valueWrap.descendantsOnlyPadding = true;
  valueWrap.height = `${glyphPx}px`;
  valueWrap.background = "transparent";
  // The icon-to-text gap, as a fraction of the CHIP rather than a flat
  // constant — the bottom bar's tiles run a 46px chip with a 13px gap,
  // i.e. 28% of the chip, and that is the proportion this is measured
  // against because it is the same object drawn in the DOM. A flat 4px
  // came out at 18% and read as the text crowding the chip's edge.
  // ── THE GAP IS A SPACER CONTROL, NOT PADDING (2.446.0) ───────────────
  // Third attempt at "the number sits too far right", and the first two
  // failed the same way: the gap was expressed as PADDING on this wrap,
  // and a padding here interacts with `descendantsOnlyPadding` and
  // `adaptWidthToChildren` in a way I mis-modelled twice — predicting the
  // text left of centre while the owner's screenshot measured it 20 px
  // from the icon and 10 px from the pill's edge, i.e. the opposite.
  //
  // A StackPanel lays its children out by their WIDTHS. A transparent
  // Rectangle of width G therefore puts exactly G between the icon and the
  // text, with no padding semantics involved at all — the gap becomes a
  // thing with a size instead of an inset whose sign I have to reason
  // about. The wrap now carries NO horizontal padding, so the pill hugs
  // the number and the only space to its right is the card's own
  // `iconPadX`, matching the icon's inset on the left.
  valueWrap.paddingLeft = "0px";
  // ⚠️ ZERO, and see the spacer note above for why this is not the dial.
  valueWrap.paddingRight = "0px";
  valueWrap.isVisible = false;
  // Added BEFORE the wrap so the row reads glyph | spacer | value. It
  // shares the wrap's visibility: a badge with no value must not carry a
  // gap to nothing, or every valueless card would be that much wider.
  const valueSpacer = strut("valgap", 0);
  // ⚠️ THE CHIP'S INK IS SMALLER THAN ITS BOX, and missing that is why two
  // attempts at this looked right on paper and wrong on screen (2.447.0).
  // `badgeImageDataUrl` bakes the squircle at BADGE_INSET_CARD (10%) inside
  // the image, so the VISIBLE chip stops 0.1·glyphPx short of the control's
  // edge on every side. Every gap I computed was therefore measured from a
  // boundary nobody can see, and the drawn gap was that plus the inset —
  // which is exactly the "still too far right" the owner kept reporting
  // while the arithmetic said otherwise.
  //
  // So the target is stated where it can be checked: the value's visible
  // clear space on the LEFT (this spacer plus the baked inset) equals its
  // visible clear space on the RIGHT (the card's own iconPadX). Solve for
  // the spacer and it is a subtraction, not a fraction — and on this
  // villa's metrics it comes out at ~1 CSS px, which is why every
  // fraction-of-the-gap value I tried was too wide.
  // ⚠️ THE OWNER STATED THE TARGET AND IT REVERSES THE 2x RULE (2.454.0):
  // "I want the 100% to appear centered between the end of the entity
  // icon and the end of the badge graph". That is VISIBLE gap == VISIBLE
  // right margin, and both are printed on the `badge` line as `gap=` and
  // `visR=` — so this stopped being a number to argue and became an
  // equation to satisfy. See CARD_VALUE_MARGIN_OF_ICON_PAD for why the
  // multiple is 1.5 (it preserves the card's width) and for the six
  // attempts that were argued from the DOM twin instead of measured.
  //
  // Whole pixels, from cardStruts: Babylon floors a control's width, so a
  // fractional strut was drawn short and never as the model said.
  valueSpacer.width = `${st.valgap}px`;
  valueSpacer.isVisible = false;
  row.addControl(valueSpacer);
  row.addControl(valueWrap);
  // The value's TAIL, and it rides the value's own visibility for the
  // same reason the gap spacer does — a bare-icon card must keep its
  // visible margins equal (with `bareink`, 2.496.130: this comment used to
  // claim visL == visR here while the drawn margins were 3.0 and 5.2), so the extra
  // margin the owner's centring asks for belongs to the VALUE, not to the
  // card. With a value: visR = this + padr = 1.5·iconPadX, which is the
  // visible gap on the other side of the text. Without one: it collapses
  // and the card is symmetric exactly as before.
  const valueTail = strut("valtail", st.valtail);
  valueTail.isVisible = false;
  row.addControl(valueTail);
  // The right margin proper, LAST in the row. It is the counterpart of
  // `padl` above and the reason the card no longer collects its padding
  // on one side. Always present.
  row.addControl(strut("padr", st.padr));
  return { badge, row, barePad, padL, valueSpacer, valueWrap, valueTail };
}

/** A group card's pooled controls: its host, one sub-card per card of the
 *  arrangement, one chip and one tap zone per cell. */
export interface GroupCardControls {
  container: Rectangle;
  cards: Rectangle[];
  chips: Image[];
  zones: Rectangle[];
}

/** Grow a group card's pools to `cells` chips (each with its tap zone) and
 *  `cards` sub-cards. Grow-only: a group's membership changes as devices come
 *  and go, and rebuilding controls on that boundary is a flicker with no
 *  upside. New controls start hidden; placeGroupCard shows what is drawn. */
export function growGroupCard(c: GroupCardControls, cells: number, cards: number): void {
  for (let k = c.cards.length; k < cards; k++) {
    const r = new Rectangle(`egroupCard${k}_${c.container.name}`);
    r.zIndex = 0;
    r.isPointerBlocker = false;
    r.isVisible = false;
    c.container.addControl(r);
    c.cards.push(r);
  }
  for (let k = c.chips.length; k < cells; k++) {
    const img = new Image(`egroupChip${k}_${c.container.name}`);
    img.zIndex = 1;
    img.stretch = Image.STRETCH_UNIFORM;
    img.isVisible = false;
    c.container.addControl(img);
    c.chips.push(img);
    // The tap zone: a transparent badge box, never a pointer blocker (taps
    // resolve through pickEntityGroupAt).
    const z = new Rectangle(`egroupZone${k}_${c.container.name}`);
    z.zIndex = 1;
    z.thickness = 0;
    z.background = "";
    z.isPointerBlocker = false;
    c.container.addControl(z);
    c.zones.push(z);
  }
}

/** The parts of a card that show and hide with its value. */
export interface ValueParts {
  valueWrap: Rectangle;
  valueSpacer?: Rectangle | null;
  valueTail?: Rectangle | null;
  padL?: Rectangle | null;
  barePad?: Rectangle | null;
}

/**
 * Show or hide a badge's value, and every margin that belongs to it: the gap
 * before it, its tail after it, and the left margin beside it — whose bare-icon
 * twin takes its place. A gap left visible beside a hidden value is dead width
 * on every valueless card; a gap hidden beside a visible one puts the number
 * back against the icon.
 */
export function setValueParts(p: ValueParts, on: boolean): void {
  p.valueWrap.isVisible = on;
  if (p.valueSpacer) p.valueSpacer.isVisible = on;
  if (p.valueTail) p.valueTail.isVisible = on;
  if (p.padL) p.padL.isVisible = on;
  if (p.barePad) p.barePad.isVisible = !on;
}

/**
 * Lay a group card out from its arrangement (badgeCard.arrange): the host's
 * size, each sub-card's box, and — with two or more cells — each chip and its
 * tap zone, in px from the host's centre. Pools are grow-only and never reset,
 * so EVERY geometry property is written on every pooled control each pass: a
 * group that lost a member must not keep a stale box beside a real one.
 */
export function placeGroupCard(c: GroupCardControls, lay: CardArrangement, drawn: number): void {
  c.container.width = `${lay.width}px`;
  // HEIGHT IS PER-PASS, like the width: a group's membership changes under a
  // stable key (four members to two), and a height written once at
  // construction would leave a stale two-row box.
  c.container.height = `${lay.height}px`;
  for (let k = 0; k < c.chips.length; k++) {
    c.chips[k].isVisible = k < drawn;
    c.zones[k].isVisible = k < drawn;
  }
  for (let k = 0; k < c.cards.length; k++) {
    const sub = c.cards[k];
    const src = lay.cards[k];
    sub.isVisible = !!src;
    if (!src) continue;
    sub.width = `${src.width}px`;
    sub.height = `${src.height}px`;
    sub.left = `${src.left}px`;
    sub.top = `${src.top}px`;
  }
  if (drawn < 2) return;
  for (let k = 0; k < drawn; k++) {
    c.chips[k].width = `${lay.chip}px`;
    c.chips[k].height = `${lay.chip}px`;
    c.chips[k].left = `${lay.cellLeft(k)}px`;
    c.chips[k].top = `${lay.cellTop(k)}px`;
    // One badge box, centred on its own chip — in PIXELS, so one code path
    // serves a single card and a split (half of two cards is not a cell).
    const z = c.zones[k];
    z.width = `${lay.zoneW}px`;
    z.height = `${lay.zoneH}px`;
    z.left = `${lay.cellLeft(k)}px`;
    z.top = `${lay.cellTop(k)}px`;
  }
}
