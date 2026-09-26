// src/babylon/roomZoomSolver.ts
// "Tap a room, see its devices": the closest camera radius at which every one
// of a room's badges lands FULLY on screen, searched on the renderer's own zoom
// ladder — and whether that shot also draws them apart.
//
// ⚠️ THREE RELEASES SHIPPED A WRONG VERSION OF THIS "because the only test
// available was a person tapping a room chip on a phone" (its docstring, in
// EntityVisuals). It took plain view numbers all along and only its badge list
// came from the class, so the ladder is here now, pure, and
// tests/oracles/room_zoom.mjs replays the cases those releases got wrong.
// EntityVisuals.solveRoomZoomRadius measures the badges and calls this.
//
// PURE — badgeProjection, badgePlacement and badgeScale import nothing heavy.

import { projectToView, exactViewBasis, type ViewBasis } from "./badgeProjection";
import { markContacts, createPlacementScratch, type PlacementItem, type PlacementScratch } from "./badgePlacement";
import { rungAt } from "./badgeScale";
import { GROUP_ZOOM_STEPS_PER_DOUBLING } from "./badgeMetrics";

// ── Zoom-to-room framing (roomWallFit) ──────────────────────
// How much of the BINDING SCREEN AXIS the room's own footprint should occupy.
//
// ── A ROOM IS SHOWN WITH ITS SURROUNDINGS, NOT EDGE TO EDGE (2.426.0) ───────
// This was a margin — 0.18, i.e. the footprint filled 85% of the axis — and it
// was reported as bad UX with four screenshots: the pool filled the glass
// corner to corner with no context at all, and the living room cropped its own
// curtains off the sides. The user then dragged to the shot they wanted and the
// log recorded it, twice: rung 271.223 -> ~152, and rung 170.860 -> ~117. Both
// asked for 1.5-1.8x more room around the subject.
//
// Restated as a FRACTION because that is the decision actually being made —
// "how much of the frame is the room" — and because it is then the same
// vocabulary as CHIP_MAX_VIEWPORT_FRACTION and CARD_MAX_VIEWPORT_FRACTION,
// which answer the same shape of question for the other two composite objects.
//
// ⚠️ It is applied AFTER the per-axis max, so it is a property of whichever
// axis binds — which is what makes one number behave identically on a portrait
// phone, a landscape laptop and a tablet either way. A margin expressed against
// one axis, or against the footprint's diagonal, is the 2.362.0 bug: the same
// room wanted radius 36 at one aspect and 51 at another.
//
// The entity-bounds fallback takes a SMALLER fraction (a wider shot), because
// device anchors sit inside the room rather than at its walls, so their box
// under-states it and the shot has to cover what the box does not describe.
export const ROOM_FIT_VIEWPORT_FRACTION = 0.6;
export const ROOM_FIT_VIEWPORT_FRACTION_ENTITIES = 0.45;
// Floor under the fitted radius, for a "room" that measures as a point (a
// single device, or a one-entity teleport spot) and would otherwise ask the
// camera to fly arbitrarily close. Expressed in world units = metres.
export const MIN_ROOM_FIT_RADIUS = 1.5;
// NOTE for anyone tempted to add a tuning constant back here: two used to
// live at this spot and both are gone (2.209.0).

/** One eligible badge, measured as the DECISION will see it (icon-only, at
 *  the destination's scale). Every eligible badge in the villa, not just the
 *  room's: a pile can span rooms, and a neighbour touching the room's badge
 *  sends it back to a chip. */
export interface ZoomBadge {
  /** Its anchor, world space. */
  wx: number; wy: number; wz: number;
  /** Whether it is one of the tapped room's — only those must be in frame. */
  mine: boolean;
  /** Its drawn box, GUI px: half extents, and how far it hangs above the anchor. */
  halfW: number; halfH: number; cy: number;
}

export interface ZoomView {
  /** Render-target height and width, px. */
  vpH: number; vpW: number;
  /** Vertical field of view, radians. */
  vFov: number;
  /** The DESTINATION's view plane, UNQUANTISED — what "on screen" is asked in. */
  frame: ViewBasis;
  /** The destination's QUANTISED basis — what grouping (the contact test) is asked in. */
  grouping: ViewBasis;
  /** The shot's orbit centre. */
  cx: number; cy: number; cz: number;
  /** Search bounds, world units. */
  minRadius: number; maxRadius: number;
}

/** The separation rules the renderer will apply at the destination. */
export interface ZoomSpacing {
  /** Minimum gap between boxes, GUI px. */
  gapPx: number;
  /** Minimum centre-to-centre pitch, GUI px (the accessibility floor). */
  minSepPx: number;
  /** Fraction of a box's half-extent that counts as reach (1 − overlap allowed). */
  allow: number;
}

/** Returns null with fewer than two of the room's badges, or no rung that
 *  frames them; else the widest framing rung, and whether any rung drew the
 *  room's badges apart (advisory — the focused room's badges are exempt from
 *  grouping and drawn individually wherever the shot lands). */
export function solveRoomZoom(
  members: readonly ZoomBadge[], view: ZoomView, spacing: ZoomSpacing,
  scratch: PlacementScratch = createPlacementScratch(),
): { radius: number; declutters: boolean } | null {
  if (!(view.vpH > 0) || !(view.vpW > 0) || !(view.vFov > 0)) return null;
  if (members.filter((m) => m.mine).length < 2) return null;
  const n = members.length;
  // Solver input, built once and re-projected per rung. The loop INVERTED in
  // 2.287.0: `reach` used to be the rung-dependent term and the anchors fixed.
  // Now `reach` is a drawn pixel count that no rung can change, and the plane
  // coordinates scale with that rung's pxPerWorld — so the plane offsets are
  // precomputed once in world units here and multiplied through below.
  //
  // The basis is the DESTINATION's, and since 2.325.0 that is no longer the
  // live one: computeRoomOverviewPose keeps the current alpha but forces beta
  // to the camera's top-down limit, so the ladder MUST be walked through the
  // direction the camera will arrive at, not the one it is leaving. It is
  // handed in (view.grouping) for exactly that reason. markContacts below is then the SAME test the
  // renderer will run — a rung that predicted a clean shot under different
  // geometry from the one that draws it is the bug this whole solver was
  // written to avoid. `fromCentre` above stays in real world units: framing a
  // room is a 3D question, not a screen-overlap one.
  // Its own object per member, not the frame loop's shared scratch: these
  // have to survive the whole rung walk. This runs once per tap, so the
  // allocation is not on any hot path.
  const plane = members.map(
    (mm) => projectToView(view.grouping, mm.wx, mm.wy, mm.wz, { px: 0, py: 0, pz: 0, pd: 0 }));
  const items: PlacementItem[] = members.map(() => ({
    sx: 0, sy: 0, sz: 0,
    // rank/sortKey/category/room are unused by markContacts (it is a
    // symmetric contact sweep, not the ranked solve, and it never runs the
    // pull-back) — only the geometry matters here.
    reach: 0, reachY: 0, rank: 0, sortKey: "", category: "", room: "", exempt: false,
  }));
  // Each anchor's offset from the shot's centre, ON THE DESTINATION'S VIEW
  // PLANE, in world units — one coordinate per SCREEN axis. Only THIS room's
  // badges have to be in frame: a neighbour's badge sitting off screen is
  // fine and expected, and demanding it be visible would push every shot out
  // to frame the whole villa.
  //
  // This was a single radial `hypot` against one half-extent until 2.364.0,
  // which is a circle inscribed in the frame — it asks a badge near the top
  // of a tall portrait screen to be as close to centre as one near the side,
  // and so held the camera at the same distance the isotropic wall fit did.
  // A screen has two axes and a badge box has two half-extents; both are
  // tested separately here.
  const framePlane = members.map((m) =>
    projectToView(view.frame, m.wx - view.cx, m.wy - view.cy, m.wz - view.cz,
      { px: 0, py: 0, pz: 0, pd: 0 }));
  const mine: number[] = [];
  for (let i = 0; i < n; i++) if (members[i].mine) mine.push(i);

  const q = GROUP_ZOOM_STEPS_PER_DOUBLING;
  const tanV = Math.tan(view.vFov / 2);
  // The frame's own half-extents, in the same drawn pixels the badge boxes
  // are measured in — so the test is literally "is this box on the glass".
  const halfWpx = view.vpW / 2;
  const halfHpx = view.vpH / 2;
  // Walk the rungs from CLOSEST outward and take the first that works, so the
  // answer is the tightest shot rather than merely a valid one.
  const lo = Math.max(view.minRadius, 0.1);
  const hi = Math.max(lo, view.maxRadius);
  const kLo = Math.floor(Math.log2(lo) * q);
  const kHi = Math.ceil(Math.log2(hi) * q);
  let widestFitting: number | null = null;
  // ── The two conditions pull in OPPOSITE directions, and that is the whole
  //    shape of this problem ────────────────────────────────────────────
  // `fits` (every badge on screen) gets easier as the camera backs off: the
  // world-space frame grows while a badge stays the same pixel size. `clean`
  // (no badge touching another) gets easier as it comes in: separations are
  // world-space and scale with pxPerWorld while the clearance is fixed
  // pixels. So each holds on one side of a threshold, and there are two
  // cases — they overlap, or they do not.
  //
  // Until 2.365.0 a rung that failed `fits` was skipped before `clean` was
  // ever evaluated, which silently made framing the hard constraint and
  // decluttering a hope. When the two did not overlap the shot landed on the
  // closest rung that framed every badge — reported as "I click the room and
  // then have to zoom in a little more myself", with the badges arriving as
  // a cluster of grouped cards and separating into readable ones a rung or
  // two closer. That is the opposite of this solver's stated purpose, and of
  // the comment in computeRoomOverviewPose promising that a room whose badges
  // only separate at maximum zoom is taken to maximum zoom.
  //
  // So `clean` is now evaluated at EVERY rung, and framing is the preference
  // it was written to be:
  //   * both hold somewhere → the WIDEST such rung (see below);
  //   * they never overlap → the WIDEST clean rung, i.e. the readable shot
  //     that crops least. A device at the room's edge may hang off the frame;
  //     that beats every device in the room being illegible;
  //   * nothing is clean at any zoom → the WIDEST framing rung.
  //
  // ── EVERY BRANCH TAKES THE WIDEST, AND THAT IS THE FIX (2.424.0) ───────
  // All three used to take the TIGHTEST qualifying rung, so the shot was
  // framed on the BADGES and the room's own footprint entered only as
  // `maxRadius` — a bound the search never had to reach. Tapping a room with
  // two devices near its middle therefore dived past the room to whatever
  // distance those two badges happened to need, which is "the zoom is acting
  // very poorly, it is zooming on the entities and not the room".
  //
  // The search interval is [minRadius, wallFit], so taking the WIDEST rung
  // that still satisfies the predicates means exactly: FRAME THE ROOM, and
  // come closer only as far as the badges actually force. Decluttering stays
  // a hard requirement in the first branch — this does not reopen 2.365.0,
  // where a rung was accepted with the badges still grouped — it only stops
  // buying more zoom than legibility asked for.
  //
  // It also retires, by description rather than by a cap, the symptom the
  // note above MIN_ROOM_FIT_RADIUS records: a fan and its own light kit
  // driving the camera point-blank onto a bed. 2.209.0 removed
  // DECLUTTER_RADIUS_MIN_FRACTION for capping that at half the wall fit and
  // was right that the cap was the wrong description. The right one is that
  // no rung tighter than the room's own fit was ever wanted.
  let widestClean: number | null = null;
  for (let k = kLo; k <= kHi; k++) {
    const radius = Math.pow(2, k / q);
    if (radius < lo || radius > hi) continue;
    // The zoom the renderer will actually quantise to at this radius — and
    // now genuinely so. This read `Math.round` while the renderer has used
    // `Math.ceil` since 2.407.0, so the rung this loop tested was up to 2.9%
    // below the one that would be drawn (/dry-audit, 2.425.0). One function,
    // every walker of the lattice.
    // badgeScale.rungAt — the same function the renderer's rung is.
    const pxPerWorld = rungAt(view.vpH, tanV, radius);
    if (!(pxPerWorld > 0)) continue;

    // Every badge fully inside the frame? Per screen axis, in drawn pixels,
    // against the box the renderer will actually paint — including the `cy`
    // by which it hangs above its anchor, which is asymmetric and so cannot
    // be folded into a single radial reach.
    let fits = true;
    for (const i of mine) {
      const sx = framePlane[i].px * pxPerWorld;
      const sy = framePlane[i].py * pxPerWorld + members[i].cy;
      if (Math.abs(sx) + members[i].halfW > halfWpx
        || Math.abs(sy) + members[i].halfH > halfHpx) { fits = false; break; }
    }
    if (fits) widestFitting = radius;

    // Is every badge of THIS room drawn on its own here? "Clear of every
    // other eligible badge" is the exact test — against neighbours from
    // other rooms too, since those are what put the room back in a chip.
    //
    // markContacts, not a copy of its arithmetic: whatever decides a thing
    // must BE the thing that does it, and a rung solver that promised a shot
    // the renderer then declined is a bug this file has already produced.
    // Its own scratch, because the layout pass may be holding a live result
    // from the shared one (see PlacementResult).
    for (let i = 0; i < n; i++) {
      items[i].sx = plane[i].px * pxPerWorld;
      // `cy` here for the same reason placementItems adds it: the box the
      // renderer paints hangs above the anchor, by an amount that differs
      // between badges. This ladder must run the identical test.
      items[i].sy = plane[i].py * pxPerWorld + members[i].cy;
      items[i].sz = plane[i].pz * pxPerWorld;
      items[i].reach = members[i].halfW * spacing.allow;
      items[i].reachY = members[i].halfH * spacing.allow;
    }
    const touching = markContacts(items, spacing.gapPx, spacing.minSepPx, scratch);
    let clean = true;
    for (const i of mine) if (touching[i]) { clean = false; break; }
    // The rungs ascend, so the last write is the widest clean one. Recorded
    // rather than derived from a threshold: `clean` is very nearly monotone
    // in radius but not exactly, because pxPerWorld is quantised onto the
    // renderer's ladder, and taking the widest rung that actually tested
    // clean is correct either way.
    // Recorded for the ADVISORY flag only — it no longer selects. The rungs
    // ascend, so the last write is the widest.
    if (clean) widestClean = radius;
  }

  // ── `clean` NO LONGER SELECTS THE SHOT, BECAUSE IT CANNOT FIRE (2.426.0) ─
  // Reported: tapping a room lands far too close — the pool filled the glass
  // edge to edge, the living room cropped its own curtains off the sides.
  // Measured from two taps: rung 271.223 where the user then settled at ~152,
  // and rung 170.860 where they settled at ~117. Consistently 1.5-1.8x too
  // close, and `clean` is what did it: it gets EASIER as the camera comes in,
  // so making it a requirement drags the shot toward the camera.
  //
  // And it is measuring a rule that CANNOT FIRE for a focused room:
  //
  //   * every OTHER room is chipped for the focus — the same captures show
  //     `chipWhy: focus=10 total=10`, all ten of them — so there are no
  //     other rooms' badges left on screen to collide with;
  //   * the focused room's OWN badges are EXEMPT from grouping, and
  //     pairFocusedRoom draws them individually or as pair-cards.
  //
  // The captures prove the exemption had already delivered it at the shot the
  // old code chose: `exempt=9 drawn=7 focusGroups=1` (a 2-cell card) accounts
  // for all nine pool devices, and `exempt=17 drawn=9 focusGroups=4` for all
  // seventeen living-room ones. Every device was already drawn. The declutter
  // search bought nothing and cost 1.5-1.8x of zoom.
  //
  // This solver's own docstring already contains the argument, applied to the
  // OTHER branch: "ONE room only. With several, the wall fit IS the answer...
  // The badges are not left to chance either — the EXEMPTION above is
  // unconditional and is what guarantees they are drawn individually, at
  // whatever distance the framing lands on." That reasoning holds verbatim
  // for one room. It was applied to merged chips and not to a single room.
  //
  // What remains is a genuine framing guarantee — every one of the room's
  // badges fully on screen — and `fits` gets easier as the camera backs off,
  // so the widest such rung is the room's own fit whenever it is reachable.
  // `declutters` stays as the ADVISORY it already was (SceneManager: "it says
  // whether the shot also separates the badges or merely frames them. Either
  // way they are drawn"), so nothing downstream loses information.
  return widestFitting === null
    ? null
    : { radius: widestFitting, declutters: widestClean !== null };
}


/** A room's floor-plan footprint on the ground, and its floor. */
export interface RoomBounds { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number }

/**
 * The WALL FIT: the camera radius at which a room's footprint fills
 * ROOM_FIT_VIEWPORT_FRACTION of the binding screen axis, seen from the shot's
 * destination (`alpha` kept, `beta` the camera's top-down limit) — the upper
 * bound the rung ladder (solveRoomZoom) searches below. `real` is whether every
 * room had a wall polygon; entity-anchor bounds take the wider fraction.
 *
 * Pure since 2.496.102; it was the half of the room shot that stayed inside
 * SceneManager when the ladder moved here (tests/oracles/room_zoom.mjs).
 */
export function roomWallFit(
  bounds: RoomBounds, real: boolean,
  view: { alpha: number; beta: number; vFov: number; hFov: number },
): {
  cx: number; cz: number; radius: number; halfW: number; halfH: number;
  destDir: { x: number; y: number; z: number }; frame: ViewBasis;
} {
  const fitFrac = real ? ROOM_FIT_VIEWPORT_FRACTION : ROOM_FIT_VIEWPORT_FRACTION_ENTITIES;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const { vFov, hFov } = view;
  const scratch = { px: 0, py: 0, pz: 0, pd: 0 };
    // Babylon puts an ArcRotateCamera at target + r(cos α sin β, cos β,
    // sin α sin β), so the direction it LOOKS is the negated unit offset. At
    // view.beta this is very nearly straight down, which is the whole point —
    // and it is what the badge ladder below has to measure through.
    const sb = Math.sin(view.beta);
    const destDir = {
      x: -Math.cos(view.alpha) * sb,
      y: -Math.cos(view.beta),
      z: -Math.sin(view.alpha) * sb,
    };

    // ── Fit the room's footprint AS PROJECTED, per screen axis ─────────────
    // This used to fit a bounding SPHERE (half the footprint diagonal) inside
    // the TIGHTER of the two field-of-view angles. Both halves of that are
    // rotation-invariant, and on a portrait phone they compound into a shot
    // that is dramatically too far out: the horizontal FOV is the tight one, so
    // the room was pushed back until its DIAGONAL fitted the screen's SHORT
    // axis, and the tall axis — most of the glass — was left empty.
    //
    // Measured, not argued (v2.362.0 telemetry): the same Living Room reports a
    // bounding sphere of 7.157 m on a 704x845 tablet, 7.151 m on a 932x616
    // tablet and 7.157 m on a 475x661 phone — the room is identical, and every
    // difference in the resulting shot was the formula. Swimming Pool wanted
    // radius 36.05 at aspect 0.719 and 51.13 at aspect 0.495: 42% further out
    // on the iPhone for the same room, which is the "zoom level is too low"
    // that was reported from it.
    //
    // The destination pose is known exactly by this point, so there is nothing
    // to be invariant to. Project the footprint's four corners onto the view
    // plane and fit each screen axis against its OWN half-angle. `tan`, not
    // `sin`: a floor seen from above is a plane facing the camera, and the
    // distance at which a plane's half-extent subtends a half-angle is
    // extent/tan. `sin` is the tangent-sphere form, and is the more
    // conservative of the two by 1/cos — small next to the anisotropy, but it
    // was wrong in the same direction.
    const frame = exactViewBasis(destDir.x, destDir.y, destDir.z, "plane");
    let halfW = 0;
    let halfH = 0;
    for (const px of [bounds.minX, bounds.maxX]) {
      for (const pz of [bounds.minZ, bounds.maxZ]) {
        // Relative to the orbit centre, which is what the frame is centred on.
        // The projection is linear, so the projected corners bound the whole
        // footprint exactly — no corner can escape a frame that holds all four.
        const p = projectToView(frame, px - cx, 0, pz - cz, scratch);
        halfW = Math.max(halfW, Math.abs(p.px));
        halfH = Math.max(halfH, Math.abs(p.py));
      }
    }
    // Per axis against its OWN half-angle, THEN the context fraction — see
    // ROOM_FIT_VIEWPORT_FRACTION for why that order is what makes one number
    // correct on every aspect ratio.
    const radius = Math.max(
      halfW / Math.tan(hFov / 2),
      halfH / Math.tan(vFov / 2),
      MIN_ROOM_FIT_RADIUS,
    ) / fitFrac;

  return { cx, cz, radius, halfW, halfH, destDir, frame };
}
