// src/babylon/placementPass.ts
// ONE PLACEMENT PASS: which badges go into a card, which rooms become chips
// and why — the steps after the solver, for one layout pass:
//   * placeEntityGroups — seat each card, absorb the badges it covers, and
//     escalate a card with no seat to its rooms' chips;
//   * pairFocusedRoom — the focused room's own pairs and counts;
//   * settleChips — chips against badges and cards, to a fixpoint;
//   * dropEscalatedGroups — a group whose rooms were all chipped goes.
// Every room that becomes a chip says why (chipRoom).
//
// ⚠️ IT LIVED IN EntityVisuals AS SIX METHODS TALKING THROUGH EIGHT FIELDS,
// and about 25 releases (2.403–2.432) changed exactly these rules — "a device
// may only join a card it actually touches", "a dropped group releases its
// other rooms", "cards were seated in an order that carried no meaning" — with
// no test able to reach any of them. The state is this object's now, cleared
// by `begin`; what it needs of the badge layer (the room of a device, a card's
// arrangement, the projection, the chips' text) is PlacementHost.
// tests/oracles/placement_pass.mjs drives it with a fake host.
//
// The ORDER of the tiers (readout → card → chip) stays in cullLabels: it is
// interleaved with GUI measurement no oracle can run.

import { roomKey, NO_ROOM_LABEL } from "@/config/roomKey";
import type { LabelControls } from "./EntityVisuals";
import { type BadgeMetrics } from "./badgeMetrics";
import { type ViewBasis } from "./badgeProjection";
import { mergeCollidingPiles, buildCliques, type PlacementItem } from "./badgePlacement";
import { channelEnabled } from "@/utils/tapDebug";
import { type RoomChip } from "./roomChips";
import { RoomFocus } from "./roomFocus";
import { type CardArrangement } from "./badgeCard";

/** The comparison key of the no-room bucket, normalised ONCE at module level —
 *  `roomOf` hands out the LABEL and every map here is keyed by `roomKey`, so
 *  the two must be related in exactly one place. See chipRoom, which refuses
 *  to chip it. */
const NO_ROOM_KEY = roomKey(NO_ROOM_LABEL);

/**
 * How much of its own width a badge ICON may overlap a neighbour before the
 * two count as piled together.
 *
 * This is THE control over how large badges can get before a room summarises,
 * and there are only ever three ways to resolve two badges that want the same
 * pixels: let them overlap, move one, or merge them. Moving is ruled out (it
 * is the fan, removed in 2.159.0 — see the file header), so the choice is
 * between this number and how early the room chip appears. They are the same
 * dial read from two ends.
 *
 * Back to ZERO in 2.173.0, and it should stay there. It was raised to half a
 * width in 2.168.0 as the only lever available while badges were pinned to
 * their anchors — the size ceiling had to be bought from somewhere, and
 * overlap was all there was. 2.169.0 let badges move again, which buys the
 * same headroom without the cost, so the tolerance became a licence to
 * overlap that nothing needed. Reported, correctly, as badges sitting on top
 * of each other.
 */
export const GROUP_OVERLAP_ALLOW_WIDTHS = 0;
/*
 * ── ZERO BY EXPLICIT DECISION (2.413.0), NOT BY OVERSIGHT ──────────────────
 * The owner was shown the trade in numbers and chose pure contact: nothing
 * groups until the ink actually meets. Do NOT restore the margin because a
 * `PLACEMENT: … OVERLAP` counter fires — that counter firing is the ACCEPTED
 * COST of this setting, not evidence of a regression, and the whole point of
 * the paragraphs below is that the cost was known before the choice was made.
 *
 * What it means in practice, measured from the capture that prompted it: the
 * rule now fires when the visible gap drops under ~9% of a badge height (the
 * 2px legibility gap alone) instead of ~24%. The pair that triggered the
 * report — a corridor light and a bedroom curtain at `dy=85` against a need of
 * `89` — stays apart, because ink-to-ink they do not touch until 72.
 *
 * ── What the 15% was for, kept so nobody re-derives it ─────────────────────
 * Read as written, this is "how much of its own width a badge may overlap a
 * neighbour". A NEGATIVE value was the opposite request: reserve that much
 * MORE than the ink. It paid for the one approximation 2.287.0 bought its
 * correctness with, and the residual it covered was measured, not guessed:
 * one to five overlapping badge pairs out of twenty to thirty-four drawn, one
 * summary pair inside a narrow band of tilt, and one or two things over a room
 * chip. Those are the pairs that may now reappear, always in the direction of
 * the plane over-estimating separation, and always for objects further from
 * the camera than the zoom rung's reference depth.
 *
 * ⚠️ The honest mitigation if they become a nuisance is NOT to reinstate a
 * blanket margin — it is that a badge drawn under another is still reachable,
 * because SceneManager's tap and long-press both ask `pickBadgeAt` before
 * answering. Set this to -0.075 for half the old margin if the overlaps are
 * worse in practice than the early grouping was; that is the dial, and it is
 * one number.
 *
 * It pays for the one thing 2.287.0 bought its correctness with. Placement is
 * measured on an orthographic view plane at ONE pixels-per-world for the whole
 * scene; the renderer divides every drawn thing by its OWN depth. Two objects
 * further from the camera than the zoom rung's reference depth therefore draw
 * closer together than the plane predicted, by the ratio of those depths, and
 * nothing inside a position-invariant metric can know that ratio — knowing it
 * is precisely what "invariant to where the camera stands" forbids.
 *
 * So it is not an error to be removed, it is a bounded approximation to be
 * covered, and 15% is what the field numbers cost: after 2.291.0 the residual
 * was one to five overlapping badge pairs out of twenty to thirty-four drawn,
 * one summary pair inside a narrow band of tilt, and one or two things over a
 * room chip — small, and always in the direction of the plane over-estimating
 * separation. This buys all three at once because all three read `allow`.
 *
 * The cost is stated: everything merges very slightly earlier, so a crowded
 * corner reaches its summary card, and a summary reaches its room chip, at a
 * marginally wider zoom than before. That is the trade this dial has always
 * been — "how large badges can get before a room summarises" — and it is the
 * right side of it, because a badge that has merged is still reachable through
 * its card while a badge drawn under another one is not.
 *
 * ZERO restores the pre-2.292.0 geometry exactly.
 */

/**
 * Do room chips take part in the collision they were the answer to?
 *
 * Until 2.290.0 they did not, and the omission was invisible because it looks
 * like a completed cascade: a crowded room hands its badges to a chip, and the
 * chip is the tier of last resort, so nothing checks it against anything. But
 * `updateClusters` only ever tested chips against OTHER CHIPS. A chip sits at
 * its room's device centroid, which is nobody's badge position and nobody's
 * card position, and it is far wider than either — so a neighbouring room's
 * badge or summary lands on top of it routinely. That is the card sitting on
 * "Staircase" in the top-down screenshots.
 *
 * The resolution is the same one every other tier uses: the thing that can
 * escalate does. A drawn badge or a placed card overlapping a chip sends its
 * OWN room(s) to their own chip — never the other way round, because a chip is
 * already the last tier and has nowhere to go. Rooms are only ever added to
 * `roomClustered`, so the loop is monotone and terminates in at most one round
 * per room.
 *
 * Two spaces, deliberately, and this must not be "tidied up" into one:
 * chip-vs-chip MERGING stays in true perspective (it is cosmetic, post-hoc,
 * cannot feed back into the solve, and being exact there is free), while
 * chip-vs-badge/card ESCALATION uses the view plane, because it decides what
 * is drawn and must stay invariant to where the camera is standing.
 *
 * ⚠️ THAT SENTENCE WAS A LIE FROM 2.290.0 TO 2.298.0, and 2.299.0 is what
 * makes it true. Escalation did use the plane — for the chips' POSITIONS. But
 * the chips it was handed were the MERGED ones, and which chips exist, how
 * many there are and where each sits are all decided by the perspective merge
 * above. A camera-position-dependent computation therefore chose the obstacle
 * set for the one test that decides what is drawn, which is the exact property
 * six rewrites died protecting. Escalation now collides against the UNMERGED
 * per-room chips — one box per chipped room, at that room's own centroid, at
 * its own text width — and merging is applied afterwards, to the render set
 * only, where it genuinely is cosmetic and genuinely cannot feed back.
 *
 * The leak was not theoretical. Merging is a function of screen distance, so
 * zooming in SPLITS a merged pill, and the pieces do not stay where the pill
 * was: each drops onto its own room's centroid, which may be somewhere the
 * obstacle set previously had nothing at all. A room that had decluttered into
 * a summary card then collides with a chip that only just appeared under it,
 * escalates, and collapses back to a chip — one rung after it expanded. That
 * is the reported "Living Room goes chip → entities → chip → entities as I
 * zoom in", captured in sources/files/zoom_in.gif. Panning did the same thing
 * for the same reason and would have been reported as badges dancing again.
 *
 * Unmerged obstacles also restore monotonicity in ZOOM, which the merged set
 * could not have: each box is a fixed pixel size at a fixed world point, so a
 * higher rung strictly increases every separation, and `roomClustered` only
 * shrinks between rungs. Nothing that has expanded can re-collapse without the
 * view direction itself changing.
 *
 * `false` restores the pre-2.290.0 behaviour exactly. It is here because this
 * is the tier that spends chips, and how many chips is too many is a judgement
 * only a screenshot can make.
 */
const CHIP_COLLISION = true as boolean;

/** A badge that survived the per-entity culls (category / floor / enabled),
 *  with BOTH its world-space anchor and its projected screen position. */
export interface ShownLabel {
  id: string;
  lbl: LabelControls;
  /** Projected screen position of the anchor, in render pixels. */
  x: number;
  y: number;
  /** World-space anchor position. `wy` (mounting HEIGHT) counts as much as the
   *  ground axes: an anchor sits just above its own geometry
   *  (buildLabelAnchors), so a ceiling fan's is ~2.7m up while a table lamp's
   *  is barely off the floor. Kept because two things genuinely need a world
   *  position — quantisedPixelsPerWorldUnit's distance to the camera, and
   *  solveRoomZoomRadius's framing — and because it is what the projection
   *  projects. */
  wx: number;
  wy: number;
  wz: number;
  /** Where the badge's BOX IS DRAWN on this pass's view plane, in GUI pixels —
   *  THE input to grouping. The anchor projected (see badgeProjection for why
   *  the decision is made in this plane rather than in world space or in true
   *  perspective) and then lifted by the badge's own `cy`, because a badge
   *  hangs above its anchor by an amount that differs between badges. Written
   *  by placementItems, the one place the projection happens. */
  sx: number;
  sy: number;
  sz: number;
  /** Anchor is in front of the camera, i.e. has a valid screen position at
   *  all. Purely a RENDER gate — deliberately not an input to grouping. */
  inFront: boolean;
  /** A wall (or slab, or shell) stands between the walking camera's eye and
   *  this anchor. First-person only, and — like `inFront`, and for the same
   *  reason — purely a RENDER gate: an occluded badge still takes part in
   *  grouping, so walking around a room can never change how it is presented.
   *  Always false in overview, where the whole villa is deliberately seen at
   *  once and through its own walls. */
  occluded: boolean;
}

/** An entity group decided this frame, before it has been checked for
 *  clearance and given controls. */
export interface PendingEntityGroup {
  /** Stable identity across frames: room + the lowest entity id in the pile.
   *  Membership is a pure function of world positions and quantised zoom, so
   *  the same pile yields the same key on every device and every frame. */
  key: string;
  /** The room's name as it will be PRINTED (raw, from HA), carrying the room
   *  chip's own "+N" suffix when the group straddles a boundary — see
   *  badgePlacement's DeferralBucket.rooms for why it now can. */
  room: string;
  /** Every room the group covers, as Map keys — see EntityVisuals.roomClustered
   *  for why the printable and the key form are carried separately rather than
   *  derived at each use. A group that cannot be placed escalates ALL of them,
   *  because all-or-nothing per room is what makes a chip readable. */
  roomKeys: string[];
  members: number[];
  /** The members' world centroid — the ONLY stored position. The card RENDERS
   *  here (linkWithMesh on a node at this point). */
  wx: number; wy: number; wz: number;
  /** The same point, projected into this pass's plane. DERIVED from wx/wy/wz by
   *  the same projection every badge uses, never accumulated in parallel: the
   *  projection is affine, so the plane centroid of the members IS the
   *  projection of their world centroid, and that identity is what makes "the
   *  card is measured where it is drawn" a fact rather than a discipline. */
  sx: number; sy: number; sz: number;
  /**
   * How many device pictograms this group asks to draw. Never 0: every group
   * reaching the renderer has at least two members, and `gridCells` stopped
   * refusing in 2.363.0.
   *
   * The card is an integer number of badge boxes on each axis (see
   * babylon/badgeCard), so every cell's tap zone is exactly the box of the
   * badge it stands in for. Decided where the group is made and never revoked:
   * the size is not a clearance decision. It was once, and because clearance
   * depends on the quantised ZOOM the same pair drew as a full-size card at one
   * rung and a half-scale one at the next — one situation, two objects, which
   * is not a distinction anybody reading a floor plan can act on.
   *
   * `badgeCard.gridCells` is the cap, applied by the layout itself rather than
   * trusted to this field: a card is one badge per column, so an unbounded
   * count is an unbounded card.
   */
  grid: number;
  /**
   * Made inside the FOCUSED room (see pairFocusedRoom), not by the main solve.
   *
   * It skips the clearance test and can never escalate a room to its chip:
   * it stands in for two badges that were already being drawn on top of each
   * other, so refusing it would put back the very overlap it exists to
   * remove, and chipping the room the user just asked to see would break the
   * one promise the focus makes.
   */
  focused: boolean;
}

/** What a placement pass needs from the badge layer. */
export interface PlacementHost {
  roomOf(entityId: string): string;
  layoutOf(g: PendingEntityGroup, memberCount: number): CardArrangement;
  planeOf(clearance: { pxPerWorld: number; basis: ViewBasis }, x: number, y: number, z: number): { sx: number; sy: number; sz: number };
  drawnDistance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number;
  summaryMetrics(): { size: number; font: number; countSize: number; countFont: number };
  sortCardMembers(shown: ShownLabel[], members: number[]): number[];
  cardOf(cells: number, max?: number, maxWidth?: number): CardArrangement;
  cardBudget(): number;
  cardCellCap(max?: number): number;
  effectiveScale(): number;
  deriveChips(shown: ShownLabel[], merge?: boolean): RoomChip[];
  metrics(): BadgeMetrics;
  focus(): RoomFocus;
}

export class PlacementPass {
  private readonly host: PlacementHost;
  constructor(host: PlacementHost) { this.host = host; }

  /** A new pass: forget the last one's chips, cards and counters. */
  begin(): void {
    this.roomClustered.clear();
    this.chipWhyCount.clear();
    this.chipRefusedNoRoom = 0;
    this.roomDisplay.clear();
    this.entityGrouped.clear();
    this.focusPairs = 0;
    this.absorbed = 0;
  }

  /** `?debug` only: badges pulled into a summary because they were underneath
   *  it (see the absorb phase in placeEntityGroups). */
  absorbed = 0;

  /** Summaries made inside the focused room — pair cards and counts alike
   *  (see pairFocusedRoom). One per pile, so this is also "how many piles the
   *  focused room had", which is the number worth watching: it should be small
   *  after the zoom solver has framed the room. */
  focusPairs = 0;

  /**
   * Why each room became a chip, keyed by reason.
   *
   * ⚠️ `chipWhy` reported THREE reasons while TEN call sites could chip a room,
   * so a field capture read `undrawable=0 degenerate=0 focus=0` beside
   * `chips=8` — a zero that meant "not measured", not "did not happen", and it
   * pointed every reader at the solver when the solver had chipped nothing.
   * That is this project's own instruments-never-skip rule broken in its own
   * telemetry. Every write to `roomClustered` now goes through `chipRoom` and
   * states a reason, so the totals reconcile with `chips=` by construction.
   *
   * Counted on the FALSE→TRUE transition only: a room chipped by one rule and
   * re-set by a later one is one chip, not two, and the point of these numbers
   * is to add up to the chips actually drawn.
   */
  chipWhyCount = new Map<string, number>();

  /** How many times a chip was REFUSED for naming the no-room bucket — see
   *  chipRoom. Deliberately not in `chipWhyCount`: that map holds reasons a chip
   *  EXISTS, and `total=` sums it against `chips=`. */
  chipRefusedNoRoom = 0;

  /** Solver input for the focused room's own pass — see pairFocusedRoom. */
  focusItems: PlacementItem[] = [];

  /** shown-index per focusItems slot, pooled: this runs per frame while a room
   *  is focused, and the steady state should allocate nothing. */
  focusIdx: number[] = [];

  /** Which rooms are showing their cluster chip instead of individual badges.
   *  Recomputed from scratch every frame by cullLabels — deliberately NOT
   *  carried over as state: grouping is a pure function of world positions
   *  and zoom now, and the previous frame's answer must never influence this
   *  one (that path-dependence was the "stays grouped when I slide back"
   *  bug — see the grouping thresholds' comment). Kept as a field only so
   *  updateClusters and pickClusterAt can read the current frame's result. */
  /**
   * Rooms summarised into a chip this frame.
   *
   * Per ROOM, deliberately: when a room collapses it takes ALL of its badges
   * with it. 2.166.0 briefly clustered per PILE instead — a chip swallowed
   * only the devices that actually overlapped and left the room's other
   * badges in place, the way a map clusters markers. It is a defensible model
   * and it was rejected: a room that is half chip and half loose badges asks
   * the user to work out which of its devices the chip stands for, and a
   * count that covers some of a room but not the rest is not a fact anyone
   * can use. All-or-nothing per room is the readable contract — the chip
   * means "this room, summarised", every time.
   *
   * Keyed by roomKey(), never the raw name. It used to be the raw name while
   * roomShownCount and the one-room test next to it already used roomKey(),
   * and rooms come from HA Area names whose casing and padding are whatever
   * HA has — so "Master Bedroom" and "master bedroom " counted as ONE room
   * for the denominator and TWO for this flag. That combination can collapse
   * one spelling and leave the other's badges drawn: a half-chip, half-badges
   * room, which is exactly the state the paragraph above says must never
   * exist. Per CLAUDE.md the key is a Map key only; every displayed name
   * stays the raw one (see roomDisplay).
   */
  roomClustered = new Map<string, boolean>();

  /** roomKey() → the raw room name to PRINT for it. The lexicographically
   *  smallest spelling seen in the current pass, so two casings of one room
   *  cannot make a chip's label flip between frames. */
  roomDisplay = new Map<string, string>();

  /** Entity ids currently standing behind an entity group, so cullLabels'
   *  visibility pass hides them exactly like a room-clustered badge. */
  entityGrouped = new Set<string>();

  /** This pass's `seat` detail, flushed by logPlacement on a real change. */
  seatLog: string[] = [];

  /**
   * THE one writer for `roomClustered` — a room may not become a chip without
   * saying which rule did it. See chipWhyCount for what that is worth.
   */
  chipRoom(key: string, why: string): void {
    // ⚠️ THE NO-ROOM BUCKET IS NOT A ROOM, AND MUST NEVER DRAW A CHIP (2.440.0).
    //
    // `roomOf` falls back to NO_ROOM_LABEL ("Other") for any entity whose room
    // is unknown — no HA Area, and no drawn polygon containing it. That bucket
    // is a legitimate thing to LIST (the Cockpit and the group panel both sort
    // it last on purpose), but on the map a chip is a claim: "this room,
    // summarised, tap it to see inside". There is no Other room in the villa,
    // so the chip names a place that does not exist and puts it at the
    // centroid of devices that have nothing to do with each other.
    //
    // Refused HERE because this is the one writer of `roomClustered` (2.403.0),
    // so one guard covers every tier that can chip — solver, seating, focus,
    // chip-vs-badge, chip-vs-card. Its members keep their individual badges;
    // they can still form summary CARDS, which are per-PILE and make no claim
    // about rooms, and nothing hides them, so the orphan invariant is
    // unaffected.
    //
    // Counted, never silently dropped: `noroom=` in chipWhy is how many rooms'
    // worth of chipping this guard turned down, so the guard cannot become
    // invisible the way the ten unnamed chip sites were before 2.403.0.
    if (key === NO_ROOM_KEY) {
      // ⚠️ ITS OWN COUNTER, NOT chipWhyCount. That map is the list of REASONS A
      // CHIP EXISTS and `total=` sums it to reconcile against `chips=` — a
      // refusal in there would inflate the total above the chips drawn and make
      // the one field that audits this tier stop adding up. Counted separately,
      // printed separately, labelled as a refusal.
      this.chipRefusedNoRoom += 1;
      return;
    }
    if (this.roomClustered.get(key)) return;
    this.roomClustered.set(key, true);
    this.chipWhyCount.set(why, (this.chipWhyCount.get(why) ?? 0) + 1);
  }

  /**
   * Decide which pending entity groups may actually be drawn, and drop the
   * rest to their room's chip.
   *
   * A group badge is a badge: it has to clear everything a badge has to clear,
   * or it is just a new way to draw two things on top of each other — the
   * exact failure the whole subsystem exists to prevent. It is checked against
   * the three things that can be in its way, all in WORLD space against the
   * quantised zoom, like every other decision here:
   *
   *   * badges that were ACCEPTED — every one of them is at its own anchor,
   *     because nothing in this file moves a badge, so the anchor is the
   *     position to test and there is no seat to look up;
   *   * other groups, in a fixed order so each pair meets exactly once.
   *
   * The centroid being inside the pile's own hull makes a collision unlikely
   * but not impossible — a point interior to a hull can sit closer to an
   * outside badge than any vertex does — so it is checked rather than assumed.
   *
   * Mutates `this.entityGrouped` (which badges hide) and `this.roomClustered`
   * (which rooms escalate), and prunes `pending` in place to what survived.
   */
  placeEntityGroups(
    shown: ShownLabel[],
    boxes: { halfW: number; halfH: number; cy: number }[],
    pending: PendingEntityGroup[],
    /** This pass's own clearance — passed in rather than re-derived, so the
     *  absorb sweep re-projects a moved centroid through exactly the basis and
     *  rung the members were projected with. */
    clearance: { pxPerWorld: number; basis: ViewBasis },
  ): void {
    if (pending.length === 0) return;
    const pxPerWorld = clearance.pxPerWorld;
    const scale = this.host.effectiveScale();
    if (pxPerWorld <= 0) {
      // No usable projection this frame — fall back to the tier that needs
      // none rather than drawing groups at unverified positions.
      for (const g of pending) for (const k of g.roomKeys) this.chipRoom(k, "noproj");
      pending.length = 0;
      return;
    }
    const gapPx = this.host.metrics().minGapPx * scale;
    const allow = 1 - GROUP_OVERLAP_ALLOW_WIDTHS;
    // Everything below compares PIXELS to PIXELS. Groups and badges alike
    // arrive already projected onto this pass's view plane (see
    // badgeProjection), which is the space both of these comparisons — a
    // summary against a badge, a summary against another summary — are
    // actually asking about: what overlaps ON SCREEN.
    // ── DELIBERATELY NOT CONVERGED with the other box tests ────────────────
    // `|dx| < needX && |dy| < needY` also appears in badgePlacement's
    // `conflicts` and `mergeCollidingPiles`, in settleChips' `clears`, and in
    // the placement guard's `hits`. A /dry-audit weighed folding them into one
    // helper and the answer is no: the shared part is ONE line, while
    // everything that can actually drift — which half-extents, whose gap,
    // whether the tap-pitch floor applies, whether the along-view residual
    // folds in — is per tier and cannot be shared. `hits` must stay separate
    // outright: it is the GUARD, and measures ink on ink in true perspective
    // with no gap and no tolerance, the opposite of every other instance by
    // design. Recorded so the next audit re-reads this rather than re-deciding.
    // The larger of the two half-extents, because a neighbour can lie in any
    // direction and this is a radial test rather than a box overlap.
    const halfOf = (i: number) => Math.max(boxes[i].halfW, boxes[i].halfH);
    // A group is drawn at the badge scale and at the badge size (see
    // summaryMetrics), so this measures it with the same numbers the renderer
    // uses — no second scale to keep in step. There used to be one: the group
    // was floored at CLUSTER_MIN_SCALE while badges took the 0.7 far-zoom cap,
    // which made a summary bigger than the badges it replaced AND forced this
    // method to reason in a scale of its own. Both went together.
    const sm = this.host.summaryMetrics();
    const squareHalf = (sm.size / 2) * scale * allow;
    // From the SAME function that draws it — the width a group is TESTED at
    // has to be the width it is DRAWN at, which is this file's oldest rule.
    // ── THE CIRCUMSCRIBED RADIUS, not half the width ────────────────────
    // This test is a DISC — it works in world distance scaled by the quantised
    // zoom, and knowing which way a neighbour lies relative to the card would
    // need the camera, the one dependency this subsystem is built without. A
    // disc of half the WIDTH is honest for a card that is wider than it is
    // tall and badly dishonest for a square one: two 2x2 cards two units apart
    // on the diagonal would each be 1.41 units away on both axes and overlap
    // in both, while the test called them clear. `hypot` is the smallest disc
    // that actually contains the card.
    //
    // "A summary must clear other summaries" is the one thing this test still
    // promises absolutely (see `fits`), so it is the one place that cannot be
    // approximated downward.
    const cardHalfOf = (g: PendingEntityGroup) => {
      const lay = this.host.layoutOf(g, g.members.length);
      return (Math.hypot(lay.width, lay.height) / 2) * scale * allow;
    };
    /**
     * The plane Y where the card's INK actually is: its anchor lifted by half
     * its OWN height, exactly as updateEntityGroups sets linkOffsetYInPixels.
     *
     * Two cards of different heights are lifted by different amounts, so a test
     * that compared their ANCHORS was measuring points up to half a card apart
     * from where the ink is. Circumscribed discs at the anchors are no defence:
     * shifting one box relative to the other closes the gap the discs were
     * counting on, and 2.287.0's counters found real pairs doing it — up to
     * five at once on a phone, against a promise `fits` makes absolutely.
     *
     * Same rule as the badge's `cy` (see placementItems): measure the card
     * where it is drawn.
     */
    const cardCentreY = (g: PendingEntityGroup) => {
      const lay = this.host.layoutOf(g, g.members.length);
      return g.sy - (lay.height / 2) * scale;
    };
    /**
     * The largest disc that fits INSIDE the card — "is this badge underneath
     * my ink", which is a different question from "do we clear each other".
     *
     * It has to be the inscribed radius and not `cardHalfOf`'s circumscribed
     * one. A 2x2 card's circumscribed disc is 1.41 units while its ink only
     * reaches 1.0 on either axis, and `fits` accepts a badge from about 1.0
     * plus a gap — so absorbing at 1.41 would swallow badges that are visibly
     * clear of the card. That is deleting devices from the map to fix a bug
     * about the opposite.
     *
     * ⚠️ Inscribed leaves exactly a `gapPx`-wide annulus between this and the
     * box `fits` refuses at, and the absorb sweep adds `gapPx` back to close
     * it — see the block there. This comment used to call that annulus "the
     * right amount of nothing"; a badge in it refused its card and chipped
     * every room the card covered.
     */
    const cardInscribedHalf = (g: PendingEntityGroup) => {
      const lay = this.host.layoutOf(g, g.members.length);
      return (Math.min(lay.width, lay.height) / 2) * scale * allow;
    };
    // A group is measured against OTHER GROUPS at the width it is actually
    // DRAWN at — the file's oldest rule. Against badges it is measured at ONE
    // badge box (`vsBadge`) instead; see `fits` for why that asymmetry is
    // deliberate. Both of these used to branch on `drawnCells < 2` and fall
    // back to `squareHalf` — the count badge's footprint, unreachable since
    // 2.363.0. See the absorb block for the proof.
    const groupHalf = (g: PendingEntityGroup) => cardHalfOf(g);

    /** The same extent as `groupHalf`, kept as SEPARATE half-width and
     *  half-height instead of collapsed into a circumscribed radius — see the
     *  boxes-not-discs block in `fits`. */
    const groupBox = (g: PendingEntityGroup): { hw: number; hh: number } => {
      const lay = this.host.layoutOf(g, g.members.length);
      return { hw: (lay.width / 2) * scale * allow, hh: (lay.height / 2) * scale * allow };
    };
    /** Only the plane metric puts both card axes on the screen's own axes;
     *  see projectToView, which zeroes `pz` there and not in world3d. */
    const planar = clearance.basis.mode === "plane";

    // Fixed order (the key is stable and total), so which of two conflicting
    // groups survives never depends on the order the solver emitted them in.
    // Byte order, not localeCompare: collation is environment-dependent, and
    // two clients must resolve the same conflict the same way.
    pending.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const placed: PendingEntityGroup[] = [];
    /**
     * Does this group clear every drawn badge, and every OTHER placed group, at
     * whatever width `g.pair` currently asks for?
     *
     * `others` is passed rather than closed over because this runs in two
     * passes and they need different sets — see below.
     */
    const focus = this.host.focus().rooms;
    // ── WHY a seat was refused, in pixels (the `seat` debug channel) ───────
    // `fits` is a boolean, and a boolean cannot answer "they are not even
    // touching". This records the blocker and the per-axis SHORTFALL — how
    // many pixels short of the required clearance the pair actually was — so a
    // refusal can be read as a measurement instead of a verdict. Written only
    // on the refusing comparison, so it costs one string per refusal and
    // nothing at all when nothing is refused.
    let why = "";
    const shortfall = (dx: number, needX: number, dy: number, needY: number) =>
      `dx=${dx.toFixed(0)}/${needX.toFixed(0)}(-${(needX - dx).toFixed(0)})`
      + ` dy=${dy.toFixed(0)}/${needY.toFixed(0)}(-${(needY - dy).toFixed(0)})`;
    const fits = (g: PendingEntityGroup, others: PendingEntityGroup[]): boolean => {
      const mineHalf = groupHalf(g);
      // ── A SUMMARY MUST CLEAR OTHER SUMMARIES; IT MAY OVERLAP A BADGE ─────
      // Against BADGES a group is measured at the count's single-badge box,
      // not at the card it draws. That is a deliberate, stated cost, and it
      // grew when the card gained a second row: a 2x2 card occupies four badge
      // boxes and reaches two badge-heights above its anchor, so it can be
      // drawn over a badge that this test called clear.
      //
      // It stays anyway. Gating a card's EXISTENCE on its full box sends
      // groups to their room's chip that a count would have seated, which is
      // the outcome this whole tier exists to avoid — one visible regression
      // traded for a worse one. What makes it survivable is that a covered
      // badge is still REACHABLE: SceneManager's tap and long-press paths both
      // ask the badges before answering for a card cell that is empty.
      //
      // (An earlier version of this comment justified the asymmetry with "the
      // card is half as tall, so most of what it refused was a neighbour above
      // or below it". That was true of a one-row card and is not true of a
      // square one; it is corrected rather than left standing beside the
      // opposite fact.)
      //
      // Two SUMMARIES on top of each other is a different matter and is still
      // refused, at the card's circumscribed radius: that is two controls each
      // claiming to stand for the other's devices, and it is the one thing
      // this test still promises absolutely.
      const vsBadge = squareHalf;
      for (let j = 0; j < shown.length; j++) {
        // Only badges that are actually DRAWN can be in the way, and a drawn
        // badge is always at its own anchor because nothing here moves one —
        // so the anchor is the position to test and there is no seat to look
        // up. A badge already behind this or another summary is not on screen;
        // testing it anyway made one room's chip push another room's group to
        // a chip it never needed, an escalation cascade driven by geometry
        // nobody could see. Safe to read both here: every solver decision is
        // final by the time this runs.
        if (this.entityGrouped.has(shown[j].id)) continue;
        if (this.roomClustered.get(roomKey(this.host.roomOf(shown[j].id)))) continue;
        // A FOCUSED room's badge blocks nobody — the same contract the `others`
        // loop below already honours for focused groups, and the one
        // PlacementItem.exempt states in the solver: "accepted unconditionally,
        // AND never counted as a blocker for anyone else". This loop was the
        // one place it was not honoured, so a focused room could push a
        // NEIGHBOURING room's group to its chip while the focus lasted — the
        // focus renegotiating the rest of the map, which is exactly what the
        // exemption exists to prevent.
        if (focus.has(roomKey(this.host.roomOf(shown[j].id)))) continue;
        // The SAME rule as everywhere else on the glass since 2.406.0: boxes,
        // per axis, not a radius against a scalar distance — `halfOf(j)` is
        // max(halfW, halfH), which judged a wide badge's vertical clearance by
        // its width. Plane metric only; the walk camera keeps the 3-axis
        // distance, as it does in the summary-vs-summary loop below.
        if (planar) {
          const dx = Math.abs(g.sx - shown[j].sx);
          const dy = Math.abs(cardCentreY(g) - shown[j].sy);
          const needX = vsBadge + boxes[j].halfW * allow + gapPx;
          const needY = vsBadge + boxes[j].halfH * allow + gapPx;
          if (dx < needX && dy < needY) {
            why = `badge ${shown[j].id} ${shortfall(dx, needX, dy, needY)}`;
            return false;
          }
          continue;
        }
        const d = this.host.drawnDistance(
          g.sx, cardCentreY(g), g.sz, shown[j].sx, shown[j].sy, shown[j].sz);
        if (d < vsBadge + halfOf(j) * allow + gapPx) return false;
      }
      for (const o of others) {
        if (o === g) continue;
        // A focused pair blocks nobody, exactly as the badges it replaces did
        // not (see PlacementItem.exempt). The focus is a deliberate, temporary
        // state and it does not get to renegotiate the rest of the map.
        if (o.focused) continue;
        // ── BOXES, NOT DISCS — the correction the CHIP tier already made ────
        // `cardHalfOf` is `hypot(width, height) / 2`: the CIRCUMSCRIBED radius
        // of the card. Comparing two of those against a scalar distance is a
        // disc test, and CLAUDE.md already records why that is wrong one tier
        // down — "a chip is a wide short pill, so a circumscribed disc would
        // chip half the villa, and since 2.287.0 the plane's axes ARE the
        // screen's axes so an exact axis-aligned test is finally expressible".
        // Cards are wide short pills too: the field capture that prompted this
        // carried `cards=2x3,4x2`, and a 4x2 card's circumscribed radius is
        // 2.2x its own half-height, so two of them one above the other were
        // refused while their ink cleared easily.
        //
        // The consequence was not one card: a refusal escalates EVERY room the
        // group covered, and dropEscalatedGroups then takes every group
        // touching those rooms to a fixpoint — so a handful of false refusals
        // collapse the whole villa at one zoom step. That is the reported
        // "entities group too soon", recorded in sources/files/group.mov, where
        // a room showing a readable 2x2 card with space around it becomes a
        // "Master Bedroom 6" chip on the next rung.
        //
        // A box test can only refuse LESS than the disc that contains it, so
        // the promise this function makes absolutely — two summaries never
        // overlap — is preserved exactly and merely stops being approximated
        // from the conservative side.
        //
        // Only in the PLANE metric, where projectToView sets `pz = 0` and the
        // two axes ARE the screen's. The walk camera keeps the 3-axis distance
        // for the same reason it keeps its own metric (see VIEW_METRIC).
        if (planar) {
          const mine = groupBox(g), theirs = groupBox(o);
          const dx = Math.abs(g.sx - o.sx);
          const dy = Math.abs(cardCentreY(g) - cardCentreY(o));
          const needX = mine.hw + theirs.hw + gapPx;
          const needY = mine.hh + theirs.hh + gapPx;
          if (dx < needX && dy < needY) {
            why = `card ${o.key}(${o.members.length}) ${shortfall(dx, needX, dy, needY)}`;
            return false;
          }
          continue;
        }
        const d = this.host.drawnDistance(
          g.sx, cardCentreY(g), g.sz, o.sx, cardCentreY(o), o.sz);
        if (d < mineHalf + groupHalf(o) + gapPx) return false;
      }
      return true;
    };

    // ── ONE PASS. THE WIDTH IS NOT A DECISION ANY MORE ────────────────────
    // A group of two is ALWAYS the full-size card, so there is nothing to
    // upgrade and nothing to decline: one situation, one appearance, one
    // behaviour, everywhere on the map.
    //
    // Two earlier shapes of this are worth remembering, because both were
    // attempts to have it both ways. 2.256.0 asked for the wide card and
    // settled for a smaller one per group, in key order — which let an early
    // group's upgrade demote a later one. 2.257.0 fixed the unfairness with a
    // seat-then-upgrade pass, and 2.259.0 made the fallback a half-scale card
    // rather than a digit. What none of them fixed is that the SAME situation
    // then drew as two visibly different objects depending on how crowded its
    // corner of the villa happened to be, which is not a distinction anybody
    // reading a floor plan can act on. Reported exactly that way, with both
    // forms on screen at once.
    //
    // The cost is stated rather than hidden: a pair card may now OVERLAP a
    // badge where the clearance test would have shrunk it. That test is a DISC
    // of the card's half-WIDTH while the card is half as tall, so most of what
    // it refused was a neighbour directly above or below — rejected on a
    // distance the card does not occupy. It has to be a disc: it works in
    // world distance scaled by the quantised zoom, and knowing which way a
    // neighbour lies relative to the card's long axis would need the camera,
    // which is the dependency this whole subsystem exists without.

    // ── ABSORB: NOTHING IS LEFT DRAWN UNDERNEATH A SUMMARY ───────────────
    // The bug this closes, in full, because it is not obvious and it survived
    // a long time: for a pile of CO-LOCATED devices the solver accepts the
    // highest-ranked one — still drawn, at its own anchor — and defers the
    // rest. The card for those losers is drawn at THEIR centroid, which for a
    // co-located pile is the same world point as the badge still drawn there.
    // `fits` then measured `d = 0` against a requirement in fixed pixels, so
    // `0 < requirement` held at EVERY zoom rung and the card was always
    // refused, escalating the room to its chip.
    //
    // That is why zooming right in on such a room never decluttered it. Two
    // points at the same place project to the same place at any zoom; no rung
    // could ever satisfy the test. Every OTHER refusal in `fits` is a real
    // separation that grows as the camera closes in, which is the behaviour
    // people expect and were not getting.
    //
    // So: a summary swallows the drawn badges that lie inside its own ink,
    // and only those (see cardInscribedHalf). It is the same reasoning as the
    // solver's lone-deferral pull-back — a summary standing on top of a device
    // it does not represent is a lie — applied at the one place that knows how
    // big the summary is actually drawn.
    //
    // Batched per round, then the centroid is recomputed, then swept again:
    // absorbing one at a time would move the centroid mid-round and make the
    // result depend on which candidate was visited first. Membership only ever
    // grows, so this cannot oscillate; the round bound is belt and braces.
    let absorbed = 0;
    for (const g of pending) {
      // Focused groups already take whole piles and skip `fits`, so they have
      // no badge of their own left to sit on — and eating a NEIGHBOURING
      // pile's focused badge is the one thing the focus forbids.
      if (g.focused) continue;
      for (let round = 0; round <= shown.length; round++) {
        const reach = cardInscribedHalf(g);
        const inkY = cardCentreY(g);
        const take: number[] = [];
        for (let j = 0; j < shown.length; j++) {
          if (this.entityGrouped.has(shown[j].id)) continue;
          const rk = roomKey(this.host.roomOf(shown[j].id));
          if (this.roomClustered.get(rk)) continue;
          if (focus.has(rk)) continue;
          // ── BOX vs BOX, ON EACH AXIS ─────────────────────────────────
          // Burial is a question about two rectangles of ink, and it has to be
          // tested as one. Two earlier shapes of this were both wrong in the
          // same direction and each left the counter non-zero:
          //
          //   the badge's CENTRE against a disc (pre-2.289.0) — a badge
          //   straddling the ink's edge, centre just outside and half of it
          //   inside, was absorbed by nobody: outside this sweep, and inside
          //   the ring `fits` starts refusing at;
          //
          //   the badge's centre against a disc GROWN by the badge's radius
          //   (2.289.0) — better, but a disc still cannot reach the corners of
          //   a square. `cardInk` in assertPlacementInvariants is the square
          //   INSCRIBED in the card, so its corners stand 41% further out than
          //   any disc of the same half-side, and a badge sitting in one was
          //   still drawn half under the ink. That is the 1–4 the counter kept
          //   reporting on both machines after 2.289.0.
          //
          // So: the same axis-aligned test the assertion uses, against the same
          // square, grown per axis by the badge's own half-extents. Expressible
          // for the same reason the chip test is (see CHIP_COLLISION): since
          // 2.287.0 the plane's axes ARE the screen's axes, so "do these two
          // rectangles overlap" is an exact question here, not one a radius has
          // to stand in for.
          //
          // `sz` is the walk camera's depth residual and is identically 0 under
          // the orbit camera, so keeping it as a third axis leaves first person
          // separating down a corridor exactly as it did.
          //
          // ── THE `+ gapPx` IS WHAT MAKES A BADGE UNABLE TO REFUSE A CARD ──
          // Without it this stops exactly `gapPx` short of the box `fits`
          // starts refusing at (`vsBadge + halfW + gapPx`), and an earlier
          // comment here called that annulus "the right amount of nothing".
          // It is not nothing: a badge landing in that 2 CSS px band is
          // neither absorbed nor clear, so its card is refused and EVERY room
          // that card covered goes to its chip. A phone capture caught it three
          // times in one zoom-in — `seat REFUSED … blocked by badge … dx=59/63`
          // against the card's OWN pile-mate, chipping that room at rung 483
          // when 456 and 542 either side of it drew every device. That is the
          // non-monotone chip → entities → chip the tier may not have.
          //
          // With the gap included, the absorb box strictly CONTAINS the refusal
          // box on every axis (`cardInscribedHalf >= squareHalf` for every
          // arrangement — a card is at least one unit tall — and `allow <= 1`),
          // so the two regions are one region and the outcome is total: a drawn
          // badge is either clear of a summary or a cell inside it. A
          // `seat REFUSED … blocked by badge` line is therefore now an
          // invariant violation, not a measurement.
          const dx = Math.abs(g.sx - shown[j].sx);
          const dy = Math.abs(inkY - shown[j].sy);
          const dz = Math.abs(g.sz - shown[j].sz);
          if (dx < reach + boxes[j].halfW + gapPx
            && dy < reach + boxes[j].halfH + gapPx
            && dz < reach + halfOf(j) + gapPx) take.push(j);
        }
        if (take.length === 0) break;
        for (const j of take) {
          g.members.push(j);
          // Claimed immediately, before any `fits` runs — otherwise the badge
          // blocks its own group, and a second group in key order could claim
          // it as well.
          this.entityGrouped.add(shown[j].id);
          const rk = roomKey(this.host.roomOf(shown[j].id));
          if (!g.roomKeys.includes(rk)) g.roomKeys.push(rk);
        }
        absorbed += take.length;
        // Everything the card reads about itself has to move with its
        // membership. Miss any one of these and the absorbed device is in the
        // group, hidden as a badge, and NOT drawn as a cell — invisible and
        // untappable, which is worse than the overlap this is fixing.
        this.host.sortCardMembers(shown, g.members);
        // The RAW membership — `gridCells` decides what that draws as. This
        // line shipped as the truncating one: absorb is the only producer that
        // can push a group past the card's capacity, and clamping there would
        // have drawn six of seven devices and left the seventh hidden with no
        // cell to tap.
        g.grid = g.members.length;
        g.roomKeys.sort();
        const primary = this.roomDisplay.get(g.roomKeys[0]) ?? g.roomKeys[0];
        g.room = g.roomKeys.length > 1 ? `${primary} +${g.roomKeys.length - 1}` : primary;
        let wx = 0, wy = 0, wz = 0;
        for (const i of g.members) { wx += shown[i].wx; wy += shown[i].wy; wz += shown[i].wz; }
        g.wx = wx / g.members.length;
        g.wy = wy / g.members.length;
        g.wz = wz / g.members.length;
        // Re-derived, in the same statement as the centroid it comes from.
        // Accumulating plane coordinates separately here is the drift bug in
        // embryo, because absorb runs in ROUNDS.
        const q = this.host.planeOf(clearance, g.wx, g.wy, g.wz);
        g.sx = q.sx; g.sy = q.sy; g.sz = q.sz;
      }

      // ── THE TWO COUNT-BADGE TIERS ARE GONE, AND THEY WERE UNREACHABLE ──
      // `strays` (2.294.0 — "a count must stand where its devices are", born of
      // a badge reading "50" in the middle of the villa) and `wholeroom` (a
      // count covering every badge its room shows IS the room, so defer to the
      // chip, which at least says which room) both guarded the same thing: a
      // summary that draws a NUMBER instead of its devices.
      //
      // 2.363.0 deleted that summary. Since then `drawnCells` cannot return
      // less than two for any group that reaches here, so neither branch could
      // fire — found by /dry-audit sweeping "everything that still expects a
      // COUNT", the predicate that also turned up PHONE_MAX_TOTAL_CHIPS.
      //
      // Removed rather than left as dead insurance because each owned a
      // `chipWhy` REASON, and an unreachable reason is worse than no reason: it
      // prints as absent, which reads as "measured, did not happen" instead of
      // "cannot happen". This session already lost four captures to a counter
      // read that way.
      //
      // The proof, so a future member-pruning change knows what it would break:
      // badgePlacement step 7 kills every bucket under two members before the
      // caller sees it (`dead[b] = 1`, compacted at the `live` sweep);
      // pairFocusedRoom skips piles under two; absorb only ever grows; and
      // dropEscalatedGroups either keeps two or splices the group out. Restore
      // BOTH branches if any of those four stops holding.
    }
    this.absorbed = absorbed;

    // ── SEATING ORDER IS A CHOICE, AND IT WAS BEING MADE AT RANDOM ─────────
    // This is a greedy fill: a card seated early occupies space a later card
    // then cannot have, so which cards survive depends on the order they are
    // tried. That order used to be `pending`'s, which is bucket order, which
    // 2.366.0 established is inherited from the caller's item order — i.e. it
    // carried no meaning at all.
    //
    // It is worth getting right because a refusal is not cheap: a card that
    // cannot be seated hands EVERY room it covers to that room's chip, which
    // hides those rooms' badges too, including ones the solver had already
    // accepted and which were nowhere near the crowding. A `?debug` capture at
    // one zoom rung showed 14 cards built, 4 seated, and 7 rooms chipped as a
    // result — 30 badges accepted by the solver, 9 actually drawn.
    //
    // So the cost of refusing a card is measured in DEVICES, and the biggest
    // groups are the ones worth seating first. Focused groups go ahead of
    // everything (they are seated unconditionally anyway, and their space has
    // to be reserved before anyone else claims it), then member count
    // descending, then `key` — which is `grp|<pileKey>`, already unique and
    // stable, so this is a total order and introduces no new order dependence
    // of the kind 2.366.0 removed.
    const seating = pending.slice().sort((a, b) =>
      (a.focused === b.focused ? 0 : a.focused ? -1 : 1)
      || b.members.length - a.members.length
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const g of seating) {
      // A FOCUSED pair is seated unconditionally. It stands in for two badges
      // that the room exemption was already drawing on top of each other, so a
      // refusal would restore the exact overlap it exists to remove — and it
      // can never escalate the focused room to its chip, which would break the
      // one promise tapping a room makes.
      if (g.focused) { placed.push(g); continue; }
      if (!fits(g, placed)) {
        // Nowhere to stand: this is room-level crowding after all. EVERY room
        // the group covered escalates, not just its primary one — a group that
        // straddles a boundary and then fails to place cannot leave half its
        // members behind a chip and half loose.
        //
        // ⚠️ THIS IS THE AMPLIFIER, and the `seat` channel exists to size it.
        // A field capture showed three refusals here turning into seven chipped
        // rooms and thirteen lost cards across ONE 5.9% zoom step, while the
        // solver's own verdict barely moved (25 accepted -> 23). So the number
        // that matters is not whether a refusal is correct but how far it
        // travels: each line names the blocker and the per-axis shortfall, and
        // the CASCADE lines below name every room dragged along after it.
        if (channelEnabled("seat")) {
          // `box` vs `wasSpread` is the question the user actually asked: the
          // MEMBERS were grouped because their badge boxes collided, but what
          // gets seated is a CARD, and a card can be LARGER than the cluster it
          // stands for (a 4-cell card is 2x2 badge boxes; four badges that
          // merely touched occupied far less). If box >> wasSpread, the card
          // manufactured the collision that refused it.
          const bx = groupBox(g);
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const m of g.members) {
            minX = Math.min(minX, shown[m].sx); maxX = Math.max(maxX, shown[m].sx);
            minY = Math.min(minY, shown[m].sy); maxY = Math.max(maxY, shown[m].sy);
          }
          this.seatLog.push(
            `seat REFUSED ${g.key} n=${g.members.length}`
            + ` card=${(bx.hw * 2).toFixed(0)}x${(bx.hh * 2).toFixed(0)}`
            + ` members spanned ${(maxX - minX).toFixed(0)}x${(maxY - minY).toFixed(0)}`
            + ` rooms=[${g.roomKeys.join("|")}] -> chips those rooms; blocked by ${why}`);
        }
        for (const k of g.roomKeys) this.chipRoom(k, "noseat");
        continue;
      }
      placed.push(g);
    }
    this.dropEscalatedGroups(placed, shown);
    pending.length = 0;
    for (const g of placed) pending.push(g);
  }

  /**
   * ── A DROPPED GROUP TAKES EVERY ROOM IT COVERED WITH IT ──────────────
   * A group whose room was escalated by a LATER pile must not also draw: the
   * chip already covers its members, and two renderings of the same content
   * is how a viewer learns to distrust both.
   *
   * But dropping it is only half the move. This used to claim "the chip hides
   * every badge in the room regardless, so nothing ends up hidden with
   * nothing in its place", and that is true only of a SINGLE-ROOM group. A
   * group straddling a boundary has members in a room that did not chip, and
   * they stay marked in `entityGrouped` — hidden, with no summary and no
   * chip. Invisible AND untappable, and the field log said so on nearly every
   * pass: `PLACEMENT: N badge(s) hidden with no summary and no chip`.
   *
   * So it escalates all of its rooms, exactly as the `!fits` branch does for
   * the same reason. That costs chips — the honest price of not losing a
   * device — and it has to run to a FIXPOINT, because escalating a room can
   * drop a group that was already past in the sweep, whose own rooms then have
   * to go too. Bounded: every round drops at least one group.
   *
   * Extracted in 2.290.0 because CHIP_COLLISION escalates rooms from OUTSIDE
   * this method and must settle the groups the same way. Writing a second
   * escalation path is how the orphan bug in the paragraph above got made in
   * the first place; there is one.
   *
   * Prunes `placed` IN PLACE.
   */
  dropEscalatedGroups(placed: PendingEntityGroup[], shown: ShownLabel[]): void {
    for (let round = 0; round <= placed.length; round++) {
      let dropped = false;
      for (let i = placed.length - 1; i >= 0; i--) {
        const g = placed[i];
        // The focused room is never chipped by its own pass, and another
        // room's escalation must not take its card down either.
        if (g.focused) continue;
        if (!g.roomKeys.some((k) => this.roomClustered.get(k))) continue;
        // ── A LOST ROOM RELEASES THE OTHERS; IT NO LONGER CHIPS THEM ────────
        // This used to chip EVERY room the group covered, and that made a
        // cross-room group a BRIDGE a single refusal walks the villa across.
        // Measured, from the field capture that prompted this — ONE refusal in
        // the living room:
        //     drop camera.main_house_door_cam   -> ALSO chips [outdoor]
        //     drop binary_sensor.motion1        -> ALSO chips [staircase]
        //     drop fan.ceiling_fan_patio_terrace-> ALSO chips [patio 1f]
        //     drop binary_sensor.motion0        -> ALSO chips [master bathroom]
        // Five rooms chipped because ONE card in a sixth had nowhere to stand.
        // No device in `outdoor` was crowded; it lost its badges because a
        // group it shared with the living room was tidied away.
        //
        // The reason it chipped them was real and is preserved differently:
        // those members stay marked in `entityGrouped`, so dropping the group
        // without a plan leaves them hidden with no summary and no chip — the
        // orphan bug this method was extracted to prevent. But chipping their
        // room was never the only answer to that, merely the loudest. The
        // members whose OWN room did not chip are RELEASED instead: the
        // partners that crowded them are behind a chip now and off the glass,
        // so the honest thing is to draw them at their own anchors again.
        //
        // Two or more survivors keep their card (pruned, so it SHRINKS — the
        // strictly safer direction for a seating test that already passed);
        // one survivor draws as a badge; none drops silently. Nothing is
        // orphaned in any branch, and no room is chipped here at all, so the
        // bridge is cut rather than narrowed. Termination is now trivial:
        // `roomClustered` gains nothing in this method, so one pass suffices.
        const keep: number[] = [];
        for (const m of g.members) {
          if (!this.roomClustered.get(roomKey(this.host.roomOf(shown[m].id)))) keep.push(m);
        }
        if (channelEnabled("seat") && keep.length) {
          this.seatLog.push(
            `seat RELEASE ${g.key} n=${g.members.length}`
            + ` (room ${g.roomKeys.filter((k) => this.roomClustered.get(k)).join("|")} chipped)`
            + ` -> ${keep.length >= 2 ? `card keeps ${keep.length}` : "1 badge redrawn"}`
            + `, chips nothing`);
        }
        if (keep.length >= 2) {
          // Survives as a smaller card. Its rooms are by construction the
          // un-chipped ones, so it cannot be re-entered on a later round.
          g.members = keep;
          // `grid` moves WITH the membership. It was left stale here, and only
          // two coincidences hid it: every reader takes `min(g.grid, length)`,
          // and `cellMax`'s `g.grid` arm is focused-only while a focused group
          // never reaches this method. Neither is a rule, so neither is a
          // guarantee — absorb already updates the pair together, and so does
          // this. (/dry-audit)
          g.grid = keep.length;
          g.roomKeys = [...new Set(keep.map((m) => roomKey(this.host.roomOf(shown[m].id))))].sort();
          continue;
        }
        for (const m of keep) this.entityGrouped.delete(shown[m].id);
        placed.splice(i, 1);
        dropped = true;
      }
      if (!dropped) break;
    }
  }

  /**
   * Pair up the FOCUSED room's own overlapping badges.
   *
   * ── The gap this closes ───────────────────────────────────────────────────
   * Tapping a room grants it an exemption: its badges are accepted
   * unconditionally and are never counted as blockers, because "tap a room,
   * see its devices" is a promise the layout is not allowed to renegotiate,
   * and two devices at ONE point are separated by no zoom that exists. So the
   * zoom solver frames the room, and anything genuinely co-located inside it —
   * a ceiling fan, its own light, the sensor clipped to the same mount — draws
   * stacked.
   *
   * Stacked is where the promise quietly stops being kept. `badgeContaining`
   * returns the TOPMOST control containing the point, so a badge completely
   * covered by another cannot be tapped at all: the device is on screen and
   * unreachable, which is a worse answer than the chip the exemption exists to
   * avoid.
   *
   * A pair card fixes exactly that and nothing else. It shows both
   * pictograms, in their own colours and their own live states, and gives each
   * a tap target — so the room's devices are MORE visible and MORE reachable
   * than the stack was, which is the promise, kept properly.
   *
   * ── Why it is a second pass rather than a change to the first ────────────
   * The exemption is a property of the MAIN pass and has to stay one: a
   * focused badge must not block anybody, and letting exempt items into that
   * graph would make them blockers. So this runs over the focused room alone,
   * with the exemption dropped so its badges are compared with each other, and
   * with the SAME overlap predicate (`conflicts`) and the SAME canonical order
   * the rest of the subsystem uses. Nothing about the main result changes and
   * badgePlacement is untouched.
   */
  pairFocusedRoom(
    shown: ShownLabel[],
    items: readonly PlacementItem[],
    clearance: { gap: number; minSep: number; pxPerWorld: number; basis: ViewBasis },
    pending: PendingEntityGroup[],
  ): void {
    const focus = this.host.focus().rooms;
    if (focus.size === 0) return;
    // Indices into `shown`, so a strip's members map straight back.
    const idx = this.focusIdx;
    idx.length = 0;
    const sub = this.focusItems;
    for (let i = 0; i < items.length; i++) {
      if (!focus.has(items[i].room)) continue;
      const src = items[i];
      let it = sub[idx.length];
      if (!it) {
        it = { sx: 0, sy: 0, sz: 0, reach: 0, reachY: 0, rank: 0, sortKey: "", category: "", room: "", exempt: false };
        sub[idx.length] = it;
      }
      it.sx = src.sx; it.sy = src.sy; it.sz = src.sz;
      // ⚠️ reachY TOO, AND ITS ABSENCE WAS THE BUG (2.429.0). This copied every
      // field of the item EXCEPT reachY, so the pooled 0 it was constructed
      // with survived into `conflicts` — and reachY is the entire VERTICAL half
      // of the collision rule. needY collapsed from
      // `halfH_a + halfH_b + gap` to `max(gap, minSep)` = the tap pitch alone:
      // 24 render px demanded where 50 is drawn, at icon 1.00x/css 1.00.
      //
      // The axis it broke is the one that matters most here. badgeProjection
      // SUMS world height (at cos tilt) and depth (at sin tilt) onto the
      // screen's VERTICAL, so two devices at one floor spot at different
      // heights — a ceiling fan and the floor lamp under it, a "..._top" light
      // and the "..._bottom" LED on the same fitting — separate almost entirely
      // in Y. Those are exactly the pairs this failed to pair, so they drew
      // stacked while horizontally-offset pairs (whose `reach` was correct)
      // paired fine. Reported from a screenshot as entities overlapping, with
      // the right guess attached: "some assets are on the floor and others
      // higher on the wall, and the collision algorithm is failing".
      //
      // That is also why `PLACEMENT: N overlapping pair(s) inside the FOCUSED
      // room` was never zero — the counter measures with the REAL boxes while
      // the pairing decided with a flat 0, so the two could not agree.
      it.reach = src.reach; it.reachY = src.reachY; it.rank = src.rank;
      it.sortKey = src.sortKey; it.category = src.category; it.room = src.room;
      it.exempt = false;
      idx.push(i);
    }
    sub.length = idx.length;
    if (idx.length < 2) return;

    // ── MUTUAL overlap, not TRANSITIVE reachability ──────────────────────
    // The predicate is the same one every other tier uses. What changed is how
    // a set is built out of it.
    //
    // Union-find answers "is there a CHAIN of overlaps from A to B", and inside
    // one room that is almost always yes: A touches B, B touches C, and eleven
    // badges strung across a living room collapse into a single component
    // whose members mostly do not overlap each other at all. Tapping the room
    // then produced one summary reading `11` — the opposite of the promise the
    // focus makes, and the third time this exact chain has bitten (2.261.0
    // painted the same component as a card the width of the screen; capping
    // the card turned it into this digit instead of fixing it).
    //
    // A group here is therefore a CLIQUE: every member overlaps every other
    // member. That is the honest reading of "these cannot be drawn separately",
    // and it is what makes the card's claim true — the devices it hides really
    // were all on top of one another. A chain breaks into the several small
    // groups it always was, and everything else stays a badge of its own.
    //
    // Greedy, in the canonical (rank, entity_id) order every other decision
    // here uses, so the result depends on nothing but geometry and rank. Capped
    // at what a card can DRAW, so a clique never becomes a count: a group that
    // cannot show its devices is not an answer to "show me this room's
    // devices". ⚠️ That is a property of the CLIQUES only — the card-vs-card
    // merge below can still take a pile past the cap, deliberately; see it for
    // the trade.
    //
    // One room's badges, so the plain O(n^2) sweep is cheaper than any index.
    // `sub` is indexed locally; `sortCardMembers` speaks in `shown` indices.
    // Going through it rather than repeating its comparator is the point — one
    // definition of "the canonical order", shared with the card renderer.
    const local = new Map<number, number>();
    for (let k = 0; k < idx.length; k++) local.set(idx[k], k);
    const order = this.host.sortCardMembers(shown, idx.slice())
      .map((i) => local.get(i) as number);
    // The clique build lives in badgePlacement.buildCliques — pure, and
    // testable for the property that actually broke here: a clique whose
    // members are valid but SPREAD draws its card at a centroid none of them
    // is near. Candidates are offered nearest-first with category as the
    // tiebreak; `order` still seeds and still breaks every remaining tie.
    // ⚠️ cardCellCap(), NOT the raw MAX_TOTAL_CHIPS — the one MEASURED answer
    // to "how many cells fit on this screen", which the solver's own
    // `drawableMax` has always come through. This was a third answer: it built
    // cliques of 6 on a narrow phone while cardCellCap allowed fewer, so a
    // tapped room could produce a card the renderer could not draw in full.
    // Found by /dry-audit against `drawableMax`.
    const piles = buildCliques(
      sub, order, clearance.gap, clearance.minSep, this.host.cardCellCap());

    // ── …and then the CARDS must clear each other ─────────────────────────
    // The cliques above are built from where the BADGES are. What gets drawn
    // is a CARD, and a card is far bigger than the badge it replaces — a 2x2
    // is two badge boxes wide and two tall. So two cliques whose badges never
    // touched can produce two cards that sit right on top of each other, which
    // is what a tapped room actually looked like: a stack of overlapping white
    // boxes where the promise was "your devices, side by side".
    //
    // Nothing here moves; that rule is absolute in this file. Two cards that
    // collide become ONE card, which is the same answer every other tier in
    // this subsystem gives (piles merge, chips merge). Repeated to a fixpoint
    // because merging grows the survivor and can bring it into contact with a
    // third — bounded by the pile count, since every round strictly reduces it.
    //
    // ⚠️ A merged pile CAN now exceed what a card can draw, and then it draws a
    // count. The comment above says a focused room can never show one; that was
    // true while piles were capped, and it is the smaller of the two evils it
    // was weighed against — but overlapping cards is the LARGER one, and a
    // count here is honest in a way the "50" of 2.294.0 was not: these devices
    // are piled by construction, since their own cards could not be told apart.
    if (piles.length > 1) {
      const scale = this.host.effectiveScale();
      const gapPx = this.host.metrics().minGapPx * scale;
      const boxOf = (pile: number[]) => {
        let wx = 0, wy = 0, wz = 0;
        for (const k of pile) { const i = idx[k]; wx += shown[i].wx; wy += shown[i].wy; wz += shown[i].wz; }
        const n = pile.length;
        const q = this.host.planeOf(clearance, wx / n, wy / n, wz / n);
        // The pile's OWN size, not a shared cap: these piles are focused, so
        // the renderer will draw one cell per member (see cellMax), and
        // measuring them against any smaller number sizes a box the card is
        // about to overflow.
        const lay = this.host.cardOf(pile.length, pile.length, this.host.cardBudget());
        const hh = (lay.height / 2) * scale;
        // Anchored bottom-edge-on-anchor exactly as the renderer draws it —
        // this file's oldest rule, and the one 2.288.0 had to restate.
        return { cx: q.sx, cy: q.sy - hh, hw: (lay.width / 2) * scale + gapPx, hh: hh + gapPx };
      };
      // ⚠️ The fixpoint itself lives in badgePlacement.mergeCollidingPiles, and
      // it moved there because the loop bound written here was wrong: it read
      // `round < piles.length`, and `piles.length` shrinks on every merge while
      // `round` grows, so the two met in the middle after about half the merges
      // a full collapse needs. Two and three piles happen to need the same
      // number either way, which is why it survived; from four up it exited
      // early and drew the overlapping cards this was written to prevent.
      // Out there it is a pure function over boxes and has a test.
      mergeCollidingPiles(piles, boxOf);
    }

    for (const pile of piles) {
      // ── ONE PILE, ONE CONTROL. THE SIZE DECIDES WHICH ─────────────────
      // A pile is a set of badges that are on top of each other, so it draws
      // as exactly one thing — its devices side by side (up to a 2x2 card), or
      // a count.
      //
      // That is one control per pile, and NOT the stronger claim an earlier
      // version of this comment made ("nothing inside a focused room can
      // overlap"). Pile separation comes from each badge's half-WIDTH, so two
      // piles can sit about a badge apart while each draws a card two badges
      // across and two tall — and focused cards skip `fits` entirely, by
      // design, because refusing one restores the overlap it exists to remove.
      // One control per pile is a large improvement on a stack of four; it is
      // not a guarantee, and saying so here is cheaper than a screenshot.
      //
      // The bound that matters is the CARD's, and it is on the strip below,
      // not here. Three earlier shapes of this got the bound wrong:
      //
      //   2.260.0  took each pile's LOSERS. A pile of three drew an accepted
      //            badge plus a card of the other two at the same point — the
      //            overlap came back with an extra control in it.
      //   2.261.0  took the whole pile as a card of N chips. A focused room
      //            whose badges transitively touch is ONE pile, so it painted
      //            a single card the full width of the screen.
      //   2.262.0  took only piles of exactly two, which left every pile of
      //            three or more stacked — reported, with three cameras and
      //            two lights drawn on top of each other.
      //   2.267.0  capped the CARD instead of the pile, so the screen-wide card
      //            became a summary reading `11` in a room with visible space
      //            all round it — reported as "I expect to see the entities".
      //
      // The whole clique, and the clique is built no larger than a card can
      // draw (see above), so a focused room cannot produce a count badge at
      // all. Bounded where the set is BUILT rather than where it is drawn:
      // capping the drawing only ever turns "too many to show" into "showing
      // none of them".
      if (pile.length < 2) continue;
      // The same cell order the main solve's cards use — one comparator, so
      // the two producers cannot drift.
      const members = this.host.sortCardMembers(shown, pile.map((k) => idx[k]));
      const pairRooms = [...new Set(members.map((i) => roomKey(this.host.roomOf(shown[i].id))))];
      let wx = 0, wy = 0, wz = 0;
      let pileKey = shown[members[0]].id;
      for (const i of members) {
        wx += shown[i].wx; wy += shown[i].wy; wz += shown[i].wz;
        if (shown[i].id < pileKey) pileKey = shown[i].id;
        this.entityGrouped.add(shown[i].id);
      }
      const n = members.length;
      pending.push({
        // Distinct namespace from the main solve's `grp|`: the same devices
        // can be a focused strip now and an ordinary group after the focus
        // lapses, and giving them one key would reuse a control whose
        // placement rules just changed.
        key: `fgrp|${pileKey}`,
        // Taken from the MEMBERS, not from "the focused room": with several
        // rooms focused at once (a merged chip's short tap) a pair can straddle
        // two of them, and naming it after whichever was focused first would
        // file it under a room half its devices are not in.
        room: this.roomDisplay.get(pairRooms[0]) ?? pairRooms[0],
        roomKeys: pairRooms,
        members,
        wx: wx / n, wy: wy / n, wz: wz / n,
        // Derived from the world centroid, by the one projection — see planeOf.
        ...this.host.planeOf(clearance, wx / n, wy / n, wz / n),
        // Same rule as the main solve, and it is badgeCard's rule, not a copy
        // of it: `gridCells` is where "more than a card can hold" becomes the
        // count badge.
        grid: n,
        focused: true,
      });
      this.focusPairs++;
    }
  }

  /**
   * Collapse the visible badges into one chip per room, anchored at the
   * world-space centroid of that room's badge anchors. Because the anchor is
   * a fixed point in the SCENE rather than a solved screen position, the chip
   * projects to a continuous screen path as the camera moves — it physically
   * cannot exhibit the jitter this whole mechanism exists to remove.
   *
   * Membership comes from resolvedRooms (roomOf), the same live-resolved room
   * SummaryGroupPanel groups by, so tapping a chip can hand its entity list
   * straight to that existing modal instead of inventing a second grouping
   * concept.
   */
  /**
   * Derive the room chips, then let them take part in the collision they were
   * the answer to — see CHIP_COLLISION for why they did not until 2.290.0 and
   * why only ONE direction of escalation is available here.
   *
   * A drawn badge or a placed card overlapping a chip sends its OWN room(s) to
   * their own chip. Never the reverse: a chip is already the last tier, so
   * "yield to the badge" has nothing to yield to. That asymmetry is what makes
   * this terminate — `roomClustered` only ever gains keys, and there are
   * finitely many rooms, which is the same monotonicity the existing chip
   * cascade runs on.
   *
   * Boxes, not discs, and that is now expressible: a chip is a wide, short
   * pill (a room name plus a count), so a circumscribed disc would reserve
   * most of its own width above and below itself and chip half the villa.
   * Since 2.287.0 the plane's axes ARE the screen's axes, so an exact
   * axis-aligned test is available where a radial approximation used to be the
   * only honest option. The chip-vs-chip merge in `deriveChips` has always
   * tested boxes for the same reason.
   *
   * Returns the chips to draw; `pending` is pruned in place to the groups that
   * survived.
   */
  settleChips(
    shown: ShownLabel[],
    boxes: { halfW: number; halfH: number; cy: number }[],
    pending: PendingEntityGroup[],
    clearance: { pxPerWorld: number; basis: ViewBasis } | null,
  ): RoomChip[] {
    // UNMERGED inside the loop — see CHIP_COLLISION. The merge is a function of
    // where the camera stands, so a merged obstacle set would hand the one test
    // that decides what is drawn back to the camera's position, and would let a
    // pill splitting at the next zoom rung drop a brand-new box onto a room
    // that had just expanded. Merging happens once, at the end, to the set that
    // is actually rendered.
    let chips = this.host.deriveChips(shown, false);
    if (!CHIP_COLLISION || !clearance || clearance.pxPerWorld <= 0) {
      return this.host.deriveChips(shown);
    }
    const scale = this.host.effectiveScale();
    const gapPx = this.host.metrics().minGapPx * scale;
    const focus = this.host.focus().rooms;
    const half = (this.host.summaryMetrics().size / 2) * scale;
    // One round per room is the worst case: each has to be able to escalate,
    // and nothing can un-escalate. The `<=` is the belt to that braces.
    for (let round = 0; round <= this.roomDisplay.size; round++) {
      // A chip is drawn ENTIRELY ABOVE its anchor — renderChips sets
      // linkOffsetYInPixels to minus half its height, exactly as a badge and a
      // card do. Measured where it is DRAWN, which is this file's oldest rule
      // and the one 2.288.0 had to restate for badges and cards.
      const chipBoxes = chips.map((c) => {
        const q = this.host.planeOf(clearance, c.centre.x, c.centre.y, c.centre.z);
        return { cx: q.sx, cy: q.sy - half, hw: c.halfW + gapPx, hh: half + gapPx };
      });
      const clears = (cx: number, cy: number, hw: number, hh: number) => {
        for (const b of chipBoxes) {
          if (Math.abs(cx - b.cx) < hw + b.hw && Math.abs(cy - b.cy) < hh + b.hh) return false;
        }
        return true;
      };
      let escalated = false;
      // Drawn badges. The same three exclusions `fits` applies, for the same
      // reasons: a grouped badge is not drawn, a chipped room's badge is not
      // drawn, and a FOCUSED room's badge blocks nobody and is not allowed to
      // spend its own room's chip either — tapping a room must not be able to
      // make that room disappear.
      for (let i = 0; i < shown.length; i++) {
        const s2 = shown[i];
        if (this.entityGrouped.has(s2.id)) continue;
        const rk = roomKey(this.host.roomOf(s2.id));
        if (this.roomClustered.get(rk)) continue;
        if (focus.has(rk)) continue;
        if (clears(s2.sx, s2.sy, boxes[i].halfW, boxes[i].halfH)) continue;
        this.chipRoom(rk, "chip-v-badge");
        escalated = true;
      }
      // Placed summaries, measured at the card they actually draw.
      for (const g of pending) {
        if (g.focused) continue;
        if (g.roomKeys.some((k) => this.roomClustered.get(k))) continue;
        const lay = this.host.layoutOf(g, g.members.length);
        const hh = (lay.height / 2) * scale;
        if (clears(g.sx, g.sy - hh, (lay.width / 2) * scale, hh)) continue;
        for (const k of g.roomKeys) this.chipRoom(k, "chip-v-card");
        escalated = true;
      }
      if (!escalated) break;
      // The EXISTING fixpoint, not a second escalation path — a group whose
      // room just chipped has to take every other room it covered with it or
      // its members are hidden with nothing in their place.
      this.dropEscalatedGroups(pending, shown);
      chips = this.host.deriveChips(shown, false);
    }
    // Only now, and only for the render: the escalation above is settled, so
    // merging can no longer change which badges are drawn — which is the
    // property its own docstring has always claimed.
    const rendered = this.host.deriveChips(shown);
    if (focus.size === 0) return rendered;

    // ── A FOCUSED ROOM'S DEVICES OUTRANK ANOTHER ROOM'S LABEL (2.431.0) ─────
    // Reported three times, last with a screenshot: focus a room and its badges
    // sit on top of other rooms' chips. 2.430.0 fixed WHICH of them paints in
    // front and which answers a tap; it could not remove the overlap, and the
    // owner's rule is that things must not overlap at all.
    //
    // Nothing above can resolve it, and that is structural rather than an
    // oversight:
    //
    //   * the focused room's badges are EXEMPT — they block nobody and may not
    //     spend their own room's chip, because tapping a room must not be able
    //     to make that room vanish. So the escalation loop skips them, by
    //     design, three times over;
    //   * a chip may never be DISPLACED — "a chip must never leave the room it
    //     names" is one of the five forbidden fixes, and relaxBoxes was deleted
    //     in 2.120.0 for flinging one clear off the villa.
    //
    // It is also geometrically unavoidable for the case that prompted it: the
    // focused room was `Outdoor`, which SURROUNDS the others, so its devices
    // land near interior rooms' centroids however the camera is placed. No gap,
    // metric or lattice can separate a point inside a room from that room's own
    // label.
    //
    // So the chip yields. While a focus is active a chip is not the last tier
    // for a crowded room — it is a navigation label for a room the user has
    // just said they are NOT looking at, and every other room's devices are
    // already hidden by the focus itself. Dropping the two or three that
    // actually collide costs one tap of navigation (exit focus, tap the room)
    // and buys the clean view the focus was asked for.
    //
    // ⚠️ This is NOT the orphan bug. That rule guards a room whose devices were
    // hidden BY CROWDING and would then have no representation at all; here the
    // hiding is the focus, it is modal, and leaving it restores everything. And
    // it runs on the RENDER set only, after the escalation fixpoint — exactly
    // where merging runs, and for the same reason: it must not be able to
    // change which badges are drawn. `roomClustered` gains nothing here, so
    // termination is untouched.
    const focusBoxes: { cx: number; cy: number; hw: number; hh: number }[] = [];
    for (let i = 0; i < shown.length; i++) {
      if (this.entityGrouped.has(shown[i].id)) continue;
      if (!focus.has(roomKey(this.host.roomOf(shown[i].id)))) continue;
      // The same box the escalation loop above measures a badge with.
      focusBoxes.push({
        cx: shown[i].sx, cy: shown[i].sy, hw: boxes[i].halfW, hh: boxes[i].halfH,
      });
    }
    for (const g of pending) {
      if (!g.focused) continue;
      const lay = this.host.layoutOf(g, g.members.length);
      const hh = (lay.height / 2) * scale;
      focusBoxes.push({ cx: g.sx, cy: g.sy - hh, hw: (lay.width / 2) * scale, hh });
    }
    if (focusBoxes.length === 0) return rendered;
    return rendered.filter((c) => {
      const q = this.host.planeOf(clearance, c.centre.x, c.centre.y, c.centre.z);
      const cx = q.sx, cy = q.sy - half, hw = c.halfW + gapPx, hh = half + gapPx;
      for (const b of focusBoxes) {
        if (Math.abs(cx - b.cx) < hw + b.hw && Math.abs(cy - b.cy) < hh + b.hh) return false;
      }
      return true;
    });
  }
}
