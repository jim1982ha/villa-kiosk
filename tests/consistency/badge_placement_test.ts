// tests/badge_placement_test.ts
// Run: npm run test:placement   (node strips the types; no runner, no deps)
//
// badgePlacement.ts imports NOTHING — no Babylon, no DOM, no path aliases —
// which is what makes this possible at all, and is a good reason to keep it
// that way. `npm run build` is otherwise the only automated gate in this repo.
//
// The check that matters most is ORDER INDEPENDENCE. Placement must be a pure
// function of world positions, quantised zoom and static rank; the one place
// camera or frame state has historically leaked in is iteration order, and
// six rewrites of this subsystem died of exactly that. Permuting the input and
// demanding an identical accepted set is the cheapest thing that would catch
// it, and it needs no browser — which matters, because this project is
// verified from screenshots by hand.

import {
  solvePlacement, createPlacementScratch, conflicts, mergeCollidingPiles, buildCliques,
  type PlacementItem, type PileBox,
} from "../../src/babylon/badgePlacement.ts";
import {
  arrange, gridCells, MAX_GRID_CHIPS, MAX_TOTAL_CHIPS, PHONE_MAX_GRID_CHIPS,
} from "../../src/babylon/badgeCard.ts";
import {
  ICON_ZOOM_EXPONENT, ICON_ZOOM_MIN_SCALE,
  GROUP_ZOOM_STEPS_PER_DOUBLING, snapToZoomLattice,
} from "../../src/babylon/badgeMetrics.ts";
import {
  viewBasis, projectToView, VIEW_BASIS_STEPS,
} from "../../src/babylon/badgeProjection.ts";
import {
  chipWidthPx, fitChipLabel, type ChipTextMetrics,
} from "../../src/babylon/labelLayout.ts";
import {
  badgeMetricsFor, VALUE_FONT_OF_CHIP, SUMMARY_TEXT_OF_HEIGHT, VALUE_CHAR_ADVANCE,
  CARD_VALUE_MARGIN_OF_ICON_PAD,
} from "../../src/babylon/badgeMetrics.ts";
import {
  cssToGui, effectiveScale, cssWidthPx, isPhoneWidth, cardBudget, cellCapFor,
  badgeBox, type BadgeViewport,
} from "../../src/babylon/badgeViewport.ts";
import {
  checkPlacement, hits, onScreen, type ScreenBox,
} from "../../src/babylon/placementCheck.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
}

// ⚠️ The arity here is load-bearing and Node does NOT check it. It strips the
// types and runs; a `mk` left one argument out of step with PlacementItem
// binds `reach` to `rank` and the whole suite "passes" on garbage. Change the
// argument list and the field list together, and READ the output afterwards —
// an exit code of 0 from this file means less than it looks like.
//
// The three coordinates became `sx/sy/sz` in 2.287.0 — GUI pixels on the view
// plane rather than world metres (see badgeProjection). Same arity, same
// metric-space semantics, so every case below reads identically; only the
// units the numbers stand for changed.
const mk = (
  id: string, x: number, y: number, z: number, reach: number,
  rank: number, room: string, exempt = false, category = "", reachY = reach,
): PlacementItem => ({ sx: x, sy: y, sz: z, reach, reachY, rank, sortKey: id, category, room, exempt });

const scratch = createPlacementScratch();
const GAP = 0.1;
const SEP = 0;

// The renderer's own cap on how many devices one summary can show — the value
// EntityVisuals actually passes (badgeCard.MAX_TOTAL_CHIPS). The solver takes
// it as `drawableMax`: a bucket at or under it is drawable, so it stands for
// its room instead of escalating to that room's chip. Kept equal to the
// shipped constant deliberately; a suite pinned to some other number would be
// testing a configuration nothing runs.
const DRAWABLE = MAX_TOTAL_CHIPS;

function solve(
  items: PlacementItem[],
  mode: "priority" | "legacy" = "priority",
  // Defaults to what SHIPS, not to 0. It used to default to 0 — the "nothing
  // is drawable" setting — directly under a comment claiming the value was
  // explicit at every call. Nine cases took that default, so the suite's
  // headline invariants were all being verified against a configuration the
  // app never runs. Cases that mean to test 0 still pass it by hand.
  drawableMax = DRAWABLE,
) {
  const r = solvePlacement(items, GAP, SEP, mode, scratch, drawableMax);
  return {
    accepted: items.map((_, i) => !!r.accepted[i]),
    buckets: r.buckets.slice(0, r.bucketCount).map((b) => ({
      room: b.room, rooms: [...b.rooms], pileKey: b.pileKey, members: [...b.members].sort(),
    })),
    stats: { ...r.stats },
    chipRooms: [...r.chipRooms].sort(),
  };
}

// ── 1. Nothing collides → everything drawn ────────────────────────────────
{
  const items = [mk("a", 0, 0, 0, 0.4, 0, "r1"), mk("b", 10, 0, 0, 0.4, 0, "r1")];
  const r = solve(items);
  check("isolated badges all accepted", r.accepted.every(Boolean));
  check("isolated badges make no buckets", r.buckets.length === 0);
}

// ── 2. Co-located pair in one room → group of 2 (must match 2.231.0) ──────
{
  const items = [
    mk("fan", 0, 0, 0, 0.5, 0, "kitchen"),
    mk("light", 0.01, 0, 0, 0.5, 1, "kitchen"),
    mk("far", 20, 0, 0, 0.5, 0, "kitchen"),
  ];
  const r = solve(items);
  check("co-located pair: neither drawn", !r.accepted[0] && !r.accepted[1]);
  check("co-located pair: third badge survives", r.accepted[2]);
  check("co-located pair: one bucket of 2", r.buckets.length === 1 && r.buckets[0].members.length === 2,
    JSON.stringify(r.buckets));
  check("co-located pair: no chip", r.chipRooms.length === 0, JSON.stringify(r.chipRooms));
}

// ── 3. Pile of 3: the controllable one keeps its badge ────────────────────
{
  const items = [
    mk("sensor.a", 0, 0, 0, 0.5, 7, "lounge"),
    mk("light.x", 0.3, 0, 0, 0.5, 1, "lounge"),
    mk("sensor.b", 0.6, 0, 0, 0.5, 7, "lounge"),
    mk("spare", 30, 0, 0, 0.5, 1, "lounge"),
  ];
  const r = solve(items);
  check("priority: the light is drawn", r.accepted[1], JSON.stringify(r.accepted));
  check("priority: both sensors deferred", !r.accepted[0] && !r.accepted[2]);
  check("priority: one bucket of 2 sensors", r.buckets.length === 1 && r.buckets[0].members.length === 2,
    JSON.stringify(r.buckets));
}

// ── 4. Legacy mode reproduces whole-pile merging ──────────────────────────
{
  const items = [
    mk("sensor.a", 0, 0, 0, 0.5, 7, "lounge"),
    mk("light.x", 0.3, 0, 0, 0.5, 1, "lounge"),
    mk("sensor.b", 0.6, 0, 0, 0.5, 7, "lounge"),
    mk("spare", 30, 0, 0, 0.5, 1, "lounge"),
  ];
  const r = solve(items, "legacy");
  check("legacy: nothing from the pile is drawn",
    !r.accepted[0] && !r.accepted[1] && !r.accepted[2]);
  check("legacy: one bucket of 3", r.buckets.length === 1 && r.buckets[0].members.length === 3,
    JSON.stringify(r.buckets));
}

// ── 5. Cross-room collision costs TWO badges, not a room ─────────────────
// The regression this whole change exists for. Two badges either side of a
// boundary conflict; nothing else in either room is near anything.
//
// Before 2.250.0: the loser had no room-mate within the pull-back bound (its
// nearest is 10m away), so it fell to "a bucket of one has nothing to
// summarise with" and chipped its ENTIRE room — three untouched badges lost to
// a collision neither of them was in. Now the loser summarises with the badge
// it actually lost to, and the six bystanders are all still drawn.
{
  const items = [
    mk("light.living", 0, 0, 0, 0.5, 1, "living"),
    mk("sensor.kitchen", 0.3, 0, 0, 0.5, 7, "kitchen"),
    // each room has plenty of other, well-separated badges
    ...[1, 2, 3].map((k) => mk(`living.${k}`, 10 * k, 0, 0, 0.5, 1, "living")),
    ...[1, 2, 3].map((k) => mk(`kitchen.${k}`, 0, 0, 10 * k, 0.5, 1, "kitchen")),
  ];
  const r = solve(items);
  check("cross-room: NO room chips", r.chipRooms.length === 0, JSON.stringify(r.chipRooms));
  check("cross-room: every bystander still drawn",
    [2, 3, 4, 5, 6, 7].every((i) => r.accepted[i]), JSON.stringify(r.accepted));
  check("cross-room: the colliding pair is one group of 2",
    r.buckets.length === 1 && r.buckets[0].members.join() === "0,1",
    JSON.stringify(r.buckets));
  check("cross-room: stats report the cross-room bucket",
    r.stats.crossRoom === 1 && r.stats.pulledBack === 1, JSON.stringify(r.stats));
  check("cross-room: the group names both rooms",
    r.buckets[0].rooms.join() === "kitchen,living", JSON.stringify(r.buckets[0].rooms));
  check("cross-room: primary room is rooms[0]", r.buckets[0].room === r.buckets[0].rooms[0]);
}

// ── 5b. An undrawable pile chips, and only its own rooms ──────────────────
// Run at drawableMax=0 — "the caller can draw nothing" — because that is the
// only setting at which a bucket of two is undrawable at all. The point being
// pinned is the BLAST RADIUS: a bystander in a THIRD room must not be touched
// by another room's escalation.
{
  const items = [
    mk("a", 0, 0, 0, 0.5, 1, "wc"),
    mk("b", 0.2, 0, 0, 0.5, 1, "wc"),
    mk("far", 40, 0, 0, 0.5, 1, "hall"),
  ];
  const r = solve(items, "priority", 0);
  check("5b: the two-badge room still chips",
    r.chipRooms.length === 1 && r.chipRooms[0] === "wc", JSON.stringify(r.chipRooms));
  check("5b: the third room is untouched", r.accepted[2]);
}

// ── 6. A bucket the caller cannot draw becomes the chip ───────────────────
{
  const items = [
    mk("a", 0, 0, 0, 0.5, 1, "wc"),
    mk("b", 0.2, 0, 0, 0.5, 1, "wc"),
  ];
  const r = solve(items, "priority", 0);
  check("whole-room bucket chips", r.chipRooms.length === 1 && r.chipRooms[0] === "wc",
    JSON.stringify(r));
  check("chipped room draws nothing", !r.accepted[0] && !r.accepted[1]);
  check("chipped room emits no group", r.buckets.length === 0);
}

// ── 6b. …UNLESS the caller can draw it ────────────────────────────────────
// The exact inverse of case 6 at the value that actually ships. A summary
// showing every one of a room's devices IS more than the chip, not a duplicate
// of it, so the room does not collapse.
{
  const items = [
    mk("a", 0, 0, 0, 0.5, 1, "wc"),
    mk("b", 0.2, 0, 0, 0.5, 1, "wc"),
  ];
  const r = solve(items, "priority", DRAWABLE);
  check("6b: drawable whole-room bucket does NOT chip", r.chipRooms.length === 0,
    JSON.stringify(r.chipRooms));
  check("6b: it survives as one bucket of 2",
    r.buckets.length === 1 && r.buckets[0].members.join() === "0,1", JSON.stringify(r.buckets));
}

// ── 6c. The boundary, from both sides ─────────────────────────────────────
// `>` against `>=` in the new clause is the likeliest typo in the whole change,
// and nothing else in this file would catch it.
//
// Built in LEGACY mode on purpose. `whole` needs a bucket that covers EVERY one
// of a room's badges, and in priority mode that is only reachable at size two:
// the first member of every pile is accepted, so a pile of n leaves a bucket of
// n-1, and only the lone-deferral pull-back (which fires at exactly one) can
// bring the winner back in. Legacy defers a whole pile at once, which is the
// shortest way to hand the clause the input it guards at an arbitrary size —
// and the clause itself does not look at the mode.
for (const size of [DRAWABLE, DRAWABLE + 1]) {
  const items = Array.from({ length: size }, (_, i) =>
    mk(`d.${i}`, i * 0.05, 0, 0, 0.5, 1, "wc"));
  const r = solve(items, "legacy", DRAWABLE);
  const chipped = r.chipRooms.length === 1;
  check(`6c: a whole-room bucket of ${size} ${size <= DRAWABLE ? "draws" : "chips"}`,
    chipped === (size > DRAWABLE), `chipRooms=${JSON.stringify(r.chipRooms)}`);
  if (size <= DRAWABLE) {
    check(`6c: …as one bucket of ${size}`,
      r.buckets.length === 1 && r.buckets[0].members.length === size,
      JSON.stringify(r.buckets));
  }
}

// ── 6c(ii). What priority mode actually does with a co-located room ───────
// Recorded because it is easy to assume otherwise, and the assumption changes
// what the renderer has to handle: a room of four co-located devices does NOT
// produce a whole-room bucket. One badge wins and stays at its anchor; the
// other three become the bucket. So at the shipped value the room draws a
// badge AND a card, and escalation is not what saves it.
{
  const items = Array.from({ length: 4 }, (_, i) =>
    mk(`d.${i}`, i * 0.05, 0, 0, 0.5, 1, "wc"));
  const r = solve(items, "priority", DRAWABLE);
  check("6c(ii): co-located room of 4 does not chip",
    r.chipRooms.length === 0, JSON.stringify(r.chipRooms));
  check("6c(ii): …one winner drawn, three bucketed",
    r.accepted.filter(Boolean).length === 1
    && r.buckets.length === 1 && r.buckets[0].members.length === 3,
    JSON.stringify(r.buckets));
  // …and the same room DOES chip once the caller can draw nothing, which is
  // the only thing separating the two outcomes.
  const none = solve(items, "priority", 0);
  check("6c(ii): …and chips at drawableMax=0", none.chipRooms.join() === "wc",
    JSON.stringify(none.chipRooms));
}

// ── 6d. drawableMax governs a CROSS-ROOM bucket too ───────────────────────
// It did not, until 2.308.0: escalation demanded a single room before it
// looked at the size at all, so a pile spanning two rooms could never escalate
// however big it grew. The renderer's only remaining move was a bare count,
// and a cross-room pile of 18 duly drew an "18" among named chips on a phone.
// Size is now the whole test, and a cross-room pile escalates BOTH its rooms —
// which the chip merge downstream renders as one "+1" pill.
{
  const items = [
    mk("a.1", 0, 0, 0, 0.5, 1, "wc"),
    mk("b.1", 0.2, 0, 0, 0.5, 1, "hall"),
  ];
  const drawable = solve(items, "priority", DRAWABLE);
  check("6d: a DRAWABLE cross-room bucket survives as a group",
    drawable.chipRooms.length === 0 && drawable.buckets.length === 1,
    JSON.stringify(drawable.chipRooms));

  const undrawable = solve(items, "priority", 0);
  check("6d: an UNDRAWABLE cross-room bucket chips every room it spans",
    undrawable.chipRooms.join() === "hall,wc", JSON.stringify(undrawable.chipRooms));
  check("6d: …and leaves no group behind to draw a number",
    undrawable.buckets.length === 0, JSON.stringify(undrawable.buckets));
}

// ── 6f. THE INVARIANT: no surviving bucket exceeds drawableMax ────────────
// This is the whole user-visible promise — "I don't want to see ANY count
// badge" — expressed as the one property that makes a count unreachable. The
// renderer draws a card for a bucket it can fit and a number for one it
// cannot; if no bucket ever exceeds what the caller said it can draw, the
// number has no input. Checked over the random villa, at several caps, in both
// modes, because escalation runs inside a fixed point and a leak would be a
// single bucket in a hundred rather than an obvious failure.
{
  const items: PlacementItem[] = [];
  let seed = 90210;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 200; i++) {
    items.push(mk(`n.${String(i).padStart(3, "0")}`,
      rnd() * 5, rnd() * 2, rnd() * 5, 0.45, Math.floor(rnd() * 12), `r${Math.floor(rnd() * 6)}`));
  }
  let worst = 0, worstAt = -1;
  for (const mode of ["priority", "legacy"] as const) {
    for (const dm of [0, 2, 3, 4, DRAWABLE]) {
      for (const b of solve(items, mode, dm).buckets) {
        if (b.members.length > dm && b.members.length > worst) {
          worst = b.members.length; worstAt = dm;
        }
      }
    }
  }
  check("6f: no bucket survives above the caller's drawableMax",
    worst === 0, `bucket of ${worst} survived at drawableMax=${worstAt}`);
}

// ── 6e. Chipping is still monotone in drawableMax ─────────────────────────
// Raising it can only ever REMOVE chips, never add one — the clause is an
// extra conjunct on a condition that was already necessary. Checked over the
// random set, because that is where an unexpected interaction with the
// contagion loop would show up.
{
  const items: PlacementItem[] = [];
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 120; i++) {
    items.push(mk(`m.${String(i).padStart(3, "0")}`,
      rnd() * 6, rnd() * 2, rnd() * 6, 0.4, Math.floor(rnd() * 12), `r${Math.floor(rnd() * 5)}`));
  }
  const wide = new Set(solve(items, "priority", DRAWABLE).chipRooms);
  const strict = new Set(solve(items, "priority", 0).chipRooms);
  let escaped = 0;
  for (const room of wide) if (!strict.has(room)) escaped++;
  check("6e: chipRooms(drawable) is a subset of chipRooms(0)", escaped === 0, `${escaped}`);

  // The clause lives INSIDE the fixed-point loop, which is exactly where an
  // order dependence would hide — so the two purity guards are re-run at the
  // shipped value rather than only at the default.
  const base = solve(items, "priority", DRAWABLE);
  const again = solve(items, "priority", DRAWABLE);
  check("6e: determinism at drawableMax", JSON.stringify(base) === JSON.stringify(again));
  const reversed = [...items].reverse();
  const rev = solve(reversed, "priority", DRAWABLE);
  const idOf = (list: PlacementItem[], acc: boolean[]) =>
    list.filter((_, i) => acc[i]).map((it) => it.sortKey).sort().join(",");
  check("6e: order independence at drawableMax",
    idOf(items, base.accepted) === idOf(reversed, rev.accepted));
}

// ── 7. Exempt (focused room) badges always draw and block nobody ──────────
{
  const items = [
    mk("f1", 0, 0, 0, 5, 1, "focus", true),
    mk("f2", 0.1, 0, 0, 5, 1, "focus", true),
    mk("other", 0.2, 0, 0, 0.5, 1, "other"),
  ];
  const r = solve(items);
  check("exempt: both focused badges drawn", r.accepted[0] && r.accepted[1]);
  check("exempt: bystander unaffected", r.accepted[2], JSON.stringify(r));
}

// ── 8. ORDER INDEPENDENCE — the purity guard ─────────────────────────────
{
  const base: PlacementItem[] = [];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 120; i++) {
    base.push(mk(
      `e.${String(i).padStart(3, "0")}`,
      rnd() * 12, rnd() * 3, rnd() * 12,
      0.35 + rnd() * 0.3,
      Math.floor(rnd() * 12),
      `room${Math.floor(rnd() * 5)}`,
    ));
  }
  const canonical = solve(base);
  let allSame = true;
  for (let trial = 0; trial < 40; trial++) {
    const perm = base.map((it, i) => ({ it, i }));
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const shuffled = perm.map((p) => p.it);
    // ⚠️ DRAWABLE explicitly — the arity warning at the top of this file is
    // not theoretical. Omitting it made the shuffled solve run with
    // drawableMax=undefined while `canonical` ran with 6, so the guard was
    // comparing two different configurations and blamed the difference on
    // ORDER. Caught 2026-08-17 when a solver change made the two diverge.
    const r = solvePlacement(shuffled, GAP, SEP, "priority", scratch, DRAWABLE);
    // Map back to original indices before comparing.
    const acceptedIds = new Set<string>();
    for (let i = 0; i < shuffled.length; i++) if (r.accepted[i]) acceptedIds.add(shuffled[i].sortKey);
    const canonicalIds = new Set<string>();
    base.forEach((it, i) => { if (canonical.accepted[i]) canonicalIds.add(it.sortKey); });
    if (acceptedIds.size !== canonicalIds.size
        || [...acceptedIds].some((id) => !canonicalIds.has(id))) {
      allSame = false;
      console.log(`   trial ${trial}: ${acceptedIds.size} vs ${canonicalIds.size} accepted`);
      break;
    }
  }
  check("ORDER INDEPENDENCE over 40 permutations of 120 badges", allSame);
  check("random set produced some accepted", canonical.accepted.some(Boolean));
  check("random set produced some grouping",
    canonical.buckets.length + canonical.chipRooms.length > 0);
}

// ── 9. No two accepted badges conflict ───────────────────────────────────
{
  const items: PlacementItem[] = [];
  let seed = 777;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 200; i++) {
    items.push(mk(`x.${String(i).padStart(3, "0")}`,
      rnd() * 8, rnd() * 2, rnd() * 8, 0.4, Math.floor(rnd() * 12), `r${Math.floor(rnd() * 4)}`));
  }
  const r = solvePlacement(items, GAP, SEP, "priority", scratch);
  let bad = 0;
  for (let i = 0; i < items.length; i++) {
    if (!r.accepted[i] || items[i].exempt) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (!r.accepted[j] || items[j].exempt) continue;
      if (conflicts(items[i], items[j], GAP, SEP)) bad++;
    }
  }
  check("no two accepted badges overlap", bad === 0, `${bad} overlapping pairs`);

  // disjointness
  const inBucket = new Set<number>();
  for (let b = 0; b < r.bucketCount; b++) for (const i of r.buckets[b].members) inBucket.add(i);
  const chipped = new Set(r.chipRooms);
  let overlapAB = 0, uncovered = 0;
  for (let i = 0; i < items.length; i++) {
    const a = !!r.accepted[i], g = inBucket.has(i), c = chipped.has(items[i].room);
    if (a && (g || c)) overlapAB++;
    if (!a && !g && !c) uncovered++;
  }
  check("accepted and grouped are disjoint", overlapAB === 0, `${overlapAB}`);
  check("every badge is accepted, grouped or chipped", uncovered === 0, `${uncovered} uncovered`);

  // A bucket may now SPAN rooms (see DeferralBucket.rooms), so "one room per
  // bucket" is no longer the invariant. What must still hold is that `rooms`
  // honestly describes the members — sorted, unique, complete — because it is
  // what the chip cascade and the group's label both read.
  let smallBucket = 0, badRooms = 0, wholeRoomLeaked = 0;
  for (let b = 0; b < r.bucketCount; b++) {
    const bk = r.buckets[b];
    if (bk.members.length < 2) smallBucket++;
    const want = [...new Set(bk.members.map((i) => items[i].room))].sort();
    if (bk.rooms.join("\u0000") !== want.join("\u0000") || bk.room !== want[0]) badRooms++;
    // A single-room bucket covering every badge its room shows should have
    // become that room's chip instead of surviving as a group.
    if (want.length === 1) {
      const inRoom = items.filter((it) => it.room === want[0]).length;
      if (bk.members.length >= inRoom) wholeRoomLeaked++;
    }
  }
  check("no bucket has fewer than 2 members", smallBucket === 0, `${smallBucket}`);
  check("every bucket's rooms are sorted, unique and complete", badRooms === 0, `${badRooms}`);
  check("no single-room bucket covers its whole room", wholeRoomLeaked === 0, `${wholeRoomLeaked}`);
}

// ── 10. Determinism: same input twice ────────────────────────────────────
{
  const items = Array.from({ length: 60 }, (_, i) =>
    mk(`d.${i}`, (i % 8) * 0.6, 0, Math.floor(i / 8) * 0.6, 0.4, i % 12, `r${i % 3}`));
  const a = solve(items);
  const b = solve(items);
  check("same input → same output", JSON.stringify(a) === JSON.stringify(b));
}

// ── 11. minSeparation floor actually binds ───────────────────────────────
{
  const items = [mk("a", 0, 0, 0, 0.01, 0, "r"), mk("b", 0.5, 0, 0, 0.01, 1, "r"),
    mk("c", 40, 0, 0, 0.01, 0, "r")];
  // Separate scratches: PlacementResult's arrays are POOLED, so a second solve
  // on the same scratch rewrites the first result in place.
  const loose = solvePlacement(items, 0, 0, "priority", createPlacementScratch());
  const tight = solvePlacement(items, 0, 2.0, "priority", createPlacementScratch());
  check("tiny badges do not conflict without the floor", !!loose.accepted[0] && !!loose.accepted[1]);
  check("minSeparation floor forces a group", !tight.accepted[0] || !tight.accepted[1]);
}

// ── 11. Card arrangement (badgeCard.ts) ───────────────────────────────────
// The only part of the drawing this suite can reach, and the part most likely
// to be got wrong: how many cards, how wide the whole thing is, and where each
// cell lands relative to the arrangement's centre.
{
  const U = 28, F = 22 / 28, G = 6;
  const A = (n: number) => arrange(n, U, F, G);

  // ── The FOCUSED ceiling (2.306.0) ─────────────────────────────────────────
  // A room chip's tap must show that room's DEVICES. 2.304.0 let a focused pile
  // exceed MAX_TOTAL_CHIPS and fall through to a count badge — an "8" in the
  // middle of the pool, which is the same answer the chip already gave. The
  // ceiling is a parameter now, and the two properties that must hold are:
  // nothing at or below the ordinary cap changes, and above it every cell is
  // still drawn.
  // ⚠️ TAUTOLOGICAL SINCE 2.363.0, kept only for the SECOND assertion on each
  // pass. `gridCells` does `void max`, so "unchanged by a raised ceiling" is
  // now true of every input by construction and can never catch a regression —
  // it reads like coverage and is not. Left in place because the ceiling is
  // still threaded through four functions and a future change may make it live
  // again; if `max` is ever deleted outright, delete this line with it.
  // (/dry-audit, 2.416.0)
  const AF = (n: number, max: number) => arrange(n, U, F, G, max);
  for (let n = 1; n <= MAX_TOTAL_CHIPS; n++) {
    const base = A(n), raised = AF(n, 12);
    check(`arrange(${n}) is unchanged by a raised ceiling (tautological)`,
      base.cells === raised.cells && base.width === raised.width
      && base.height === raised.height && base.cards.length === raised.cards.length);
    check(`arrange(${n}) is a single row (top 0)`,
      base.cards.every((c) => c.top === 0));
  }
  // 2.363.0: the count badge is gone. Over the ordinary cap an arrangement
  // draws every member and wraps; refusing into a digit is what was removed.
  check("over the ordinary cap draws every cell, never a count", A(8).cells === 8);
  {
    // ── The budget makes it WRAP, never refuse (2.307.0) ────────────────────
    // The cap that produced the reported "8" was never MAX_TOTAL_CHIPS — it was
    // the VIEWPORT one, which at a large icon size leaves room for two cells.
    // A focused arrangement is handed the budget instead and folds into it.
    const narrow = 2.2 * U;                       // barely one 2x2 card wide
    const a = arrange(8, U, F, G, 12, narrow);
    check("a budgeted arrangement still draws every cell", a.cells === 8);
    check("a budgeted arrangement obeys its budget", a.width <= narrow + 1e-9);
    check("a budgeted arrangement grows DOWNWARD instead", a.height > a.width);
    let inside = true;
    for (let k = 0; k < a.cells; k++) {
      if (Math.abs(a.cellLeft(k)) > a.width / 2 || Math.abs(a.cellTop(k)) > a.height / 2) inside = false;
    }
    check("every cell of a budgeted arrangement is inside its box", inside);
    const seen = new Set<string>();
    for (let k = 0; k < a.cells; k++) seen.add(`${a.cellLeft(k)},${a.cellTop(k)}`);
    check("every cell of a budgeted arrangement has its own position", seen.size === a.cells);
    // Even a budget narrower than ONE card still draws it: a device the user
    // asked to see must be on screen, tight beats absent.
    const tiny = arrange(4, U, F, G, 12, U / 4);
    check("a budget narrower than one card still draws the card", tiny.cells === 4);
  }
  check("a raised ceiling draws every cell", AF(8, 12).cells === 8 && AF(12, 12).cells === 12);
  check("past ITS ceiling it still draws every cell", AF(13, 12).cells === 13);
  // ── …WHICH IS WHY A FOCUSED CALLER PASSES THE PILE'S OWN SIZE ─────────────
  // The line above is `arrange`'s contract and is correct: over its max it
  // returns zero cells, and zero cells is a COUNT. The bug that shipped was in
  // the CALLER — EntityVisuals passed a fixed ceiling of 12 for focused piles,
  // so tapping a room whose pile held 19 devices hit it, got zero, and drew a
  // "19" on the exact path that must never produce a number. cellMax() now
  // returns the group's own membership when it is focused, and this pins what
  // that guarantees: at max = n there is no size, at any budget, that refuses.
  {
    let refused = -1, escaped = -1;
    const budget = 5.2 * U;                     // ~a phone's 45% at this unit
    for (const n of [7, 12, 13, 19, 21, 34, 60]) {
      const a = arrange(n, U, F, G, n, budget);
      if (a.cells !== n && refused < 0) refused = n;
      if (a.width > budget + 1e-9 && escaped < 0) escaped = n;
    }
    check("focused: max = n never refuses, at any pile size", refused < 0,
      `refused at ${refused}`);
    check("focused: …and every one of them still obeys the budget", escaped < 0,
      `overflowed at ${escaped}`);
    // The reported case, spelled out: 19 devices, every one with its own cell,
    // folded into rows rather than a strip.
    const big = arrange(19, U, F, G, 19, budget);
    check("focused: a pile of 19 draws 19 cells", big.cells === 19, `${big.cells}`);
    check("focused: a pile of 19 wraps into rows", big.cards.some((c) => c.top !== 0));
    const seen = new Set<string>();
    for (let k = 0; k < big.cells; k++) seen.add(`${big.cellLeft(k)},${big.cellTop(k)}`);
    check("focused: all 19 cells have distinct positions", seen.size === 19, `${seen.size}`);
    let inside = true;
    for (let k = 0; k < big.cells; k++) {
      if (Math.abs(big.cellLeft(k)) > big.width / 2
        || Math.abs(big.cellTop(k)) > big.height / 2) inside = false;
    }
    check("focused: all 19 cells sit inside the card box", inside);
  }
  {
    // Wrapping: 12 cells is three 2x2 cards, which must become a block rather
    // than a strip — a strip would be refused by the viewport cap and fall
    // straight back to the count this exists to remove.
    const a = AF(12, 12);
    check("a large arrangement wraps into rows", a.cards.some((c) => c.top !== 0));
    check("a wrapped arrangement is not a strip", a.width < 12 * U);
    const tops = new Set(a.cards.map((c) => c.top));
    check("wrapped rows are inside the arrangement's own height",
      [...tops].every((t) => Math.abs(t) <= a.height / 2));
    // Every cell distinct and inside the box — the promise a card makes.
    const seen = new Set<string>();
    for (let k = 0; k < a.cells; k++) seen.add(`${a.cellLeft(k)},${a.cellTop(k)}`);
    check("every cell of a wrapped arrangement has its own position", seen.size === a.cells);
    let inside = true;
    for (let k = 0; k < a.cells; k++) {
      if (Math.abs(a.cellLeft(k)) > a.width / 2 || Math.abs(a.cellTop(k)) > a.height / 2) inside = false;
    }
    check("every cell of a wrapped arrangement is inside the card box", inside);
  }
  const shape = (n: number) => A(n).cards.map((c) => `${c.cols}x${c.rows}`).join("+");

  check("card: 1 -> 1x1", shape(1) === "1x1", shape(1));
  check("card: 2 -> 2x1", shape(2) === "2x1", shape(2));
  check("card: 3 -> 2x2", shape(3) === "2x2", shape(3));
  check("card: 4 -> 2x2", shape(4) === "2x2", shape(4));
  // The whole point of the change: five and six SPLIT rather than growing.
  check("card: 5 -> 2x2 + 1x1", shape(5) === "2x2+1x1", shape(5));
  check("card: 6 -> 2x2 + 2x1", shape(6) === "2x2+2x1", shape(6));
  // Over the cap is NOT a count and NOT a truncated card. A truncated card
  // would hide a device with no cell to tap — still forbidden — and the digit
  // that used to stand in its place is gone by request (2.363.0). Every member
  // gets a cell; a pile too big to draw escalates to its ROOM CHIP before it
  // reaches here, which is the solver's job via drawableMax.
  check("card: 9 draws nine cells, never a count", A(9).cells === 9, `${A(9).cells}`);
  check("card: 9 is cards of chips, not a 1x1 digit", shape(9) !== "1x1", shape(9));
  check("card: gridCells never refuses",
    gridCells(MAX_TOTAL_CHIPS) === MAX_TOTAL_CHIPS
    && gridCells(MAX_TOTAL_CHIPS + 1) === MAX_TOTAL_CHIPS + 1 && gridCells(-3) === 0);
  check("card: one card never exceeds MAX_GRID_CHIPS",
    A(6).cards.every((c) => c.cells <= MAX_GRID_CHIPS), JSON.stringify(A(6).cards));

  // Arrangement width is the cards plus the gaps between them, exactly.
  for (const n of [2, 3, 4, 5, 6]) {
    const a = A(n);
    const want = a.cards.reduce((acc, c) => acc + c.width, 0) + G * (a.cards.length - 1);
    check(`card: ${n} — width is the cards plus the gaps`,
      Math.abs(a.width - want) < 1e-9, `${a.width} vs ${want}`);
  }
  check("card: a pair is two units wide, one tall",
    A(2).width === 2 * U && A(2).height === U, `${A(2).width}x${A(2).height}`);
  check("card: a quad is two units square",
    A(4).width === 2 * U && A(4).height === 2 * U, `${A(4).width}x${A(4).height}`);
  check("card: a split of five is two rows tall, not three",
    A(5).height === 2 * U, `${A(5).height}`);

  // Cells are pitched exactly one badge apart inside a card, and the cards are
  // centred about the arrangement.
  {
    const a = A(4);
    check("card: cell pitch is exactly one badge",
      a.cellLeft(1) - a.cellLeft(0) === U && a.cellTop(2) - a.cellTop(0) === U);
    check("card: row-major — cell 3 is bottom-right",
      a.cellLeft(3) > 0 && a.cellTop(3) > 0);
    const lefts = [0, 1, 2, 3].map((k) => a.cellLeft(k));
    check("card: a lone quad is symmetric about its centre",
      lefts[0] === -lefts[1] && lefts[2] === -lefts[3], JSON.stringify(lefts));
  }
  // The HONEST stability claim: a device keeps its cell WITHIN ITS CARD when a
  // fifth arrives — not its absolute position, because the arrangement is
  // centred and a second card shifts the first one left.
  {
    const four = A(4), five = A(5);
    const relFour = [0, 1, 2, 3].map((k) => [
      four.cellLeft(k) - four.cards[0].left, four.cellTop(k),
    ]);
    const relFive = [0, 1, 2, 3].map((k) => [
      five.cellLeft(k) - five.cards[0].left, five.cellTop(k),
    ]);
    check("card: the first four keep their cells WITHIN their card",
      JSON.stringify(relFour) === JSON.stringify(relFive),
      `${JSON.stringify(relFour)} vs ${JSON.stringify(relFive)}`);
    check("card: …and the arrangement moved, which is the honest caveat",
      four.cellLeft(0) !== five.cellLeft(0));
  }
  // Zones are one badge square, centred on their own chip, tiling each card
  // without straddling the gap between cards.
  for (const n of [2, 4, 5, 6]) {
    const a = A(n);
    let ok = true;
    for (let k = 0; k < a.cells; k++) {
      const l = a.cellLeft(k), t = a.cellTop(k);
      const c = a.cards.find((cd) => k >= cd.first && k < cd.first + cd.cells)!;
      // Inside its own card, on both axes.
      if (l - a.zoneW / 2 < c.left - c.width / 2 - 1e-9) ok = false;
      if (l + a.zoneW / 2 > c.left + c.width / 2 + 1e-9) ok = false;
      if (t - a.zoneH / 2 < -c.height / 2 - 1e-9) ok = false;
      if (t + a.zoneH / 2 > c.height / 2 + 1e-9) ok = false;
    }
    check(`card: ${n} zones sit inside their own card`, ok);
  }
  {
    // No two zones overlap, at any size.
    const a = A(6);
    let clash = 0;
    for (let i = 0; i < a.cells; i++) {
      for (let j = i + 1; j < a.cells; j++) {
        const dx = Math.abs(a.cellLeft(i) - a.cellLeft(j));
        const dy = Math.abs(a.cellTop(i) - a.cellTop(j));
        if (dx < a.zoneW - 1e-9 && dy < a.zoneH - 1e-9) clash++;
      }
    }
    check("card: no two zones overlap", clash === 0, `${clash}`);
  }
}

// ── 12. THE PROJECTION ────────────────────────────────────────────────────
// The piece 2.287.0 added, and where the value of this file now is: the whole
// badge-overlap bug was one wrong expression here, and every property below
// would have caught it before it reached a screenshot.
{
  const P = () => ({ px: 0, py: 0, pz: 0 });
  const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
  const S = VIEW_BASIS_STEPS;

  // Every lattice step, at a spread of pitches. Orthonormality is what makes
  // the projection a rigid map: lose it and every distance is quietly wrong.
  {
    let bad = 0;
    for (let i = 0; i < S; i += 7) {
      const th = (i / S) * Math.PI * 2;
      for (const ph of [0.001, 0.3, 0.9, 1.4, Math.PI / 2 - 0.001]) {
        const b = viewBasis(Math.sin(th) * Math.cos(ph), -Math.sin(ph),
          Math.cos(th) * Math.cos(ph), S, "plane");
        const rLen = Math.hypot(b.rx, b.rz);
        const uLen = Math.hypot(b.sinPhi * b.ax, b.cosPhi, b.sinPhi * b.az);
        const dot = b.rx * b.sinPhi * b.ax + b.rz * b.sinPhi * b.az;
        if (!near(rLen, 1) || !near(uLen, 1) || !near(dot, 0)) bad++;
      }
    }
    check("projection: basis is orthonormal at every lattice step", bad === 0, `${bad}`);
  }

  // A pure VERTICAL offset draws at cos(tilt). This is the property the retired
  // VERTICAL_FORESHORTEN_STEPS existed to assert in a comment; provable now.
  {
    const b = viewBasis(0, -Math.sin(0.6), Math.cos(0.6), 0, "plane");
    const p = projectToView(b, 0, 3, 0, P());
    check("projection: a vertical offset draws at cos(tilt)",
      near(p.px, 0) && near(Math.abs(p.py), 3 * Math.cos(0.6)), `${p.px},${p.py}`);
  }

  // A pure ALONG-VIEW offset draws at sin(tilt). THE BUG: this used to draw at
  // full length, over-crediting depth by 1/sin(tilt) — 5.9x at the shallowest
  // camera the overview allows.
  {
    const phi = 0.171; // ~9.8 deg, the pitch at OverviewController.BETA_MAX
    const b = viewBasis(0, -Math.sin(phi), Math.cos(phi), 0, "plane");
    const p = projectToView(b, 0, 0, 5, P());
    check("projection: an along-view offset draws at sin(tilt), not full length",
      near(p.px, 0) && near(Math.abs(p.py), 5 * Math.sin(phi)),
      `drew ${Math.abs(p.py).toFixed(3)} of 5, want ${(5 * Math.sin(phi)).toFixed(3)}`);
  }

  // A pure CROSS-VIEW offset is drawn at full length, at any tilt. The one case
  // the old metric got right, pinned so a fix cannot break it.
  {
    let bad = 0;
    for (const phi of [0.1, 0.8, 1.5]) {
      const b = viewBasis(0, -Math.sin(phi), Math.cos(phi), 0, "plane");
      const p = projectToView(b, 4, 0, 0, P());
      if (!near(Math.abs(p.px), 4) || !near(p.py, 0)) bad++;
    }
    check("projection: a cross-view offset is drawn at full length", bad === 0, `${bad}`);
  }

  // CANCELLATION IS EXPRESSIBLE. Higher AND further away lands where lower and
  // nearer does. The old quadrature sum could not produce this value at all,
  // which is why this is the test that would have caught the bug.
  {
    const phi = 0.5;
    const b = viewBasis(0, -Math.sin(phi), Math.cos(phi), 0, "plane");
    const h = 4;
    const dy = -h * Math.tan(phi); // the height offset that exactly cancels
    const p = projectToView(b, 0, dy, h, P());
    check("projection: depth and height CANCEL on one screen axis",
      near(p.py, 0), `${p.py}`);
  }

  // AFFINE: project(mean) === mean(project). This identity is the only reason a
  // summary card can be DRAWN at its members' world centroid and MEASURED at
  // the projection of that point without the two drifting. A perspective
  // projection does not have it.
  {
    const b = viewBasis(0.4, -0.6, 0.7, S, "plane");
    const pts = [[1, 2, 3], [-4, 0.5, 8], [2, 5, -1], [0, 0, 0]];
    let cx = 0, cy = 0, cz = 0;
    let mx = 0, my = 0;
    for (const [x, y, z] of pts) {
      cx += x / pts.length; cy += y / pts.length; cz += z / pts.length;
      const q = projectToView(b, x, y, z, P());
      mx += q.px / pts.length; my += q.py / pts.length;
    }
    const c = projectToView(b, cx, cy, cz, P());
    check("projection: affine — project(mean) equals mean(project)",
      near(c.px, mx) && near(c.py, my), `${c.px - mx},${c.py - my}`);
  }

  // The quantisation bound. This is what stops someone lowering
  // VIEW_BASIS_STEPS "to reduce regrouping": the projected error grows with the
  // step, linearly in the separation being measured.
  {
    let worst = 0;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let i = 0; i < 400; i++) {
      const fx = rnd(), fy = rnd(), fz = rnd();
      const len = Math.hypot(fx, fy, fz);
      if (len < 0.2) continue;
      const live = viewBasis(fx / len, fy / len, fz / len, 0, "plane");
      const snap = viewBasis(fx / len, fy / len, fz / len, S, "plane");
      const x = rnd() * 10, y = rnd() * 3, z = rnd() * 10;
      const mag = Math.hypot(x, y, z);
      const a = projectToView(live, x, y, z, P());
      const c = projectToView(snap, x, y, z, P());
      const err = Math.hypot(a.px - c.px, a.py - c.py) / Math.max(mag, 1e-9);
      if (err > worst) worst = err;
    }
    // Half a lattice step on each of two angles, generously bounded.
    const bound = (2 * Math.PI) / S;
    check("projection: snapping costs no more than one lattice step per unit",
      worst <= bound, `${worst.toFixed(5)} > ${bound.toFixed(5)}`);
  }

  // THE TRAP. sin(tilt) must never be zero over the reachable pitch range: a
  // zero collapses the entire along-view axis and merges every badge on every
  // view ray. Deriving it from a quantised COSINE — the retired
  // VERTICAL_FORESHORTEN_STEPS — does exactly that across the top ~11 degrees.
  {
    let zeros = 0;
    for (let i = 0; i <= 200; i++) {
      const beta = 0.05 + (1.4 - 0.05) * (i / 200); // OverviewController's clamp
      const phi = Math.PI / 2 - beta;
      const b = viewBasis(0, -Math.sin(phi), Math.cos(phi), S, "plane");
      if (b.sinPhi <= 1e-6) zeros++;
    }
    check("projection: sin(tilt) is never zero over the camera's reachable range",
      zeros === 0, `${zeros} of 201 pitches collapsed`);
  }

  // world3d mode keeps the pre-2.287.0 geometry: depth at FULL length on its
  // own axis. It is the walk camera's metric and the kill switch's, so it has
  // to stay what it claims to be.
  {
    const phi = 0.171;
    const b = viewBasis(0, -Math.sin(phi), Math.cos(phi), 0, "world3d");
    const p = projectToView(b, 0, 0, 5, P());
    check("projection: world3d keeps depth at full length on its own axis",
      near(p.px, 0) && near(p.py, 0) && near(Math.abs(p.pz), 5), `${p.py},${p.pz}`);
  }

  // Zooming IN never adds a conflict: scaling every coordinate up can only
  // separate. The claim the rung ladder rests on, restated in the units the
  // solver now actually uses.
  {
    const base = [
      mk("a", 0, 0, 0, 20, 0, "r"), mk("b", 30, 10, 0, 20, 1, "r"),
      mk("c", 55, -5, 0, 20, 2, "r"), mk("d", 90, 40, 0, 20, 3, "r"),
    ];
    let broke = 0;
    for (const k of [1.5, 2, 4]) {
      const zoomed = base.map((it) => ({ ...it, sx: it.sx * k, sy: it.sy * k, sz: it.sz * k }));
      for (let i = 0; i < base.length; i++) {
        for (let j = i + 1; j < base.length; j++) {
          if (!conflicts(base[i], base[j], GAP, SEP)
            && conflicts(zoomed[i], zoomed[j], GAP, SEP)) broke++;
        }
      }
    }
    check("projection: zooming in never ADDS a conflict", broke === 0, `${broke}`);
  }
}


// ── Card-vs-card merge: the fixpoint must actually reach a fixpoint ─────────
// Shipped wrong for two releases as `for (round = 0; round < piles.length;
// round++)`. `piles.length` shrinks by one per merge while `round` grows, so
// the two meet in the middle: at most ceil(N/2) merges happen where N-1 are
// needed. N=2 and N=3 need exactly ceil(N/2), which is why it looked right —
// the failure starts at FOUR, and a tapped room reaches four piles easily.
{
  // Every pile at the same point, so every pair overlaps: the only correct
  // answer at any N is a single pile.
  const box = (): PileBox => ({ cx: 0, cy: 0, hw: 10, hh: 10 });
  let firstBad = -1;
  for (let n = 2; n <= 12; n++) {
    const piles = Array.from({ length: n }, (_, i) => [i]);
    mergeCollidingPiles(piles, box);
    if ((piles.length !== 1 || piles[0].length !== n) && firstBad < 0) firstBad = n;
  }
  check("merge: N mutually-overlapping piles collapse to one, for every N",
    firstBad < 0, `first failure at N=${firstBad}`);

  // THE PROMISE, stated as the property it actually is: whatever comes back,
  // no two survivors overlap. "Collapses to one" is NOT the promise and would
  // be the wrong assertion — a merged pile's box sits at its members' centroid,
  // so merging two neighbours moves the survivor AWAY from a third and a chain
  // can legitimately settle as several separated piles.
  //
  // Swept over random layouts because the bug was N-dependent: it began at four
  // piles, and a suite that only tried two or three would have passed. Each
  // case is checked for the exact thing the screenshot showed.
  {
    let seed = 1337;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const mean = (p: number[], f: (i: number) => number) =>
      p.reduce((t, i) => t + f(i), 0) / p.length;
    let bad = -1, badN = -1;
    for (let n = 2; n <= 10 && bad < 0; n++) {
      for (let trial = 0; trial < 200 && bad < 0; trial++) {
        const xs = Array.from({ length: n }, () => rnd() * 60);
        const ys = Array.from({ length: n }, () => rnd() * 60);
        const piles = Array.from({ length: n }, (_, i) => [i]);
        // Centroid + a half-extent that GROWS with the pile, exactly as a card
        // does when it gains cells — the property that makes the fixpoint need
        // more than one pass in the first place.
        const boxOf = (p: number[]): PileBox => ({
          cx: mean(p, (i) => xs[i]), cy: mean(p, (i) => ys[i]),
          hw: 8 + p.length, hh: 8 + p.length,
        });
        mergeCollidingPiles(piles, boxOf);
        const b = piles.map(boxOf);
        for (let i = 0; i < b.length && bad < 0; i++) {
          for (let j = i + 1; j < b.length; j++) {
            if (Math.abs(b[i].cx - b[j].cx) < b[i].hw + b[j].hw
              && Math.abs(b[i].cy - b[j].cy) < b[i].hh + b[j].hh) { bad = trial; badN = n; break; }
          }
        }
        // …and nothing may be lost or duplicated on the way.
        const flat = piles.flat().sort((p, q) => p - q);
        if (flat.join() !== Array.from({ length: n }, (_, i) => i).join()) { bad = trial; badN = n; }
      }
    }
    check("merge: no two survivors overlap, at any pile count", bad < 0,
      `N=${badN} trial ${bad}`);
  }

  // …and it must NOT over-merge: piles that clear each other are left alone.
  const apart = [[0], [1], [2], [3], [4]];
  mergeCollidingPiles(apart, (p) => ({ cx: p[0] * 1000, cy: 0, hw: 10, hh: 10 }));
  check("merge: well-separated piles are never merged",
    apart.length === 5, JSON.stringify(apart));

  // Touching exactly at the boundary is NOT an overlap — the test is strict
  // `<`, and a gap term is already folded into hw/hh by the caller.
  const touching = [[0], [1]];
  mergeCollidingPiles(touching, (p) => ({ cx: p[0] * 20, cy: 0, hw: 10, hh: 10 }));
  check("merge: boxes that exactly abut are left apart", touching.length === 2);
}


// ── Clique building: valid, deterministic, and SPATIALLY TIGHT ─────────────
// The clique CONDITION has no freedom; the order candidates are offered in
// decides which valid partition you get. It used to be canonical (rank, id)
// order, and badgeRank is largely a function of CATEGORY — so the sweep
// reached every camera in a room consecutively however far apart they stood,
// and the resulting card, drawn at its members' centroid, landed nowhere near
// them. Reported with three zoom levels of one terrace.
{
  const canonical = (its: PlacementItem[]) =>
    its.map((_, i) => i).sort((x, y) => its[x].rank !== its[y].rank
      ? its[x].rank - its[y].rank
      : (its[x].sortKey < its[y].sortKey ? -1 : 1));

  // Every clique must be a clique: all pairs mutually conflict.
  // Every badge must appear exactly once.
  const audit = (its: PlacementItem[], piles: number[][], label: string) => {
    let ok = true;
    for (const p of piles) {
      for (let i = 0; i < p.length; i++) {
        for (let j = i + 1; j < p.length; j++) {
          if (!conflicts(its[p[i]], its[p[j]], GAP, SEP)) ok = false;
        }
      }
    }
    check(`cliques: every member overlaps every other (${label})`, ok);
    const flat = piles.flat().sort((a, b) => a - b);
    check(`cliques: every badge appears exactly once (${label})`,
      flat.join() === its.map((_, i) => i).join());
  };

  // A random villa room, with categories deliberately CORRELATED to rank (as
  // badgeRank makes them) and positions deliberately not — the exact shape
  // that produced the report.
  let seed = 20260814;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const CATS = ["light", "camera", "energy", "climate"];
  const build = (n: number) => Array.from({ length: n }, (_, i) => {
    const c = Math.floor(rnd() * CATS.length);
    return mk(`e.${String(i).padStart(2, "0")}`, rnd() * 90, rnd() * 90, 0, 14,
      c, CATS[c]);            // rank == category index: rank correlates with type
  });

  // Mean distance from a member to its own pile's centroid — the quantity the
  // card's placement actually depends on, since a card is drawn at that point.
  const spread = (its: PlacementItem[], piles: number[][]) => {
    let total = 0, count = 0;
    for (const p of piles) {
      if (p.length < 2) continue;
      const cx = p.reduce((t, i) => t + its[i].sx, 0) / p.length;
      const cy = p.reduce((t, i) => t + its[i].sy, 0) / p.length;
      for (const i of p) { total += Math.hypot(its[i].sx - cx, its[i].sy - cy); count++; }
    }
    return count ? total / count : 0;
  };

  // The OLD builder, kept here only as the baseline to measure against.
  const rankOrderCliques = (its: PlacementItem[], order: number[], max: number) => {
    const taken = new Uint8Array(its.length); const piles: number[][] = [];
    for (const s2 of order) {
      if (taken[s2]) continue;
      taken[s2] = 1; const pile = [s2];
      for (const c of order) {
        if (pile.length >= max) break;
        if (taken[c]) continue;
        let all = true;
        for (const m of pile) if (!conflicts(its[c], its[m], GAP, SEP)) { all = false; break; }
        if (!all) continue;
        taken[c] = 1; pile.push(c);
      }
      piles.push(pile);
    }
    return piles;
  };

  let tighter = 0, looser = 0, sumOld = 0, sumNew = 0;
  for (let trial = 0; trial < 300; trial++) {
    const its = build(14);
    const ord = canonical(its);
    const now = buildCliques(its, ord, GAP, SEP, MAX_TOTAL_CHIPS);
    const before = rankOrderCliques(its, ord.slice(), MAX_TOTAL_CHIPS);
    if (trial === 0) audit(its, now, "sample");
    const a = spread(its, before), b = spread(its, now);
    sumOld += a; sumNew += b;
    if (b < a - 1e-9) tighter++; else if (b > a + 1e-9) looser++;
  }
  check("cliques: nearest-first is tighter more often than not",
    tighter > looser, `tighter ${tighter} / looser ${looser}`);
  check("cliques: …and tighter on aggregate",
    sumNew < sumOld, `old ${sumOld.toFixed(1)} new ${sumNew.toFixed(1)}`);

  // Determinism and input-order independence: the canonical order seeds and
  // breaks every tie, so shuffling the ITEM array must not change the answer.
  {
    const its = build(12);
    const ord = canonical(its);
    const a = buildCliques(its, ord, GAP, SEP, MAX_TOTAL_CHIPS);
    const b = buildCliques(its, ord, GAP, SEP, MAX_TOTAL_CHIPS);
    check("cliques: deterministic", JSON.stringify(a) === JSON.stringify(b));
    const key = (piles: number[][]) =>
      piles.map((p) => p.map((i) => its[i].sortKey).sort().join("+")).sort().join(" | ");
    const shuffled = its.map((_, i) => i).sort(() => rnd() - 0.5);
    const its2 = shuffled.map((i) => its[i]);
    const c = buildCliques(its2, canonical(its2), GAP, SEP, MAX_TOTAL_CHIPS);
    const key2 = c.map((p) => p.map((i) => its2[i].sortKey).sort().join("+")).sort().join(" | ");
    check("cliques: independent of input array order", key(a) === key2,
      `${key(a)}  vs  ${key2}`);
    audit(its, a, "determinism set");
  }

  // ── THE REPORTED TERRACE, reduced to its essence ────────────────────────
  // A light on the left, two cameras on the right, two sockets between them —
  // all mutually overlapping at the reported zoom, and more of them than one
  // card can hold. badgeRank puts cameras before sockets, so the OLD sweep
  // gave the light both cameras and left the sockets to pair up: the card
  // holding the cameras was then centred at the mean of light+camera+camera,
  // which sits well LEFT of the cameras themselves — and left of the socket
  // card. That is exactly the inversion in the screenshots.
  {
    const its = [
      mk("a.light", 0, 0, 0, 35, 0, "r", false, "light"),
      mk("c.cam1", 60, 0, 0, 35, 1, "r", false, "camera"),
      mk("c.cam2", 60, 15, 0, 35, 1, "r", false, "camera"),
      mk("e.plug1", 35, 0, 0, 35, 5, "r", false, "energy"),
      mk("e.plug2", 35, 15, 0, 35, 5, "r", false, "energy"),
    ];
    const ord = canonical(its);
    const CAP = 3;                       // more badges than one card can hold
    const cx = (p: number[]) => p.reduce((t, i) => t + its[i].sx, 0) / p.length;
    const camPile = (piles: number[][]) => piles.find((p) => p.includes(1)) as number[];

    const before = rankOrderCliques(its, ord.slice(), CAP);
    const after = buildCliques(its, ord, GAP, SEP, CAP);

    check("terrace: the two cameras end up together", camPile(after).includes(2),
      JSON.stringify(camPile(after).map((i) => its[i].sortKey)));
    check("terrace: …and NOT with the light on the far side",
      !camPile(after).includes(0), JSON.stringify(camPile(after).map((i) => its[i].sortKey)));
    // The point of the whole change: the card lands ON its devices. The
    // cameras stand at x=60; under the old sweep their card was drawn at 40.
    check("terrace: the camera card is centred on the cameras",
      Math.abs(cx(camPile(after)) - 60) < 1e-9, `${cx(camPile(after))}`);
    check("terrace: …which the rank-order sweep did not manage",
      Math.abs(cx(camPile(before)) - 60) > 15, `${cx(camPile(before))}`);
    audit(its, after, "terrace");
  }

  // Category is a tiebreak between candidates that are genuinely EQUIDISTANT,
  // and nothing more. Both candidates sit exactly 6px from the seed here, so
  // the distance buckets tie and type is the only thing left to decide — and
  // the same-category one is deliberately ranked LAST, so only the category
  // preference can pull it in ahead of the other.
  {
    const its = [
      mk("a.seed", 0, 0, 0, 14, 0, "r", false, "camera"),
      mk("b.other", 6, 0, 0, 14, 1, "r", false, "energy"),
      mk("c.same", 0, 6, 0, 14, 9, "r", false, "camera"),
    ];
    const p = buildCliques(its, canonical(its), GAP, SEP, 2);   // room for one
    const withSeed = p.find((q) => q.includes(0)) as number[];
    check("cliques: same category wins among EQUIDISTANT candidates",
      withSeed.includes(2), JSON.stringify(withSeed.map((i) => its[i].sortKey)));
    check("cliques: …and it beat a candidate that ranks earlier",
      !withSeed.includes(1), JSON.stringify(withSeed.map((i) => its[i].sortKey)));
    audit(its, p, "category tiebreak");
  }

  // …but it must NEVER outrank distance. Same setup, except the same-category
  // candidate is now genuinely farther: the nearer one has to win.
  {
    const its = [
      mk("a.seed", 0, 0, 0, 14, 0, "r", false, "camera"),
      mk("b.other", 6, 0, 0, 14, 1, "r", false, "energy"),
      mk("c.same", 24, 0, 0, 14, 9, "r", false, "camera"),
    ];
    const p = buildCliques(its, canonical(its), GAP, SEP, 2);
    const withSeed = p.find((q) => q.includes(0)) as number[];
    check("cliques: distance beats category when they disagree",
      withSeed.includes(1), JSON.stringify(withSeed.map((i) => its[i].sortKey)));
  }
}

// ── THE collision rule is a BOX test (2.406.0) ─────────────────────────────
// Two things collide when their drawn boxes, inflated by the gap and floored
// by the tap pitch, intersect on the glass. These pins hold the two properties
// that distinguish it from the disc test it replaced — each was a real
// field over-grouping ("entities group while there is clearly space left",
// sources/files/move.mov).
{
  // 1. WIDE badges stacked VERTICALLY: boxes clear (heights 8+8+gap 0.1 < 25)
  //    so they must NOT conflict — the disc judged this gap by their WIDTHS
  //    (30+30+0.1 > 25) and grouped them.
  const wideA = mk("a.wide", 0, 0, 0, 30, 0, "r", false, "", 8);
  const wideB = mk("b.wide", 0, 25, 0, 30, 1, "r", false, "", 8);
  check("box rule: vertical clearance is judged by HEIGHT, not width",
    !conflicts(wideA, wideB, GAP, SEP));
  const r = solve([wideA, wideB]);
  check("box rule: …so both stacked wide badges draw",
    r.accepted[0] === true && r.accepted[1] === true);

  // 2. And the same pair pushed together until the boxes DO meet must group —
  //    the rule is "exactly at collision", not "never".
  const closeB = mk("b.wide", 0, 15, 0, 30, 1, "r", false, "", 8);
  check("box rule: overlapping boxes still conflict",
    conflicts(wideA, closeB, GAP, SEP));

  // 3. Squares on the DIAGONAL: boxes clear per axis at (20,20) with reach 14
  //    on one axis only... both axes overlap (20 < 14+14+0.1), so conflict —
  //    but at (30, 20) the X axis clears (30 > 28.1) and they must not.
  const sqA = mk("a.sq", 0, 0, 0, 14, 0, "r");
  const sqDiag = mk("b.sq", 30, 20, 0, 14, 1, "r");
  check("box rule: one clear axis is enough to not collide",
    !conflicts(sqA, sqDiag, GAP, SEP));
}

// ── The pull-back can only ever see badges that COLLIDED with the loner ───
// Recorded as a PROOF rather than a case, because no case can exercise it:
// a bucket of one means its pile has exactly one deferred badge, so every
// other member is accepted; two accepted badges never conflict (the greedy
// pass would have deferred the second); therefore an accepted member that did
// not conflict with the loner has no edge to anything and cannot be in the
// pile at all. So PULLBACK_REACH_FACTOR is a distance CAP on genuine blockers,
// never a door that admits a non-blocker — and "prefer the badge you actually
// hit" is not a rule that can be written here, because there is nothing else
// to prefer it over. 2.411.1 tried; the attempted pin passed on the unchanged
// code, which is how the inertness was caught before it shipped.

// ── ZOOMING OUT MAY NEVER UN-GROUP (2.414.0) ──────────────────────────────
// The badge/separation ratio is r^(1 - ICON_ZOOM_EXPONENT); zooming out grows
// r, so the ratio must not shrink. Simulated over the whole zoom-out range
// rather than asserted on the constant, so the pin fails for the RIGHT reason
// and would also catch a future change to how the two scales combine.
{
  const fit = 30;
  const ratio = (r: number, e: number) => {
    const icon = Math.min(1, Math.max(ICON_ZOOM_MIN_SCALE, Math.pow(fit / r, e)));
    return icon / (1 / r);            // badge size over screen separation
  };
  const monotone = (e: number) => {
    let prev = -Infinity;
    for (let r = fit; r <= fit * 8; r *= 1.05) {
      const v = ratio(r, e);
      if (v < prev - 1e-9) return false;
      prev = v;
    }
    return true;
  };
  check("zoom-out never un-groups at the SHIPPED exponent", monotone(ICON_ZOOM_EXPONENT),
    `e=${ICON_ZOOM_EXPONENT}`);
  // The pin has to be able to fail: 1.8 is what shipped and what the field log
  // caught de-clustering on the way out.
  check("…and the pin would have caught the old 1.8", !monotone(1.8));
  check("exponent stays at or below 1", ICON_ZOOM_EXPONENT <= 1, `e=${ICON_ZOOM_EXPONENT}`);
}

// ── 15. The PHONE card shape, and the premise absorb now rests on (2.415.0) ─
// Two reasons this section exists, and they are different kinds of reason.
//
// (1) COVERAGE THAT WAS NEVER THERE. Every `arrange` call above takes the
//     default `perCard = MAX_GRID_CHIPS`. The phone shape (`PHONE_MAX_GRID_CHIPS`
//     — pairs side by side, never a 2x2) had NO pin at all, and until 2.415.0
//     that was nearly harmless: the phone total cap pinned `drawableMax` to 2,
//     so an ordinary group could not reach a shape with more than one card in
//     it. Deleting that cap made the multi-card phone arrangement reachable on
//     the ORDINARY path, at up to the viewport budget. New exposure, so: pins.
//
// (2) A PREMISE I WROTE INTO A COMMENT AS IF PROVEN. `placeEntityGroups`'
//     absorb sweep now claims its box strictly CONTAINS the box `fits` refuses
//     at, and the argument for that is `cardInscribedHalf >= squareHalf` — i.e.
//     `min(width, height) >= unit` for EVERY arrangement `arrange` can emit.
//     It holds structurally (a row is at least one unit tall and one unit
//     wide), so this pin cannot fail today and is not evidence for the fix.
//     It is a guard on the premise: the day an arrangement gets a half-height
//     row, the annulus comes back and nothing else in the repo would say so.
{
  const U = 28, F = 22 / 28, G = 6;
  const shapes = [MAX_GRID_CHIPS, PHONE_MAX_GRID_CHIPS];

  // (2) — the containment premise, over every shape and budget a caller can ask
  // for, including budgets too narrow for one card.
  let minOk = true, worst = "";
  for (const perCard of shapes) {
    for (let n = 1; n <= 12; n++) {
      for (const budget of [0, U / 4, 2.2 * U, 5 * U, 40 * U]) {
        const a = arrange(n, U, F, G, 12, budget, perCard);
        if (Math.min(a.width, a.height) < U - 1e-9) {
          minOk = false; worst = `n=${n} perCard=${perCard} budget=${budget}`;
        }
      }
    }
  }
  check("every arrangement is at least ONE UNIT on its short axis", minOk, worst);
  // The pin has to be able to fail, so show the comparison it is really making:
  // half a unit shorter and the claim `cardInscribedHalf >= squareHalf` breaks.
  check("…which is what makes cardInscribedHalf >= squareHalf",
    arrange(6, U, F, G, 12, 0, PHONE_MAX_GRID_CHIPS).height >= U);

  // (1) — the phone shape itself. A phone card is a single ROW of at most two:
  // that is the whole of PHONE_MAX_GRID_CHIPS, and since 2.415.0 it is the ONLY
  // phone-specific cell rule, so nothing else is left to catch a regression.
  {
    let pairsOnly = true, everyCell = true;
    for (let n = 1; n <= 8; n++) {
      const a = arrange(n, U, F, G, 12, 0, PHONE_MAX_GRID_CHIPS);
      if (a.cells !== n) everyCell = false;
      for (const c of a.cards) if (c.rows !== 1 || c.cols > PHONE_MAX_GRID_CHIPS) pairsOnly = false;
    }
    check("a phone card is a single row of at most two — never a 2x2", pairsOnly);
    check("…and the phone shape still draws every device a cell", everyCell);
    // Discriminating: the DEFAULT shape does produce 2-row cards, so the check
    // above is testing `perCard` and not merely restating `arrange`.
    check("…and that pin would fail against the desktop shape",
      arrange(4, U, F, G).cards.some((c) => c.rows === 2));
  }

  // The budget is the rule that REPLACED the deleted phone cap, so it has to
  // hold in the phone shape too — a phone's cards are one unit tall, so wrapping
  // is the only thing keeping a 6-device group off the edge of a 360px screen.
  {
    const narrow = 2.2 * U;
    const a = arrange(6, U, F, G, 12, narrow, PHONE_MAX_GRID_CHIPS);
    check("a budgeted PHONE arrangement draws every cell", a.cells === 6);
    check("a budgeted PHONE arrangement obeys its budget", a.width <= narrow + 1e-9);
    check("a budgeted PHONE arrangement grows DOWNWARD", a.height > a.width);
    const seen = new Set<string>();
    let inside = true;
    for (let k = 0; k < a.cells; k++) {
      seen.add(`${a.cellLeft(k)},${a.cellTop(k)}`);
      if (Math.abs(a.cellLeft(k)) > a.width / 2 || Math.abs(a.cellTop(k)) > a.height / 2) inside = false;
    }
    check("every cell of a budgeted PHONE arrangement has its own position",
      seen.size === a.cells);
    check("every cell of a budgeted PHONE arrangement is inside its box", inside);
  }
}

// ── THE CHIP TIER RESERVES THE WIDTH IT PAINTS (2.421.0, 2.422.0) ──────────
// fitChipLabel's own docstring states the rule: "the caller measures the chip
// with the string this returns, so the width the layout reserves and the width
// the renderer draws are the same string put through the same function."
//
// It was broken from both ends. The count kept being concatenated into the
// measured string after it became a fixed-size corner overlay (2.421.0), and
// labelLayout carried its own per-character advance and pad instead of the
// renderer's (2.422.0) — wrong in opposite directions, cancelling at one name
// length and nowhere else.
//
// ⚠️ The half that did the damage lives in `EntityVisuals.deriveChips`, needs
// Babylon, and is not pinnable here — the same gap v2.415.0 had. What IS
// pinnable is the model itself, and the last two below would have failed
// outright against the private constants.
{
  // Mirrors EntityVisuals.chipTextMetrics(): nothing private, every term from
  // badgeMetrics and the count pill the chip actually draws.
  const chipText = (pointer: "coarse" | "fine", card: boolean): ChipTextMetrics => {
    const m = badgeMetricsFor(pointer);
    const size = card ? m.cardHeightPx : m.badgeDiameterPx;
    return {
      charPx: Math.round(size * SUMMARY_TEXT_OF_HEIGHT) * VALUE_CHAR_ADVANCE,
      padPx: m.chipTextPadPx * 2 + Math.round(size * m.countPillFraction),
    };
  };
  const CT = chipText("coarse", true);

  const budgets = [60, 90, 140, 200, 400];
  const names = ["Alpha", "Beta Room", "Gamma Chamber", "Delta", "Eps"];
  let reserveMatches = true;
  let withinBudget = true;
  let countIrrelevant = true;
  for (const maxPx of budgets) {
    for (const name of names) {
      for (const suffix of ["", "+1", "+12"]) {
        const label = fitChipLabel(name, suffix, CT, maxPx);
        // A chip may overflow ONLY at the CHIP_MIN_NAME_CHARS floor, where it
        // keeps four readable characters rather than printing an unusable
        // stub. So the demand is conditional: if the floor itself would have
        // fitted, a fitting label existed and fitChipLabel had to return one.
        const stub = name.slice(0, 4).trimEnd() + "\u2026";
        const floor = suffix ? `${stub} ${suffix}` : stub;
        if (chipWidthPx(floor, CT) <= maxPx && chipWidthPx(label, CT) > maxPx) withinBudget = false;
        if (suffix && !label.includes(suffix)) reserveMatches = false;
        if (fitChipLabel(name, suffix, CT, maxPx) !== label) countIrrelevant = false;
      }
    }
  }
  check("fitChipLabel never truncates the merged-rooms suffix", reserveMatches);
  check("a fitted chip label fits the budget chipWidthPx measures it with", withinBudget);
  check("a chip's fitted label does not depend on its device count", countIrrelevant);

  // ── The two that discriminate ─────────────────────────────────────────────
  // 1. The advance is derived from the font the chip PRINTS — its own summary
  //    text size since 2.447.0, not the badge's value readout. A private
  //    constant would be equal across styles; these two must differ, because
  //    the card and the classic badge are different heights.
  const cardAdv = chipText("coarse", true).charPx;
  const pillAdv = chipText("coarse", false).charPx;
  check("the chip advance follows the STYLE's value font, not a constant",
    cardAdv !== pillAdv, `card=${cardAdv} pill=${pillAdv}`);

  // 2. It tracks the pointer class the whole file is scaled by. A fine pointer
  //    paints 32/44 of a coarse one, so the same room name cannot measure the
  //    same on both — under the private constants it measured identically.
  const wCoarse = chipWidthPx("Gamma Chamber", chipText("coarse", true));
  const wFine = chipWidthPx("Gamma Chamber", chipText("fine", true));
  check("a chip's modelled width tracks the pointer class",
    wFine < wCoarse, `coarse=${wCoarse.toFixed(1)} fine=${wFine.toFixed(1)}`);

  // 3. The phantom the count once added, so nobody re-reads it as noise beside
  //    a 2 px merge gap.
  const label = fitChipLabel("Gamma Chamber", "+4", CT, 400);
  const phantom = chipWidthPx(`${label}  12`, CT) - chipWidthPx(label, CT);
  // Threshold stated against the merge gap it dwarfs, not against a copy of
  // the advance — 32.8 with the private 8.2, 28.8 with badgeMetrics' honest
  // 7.2, and a pin calibrated to either number fails when the other is right.
  check("the chip width reserve excludes the overlay count",
    phantom > 10 * 2, `phantom=${phantom.toFixed(1)} CSS px vs minGapPx=2`);
}

// ── A BADGE MAY NOT RESERVE WIDTH IT CANNOT DRAW (2.423.0) ─────────────────
// /dry-audit: `container.width` was a literal 180px while `labelBoxes` reserved
// `len * charPx + pad` with no ceiling, and `groupedValue` joins one clamped
// value PER GROUP MEMBER ("  .  " separated, 21N-5 characters) while clamping
// only the parts. At three members the solver reserved ~384 CSS px for a pill
// the container clips at 180 — 113% over, i.e. early grouping by construction.
//
// The production clamp needs `this.metrics` and lives in EntityVisuals, so what
// is pinned here is the ARITHMETIC it rests on: the character budget the
// ceiling implies must be positive (a badge can always say something) and must
// model no wider than the ceiling (the renderer can always draw it).
{
  let positive = true;
  let withinCeiling = true;
  let worst = "";
  for (const pointer of ["coarse", "fine"] as const) {
    const m = badgeMetricsFor(pointer);
    for (const card of [true, false]) {
      const fixed = card
        ? m.cardPadLeftPx + m.cardHeightPx + m.cardValuePadPx
        : m.pillValuePadPx;
      const charPx = card ? m.cardValueCharPx : m.pillValueCharPx;
      const max = Math.max(1, Math.floor((m.labelMaxWidthPx - fixed) / charPx));
      if (max < 4) { positive = false; worst = `${pointer}/${card} max=${max}`; }
      const modelled = max * charPx + fixed;
      if (modelled > m.labelMaxWidthPx) {
        withinCeiling = false;
        worst = `${pointer}/${card} ${modelled.toFixed(1)} > ${m.labelMaxWidthPx}`;
      }
    }
  }
  // ── THE CARD'S VISIBLE MARGINS AND GAP (2.451.0) ──────────────────────────
  // Four attempts at "the value sits too far right" failed because the chip's
  // squircle is baked BADGE_INSET_CARD inside its control, so every margin
  // measured to the CONTROL was measured from a boundary nobody can see. These
  // pin what a reader actually sees, in the same arithmetic the renderer uses.
  //
  // ⚠️ THE RULE CHANGED IN 2.454.0 AND THE OWNER SET IT, so this block pins an
  // EQUATION rather than a preference. 2.451.0 pinned "the gap is clearly wider
  // than the margins", reasoned from the DOM twin. The owner then stated the
  // target outright — "I want the 100% to appear centered between the end of
  // the entity icon and the end of the badge graph" — which is gap == visR, the
  // exact opposite of what was pinned. Six attempts were argued from a model;
  // this one is checkable against the `badge` line of any capture.
  {
    let centred = true;
    let chipMarginHeld = true;
    let detail = "";
    for (const pointer of ["coarse", "fine"] as const) {
      const mm = badgeMetricsFor(pointer);
      const glyph = Math.min(
        Math.round(mm.cardHeightPx * mm.cardIconFraction),
        mm.cardHeightPx - 2 * mm.ringThicknessPx,
      );
      const iconPad = (mm.cardHeightPx - glyph) / 2;
      const ink = glyph * 0.10;                       // BADGE_INSET_CARD
      // The renderer's own arithmetic, unrounded exactly as it now is there.
      const padL = Math.max(0, iconPad - ink);
      const spacer = Math.max(0, CARD_VALUE_MARGIN_OF_ICON_PAD * iconPad - ink);
      const tail = (CARD_VALUE_MARGIN_OF_ICON_PAD - 1) * iconPad;
      /** Babylon quantises a control's pixel width to an integer — see below. */
      const q = Math.floor;
      const visL = padL + ink;                        // badge edge -> chip ink
      const gap = ink + spacer;                       // chip ink -> text
      const visR = tail + iconPad;                    // text -> badge edge
      // THE owner's equation, on the IDEAL widths.
      if (Math.abs(gap - visR) > 0.01) {
        centred = false;
        detail = `${pointer}: gap=${gap.toFixed(3)} visR=${visR.toFixed(3)}`;
      }
      // ⚠️ AND THE SAME EQUATION ON WHAT IS ACTUALLY DRAWN, WHICH IS NOT THE
      // SAME NUMBER (2.455.0). **Babylon QUANTISES a control's pixel width to
      // an integer.** Measured, not inferred: `logBadgeGeometry` prints
      // `_currentMeasure` at toFixed(1), and a strut set to 0.65px printed as
      // `0.0` while one set to 1.775px printed as `1.0` — a fractional width
      // would have printed 0.7 and 1.8. So 2.454.0's "rounding is gone from all
      // three struts" did not remove the rounding, it moved it inside Babylon
      // and made it a FLOOR instead of a round.
      //
      // This matters because the ideal equality above is unreachable: `ink` is
      // 0.1·glyph and therefore fractional, so no pair of integer struts can sit
      // exactly the same distance either side of the text. The best available at
      // this size is 0.4 px out (drawn gap=2.60 against visR=3.00, which the
      // owner accepted on screen). A pin that only checked the ideal would pass
      // on a build whose drawn geometry had drifted arbitrarily far — the exact
      // "layout geometry must equal render geometry" rule this subsystem has
      // paid for four times.
      const drawnGap = ink + q(spacer);
      const drawnVisR = q(tail) + q(iconPad);
      if (Math.abs(drawnGap - drawnVisR) > 0.5) {
        centred = false;
        detail = `${pointer}: DRAWN gap=${drawnGap.toFixed(2)} visR=${drawnVisR.toFixed(2)}`;
      }
      // ...and the chip keeps its own margin, which is a separate question the
      // owner did not reopen: a bare-icon card is still symmetric at iconPad.
      // Checked on the DRAWN width for the same reason as above — the ideal
      // 0.65 strut floors to 0, so what a reader sees on the left is the baked
      // ink alone. Within one integer step of iconPad is the whole claim.
      if (Math.abs((q(padL) + ink) - iconPad) > 1.0) {
        chipMarginHeld = false;
        detail = `${pointer}: drawn visL=${(q(padL) + ink).toFixed(2)}`
          + ` iconPad=${iconPad.toFixed(3)} (ideal visL=${visL.toFixed(3)})`;
      }
    }
    check("the value is centred between the chip's ink and the card's edge",
      centred, detail);
    check("...and the chip keeps its own iconPad margin on the left",
      chipMarginHeld, detail);
    // The rule this REPLACED, pinned as failing, so nobody restores it by
    // reasoning from the DOM twin a seventh time: 2.451.0 put the gap at
    // 2*iconPad against a visR of iconPad, which is not centred by a full
    // iconPad.
    check("...and the 2.451.0 gap=2x rule would NOT have been centred",
      Math.abs(2 * 3 - 3) > 0.01);
    // The measurement that started this: an equal-CONTROL-margin card, which is
    // what shipped twice, leaves the two VISIBLE margins unequal by the inset.
    check("...and equal CONTROL padding would NOT have matched visually",
      Math.abs((3 + 22 * 0.10) - 3) > 0.75);
  }

  // ── THE VALUE FONT'S RATIO MUST SURVIVE BOTH POINTER CLASSES (2.441.0) ────
  // `VALUE_FONT_OF_CHIP` says the value is half its chip. On a fine pointer the
  // whole table is COARSE x 32/44, so the value scales to 8.0 px — and a
  // MIN_VALUE_FONT_PX of 10 clamped it back up, making the ratio a lie on every
  // mouse-driven screen. The owner reported the size not changing on their
  // laptop when the base went 13 -> 11; this is why. A floor is allowed to
  // exist, but not to quietly become the thing that decides.
  {
    let ratioHeld = true;
    let detail = "";
    for (const pointer of ["coarse", "fine"] as const) {
      const mm = badgeMetricsFor(pointer);
      const chip = Math.min(
        Math.round(mm.cardHeightPx * mm.cardIconFraction),
        mm.cardHeightPx - 2 * mm.ringThicknessPx,
      );
      const ratio = mm.cardValueFontPx / chip;
      // Reads the CONSTANT, never a copy of its value: the previous version
      // hard-coded 0.5 and would have had to be edited in lockstep with every
      // tuning pass, which is how a pin starts asserting last month's design.
      // The tolerance is one rounding step of the half-pixel grid scaleGeometry
      // snaps to, not slack for a clamp.
      if (Math.abs(ratio - VALUE_FONT_OF_CHIP) > 0.04) {
        ratioHeld = false;
        detail = `${pointer}: ${mm.cardValueFontPx}px on a ${chip}px chip = ${ratio.toFixed(3)}`;
      }
    }
    check("the value font honours its ratio on BOTH pointer classes", ratioHeld, detail);
    // ...and the pin would have caught the floor that was deciding: at 10, the
    // fine table reads 10 on a 16px chip = 0.625.
    check("...and that pin would fail against a floor that decides instead",
      Math.abs(10 / 16 - VALUE_FONT_OF_CHIP) > 0.04);
  }

  check("a clamped value still has room to say something", positive, worst);
  check("a clamped value never models wider than the container draws",
    withinCeiling, worst);

  // The defect's own magnitude, so nobody reads the clamp as cosmetic: an
  // unclamped 3-member group reaches 21*3-5 = 58 characters.
  //
  // ⚠️ The MULTIPLE is not the invariant and must not be pinned as one. It
  // scales with the value font, which since 2.441.0 is derived from the chip
  // rather than being an independent literal — so a legitimate font change
  // moves it (13px -> 11px took this from 2.1x to 1.9x and tripped a `> 2x`
  // threshold that was only ever illustrative). What must stay true is that an
  // unclamped group is unmistakably wider than the container it has to fit.
  const m = badgeMetricsFor("coarse");
  const unclamped = 58 * m.pillValueCharPx + m.pillValuePadPx;
  check("an unclamped grouped value would exceed the container",
    unclamped > m.labelMaxWidthPx * 1.5,
    `${unclamped.toFixed(0)} CSS px vs a ${m.labelMaxWidthPx} px container`
    + ` (${(unclamped / m.labelMaxWidthPx).toFixed(2)}x)`);
}

// ── THE ZOOM LATTICE IS ONE-SIDED, AND ONE FUNCTION (2.425.0) ──────────────
// The rung scales every separation the solver measures while the badge boxes it
// compares them against are real drawn pixels no rung can shrink. A rung BELOW
// the drawn zoom therefore compares shortened distances against full-size boxes
// and groups while space is still visible — the "groups too soon" cliff of
// 2.407.0. Ceil makes the error one-sided; round does not.
//
// Pinned here because the correction was previously rolled out by call site and
// missed the third walker of the same lattice (/dry-audit): solveRoomZoomRadius
// kept Math.round under a comment claiming to match the renderer.
{
  const q = GROUP_ZOOM_STEPS_PER_DOUBLING;
  const step = Math.pow(2, 1 / q);
  const samples: number[] = [];
  for (let e = -6; e <= 9; e += 0.037) samples.push(Math.pow(2, e));

  let neverBelow = true;
  let withinOneStep = true;
  let onLattice = true;
  let monotone = true;
  let worst = "";
  let prev = -Infinity;
  for (const v of samples) {
    const r = snapToZoomLattice(v);
    if (r < v * (1 - 1e-12)) { neverBelow = false; worst = `${v} -> ${r}`; }
    if (r > v * step * (1 + 1e-12)) { withinOneStep = false; worst = `${v} -> ${r}`; }
    const k = Math.log2(r) * q;
    if (Math.abs(k - Math.round(k)) > 1e-9) { onLattice = false; worst = `${v} -> ${r}`; }
    if (r < prev) { monotone = false; worst = `${v} -> ${r}`; }
    prev = r;
  }
  check("the zoom rung is never BELOW the zoom it quantises", neverBelow, worst);
  check("the zoom rung is never more than one step above it", withinOneStep, worst);
  check("the zoom rung lands exactly on the lattice", onLattice, worst);
  check("the zoom rung is monotone in zoom", monotone, worst);

  // The discriminating half: the Math.round form this replaced FAILS the
  // one-sidedness pin, by up to half a step. Stated as a property of round
  // rather than a copy of the old code, so it cannot rot into agreement.
  let roundWouldFail = false;
  let maxShortfall = 0;
  for (const v of samples) {
    const rounded = Math.pow(2, Math.round(Math.log2(v) * q) / q);
    if (rounded < v * (1 - 1e-12)) {
      roundWouldFail = true;
      maxShortfall = Math.max(maxShortfall, 1 - rounded / v);
    }
  }
  check("...and that pin would fail against Math.round", roundWouldFail,
    `worst shortfall ${(maxShortfall * 100).toFixed(2)}% of the drawn zoom`);

  // Non-positive input is passed through rather than becoming NaN/-Infinity:
  // applyIconZoom hands this a scale that can legitimately be 0 mid-teardown.
  check("a non-positive zoom passes through untouched",
    snapToZoomLattice(0) === 0 && snapToZoomLattice(-3) === -3);
}

// ── reachY IS THE WHOLE VERTICAL HALF OF THE RULE (2.429.0) ─────────────────
// `conflicts` is per-axis: dx against reach, dy against reachY. An item that
// reaches the predicate with reachY unset therefore has its vertical
// requirement collapse to `max(gap, minSeparation)` — the tap pitch alone —
// and a VERTICALLY stacked pair stops colliding while it is visibly stacked.
//
// That is not hypothetical: pairFocusedRoom copied every field of its items
// except reachY, so a ceiling fan and the lamp under it never paired, because
// height projects almost entirely onto the screen's Y (badgeProjection sums
// height at cos-tilt onto the vertical). This pins the property so the omission
// cannot come back silently.
{
  const stacked = (reachY: number): PlacementItem[] => ([
    { sx: 0, sy: 0, sz: 0, reach: 40, reachY, rank: 0, sortKey: "a", category: "", room: "r", exempt: false },
    { sx: 0, sy: 60, sz: 0, reach: 40, reachY, rank: 1, sortKey: "b", category: "", room: "r", exempt: false },
  ]);
  // 60 px apart vertically, each drawn 40 px half-height: they overlap by 20.
  const [a1, b1] = stacked(40);
  check("a vertically stacked pair collides when reachY is carried",
    conflicts(a1, b1, 2, 24));
  // The same pair with reachY dropped: needY falls to the tap pitch (24) and
  // 60 > 24, so the predicate says "clear" about badges that visibly overlap.
  const [a0, b0] = stacked(0);
  check("...and does NOT when reachY is dropped — the 2.429.0 bug",
    !conflicts(a0, b0, 2, 24));
  // Horizontal reach alone cannot rescue it: that is why the failure was
  // invisible for pairs offset sideways and total for pairs offset vertically.
  check("dropping reachY leaves the HORIZONTAL answer unchanged",
    conflicts(
      { ...a0, sx: 0 }, { ...b0, sx: 30, sy: 0 }, 2, 24,
    ) === conflicts(
      { ...a1, sx: 0 }, { ...b1, sx: 30, sy: 0 }, 2, 24,
    ));
}

// ── The drawn-geometry cluster (badgeViewport) ─────────────────────────────
// ⚠️ FIVE STATED INVARIANTS, EVERY ONE A PAST FIELD DEFECT, and not one of
// them was executable until 2.945.0: the cluster was a ~250-line ribbon
// threaded through positions 4006, 6758 and 7794 of a 9,858-line Babylon class
// whose total contact with the engine was TWO SCALARS.
console.log("\n— badgeViewport: how big, and how many fit —");
{
  const vp = (o: Partial<BadgeViewport> = {}): BadgeViewport => ({
    renderWidthPx: 1600, hardwareScaling: 2, iconUserScale: 1, iconZoomScale: 1, ...o,
  });

  // ⚠️ INVARIANT 3: "phone" is read in CSS px, never render px. The resolution
  // valve moves the render width whenever the camera starts and stops.
  check("a device is a phone by its CSS width",
    isPhoneWidth(vp({ renderWidthPx: 780, hardwareScaling: 1 }), 820));
  // ⚠️ THE CASE INVARIANT 3 EXISTS FOR, and it only bites when the two
  // readings DISAGREE across the threshold. A 1024 CSS px tablet that the
  // resolution valve has coarsened to 2x renders at 512 device px — read in
  // render px it becomes a "phone" mid-gesture and regroups its badges for no
  // reason; read in CSS px it stays a tablet, which is what it is.
  const coarsenedTablet = vp({ renderWidthPx: 512, hardwareScaling: 2 });
  check("a tablet the valve coarsened is NOT a phone",
    !isPhoneWidth(coarsenedTablet, 820),
    `cssWidth ${cssWidthPx(coarsenedTablet)}, renderWidth 512`);
  check("…and its CSS width is what it always was",
    cssWidthPx(coarsenedTablet) === 1024);
  // And the mirror: a real phone the valve SHARPENED still reads as a phone.
  const sharpenedPhone = vp({ renderWidthPx: 1560, hardwareScaling: 0.5 });
  check("a phone the valve sharpened is STILL a phone",
    isPhoneWidth(sharpenedPhone, 820),
    `cssWidth ${cssWidthPx(sharpenedPhone)}, renderWidth 1560`);

  // ⚠️ THE DEVICE PIXEL RATIO MUST CANCEL. `hardwareScaling` above 1 is
  // COARSER, so the same 800 CSS px is 800 render px at 1x and 1600 at 0.5x —
  // and the budget, which the render width and the scale both carry, must come
  // out identical. (I got this pairing backwards on the first write and the
  // test caught it, which is the point of having one.)
  const budgetAt = (hw: number, px: number) =>
    cardBudget(vp({ renderWidthPx: px, hardwareScaling: hw }), 0.5);
  check("the width budget is a pure fraction of the screen, DPR cancelled",
    Math.abs(budgetAt(1, 800) - budgetAt(0.5, 1600)) < 1e-9,
    `${budgetAt(1, 800)} vs ${budgetAt(0.5, 1600)}`);
  check("…and a genuinely wider screen genuinely gets more room",
    budgetAt(1, 1600) > budgetAt(1, 800));

  check("cssToGui inverts hardware scaling", cssToGui(vp({ hardwareScaling: 2 })) === 0.5);
  check("a zero scaling level cannot divide by zero",
    Number.isFinite(cssToGui(vp({ hardwareScaling: 0 }))));
  check("effectiveScale multiplies all three",
    effectiveScale(vp({ hardwareScaling: 2, iconUserScale: 1.5, iconZoomScale: 2 })) === 1.5);

  // ⚠️ INVARIANT 5: down to 2 and no further. A group of two is ALWAYS the
  // full-size card, which is what the one-pass placement rests on.
  check("the cap never falls below a pair card",
    cellCapFor(1, 8, () => 999999) === 2);
  check("a generous budget keeps the full cap",
    cellCapFor(1e9, 8, (n) => n) === 8);
  // ⚠️ INVARIANT 2: MEASURED, not guessed — the cap asks the arrangement.
  check("the cap is the largest arrangement that fits",
    cellCapFor(4.5, 8, (n) => n) === 4, String(cellCapFor(4.5, 8, (n) => n)));
  check("a zero budget disables the cap rather than collapsing it",
    cellCapFor(0, 8, () => 999999) === 8);
}

console.log("\n— badgeBox: the footprint a neighbour is pushed away from —");
{
  const m = {
    badgeDiameterPx: 40, classicHalfHPx: 20, classicHalfHWithPillPx: 29,
    classicCyPx: -56, classicCyWithPillPx: -47,
    pillValueCharPx: 8, pillValuePadPx: 12,
    cardHeightPx: 28, cardPadLeftPx: 4, cardValueCharPx: 8, cardValuePadPx: 6,
  };
  const box = () => ({ halfW: 0, halfH: 0, cy: 0 });
  const at = (t: Parameters<typeof badgeBox>[1], card = false) =>
    badgeBox(box(), t, m, 1, card);

  // ⚠️ INVARIANT 4, AND THE FIELD REPORT BEHIND IT. A ceiling fan and its own
  // temperature sensor sit fine while both are pill-less — but when the fan
  // turns off and drops its pill, its box shrank while the sensor's did not,
  // so they were pushed apart LESS than before and ended up nearly touching.
  // Read by the owner as "the badge got smaller"; it was really "got less
  // clearance from its neighbour".
  const fanWithPill = at({ hasValue: true, valueLen: 3, pillCapable: true });
  const fanNoPill = at({ hasValue: false, valueLen: 0, pillCapable: true });
  const plainSensor = at({ hasValue: false, valueLen: 0, pillCapable: false });
  check("a pill-capable badge reserves the with-pill HEIGHT even with no pill",
    fanNoPill.halfH === fanWithPill.halfH, `${fanNoPill.halfH} vs ${fanWithPill.halfH}`);
  check("…and the with-pill CENTRE too",
    fanNoPill.cy === fanWithPill.cy);
  check("…so dropping a readout never changes a neighbour's clearance",
    fanNoPill.halfH === fanWithPill.halfH && fanNoPill.cy === fanWithPill.cy);
  check("a badge that can NEVER grow a pill is genuinely shorter",
    plainSensor.halfH < fanNoPill.halfH);
  // Only the WIDTH adapts to the actual text.
  check("width still adapts to the pill text",
    at({ hasValue: true, valueLen: 12, pillCapable: true }).halfW > fanWithPill.halfW);
  check("a narrow value never shrinks the box below the badge itself",
    at({ hasValue: true, valueLen: 1, pillCapable: true }).halfW
      === m.badgeDiameterPx / 2);

  // Card style.
  const card = at({ hasValue: true, valueLen: 6, pillCapable: true }, true);
  check("a card hangs exactly half a card above the anchor",
    card.cy === -(m.cardHeightPx / 2));
  check("a card with a value is wider than one without",
    card.halfW > at({ hasValue: false, valueLen: 0, pillCapable: true }, true).halfW);

  // Scale is applied to every dimension.
  const scaled = badgeBox(box(), { hasValue: false, valueLen: 0, pillCapable: true }, m, 2, false);
  check("every dimension carries the scale",
    scaled.halfH === fanNoPill.halfH * 2 && scaled.cy === fanNoPill.cy * 2
      && scaled.halfW === fanNoPill.halfW * 2);

  // ⚠️ Writes in place off the grow-only pool.
  const reused = box();
  check("the box is filled in place, not reallocated",
    badgeBox(reused, { hasValue: false, valueLen: 0, pillCapable: false }, m, 1, false) === reused);
}

// ── The placement oracle (placementCheck) ──────────────────────────────────
// ⚠️ THIS ORACLE HAS EXISTED FOR A YEAR AND HAS NEVER RUN IN CI. 300 lines of
// pairwise checks inside a 9,858-line Babylon class, reachable only on a
// device, only under `?debug=place`, only while a human was looking — and it
// guards the subsystem this app has rewritten SIX times.
console.log("\n— placementCheck: ink on ink —");
{
  const box = (cx: number, cy: number, hw = 10, hh = 10): ScreenBox => ({ cx, cy, hw, hh });
  const empty = {
    badges: [], badgeExempt: [], cards: [], cardInk: [], cardFocused: [],
    chips: [], minSepPx: 0,
  };

  check("two things either cover the same pixels or they don't",
    hits(box(0, 0), box(19, 0)) && !hits(box(0, 0), box(21, 0)));
  check("touching exactly is NOT overlapping", !hits(box(0, 0), box(20, 0)));

  check("off-screen overlap is not something anyone sees",
    !onScreen(box(-100, 0), { x: 0, y: 0, width: 800, height: 600 }));
  check("…but a box straddling the edge still counts",
    onScreen(box(-5, 0), { x: 0, y: 0, width: 800, height: 600 }));

  // (a) badge vs badge
  {
    const r = checkPlacement({ ...empty,
      badges: [box(0, 0), box(5, 0)], badgeExempt: [false, false] });
    check("two overlapping badges are the headline violation", r.overlaps === 1);
    const clear = checkPlacement({ ...empty,
      badges: [box(0, 0), box(100, 0)], badgeExempt: [false, false], minSepPx: 40 });
    check("clear badges do not overlap", clear.overlaps === 0);
    check("…but closer than the tap pitch is counted SEPARATELY",
      checkPlacement({ ...empty, badges: [box(0, 0), box(30, 0), box(200, 0)],
        badgeExempt: [false, false, false], minSepPx: 40 }).tooClose === 1);
  }

  // ⚠️ BUCKET, DO NOT DROP. Three counters in this file's history reported 0
  // for the exact case they existed to see, because an "expected" pair was
  // `continue`d instead of labelled.
  {
    const focused = checkPlacement({ ...empty,
      badges: [box(0, 0), box(5, 0)], badgeExempt: [true, false] });
    check("a focused-room overlap is NOT a violation", focused.overlaps === 0);
    check("…and is NOT invisible either — it has its own bucket",
      focused.focusOverlaps === 1);
  }

  // (b) badge vs card — the split is what makes the line actionable
  {
    const card = box(0, 0, 40, 12);
    const ink = box(0, 0, 12, 12);   // the inscribed square
    const buried = checkPlacement({ ...empty,
      badges: [box(0, 0)], badgeExempt: [false],
      cards: [card], cardInk: [ink], cardFocused: [false] });
    check("a badge under the card's INK is buried", buried.buried === 1);
    check("…and is not counted as an overhang too", buried.overhung === 0);
    const overhung = checkPlacement({ ...empty,
      badges: [box(30, 0)], badgeExempt: [false],
      cards: [card], cardInk: [ink], cardFocused: [false] });
    check("a badge under the card's OVERHANG is allowed, and labelled",
      overhung.overhung === 1 && overhung.buried === 0);
    const focusedCard = checkPlacement({ ...empty,
      badges: [box(0, 0)], badgeExempt: [false],
      cards: [card], cardInk: [ink], cardFocused: [true] });
    check("a FOCUSED card never went through fits, so it is bucketed",
      focusedCard.focusCardHits === 1 && focusedCard.buried === 0);
  }

  // (c) card vs card — the one clearance guarantee fits() makes
  {
    const r = checkPlacement({ ...empty,
      cards: [box(0, 0, 40, 12), box(50, 0, 40, 12)],
      cardInk: [box(0, 0, 12, 12), box(50, 0, 12, 12)], cardFocused: [false, false] });
    check("two cards that fits() cleared must never overlap", r.summaryOverlaps === 1);
    const focused = checkPlacement({ ...empty,
      cards: [box(0, 0, 40, 12), box(50, 0, 40, 12)],
      cardInk: [box(0, 0, 12, 12), box(50, 0, 12, 12)], cardFocused: [true, false] });
    check("…while two focused pair-cards CAN, and say so",
      focused.summaryOverlaps === 0 && focused.summaryFocusOverlaps === 1);
  }

  // (d) the tier of last resort
  {
    const r = checkPlacement({ ...empty,
      badges: [box(0, 0)], badgeExempt: [false], chips: [box(5, 0, 30, 12)] });
    check("a badge over a room chip is a violation", r.chipHits === 1);
    const focused = checkPlacement({ ...empty,
      badges: [box(0, 0)], badgeExempt: [true], chips: [box(5, 0, 30, 12)] });
    check("…and a FOCUSED one is expected, but still counted",
      focused.chipHits === 0 && focused.chipHitsFocused === 1);
    check("a card over a chip counts too",
      checkPlacement({ ...empty, cards: [box(0, 0, 40, 12)],
        cardInk: [box(0, 0, 12, 12)], cardFocused: [false],
        chips: [box(5, 0, 30, 12)] }).chipHits === 1);
  }

  // (e) chip vs chip — the merge reaching a fixpoint
  check("two overlapping chips mean the merge did not converge",
    checkPlacement({ ...empty, chips: [box(0, 0, 30, 12), box(20, 0, 30, 12)] })
      .chipPairs === 1);
  check("…and separated chips are clean",
    checkPlacement({ ...empty, chips: [box(0, 0, 30, 12), box(200, 0, 30, 12)] })
      .chipPairs === 0);

  // The clean layout: nothing anywhere.
  {
    const clean = checkPlacement({ ...empty,
      badges: [box(0, 0), box(200, 0)], badgeExempt: [false, false],
      cards: [box(0, 400, 40, 12)], cardInk: [box(0, 400, 12, 12)], cardFocused: [false],
      chips: [box(600, 0, 30, 12)], minSepPx: 40 });
    check("a clean layout reports zero on every counter",
      Object.values(clean).every((n) => n === 0), JSON.stringify(clean));
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
