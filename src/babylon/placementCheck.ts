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
  /** Every surviving card: its whole box and the disc its cells' ink fills; `key` names it in a finding. */
  cards: readonly { box: ScreenBox; ink: ScreenBox; focused: boolean; key?: string }[];
  /** The chips that survived, and each one's measured width (CSS px) if drawn. */
  chips: readonly RoomChip[];
  chipDrawnWidth(key: string): number | undefined;
  chipScale: number;
  minGapPx: number;
  /** GROUP_OVERLAP_ALLOW_WIDTHS (0: grouping on contact, rules/decided.md#badges-group-only-when-they-touch). */
  overlapAllow: number;
  /** The pass's solver input, for the order-dependence re-solve. */
  solve: { items: readonly PlacementItem[]; gap: number; mode: "priority" | "legacy"; drawableMax: number };
}

/** Every count the check makes: each is a failure unless ALLOWED_FINDINGS names the owner's decision allowing it. */
export interface PlacementCounts {
  overlaps: number; focusOverlaps: number;
  buried: number; overhung: number; focusCardHits: number;
  summaryOverlaps: number; summaryFocusOverlaps: number;
  chipHits: number; chipHitsFocused: number; chipPairs: number;
  moved: number; leaked: number; orphaned: number; byWall: number;
}

/**
 * The counts that are NOT failures, each with the heading of the owner's decision that allows it in rules/decided.md
 * (tests/oracles/placement_check.mjs reads the file). Every other count is a failure: nothing on the map overlaps
 * (rules/decided.md#nothing-on-the-map-overlaps). A category is allowed here, by the owner's word, or nowhere.
 */
export const ALLOWED_FINDINGS: Readonly<Partial<Record<keyof PlacementCounts, string>>> = {
  byWall: "badges-behind-a-wall-hide-while-walking",
};

/** Two drawn things on the same pixels, named: what an agent needs to find them again (placementReport). */
export interface FindingPair { kind: keyof PlacementCounts; a: string; b: string }

/** What the check found — every count, the failures among them, the pairs, and the lines it would print. */
export interface PlacementFindings extends PlacementCounts {
  /** The chip width estimate's worst error, CSS px: a failure past minGapPx. */
  chipWidthErr: number;
  orderDependent: boolean;
  /** Every count not in ALLOWED_FINDINGS, plus a chip estimate past the gap and an order-dependent solve. */
  failures: number;
  /** The first PAIRS_KEPT overlapping pairs, by id (badge id, card key, `chip:` room key). */
  pairs: FindingPair[];
  lines: string[];
}

const PAIRS_KEPT = 24;
const COUNT_KEYS: readonly (keyof PlacementCounts)[] = [
  "overlaps", "focusOverlaps", "buried", "overhung", "focusCardHits", "summaryOverlaps", "summaryFocusOverlaps",
  "chipHits", "chipHitsFocused", "chipPairs", "moved", "leaked", "orphaned", "byWall",
];

/** The failures among `f`'s counts (see PlacementFindings.failures). */
export function failuresOf(f: PlacementCounts & { chipWidthErr: number; orderDependent: boolean }, minGapPx: number): number {
  let n = 0;
  for (const k of COUNT_KEYS) if (ALLOWED_FINDINGS[k] === undefined) n += f[k];
  return n + (f.chipWidthErr > minGapPx ? 1 : 0) + (f.orderDependent ? 1 : 0);
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
    // `conflicts` — the same items, the same predicate, the same gap the
    // solver had satisfied a few lines earlier. That is a
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
    // Ink on ink. No gap, no tolerance: two things either
    // cover the same pixels or they don't, and that is the one claim about
    // this subsystem nobody can argue with from a screenshot.
    const hits = (a: ScreenBox, b: ScreenBox) =>
      Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cy - b.cy) < a.hh + b.hh;
    const lines: string[] = [];
    const pairs: FindingPair[] = [];
    const f: PlacementFindings = {
      overlaps: 0, focusOverlaps: 0, buried: 0, overhung: 0, focusCardHits: 0,
      summaryOverlaps: 0, summaryFocusOverlaps: 0, chipHits: 0, chipHitsFocused: 0, chipPairs: 0,
      chipWidthErr: 0, moved: 0, leaked: 0, orphaned: 0, byWall: 0, orderDependent: false, failures: 0, pairs, lines,
    };
    /** Count one finding, and keep its pair while there is room. */
    const hit = (kind: keyof PlacementCounts, a: string, b: string) => {
      f[kind]++;
      if (pairs.length < PAIRS_KEPT) pairs.push({ kind, a, b });
    };

    // Drawn, in front, on screen: off-screen overlap is not something anyone sees.
    const bb: ScreenBox[] = [], bEx: boolean[] = [], bId: string[] = [];
    for (const b of s.badges) {
      if (!b.inFront || !b.visible || !b.box || !onScreen(b.box)) continue;
      bb.push(b.box); bEx.push(b.exempt); bId.push(b.id);
    }
    const cards = s.cards.filter((c) => onScreen(c.box));
    const cardId = (i: number) => cards[i].key ?? `card#${i}`;

    // (a) Drawn badge vs drawn badge. The headline number.
    //
    // Two of the focused room's OWN badges get their own bucket rather than
    // being dropped: the exemption stacks them (pairFocusedRoom pairs them up),
    // and a bucket says where an overlap came from. Both are failures
    // (rules/decided.md#nothing-on-the-map-overlaps). A focused badge under
    // ANOTHER room's is a plain overlap since 2.496.553: the other badge yields
    // (badgePlacement.focusContacts).
    for (let i = 0; i < bb.length; i++) {
      for (let j = i + 1; j < bb.length; j++) {
        if (!hits(bb[i], bb[j])) continue;
        hit(bEx[i] && bEx[j] ? "focusOverlaps" : "overlaps", bId[i], bId[j]);
      }
    }
    if (f.overlaps) lines.push(`PLACEMENT: ${f.overlaps} drawn badge pair(s) OVERLAP on screen`);
    if (f.focusOverlaps) lines.push(`PLACEMENT: ${f.focusOverlaps} drawn badge pair(s) OVERLAP inside the FOCUSED room (pairFocusedRoom's leftovers)`);

    // (b) Drawn badge vs summary card, split in two: under the card's middle
    // (`buried`) or only under its end (`overhung`). The end USED to be allowed —
    // the pass measured a card against a badge at one badge's box — and that is
    // how a pair card stood over most of a power reading's badge (owner's
    // screenshot, 2026-10-27). Since 2.496.552 the pass measures the card's whole
    // box and absorbs what it would cover.
    //
    // ⚠️ MEASURED IN A DIFFERENT SPACE FROM THE DECISION (2.428.0): absorb decides
    // in the ORTHOGRAPHIC view plane at the QUANTISED rung (`g.sx` vs
    // `shown[j].sx`), which is what makes grouping invariant to camera position;
    // these boxes come from `Vector3.ProjectToRef(…, tm, vp, …)`, TRUE
    // PERSPECTIVE at the LIVE camera, because the check's job is the renderer's
    // own output. A badge further than the rung's reference depth draws closer
    // than the plane predicted, so a count here can be that residual — still a
    // failure (rules/decided.md#nothing-on-the-map-overlaps), and the replay
    // (tools/placement-probe.mjs) is how to tell it from a pass bug.
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
    // must never be blind to the case it exists to see: a bucket says where an
    // overlap came from, and every bucket is a failure unless ALLOWED_FINDINGS
    // names the owner's decision.
    for (let ci = 0; ci < cards.length; ci++) {
      const c = cards[ci];
      for (let i = 0; i < bb.length; i++) {
        const ink = hits(c.ink, bb[i]);
        if (!ink && !hits(c.box, bb[i])) continue;
        // A focused card never went through `fits`, and a focused badge blocks nobody: their own bucket.
        hit(c.focused || bEx[i] ? "focusCardHits" : ink ? "buried" : "overhung", cardId(ci), bId[i]);
      }
    }
    if (f.buried) lines.push(`PLACEMENT: ${f.buried} drawn badge(s) BURIED under a summary's ink`);
    if (f.overhung) lines.push(`PLACEMENT: ${f.overhung} drawn badge(s) under a card's END`);
    if (f.focusCardHits) {
      lines.push(`PLACEMENT: ${f.focusCardHits} badge/card OVERLAP(s) involving a FOCUSED`
        + " object (a focused card skips `fits`, a focused badge blocks nobody)");
    }

    // (c) Summary vs summary. This one must be EXACTLY ZERO for cards that went
    // through `fits` — the single clearance guarantee it makes without
    // qualification, and nothing verified it before 2.405.0.
    //
    // Focused groups are BUCKETED rather than skipped, for the reason (b) above
    // spells out: they never went through `fits`, and two focused pair-cards CAN
    // overlap each other (pairFocusedRoom emits several per room); a counter
    // that drops them cannot say so.
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        if (!hits(cards[i].box, cards[j].box)) continue;
        hit(cards[i].focused || cards[j].focused ? "summaryFocusOverlaps" : "summaryOverlaps", cardId(i), cardId(j));
      }
    }
    if (f.summaryFocusOverlaps) {
      lines.push(`PLACEMENT: ${f.summaryFocusOverlaps} summary pair(s) OVERLAP involving a`
        + " FOCUSED card (a focused card is seated unconditionally, never through `fits`)");
    }
    if (f.summaryOverlaps) lines.push(`PLACEMENT: ${f.summaryOverlaps} summary pair(s) OVERLAP on screen`);

    // (d) Room chip vs everything the chip outranks. A chip is the tier of
    // last resort and nothing used to test it against anything but another
    // chip — see CHIP_COLLISION. Measured in TRUE perspective like every other
    // counter here, against the chip's DRAWN box (it is lifted by half its own
    // height, exactly as badges and cards are).
    // ⚠️ THE FOCUSED CASE IS COUNTED, NOT EXCLUDED (2.430.0). This skipped every
    // exempt badge and focused card — and when a room is focused those are the
    // ONLY things drawn besides the chips, so `chipHits=0` meant "not measured"
    // rather than "did not happen". A capture of exactly this complaint came
    // back clean while the screenshot showed it plainly. Third blind counter in
    // this file's history — same shape as estErr (2.421.0) and the chip-vs-chip
    // pair test (2.420.0): a counter must never be blind to the case it exists
    // to see. Its own bucket, a failure like the rest: settleChips drops any chip
    // a focused badge or card collides with (2.431.0), so a count here is the
    // plane-vs-perspective residual of (b) or a gap in that drop.
    const chipBox = (c: RoomChip): ScreenBox => ({ cx: c.x, cy: c.y - c.halfH, hw: c.halfW, hh: c.halfH });
    for (const c of s.chips) {
      const box = chipBox(c);
      if (!onScreen(box)) continue;
      for (let i = 0; i < bb.length; i++) {
        if (hits(box, bb[i])) hit(bEx[i] ? "chipHitsFocused" : "chipHits", `chip:${c.key}`, bId[i]);
      }
      for (let k = 0; k < cards.length; k++) {
        if (hits(box, cards[k].box)) hit(cards[k].focused ? "chipHitsFocused" : "chipHits", `chip:${c.key}`, cardId(k));
      }
    }
    if (f.chipHits) lines.push(`PLACEMENT: ${f.chipHits} drawn badge(s)/card(s) OVERLAP a room chip`);
    if (f.chipHitsFocused) lines.push(`PLACEMENT: ${f.chipHitsFocused} FOCUSED badge(s)/card(s) OVERLAP a room chip`);
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
        if (onScreen(b) && hits(a, b)) hit("chipPairs", `chip:${s.chips[i].key}`, `chip:${s.chips[j].key}`);
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
        + ` (+${f.byWall} behind a wall, allowed: rules/decided.md#${ALLOWED_FINDINGS.byWall})`);
    }

    // "Nothing is drawn inside a summary's ink" — the invariant the absorb
    // phase exists to establish — used to be checked separately here, via
    // the distance absorb used. That made it circular in exactly the way the
    // badge-pair check was: re-asking absorb's own distance
    // could only ever agree. It is check (b)'s `buried` counter now, measured
    // against the card's drawn box.
    // Order independence — the purity guard.
    // The SAME drawableMax as the live solve, or this guard verifies the
    // purity of a function that does not ship.
    const { items, gap, mode, drawableMax } = s.solve;
    const reversed = items.slice().reverse();
    const a = solvePlacement(items, gap, mode, this.scratchA, drawableMax);
    const idsA = new Set<string>();
    for (let i = 0; i < items.length; i++) if (a.accepted[i]) idsA.add(items[i].sortKey);
    const b = solvePlacement(reversed, gap, mode, this.scratchB, drawableMax);
    const idsB = new Set<string>();
    for (let i = 0; i < reversed.length; i++) if (b.accepted[i]) idsB.add(reversed[i].sortKey);
    f.orderDependent = idsA.size !== idsB.size || [...idsA].some((id) => !idsB.has(id));
    if (f.orderDependent) lines.push(`PLACEMENT: ORDER DEPENDENT — ${idsA.size} vs ${idsB.size} accepted on a reversed input`);
    f.failures = failuresOf(f, s.minGapPx);
    return f;
  }
}
