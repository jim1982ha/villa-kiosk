// src/babylon/placementCheck.ts
// Does what a layout pass PAINTED keep the placement rules? The `?debug=place`
// self-check: overlapping badges, badges buried under a card's ink, cards on
// cards, anything on a room chip, chips on chips, a chip whose width estimate
// is wrong, a badge that moved, a badge showing inside a chipped room, a badge
// hidden with neither a summary nor a chip, and whether the solve depends on
// its input order.
//
// ⚠️ 460 LINES INSIDE EntityVisuals THAT COULD ONLY FAIL ON THE TABLET. Its own
// comment records that an earlier version was a tautology which "could not fail
// whatever the screen looked like" — and nothing could show the current one
// fails either, short of `?debug=place` on the wall. It is a pure function of a
// SNAPSHOT of the pass now: EntityVisuals projects what it drew (with the
// renderer's own matrix — the one place allowed to know what got painted) and
// hands the boxes over; this counts. tests/oracles/placement_check.mjs feeds
// it layouts that break each rule and requires it to say so.

import { solvePlacement, createPlacementScratch, type PlacementItem, type PlacementScratch } from "./badgePlacement";
import type { RoomChip } from "./roomChips";

/** A drawn thing's box on the glass, render px: centre and half extents. */
export interface ScreenBox { cx: number; cy: number; hw: number; hh: number }

export interface PassSnapshot {
  viewport: { x: number; y: number; width: number; height: number };
  /** Every shown badge, as drawn. `box` is its box (null when behind the camera). */
  badges: readonly {
    id: string; box: ScreenBox | null; visible: boolean; inFront: boolean; occluded: boolean;
    /** In a focused room — its overlaps are expected, and counted apart. */
    exempt: boolean;
    /** Its room is a chip this pass. */
    roomChipped: boolean;
    /** Stands behind a surviving summary card. */
    covered: boolean;
    offsetX: number;
  }[];
  /** Every surviving card: its whole box and the disc its cells' ink fills. */
  cards: readonly { box: ScreenBox; ink: ScreenBox; focused: boolean }[];
  /** The chips that survived, and each one's measured width (CSS px) if drawn. */
  chips: readonly RoomChip[];
  chipDrawnWidth(key: string): number | undefined;
  chipScale: number;
  minSepPx: number;
  minGapPx: number;
  /** GROUP_OVERLAP_ALLOW_WIDTHS — zero means summary overlaps are the accepted cost. */
  overlapAllow: number;
  /** The pass's solver input, for the order-dependence re-solve. */
  solve: { items: readonly PlacementItem[]; gap: number; minSep: number; mode: "priority" | "legacy"; drawableMax: number };
}

/** What the check found — every count, and the lines it would print. */
export interface PlacementFindings {
  overlaps: number; tooClose: number; focusOverlaps: number;
  buried: number; overhung: number; focusCardHits: number;
  summaryOverlaps: number; summaryFocusOverlaps: number;
  chipHits: number; chipHitsFocused: number; chipPairs: number;
  chipWidthErr: number; moved: number; leaked: number; orphaned: number; byWall: number;
  orderDependent: boolean;
  lines: string[];
}

export class PlacementCheck {
  /** Separate from the live solver workspaces: a PlacementResult is pooled,
   *  and a second solve would rewrite the result the pass is still using. */
  private readonly scratchA: PlacementScratch = createPlacementScratch();
  private readonly scratchB: PlacementScratch = createPlacementScratch();

  check(s: PassSnapshot): PlacementFindings {
    const vp = s.viewport;
    // ── OVERLAP, MEASURED IN THE SPACE A PERSON ACTUALLY SEES ────────────
    // What used to be here fed `placementItems` straight back into
    // `conflicts` — the same items, the same predicate, the same gap and
    // minSep the solver had satisfied a few lines earlier. That is a
    // tautology: it could not fail whatever the screen looked like, and for
    // as long as it existed it reported a clean layout over screenshots full
    // of badges and cards drawn on top of each other. An assertion that
    // restates its subject's own conclusion is worse than no assertion,
    // because it is read as evidence.
    //
    // Everything below is measured from `Vector3.ProjectToRef` — the TRUE
    // perspective projection the GUI layer draws through, which cullLabels
    // has always computed and, until now, never read (ShownLabel.x/y were
    // dead fields; `tsc` does not police unused interface members). It shares
    // no arithmetic at all with the solver, which is the only reason it is
    // able to disagree with it.
    //
    // Everything is in RENDER pixels and that is commensurable by
    // construction: Vector3.Project works in the global viewport, and
    // effectiveScale() carries cssToGui() — the render-pixel conversion —
    // so `boxes` and the card layout are already in the same space as `p`.
    const onScreen = (b: ScreenBox) =>
      b.cx + b.hw >= vp.x && b.cx - b.hw <= vp.x + vp.width
      && b.cy + b.hh >= vp.y && b.cy - b.hh <= vp.y + vp.height;
    // Ink on ink. No gap, no minimum pitch, no tolerance: two things either
    // cover the same pixels or they don't, and that is the one claim about
    // this subsystem nobody can argue with from a screenshot.
    const hits = (a: ScreenBox, b: ScreenBox) =>
      Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cy - b.cy) < a.hh + b.hh;
    const lines: string[] = [];
    const f: PlacementFindings = {
      overlaps: 0, tooClose: 0, focusOverlaps: 0, buried: 0, overhung: 0, focusCardHits: 0,
      summaryOverlaps: 0, summaryFocusOverlaps: 0, chipHits: 0, chipHitsFocused: 0, chipPairs: 0,
      chipWidthErr: 0, moved: 0, leaked: 0, orphaned: 0, byWall: 0, orderDependent: false, lines,
    };

    // Drawn, in front, on screen: off-screen overlap is not something anyone sees.
    const bb: ScreenBox[] = [], bEx: boolean[] = [];
    for (const b of s.badges) {
      if (!b.inFront || !b.visible || !b.box || !onScreen(b.box)) continue;
      bb.push(b.box); bEx.push(b.exempt);
    }
    const cards = s.cards.filter((c) => onScreen(c.box));

    // (a) Drawn badge vs drawn badge. The headline number.
    //
    // The accessibility PITCH is counted separately from visual overlap on
    // purpose: they mean different things (one is a tap-target rule, the other
    // is legibility) and one of them is much more likely to be non-zero for a
    // legitimate reason. Rolled together, the first excusable case would
    // teach whoever reads this to ignore the line.
    //
    // Focused-room badges get their own bucket rather than being dropped:
    // their overlap is DELIBERATE (the exemption stacks them, which is exactly
    // why pairFocusedRoom exists), so mixing them in would poison the number
    // that matters while hiding the one case where the pairing failed.
    for (let i = 0; i < bb.length; i++) {
      for (let j = i + 1; j < bb.length; j++) {
        const ink = hits(bb[i], bb[j]);
        if (bEx[i] || bEx[j]) { if (ink) f.focusOverlaps++; continue; }
        if (ink) f.overlaps++;
        else if (Math.hypot(bb[i].cx - bb[j].cx, bb[i].cy - bb[j].cy) < s.minSepPx) f.tooClose++;
      }
    }
    if (f.overlaps) lines.push(`PLACEMENT: ${f.overlaps} drawn badge pair(s) OVERLAP on screen`);
    if (f.tooClose) lines.push(`PLACEMENT: ${f.tooClose} drawn badge pair(s) closer than the ${Math.round(s.minSepPx)}px tap pitch`);
    if (f.focusOverlaps) lines.push(`PLACEMENT: ${f.focusOverlaps} overlapping pair(s) inside the FOCUSED room (expected; pairFocusedRoom's leftovers)`);

    // (b) Drawn badge vs summary card, split in two — and the split is what
    // makes the line actionable. `overhung` is expressly allowed: a card MAY be
    // drawn over a badge outside its ink, because gating a card's existence on
    // its full width sends groups to room chips instead (see `fits`). A single
    // undifferentiated counter would be permanently non-zero for a documented
    // reason, and a permanently non-zero assertion is a disabled one.
    //
    // ⚠️ `buried` IS NOT AN INVARIANT VIOLATION EITHER, AND CALLING IT ONE COST
    // TWO ROUNDS OF CHASING (2.428.0). It is measured in a DIFFERENT SPACE from
    // the decision it appears to contradict:
    //
    //   * absorb decides in the ORTHOGRAPHIC view plane at the QUANTISED rung
    //     (`g.sx` vs `shown[j].sx`), which is what makes grouping invariant to
    //     camera position at all;
    //   * these boxes come from `Vector3.ProjectToRef(…, tm, vp, …)` — TRUE
    //     PERSPECTIVE at the LIVE camera — which is deliberate, because the
    //     assertion's job is to check the renderer's own output, not to re-run
    //     the solver's arithmetic.
    //
    // The gap between those two spaces is the orthographic-vs-perspective
    // residual CLAUDE.md documents as the ACCEPTED COST of
    // GROUP_OVERLAP_ALLOW_WIDTHS = 0, "always in the direction of the plane
    // over-estimating separation, and always for objects further from the camera
    // than the zoom rung's reference depth" — which is exactly a badge absorb
    // believed was clear being drawn under the ink. Its own list of what the old
    // margin covered includes "one or two things over a room chip": same family.
    //
    // So a small, transient `buried` is a MEASUREMENT. The invariant that really
    // must hold is the other side of the same absorb block — `seat REFUSED …
    // blocked by badge`, which cannot happen because the absorb box strictly
    // contains the refusal box on every axis — and every capture since 2.415.0
    // shows zero of those. Do NOT reinstate a margin on sight of this counter;
    // the honest mitigation is that a covered badge is still reachable, because
    // tap and long-press both ask pickBadgeAt first. The one dial, if it ever
    // costs more than the early grouping did, is GROUP_OVERLAP_ALLOW_WIDTHS at
    // -0.075 (half the old margin).
    // ── BUCKET, DO NOT DROP (2.432.0) ─────────────────────────────────────
    // These two `continue`s USED to skip every pair involving a focused card or
    // a focused badge, which made this test blind in exactly the state every
    // reported overlap has come from. The exemption is NOT the same condition as
    // "all other rooms are chipped": cullLabels computes `suppressOthers`
    // separately (RoomFocus.step: only at or wider than the granted zoom), so a focus can
    // be live while other rooms still draw their own badges and cards — a
    // capture caught precisely that, `exempt=12` beside `chips=1`.
    //
    // So focused pairs go in their own bucket, which is the pattern the
    // badge-vs-badge test two tiers up already uses (`focusOverlaps`). Dropping
    // them is what made `chipHits` report 0 for the case a screenshot showed
    // plainly (2.430.0), and /dry-audit found the same shape here. A counter
    // must never be blind to the case it exists to see; if a category is
    // expected, LABEL it, do not exclude it.
    for (const c of cards) {
      for (let i = 0; i < bb.length; i++) {
        const ink = hits(c.ink, bb[i]);
        if (!ink && !hits(c.box, bb[i])) continue;
        // A focused card never went through `fits`, and a focused badge blocks
        // nobody — so neither is a violation. Still counted, so the number
        // exists.
        if (c.focused || bEx[i]) { f.focusCardHits++; continue; }
        if (ink) f.buried++; else f.overhung++;
      }
    }
    if (f.buried) lines.push(`PLACEMENT: ${f.buried} drawn badge(s) BURIED under a summary's ink`);
    if (f.overhung) lines.push(`PLACEMENT: ${f.overhung} drawn badge(s) under a card's overhang (allowed)`);
    if (f.focusCardHits) {
      lines.push(`PLACEMENT: ${f.focusCardHits} badge/card overlap(s) involving a FOCUSED`
        + " object (expected: a focused card skips `fits`, a focused badge blocks"
        + " nobody — pairFocusedRoom is what keeps them all tappable)");
    }

    // (c) Summary vs summary. This one must be EXACTLY ZERO for cards that went
    // through `fits` — the single clearance guarantee it makes without
    // qualification, and nothing verified it before 2.405.0.
    //
    // Focused groups are BUCKETED rather than skipped, for the reason (b) above
    // spells out: they never went through `fits`, so they are not violations,
    // but two focused pair-cards CAN overlap each other (pairFocusedRoom emits
    // several per room) and a counter that drops them cannot say so.
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        if (!hits(cards[i].box, cards[j].box)) continue;
        if (cards[i].focused || cards[j].focused) f.summaryFocusOverlaps++;
        else f.summaryOverlaps++;
      }
    }
    if (f.summaryFocusOverlaps) {
      lines.push(`PLACEMENT: ${f.summaryFocusOverlaps} summary pair(s) OVERLAP involving a`
        + " FOCUSED card (expected: a focused card is seated unconditionally and"
        + " never went through `fits`)");
    }
    if (f.summaryOverlaps) {
      lines.push(`PLACEMENT: ${f.summaryOverlaps} summary pair(s) OVERLAP on screen`
        + (s.overlapAllow === 0
          // Saying "fits() promises this cannot happen" was true while a margin
          // covered the plane-vs-perspective residual. At zero it is not, and a
          // guard that cries regression at an accepted cost teaches its reader
          // to ignore it.
          ? " — expected: GROUP_OVERLAP_ALLOW_WIDTHS is 0, so nothing covers the"
            + " orthographic/perspective depth residual"
          : " — fits() promises this cannot happen"));
    }

    // (d) Room chip vs everything the chip outranks. A chip is the tier of
    // last resort and nothing used to test it against anything but another
    // chip — see CHIP_COLLISION. Measured in TRUE perspective like every other
    // counter here, against the chip's DRAWN box (it is lifted by half its own
    // height, exactly as badges and cards are). Focused-room badges are
    // excluded: they are exempt from the escalation pass by design, because
    // tapping a room must not be able to make that room vanish.
    // ⚠️ THE FOCUSED CASE IS COUNTED, NOT EXCLUDED (2.430.0). This skipped every
    // exempt badge and focused card — and when a room is focused those are the
    // ONLY things drawn besides the chips, so `chipHits=0` meant "not measured"
    // rather than "did not happen". A capture of exactly this complaint came
    // back clean while the screenshot showed it plainly. Third blind counter in
    // this file's history — same shape as estErr (2.421.0) and the chip-vs-chip
    // pair test (2.420.0): a counter must never be blind to the case it exists
    // to see. Reported SEPARATELY because it is expected and now harmless: the
    // chip paints behind (zIndex -1) and is asked last for taps, so the device
    // stays both visible and reachable.
    const chipBox = (c: RoomChip): ScreenBox => ({ cx: c.x, cy: c.y - c.halfH, hw: c.halfW, hh: c.halfH });
    for (const c of s.chips) {
      const box = chipBox(c);
      if (!onScreen(box)) continue;
      for (let i = 0; i < bb.length; i++) {
        if (!hits(box, bb[i])) continue;
        if (bEx[i]) f.chipHitsFocused++; else f.chipHits++;
      }
      for (const k of cards) {
        if (!hits(box, k.box)) continue;
        if (k.focused) f.chipHitsFocused++; else f.chipHits++;
      }
    }
    if (f.chipHits) lines.push(`PLACEMENT: ${f.chipHits} drawn badge(s)/card(s) OVERLAP a room chip`);
    // ⚠️ SHOULD NOW BE ZERO (2.431.0). settleChips drops any chip a focused
    // badge or card collides with, so this line firing means the drop missed —
    // most likely because the render set is measured here in TRUE PERSPECTIVE
    // while the drop tests the orthographic plane, i.e. the same residual the
    // BURIED counter reports. A small transient count is that; a persistent one
    // is a real gap in the drop.
    if (f.chipHitsFocused) {
      lines.push(`PLACEMENT: ${f.chipHitsFocused} FOCUSED badge(s)/card(s) over a room chip`
        + " — ONE FRAME while the camera flies in is the plane-vs-perspective"
        + " residual (expected); a PERSISTENT count is a gap in settleChips'"
        + " focus drop");
    }
    // ── (e) CHIP vs CHIP, AND THE ESTIMATE THAT DECIDES IT (2.420.0) ──────
    // The last hole in this family: every other tier had an overlap counter
    // and the chip-vs-chip merge — the one test 2.419.0 retuned — had none.
    //
    // Worth two counters rather than one, because the merge is the ONLY
    // collision test in the subsystem whose inputs are an ESTIMATE.
    // `chipWidthPx` is `len * 8.2 + 24`; the real width comes from Babylon's
    // `adaptWidthToChildren` and is not readable until after the frame is laid
    // out. Its docstring says it "only has to be close enough to keep chips
    // apart" — which was fair while a 6 px gap covered the error and is a
    // thinner claim now that 2.419.0 cut that to 2. Under-estimate by more
    // than the slack and two chips overlap on the glass with nothing merging
    // them; over-estimate and they merge while visibly clear, which is the
    // complaint 2.419.0 answered.
    //
    // So: `estErr` reads the width the renderer ACTUALLY laid out (the
    // previous frame's `_currentMeasure` — this pass has not laid out yet,
    // which is the whole reason the estimate exists) and reports the worst
    // disagreement in CSS px. If it comes back bigger than `minGapPx`, the gap
    // is not the dial to move: the estimate is, or the merge has to read the
    // drawn width a frame late.
    for (let i = 0; i < s.chips.length; i++) {
      const a = chipBox(s.chips[i]);
      if (!onScreen(a)) continue;
      for (let j = i + 1; j < s.chips.length; j++) {
        const b = chipBox(s.chips[j]);
        if (onScreen(b) && hits(a, b)) f.chipPairs++;
      }
    }
    if (f.chipPairs) {
      // ⚠️ This measures the merge against its OWN boxes, so it can only catch
      // a merge that failed to reach a fixpoint — never a wrong `halfW`, since
      // both sides read the same estimate. `estErr` below is the half that can
      // see the estimate, and it is the one to trust about width.
      lines.push(`PLACEMENT: ${f.chipPairs} room chip pair(s) OVERLAP on screen`
        + " — the merge did not reach a fixpoint (width error is estErr's job)");
    }

    let worst = "";
    for (const c of s.chips) {
      const drawn = s.chipDrawnWidth(c.key);
      if (!(typeof drawn === "number" && drawn > 0) || !(s.chipScale > 0)) continue;
      // ⚠️ ONLY THE ESTIMATE IS DIVIDED (2.421.0). `_currentMeasure` is the
      // control's PRE-TRANSFORM measure, so it is already in the CSS px the
      // control's own `width`/padding strings are written in — `scaleX` is
      // applied at draw time and never reaches it. `c.halfW` alone carries the
      // scale. As shipped, this divided both and reported 76-135 CSS px of
      // disagreement on a build whose estimate was within 30%: an instrument
      // that indicts the thing it is auditing is worse than no instrument, and
      // this one nearly bought a rewrite of chipWidthPx that was not needed.
      const err = Math.abs((c.halfW * 2) / s.chipScale - drawn);
      if (err > f.chipWidthErr) { f.chipWidthErr = err; worst = c.label; }
    }
    if (f.chipWidthErr > s.minGapPx) {
      lines.push(`PLACEMENT: chipWidthPx is off by ${f.chipWidthErr.toFixed(1)} CSS px`
        + ` (worst: "${worst}") — more than minGapPx=${s.minGapPx},`
        + " so the chip merge is deciding on a width it cannot trust");
    }

    // A badge never moves: the layout writes one shared lift and no X offset.
    for (const b of s.badges) if (b.offsetX !== 0) f.moved++;
    if (f.moved) lines.push(`PLACEMENT: ${f.moved} badge(s) have a non-zero X offset`);
    // A chipped room hands over ALL of its badges, never a subset.
    for (const b of s.badges) if (b.roomChipped && b.visible) f.leaked++;
    if (f.leaked) lines.push(`PLACEMENT: ${f.leaked} badge(s) visible inside a chipped room`);
    // ── EVERY BADGE IS DRAWN, INSIDE A DRAWN SUMMARY, OR CHIPPED ─────────
    // The one whole-system promise: a device the map knows about is always
    // reachable. `entityGrouped` marks a badge as "hidden because a summary
    // stands for it", but a summary can be DROPPED after the fact — a
    // cross-room group whose other room chipped is removed at the end of
    // placeEntityGroups while its members stay marked, so a badge in the room
    // that did NOT chip ends up hidden with nothing in its place. There has
    // never been a check for it; the 2x2 card makes the path more reachable,
    // because a bigger card fails `fits` more often and every failure
    // escalates a room.
    // BUCKETED, NOT DROPPED. A badge behind a wall in first-person is hidden on
    // purpose and is not an orphan — but a bare `continue` would delete it from
    // the only number that can report it, and this subsystem has already been
    // burned four times by an expected case swallowed by a `continue` (see the
    // badge-rules skill). It gets its own count on the same line, so "the wall
    // cull is hiding more than you think" stays visible from a capture.
    for (const b of s.badges) {
      if (b.visible || !b.inFront || b.roomChipped || b.covered) continue;
      if (b.occluded) f.byWall++; else f.orphaned++;
    }
    if (f.orphaned || f.byWall) {
      lines.push(`PLACEMENT: ${f.orphaned} badge(s) hidden with no summary and no chip`
        + ` (+${f.byWall} deliberately, behind a wall)`);
    }

    // "Nothing is drawn inside a summary's ink" — the invariant the absorb
    // phase exists to establish — used to be checked separately here, via
    // drawnDistance. That made it circular in exactly the way the badge-pair
    // check was: absorb decides with drawnDistance, so re-asking drawnDistance
    // could only ever agree. It is check (b)'s `buried` counter now, measured
    // against the card's drawn box.
    // Order independence — the purity guard.
    // The SAME drawableMax as the live solve, or this guard verifies the
    // purity of a function that does not ship.
    const { items, gap, minSep, mode, drawableMax } = s.solve;
    const reversed = items.slice().reverse();
    const a = solvePlacement(items, gap, minSep, mode, this.scratchA, drawableMax);
    const idsA = new Set<string>();
    for (let i = 0; i < items.length; i++) if (a.accepted[i]) idsA.add(items[i].sortKey);
    const b = solvePlacement(reversed, gap, minSep, mode, this.scratchB, drawableMax);
    const idsB = new Set<string>();
    for (let i = 0; i < reversed.length; i++) if (b.accepted[i]) idsB.add(reversed[i].sortKey);
    f.orderDependent = idsA.size !== idsB.size || [...idsA].some((id) => !idsB.has(id));
    if (f.orderDependent) lines.push(`PLACEMENT: ORDER DEPENDENT — ${idsA.size} vs ${idsB.size} accepted on a reversed input`);
    return f;
  }
}
