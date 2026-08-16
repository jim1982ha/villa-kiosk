// src/babylon/badgePlacement.ts
// Decides which badges are drawn at their own anchors and which fall back to a
// summary. Pure: no Babylon, no scene, no DOM, no time — sibling to
// labelLayout.ts and held to the same discipline.
//
// ── The invariant this file exists to protect ──────────────────────────────
// The output is a pure function of (world anchor positions projected through a
// QUANTISED view direction and a QUANTISED zoom — see babylon/badgeProjection —
// and each item's STATIC rank). Where the camera STANDS appears nowhere: an
// orthographic projection of a difference vector is invariant to it. And no
// previous frame's result is an input — `solvePlacement` takes no
// previous-frame argument at all, so a "keep last frame's winner" stabiliser
// is not merely discouraged, it is inexpressible.
//
// That is not stylistic. Six rewrites of this subsystem failed by testing
// overlap in true PERSPECTIVE screen space, which made grouping a function of
// the whole camera pose: panning silently regrouped rooms, and the hysteresis
// added to damp the resulting flicker made the result depend on the PATH taken
// rather than the destination — so returning to the exact view you started
// from did not restore what you started with. EntityVisuals' header has the
// full account. Hysteresis cannot fix path-dependence; it IS path-dependence.
//
// 2.287.0 admitted the camera's view DIRECTION (not its position) because no
// correct measure of "do these two overlap on the glass" can be blind to which
// way the villa is being looked at — badgeProjection sets out what that buys
// and what it costs.
//
// ── Union-find is kept, but demoted ───────────────────────────────────────
// The predicate that unions two badges is the SAME predicate that later
// decides whether one can be accepted next to another (`conflicts`). So any
// two badges that can conflict are necessarily in one connected component,
// which buys two things:
//
//   * a badge in no pile conflicts with nothing and is accepted outright;
//   * greedy acceptance inside a pile only ever has to test against other
//     members of THAT pile — there is no global scan and no cross-pile
//     cascade to reason about.
//
// So union-find no longer decides what draws. It decides who competes — and,
// since 2.250.0, who SUMMARISES TOGETHER: a deferral bucket is keyed by pile
// rather than by room, so the badge a loser is drawn with is the badge it
// actually lost to. See step 5 for the whole-room collapse that keying by room
// was causing.

/** One badge offered to the solver. */
export interface PlacementItem {
  /** The anchor PROJECTED ONTO THE VIEW PLANE, in GUI pixels — see
   *  babylon/badgeProjection. THE input, and deliberately not a scene
   *  coordinate: everything measured against it is a distance on the glass,
   *  and a metre of height, a metre of depth and a metre across the view are
   *  each drawn at a different length.
   *
   *  `sz` is a RESIDUAL, zero under the orbit camera. It carries the along-view
   *  axis for the walk camera only, where orthographic's small-angle assumption
   *  fails because the camera stands inside the badge cloud (projectToView says
   *  why, with the worked case). Nothing in this file needs to know which mode
   *  is live: it is one projection at the boundary, and `conflicts`, the
   *  spatial hash and the pull-back all inherit it.
   *
   *  Do NOT use these coordinates to position anything in the scene. */
  sx: number;
  sy: number;
  sz: number;
  /** The badge's drawn half-WIDTH, in the same GUI pixels as `sx`/`sy` — no
   *  conversion, because both sides of every comparison are already on the
   *  glass. */
  reach: number;
  /** The badge's drawn half-HEIGHT, same units. Separate from `reach` since
   *  2.406.0, because collapsing a rectangle to one radius is exactly how the
   *  card tier (2.405.0) and the chip tier (2.287.0) each over-grouped before
   *  their own box fixes — a badge with a value readout is far wider than
   *  tall, and judging its VERTICAL clearance by its WIDTH grouped stacked
   *  neighbours that visibly did not touch. */
  reachY: number;
  /** Static placement rank; LOWER is placed first (see badgePriority). */
  rank: number;
  /** Total, locale-independent tiebreak — the entity_id. */
  sortKey: string;
  /**
   * The device's category, as a TIEBREAK and never as a gate.
   *
   * Nothing about who groups with whom is decided here and nothing may be: a
   * summary exists because its members overlap, and who overlaps whom is a
   * connected-component partition with no freedom in it. The one place a
   * preference is expressible is the lone-deferral pull-back below, which
   * genuinely chooses among several pile-mates that all satisfy the same
   * bound — and there, all else near-equal, a light is a better partner for a
   * light than a camera is.
   */
  category: string;
  /** roomKey() form, never a raw name. Buckets deferrals and keys chips. */
  room: string;
  /** The focused room's badges: accepted unconditionally, AND never counted
   *  as a blocker for anyone else. "Tap a room, see its devices" is a promise
   *  the layout is not allowed to renegotiate. */
  exempt: boolean;
}

/** Badges that could not be drawn, gathered into one summary badge. */
export interface DeferralBucket {
  /** The bucket's PRIMARY roomKey — `rooms[0]`, i.e. the lowest in byte order.
   *  Names the group and keys its controls. A bucket may span rooms (see
   *  `rooms`), in which case this is one of several and the caller marks it. */
  room: string;
  /**
   * Every roomKey represented, sorted, unique. Length 1 is the common case.
   *
   * A bucket used to be one room BY CONSTRUCTION, because deferrals were
   * bucketed by room. That rule cost far more than it protected: a badge that
   * lost to a neighbour ACROSS a room boundary had no room-mate to summarise
   * with, so it fell through to "a bucket of one has nothing to summarise
   * with" and took its entire room to the chip — including badges metres away
   * that had conflicted with nothing at all. Reported as "the whole Living
   * Room becomes one chip and there is obviously space for the icons".
   *
   * Buckets are keyed by PILE now, so the partner a loser summarises with is
   * the badge it actually lost to, whatever room that is in. See solvePlacement
   * step 5.
   */
  rooms: string[];
  /** Stable identity across frames: the lowest sortKey of the whole PILE, not
   *  of the surviving members, so the group's GUI controls are not rebuilt
   *  (and do not flicker) when membership shifts by one at a zoom step. */
  pileKey: string;
  /** Indices into the input array. Always ≥ 2 — see solvePlacement. */
  members: number[];
}

/** Counters for `?debug`. Costs a handful of increments; never read otherwise. */
export interface PlacementStats {
  items: number;
  exempt: number;
  piles: number;
  accepted: number;
  /** Lost their own anchor in the greedy pass, before any pull-back. */
  deferred: number;
  /** Accepted badges dragged back into a bucket of one (step 6). */
  pulledBack: number;
  buckets: number;
  /** Of `buckets`, how many span more than one room — the case that used to
   *  be impossible and used to cost a whole room its badges. */
  crossRoom: number;
  chipRooms: number;
  /** Of the buckets killed in step 7, how many died because pruning left them
   *  with fewer than two members — the DEGENERATE half of the kill test, and
   *  the monotone one. */
  chipDegenerate: number;
  /** …and how many died because they held more devices than the renderer can
   *  draw as cells. Since 2.406.0 an oversized bucket SPLITS into cliques
   *  (step 6b) instead of dying, so this is only reachable when drawableMax
   *  is below 2 — a live value here on an ordinary pass means the split was
   *  bypassed, which is itself the finding. */
  chipUndrawable: number;
}

/**
 * ⚠️ EVERY array in here is POOLED and belongs to the scratch that produced
 * it. The next `solvePlacement` call on the SAME scratch overwrites all of
 * them in place, so a result must be consumed before the next solve — or the
 * caller must own a separate scratch. `solveRoomZoomRadius` solves ~40 rungs
 * inside one tap while `cullLabels` holds a live result, which is exactly why
 * they do not share one.
 */
export interface PlacementResult {
  /** 1 = draws at its own anchor. Length = items.length. */
  accepted: Uint8Array;
  /** Live entries of the pooled bucket array — read `buckets[i]` for
   *  `i < bucketCount` and ignore the rest. */
  buckets: DeferralBucket[];
  bucketCount: number;
  /** roomKeys that must fall all the way to their chip. Sorted. */
  chipRooms: string[];
  /** `?debug` counters — see PlacementStats. */
  stats: PlacementStats;
}

/** Reusable working set. One per caller — see solvePlacement. */
export interface PlacementScratch {
  parent: Int32Array;
  order: Int32Array;
  accepted: Uint8Array;
  deferred: Int32Array;
  cells: Map<number, number[]>;
  piles: number[][];
  pileIdx: Int32Array;
  buckets: DeferralBucket[];
  /** pile index → bucket index, or -1. Buckets are keyed by pile. */
  pileBucket: Int32Array;
  bucketDead: Uint8Array;
  chipRooms: string[];
  chipped: Set<string>;
  contacts: Uint8Array;
  stats: PlacementStats;
}

export function createPlacementScratch(): PlacementScratch {
  return {
    parent: new Int32Array(0),
    order: new Int32Array(0),
    accepted: new Uint8Array(0),
    deferred: new Int32Array(0),
    cells: new Map(),
    piles: [],
    pileIdx: new Int32Array(0),
    buckets: [],
    pileBucket: new Int32Array(0),
    bucketDead: new Uint8Array(0),
    chipRooms: [],
    chipped: new Set(),
    contacts: new Uint8Array(0),
    stats: {
      items: 0, exempt: 0, piles: 0, accepted: 0, deferred: 0,
      pulledBack: 0, buckets: 0, crossRoom: 0, chipRooms: 0,
      chipDegenerate: 0, chipUndrawable: 0,
    },
  };
}

/**
 * Do these two badges' drawn footprints leave less than the required clear
 * space between them?
 *
 * THE definition — grouping, group placement and solveRoomZoomRadius all call
 * this one function rather than keeping copies, because whatever decides a
 * thing must be the thing that does it. A rung solver that promised a shot the
 * renderer then declined is a bug this file has already produced once.
 *
 * `minSeparation` is a floor on centre-to-centre distance regardless of how
 * small the badges are drawn: two controls stop being independently tappable
 * once their touch targets merge, whatever their painted size (badgeMetrics'
 * `minCentrePitchPx` derives the number from Material and WCAG).
 */
export function conflicts(
  a: PlacementItem,
  b: PlacementItem,
  gap: number,
  minSeparation: number,
  /** Inflates both requirements uniformly. 1 asks "do they collide"; the
   *  lone-deferral pull-back asks with PULLBACK_REACH_FACTOR to mean "close
   *  enough to summarise with". One predicate, one knob — not two copies. */
  scale = 1,
): boolean {
  // ── THE RULE, and the only one: TWO THINGS COLLIDE WHEN THEIR DRAWN BOXES,
  // INFLATED BY THE GAP AND FLOORED BY THE TAP PITCH, INTERSECT ON THE GLASS.
  // Axis-aligned, against each thing's own drawn extents — the same test the
  // chip tier has used since 2.287.0 and the card tier since 2.405.0. This
  // tier was the last one still collapsing the rectangle to a single radius
  // (`reach`, the half-WIDTH) and comparing a scalar distance against it:
  // a disc test, over-grouping every vertical stack by width-over-height and
  // every diagonal by up to √2. At icon 2.00x that margin is ~a full zoom
  // rung, reported as "entities group while there is clearly space left"
  // (sources/files/move.mov: one lattice step flips drawn=25 to drawn=1).
  //
  // Every axis arrives already drawn — height at cos(tilt), depth at
  // sin(tilt), SUMMED onto the screen's vertical rather than added in
  // quadrature (see badgeProjection). `sz` is zero under the orbit camera; on
  // the walk camera it is the along-view residual, folded into the HORIZONTAL
  // term because there it is a ground-plane axis exactly as `sx` is — so the
  // orbit camera gets the exact box test and the walk camera gets ground
  // distance against width plus height against height, which is the same
  // sentence with its axes named honestly.
  const dh2 = (b.sx - a.sx) * (b.sx - a.sx) + (b.sz - a.sz) * (b.sz - a.sz);
  const needX = scale * Math.max(a.reach + b.reach + gap, minSeparation);
  if (dh2 >= needX * needX) return false;
  const needY = scale * Math.max(a.reachY + b.reachY + gap, minSeparation);
  return Math.abs(b.sy - a.sy) < needY;
}

/**
 * How far a lone deferral may reach for a room-mate to summarise WITH, as a
 * multiple of the distance at which the two would have conflicted.
 *
 * 2 puts the pair's centroid within roughly one badge width of each of them,
 * so the summary reads as standing for those two devices. Larger and it starts
 * pointing at empty floor; smaller and almost nothing pairs, so ordinary
 * cross-room crowding would fall to a room chip it does not need.
 */
const PULLBACK_REACH_FACTOR = 2;
/**
 * How much further a SAME-CATEGORY pile-mate may be and still win the
 * lone-deferral pull-back. Squared distances are compared, so 1.25 is about
 * 12% in length.
 *
 * Small on purpose. The preference is cosmetic — it makes a rescued pair read
 * as one thing rather than two unrelated ones — and the geometry is not: the
 * summary is drawn at its two members' centroid, so every pixel of extra
 * distance moves the card away from the device that was actually crowded out.
 * 1 disables the preference exactly.
 */
const PULLBACK_SAME_CATEGORY_SLACK = 1.25;

/** Byte order, never localeCompare: collation is environment-dependent, so a
 *  locale-sensitive sort would let two clients order the same pile
 *  differently — a purity leak across devices rather than across frames. */
function byteLess(a: string, b: string): boolean {
  return a < b;
}

/**
 * Which badges are in direct contact with at least one other — the tier 1 → 2
 * test, where a crowded badge drops its READOUT before anything is summarised.
 *
 * Deliberately NOT the greedy solve: no priority, no acceptance, just symmetry.
 * A badge whose neighbour is close enough that one of them must lose its
 * number is in exactly the same position as that neighbour, so they both lose
 * it. This is also provably what the old pile-based rule did — a member of a
 * connected component of size ≥ 2 has, by definition, at least one direct edge
 * — which is what lets tier 1 stay byte-identical to 2.231.0 while tier 2
 * gains ranking.
 *
 * Ordering matters here in a way it does not elsewhere: tier 2 re-measures
 * after this has hidden the readouts, so the accept/defer decision never sees
 * a badge drawn with a readout it was measured without.
 *
 * Returns a pooled array — see PlacementResult's warning.
 */
export function markContacts(
  items: readonly PlacementItem[],
  gap: number,
  minSeparation: number,
  scratch: PlacementScratch,
): Uint8Array {
  const n = items.length;
  if (scratch.contacts.length < n) scratch.contacts = new Uint8Array(n * 2);
  const out = scratch.contacts;
  out.fill(0, 0, n);
  if (n < 2) return out;

  let maxReach = 0;
  for (let i = 0; i < n; i++) {
    // Both extents: the cell edge must cover the largest possible conflict
    // distance on EITHER axis, or the 27-cell query stops being exhaustive.
    if (items[i].reach > maxReach) maxReach = items[i].reach;
    if (items[i].reachY > maxReach) maxReach = items[i].reachY;
  }
  const cell = Math.max(2 * maxReach + gap, minSeparation);
  if (!(cell > 0) || !Number.isFinite(cell)) return out;

  const cells = scratch.cells;
  for (const arr of cells.values()) arr.length = 0;
  for (let i = 0; i < n; i++) {
    if (items[i].exempt) continue;
    const it = items[i];
    const k = hashCell(
      Math.floor(it.sx / cell), Math.floor(it.sy / cell), Math.floor(it.sz / cell),
    );
    let bucket = cells.get(k);
    if (!bucket) { bucket = []; cells.set(k, bucket); }
    bucket.push(i);
  }
  for (let i = 0; i < n; i++) {
    const a = items[i];
    if (a.exempt) continue;
    const cx = Math.floor(a.sx / cell), cy = Math.floor(a.sy / cell), cz = Math.floor(a.sz / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          const bucket = cells.get(hashCell(cx + ox, cy + oy, cz + oz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            if (!conflicts(a, items[j], gap, minSeparation)) continue;
            out[i] = 1; out[j] = 1;
          }
        }
      }
    }
  }
  return out;
}

/** Standard 3-prime spatial hash. */
function hashCell(ix: number, iy: number, iz: number): number {
  return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) | 0;
}

/**
 * Choose which badges draw.
 *
 * `mode` is the kill switch. `"legacy"` reproduces the pre-2.232.0 rule —
 * every member of a pile of two or more is deferred, so the whole pile
 * summarises together — and exists so a regression can be answered with a
 * one-word edit rather than an unpicked commit.
 *
 * ── Stability across zoom steps ────────────────────────────────────────────
 * Zooming out grows every reach monotonically, so piles only ever merge and
 * the accepted set only ever shrinks. Reversibly: the rung is quantised, the
 * function is pure, so the same rung always renders the same way.
 *
 * There is one honest cost, at badge granularity rather than pile granularity.
 * Inside one pile ordered A,B,C: at some rung A is accepted, B deferred
 * (it conflicts with A) and C accepted — C clears A, and B is not a blocker
 * because B is not accepted. One rung further in, B may clear A and be
 * accepted, and if C conflicts with B then C is now the one deferred. So
 * zooming IN one step can swap C out for B. No badge moves, the drawn count
 * does not fall, the swap always goes toward the higher-priority device, and
 * rung k renders identically every time you return to it.
 *
 * The alternative — test each candidate against every EARLIER item in the
 * order whether or not it was accepted — makes acceptance provably monotone
 * in zoom, because it depends only on pairwise predicates against a fixed
 * earlier set. It also draws strictly fewer badges (in a chain A–B–C with A
 * clear of C, only A survives), which is the thing this whole change exists
 * to stop doing. It is written down here so the trade is a decision rather
 * than a rediscovery; it is not shipped.
 */
export function solvePlacement(
  items: readonly PlacementItem[],
  gap: number,
  minSeparation: number,
  mode: "priority" | "legacy",
  scratch: PlacementScratch,
  /**
   * The largest bucket the CALLER can still draw as a summary that shows every
   * one of its devices — see the `whole` rule in step 7.
   *
   * Zero means "nothing is drawable", so every bucket of two or more escalates
   * to its rooms' chips.
   *
   * ⚠️ REQUIRED, with no default, since 2.308.0. It defaulted to 0, and a
   * default that silently selects the most destructive behaviour available is a
   * trap — the placement suite fell into it, defaulting nine of its own cases
   * to 0 while carrying a comment insisting the value must be explicit at every
   * call. Making it required is the only way that comment can be true.
   *
   * It is a plain integer and STAYS one: it must not become a function of
   * camera distance or anything else this module cannot see, or the output
   * stops being a pure function of world position, quantised zoom and static
   * rank. A cap derived from the VIEWPORT is fine and is what ships — screen
   * size is constant across a frame and independent of where the camera is.
   */
  drawableMax: number,
): PlacementResult {
  const n = items.length;
  const st = scratch;
  if (st.parent.length < n) {
    st.parent = new Int32Array(n * 2);
    st.order = new Int32Array(n * 2);
    st.accepted = new Uint8Array(n * 2);
    st.deferred = new Int32Array(n * 2);
  }
  const parent = st.parent;
  const accepted = st.accepted;
  accepted.fill(0, 0, n);
  st.chipRooms.length = 0;
  let bucketCount = 0;
  const stats = st.stats;
  stats.items = n; stats.exempt = 0; stats.piles = 0; stats.accepted = 0;
  stats.deferred = 0; stats.pulledBack = 0; stats.buckets = 0;
  stats.crossRoom = 0; stats.chipRooms = 0;
  stats.chipDegenerate = 0; stats.chipUndrawable = 0;

  if (n === 0) {
    return { accepted, buckets: st.buckets, bucketCount: 0, chipRooms: st.chipRooms, stats };
  }

  // ── 1. Spatial index ─────────────────────────────────────────────────────
  // A uniform grid, the same structure Mapbox's own collision index uses
  // (grid_index.ts) — an R-tree buys nothing for near-uniformly-sized boxes
  // and costs a rebuild every frame. Cell edge is the largest distance at
  // which any pair can possibly conflict, so a conflicting pair always shares
  // a cell or an immediate neighbour and the 27-cell query is exhaustive.
  let maxReach = 0;
  for (let i = 0; i < n; i++) {
    // Both extents: the cell edge must cover the largest possible conflict
    // distance on EITHER axis, or the 27-cell query stops being exhaustive.
    if (items[i].reach > maxReach) maxReach = items[i].reach;
    if (items[i].reachY > maxReach) maxReach = items[i].reachY;
  }
  const cell = Math.max(2 * maxReach + gap, minSeparation);
  if (!(cell > 0) || !Number.isFinite(cell)) {
    // No usable geometry this frame (zoom unresolved, degenerate projection).
    // Draw everything rather than summarise on numbers we do not trust.
    accepted.fill(1, 0, n);
    stats.accepted = n;
    return { accepted, buckets: st.buckets, bucketCount: 0, chipRooms: st.chipRooms, stats };
  }

  const cells = st.cells;
  // Truncate rather than clear: the bucket arrays are reused across frames, so
  // the steady state allocates nothing.
  for (const arr of cells.values()) arr.length = 0;
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const k = hashCell(
      Math.floor(it.sx / cell), Math.floor(it.sy / cell), Math.floor(it.sz / cell),
    );
    let bucket = cells.get(k);
    if (!bucket) { bucket = []; cells.set(k, bucket); }
    bucket.push(i);
  }

  // ── 2. Union-find over conflicting pairs ─────────────────────────────────
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; }
    return r;
  };
  for (let i = 0; i < n; i++) {
    const a = items[i];
    // An exempt badge is drawn whatever happens and blocks nobody, so it takes
    // no part in the graph at all.
    if (a.exempt) continue;
    const cx = Math.floor(a.sx / cell), cy = Math.floor(a.sy / cell), cz = Math.floor(a.sz / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          const bucket = cells.get(hashCell(cx + ox, cy + oy, cz + oz));
          if (!bucket) continue;
          for (const j of bucket) {
            // Each unordered pair considered once; self skipped.
            if (j <= i) continue;
            const b = items[j];
            if (b.exempt) continue;
            if (!conflicts(a, b, gap, minSeparation)) continue;
            const ra = find(i), rb = find(j);
            if (ra !== rb) parent[ra] = rb;
          }
        }
      }
    }
  }

  // ── 3. Components ────────────────────────────────────────────────────────
  const piles = st.piles;
  let pileCount = 0;
  const pileOf = new Map<number, number>();
  // -1 means "in no pile": an exempt badge, which takes no part in the graph.
  // It has to be a real sentinel rather than the default 0, because a bucket
  // is keyed by pile now and an exempt item left at 0 would read as a member
  // of pile 0.
  if (st.pileIdx.length < n) st.pileIdx = new Int32Array(n * 2);
  const pileIdx = st.pileIdx;
  pileIdx.fill(-1, 0, n);
  for (let i = 0; i < n; i++) {
    if (items[i].exempt) { accepted[i] = 1; stats.exempt++; continue; }
    const r = find(i);
    let p = pileOf.get(r);
    if (p === undefined) {
      p = pileCount++;
      pileOf.set(r, p);
      if (!piles[p]) piles[p] = [];
      piles[p].length = 0;
    }
    piles[p].push(i);
    pileIdx[i] = p;
  }
  stats.piles = pileCount;

  // ── 4. Accept greedily inside each pile ──────────────────────────────────
  const deferred = st.deferred;
  let deferredCount = 0;
  for (let p = 0; p < pileCount; p++) {
    const members = piles[p];
    if (members.length === 1) { accepted[members[0]] = 1; continue; }

    if (mode === "legacy") {
      for (const i of members) deferred[deferredCount++] = i;
      continue;
    }

    // Total order: rank first, entity_id to break ties. Both static, so this
    // is the same order on every device and every frame — which is the last
    // place camera or frame state could have leaked in.
    members.sort((x, y) => {
      const rx = items[x].rank, ry = items[y].rank;
      if (rx !== ry) return rx - ry;
      return byteLess(items[x].sortKey, items[y].sortKey) ? -1
        : items[x].sortKey === items[y].sortKey ? 0 : 1;
    });
    const acceptedHere: number[] = [];
    for (const i of members) {
      let clear = true;
      for (const a of acceptedHere) {
        if (conflicts(items[i], items[a], gap, minSeparation)) { clear = false; break; }
      }
      if (clear) { accepted[i] = 1; acceptedHere.push(i); }
      else deferred[deferredCount++] = i;
    }
  }
  stats.deferred = deferredCount;

  // ── 5. Bucket the deferrals by PILE ──────────────────────────────────────
  // Not by room, which is what this used to do and what made a cross-room
  // collision catastrophic.
  //
  // A pile is the set of badges that competed for the same piece of floor —
  // they are transitively within a conflict distance of each other, by
  // construction. So the badges that lost inside one pile are exactly the ones
  // it is honest to draw as a single summary standing where they are, and a
  // room boundary running through the middle of that pile is a fact about the
  // floor plan, not about the crowding.
  //
  // Bucketing by room had two consequences, neither intended. Two deferrals
  // from DIFFERENT piles in the same room merged into one summary drawn at the
  // midpoint of both — a badge pointing at floor between two unrelated
  // clusters. And a deferral whose only near neighbour was in another room was
  // alone in its bucket with no room-mate close enough to pair with, so it fell
  // to "a bucket of one has nothing to summarise with" and chipped its whole
  // room. Both are fixed by asking the pile instead of the map.
  const pileKeyOf = (p: number): string => {
    // The whole pile's lowest sortKey — stable even as membership shifts.
    const members = piles[p];
    let k = items[members[0]].sortKey;
    for (let m = 1; m < members.length; m++) {
      if (byteLess(items[members[m]].sortKey, k)) k = items[members[m]].sortKey;
    }
    return k;
  };
  if (st.pileBucket.length < pileCount) st.pileBucket = new Int32Array(pileCount * 2);
  const pileBucket = st.pileBucket;
  pileBucket.fill(-1, 0, pileCount);

  for (let d = 0; d < deferredCount; d++) {
    const i = deferred[d];
    const p = pileIdx[i];
    let bi = pileBucket[p];
    if (bi < 0) {
      bi = bucketCount++;
      pileBucket[p] = bi;
      if (!st.buckets[bi]) st.buckets[bi] = { room: "", rooms: [], pileKey: "", members: [] };
      const b = st.buckets[bi];
      b.pileKey = pileKeyOf(p);
      b.members.length = 0;
      b.rooms.length = 0;
    }
    st.buckets[bi].members.push(i);
  }

  // ── 6. A bucket of one is not a group ────────────────────────────────────
  // A summary badge showing "1" is a worse drawing of a badge. So a lone
  // deferral pulls its nearest accepted PILE-MATE down with it, making an
  // honest group of two.
  //
  // Searching the pile rather than the room is what makes this rule total. A
  // bucket of one can only come from a pile of two or more, and that badge
  // deferred precisely because it conflicted with something already accepted
  // in the same pile — so an accepted partner always exists, and it is within
  // one conflict distance, comfortably inside the bound below. The "nothing
  // near enough, chip the room" outcome is therefore no longer reachable from
  // here. It used to be the common case, because the search was restricted to
  // room-mates and the badge that beat you is very often in the next room.
  //
  // The rule stays load-bearing for the case it was written for: a ceiling fan
  // and its own light are one pile of two in one room, so the fan is accepted,
  // the light deferred, and the pull-back turns them back into the group of 2
  // that 2.231.0 drew.
  //
  // NEAREST rather than lowest-priority, and BOUNDED, because the group is
  // drawn at its members' centroid. An unbounded search happily paired a
  // device with a room-mate ten metres away and drew the summary at the
  // midpoint — a badge sitting where neither of the two devices it claims to
  // stand for actually is, which is a worse lie than the crowding it set out
  // to solve.
  for (let b = 0; b < bucketCount; b++) {
    const bucket = st.buckets[b];
    if (bucket.members.length !== 1) continue;
    const lone = bucket.members[0];
    const li = items[lone];
    let best = -1, bestD2 = Infinity;
    // ── SAME CATEGORY, ALL ELSE NEAR-EQUAL ──────────────────────────────
    // The nearest same-category pile-mate is tracked alongside the nearest of
    // any kind, and wins only if it is within `PULLBACK_SAME_CATEGORY_SLACK`
    // of it. That ordering matters: the strict nearest still sets the scale,
    // so the preference can shorten no distance and lengthen it by a bounded
    // fraction of an already-bounded search. The card cannot be dragged
    // anywhere the un-preferred rule would not have been willing to draw it.
    //
    // Why this is the ONLY place a category preference belongs: everywhere
    // else, membership is forced. A summary exists because its members
    // overlap, and overlap partitions into connected components — there is no
    // second candidate to prefer. Here the solver is genuinely choosing which
    // accepted pile-mate to demote, and a pair of lights reads as one thing
    // where a light beside a camera reads as two unrelated ones that happen to
    // be near each other.
    let same = -1, sameD2 = Infinity;
    for (const i of piles[pileIdx[lone]]) {
      if (!accepted[i]) continue;
      // Eligibility is THE collision predicate at PULLBACK_REACH_FACTOR —
      // the same box, inflated — so "close enough to summarise with" can
      // never disagree in shape with "close enough to have collided".
      // NEAREST among the eligible is still ranked by straight distance:
      // that is a ranking, not an overlap test, and the centroid the pair
      // will be drawn at cares about distance, not about box axes.
      if (!conflicts(li, items[i], gap, minSeparation, PULLBACK_REACH_FACTOR)) continue;
      const dx = items[i].sx - li.sx, dy = items[i].sy - li.sy, dz = items[i].sz - li.sz;
      const d2 = dx * dx + dy * dy + dz * dz;
      // Deterministic on ties, so two equidistant pile-mates cannot alternate.
      if (d2 < bestD2 || (d2 === bestD2 && best >= 0 && byteLess(items[i].sortKey, items[best].sortKey))) {
        best = i; bestD2 = d2;
      }
      if (items[i].category === li.category
        && (d2 < sameD2 || (d2 === sameD2 && same >= 0 && byteLess(items[i].sortKey, items[same].sortKey)))) {
        same = i; sameD2 = d2;
      }
    }
    if (same >= 0 && sameD2 <= bestD2 * PULLBACK_SAME_CATEGORY_SLACK) best = same;
    if (best < 0) continue; // nothing near enough — falls to the chip below
    accepted[best] = 0;
    bucket.members.push(best);
    stats.pulledBack++;
  }

  // ── 6b. AN OVERSIZED BUCKET SPLITS; IT DOES NOT DIE (2.406.0) ────────────
  // Until now a bucket holding more members than one card can draw was KILLED
  // — every room it touched went to its chip, the all-or-nothing contract hid
  // every badge in those rooms, and the cascade in step 7 took the neighbours.
  // One boundary pair fusing two rooms' piles was enough: bedroom (6) plus
  // bathroom (4) made a bucket of 10, "undrawable", and BOTH rooms chipped in
  // the same frame — the villa-wide cliff recorded in sources/files/move.mov,
  // where one zoom rung flips drawn=25 to drawn=1.
  //
  // But "more than one card can draw" was never a reason to draw NOTHING: the
  // clique machinery below (buildCliques — pure, pinned by the suite, already
  // used by the focused-room path) splits exactly such a pile into mutually-
  // overlapping clusters of at most drawableMax, each an honest card at its
  // own local centroid. A fused bedroom+bathroom pile splits along its real
  // geometry, because mutual overlap is spatially local. So the tiering
  // becomes the one sentence the whole subsystem is supposed to mean:
  //
  //   A BADGE DRAWS ALONE UNTIL ITS BOX COLLIDES; COLLIDING BADGES GROUP INTO
  //   AS MANY CARDS AS THEIR GEOMETRY NEEDS; A ROOM FALLS TO ITS CHIP ONLY
  //   WHEN EVEN THE CARDS CANNOT BE PLACED (the caller's seating test), NOT
  //   BECAUSE A COUNTING CEILING SAID SO.
  //
  // A singleton clique — a member that mutually overlaps no other, possible
  // because bucket-mates shared a PILE, not necessarily each other's boxes —
  // folds into the nearest clique that still has room, exactly the reasoning
  // of the lone-deferral pull-back one tier up. If every clique is full it
  // stays a bucket of one and step 7's degenerate rule sends it to the chip,
  // which is honest: that floor is genuinely crowded.
  //
  // drawableMax < 2 keeps the old kill (step 7's `undrawable` branch): "the
  // caller can draw nothing" cannot be answered by splitting.
  if (drawableMax >= 2) {
    const originalCount = bucketCount;
    for (let b = 0; b < originalCount; b++) {
      const bucket = st.buckets[b];
      if (bucket.members.length <= drawableMax) continue;
      // The canonical order every other decision uses: rank, then entity_id.
      const order = bucket.members.slice().sort((x, y) => {
        const rx = items[x].rank, ry = items[y].rank;
        if (rx !== ry) return rx - ry;
        return byteLess(items[x].sortKey, items[y].sortKey) ? -1
          : items[x].sortKey === items[y].sortKey ? 0 : 1;
      });
      const cliques = buildCliques(items, order, gap, minSeparation, drawableMax);
      // Fold singletons nearest-first, in canonical order so the outcome is a
      // function of geometry and rank like everything else here.
      const cent = cliques.map((c) => {
        let cx = 0, cy = 0;
        for (const i of c) { cx += items[i].sx; cy += items[i].sy; }
        return { cx: cx / c.length, cy: cy / c.length };
      });
      for (let si = 0; si < cliques.length; si++) {
        if (cliques[si].length !== 1) continue;
        const lone = cliques[si][0];
        let best = -1, bestD2 = Infinity;
        for (let ci = 0; ci < cliques.length; ci++) {
          if (ci === si || cliques[ci].length === 0) continue;
          if (cliques[ci].length >= drawableMax) continue;
          const dx = items[lone].sx - cent[ci].cx, dy = items[lone].sy - cent[ci].cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { best = ci; bestD2 = d2; }
        }
        if (best < 0) continue; // stays a singleton — step 7's degenerate rule
        const c = cliques[best];
        cent[best].cx = (cent[best].cx * c.length + items[lone].sx) / (c.length + 1);
        cent[best].cy = (cent[best].cy * c.length + items[lone].sy) / (c.length + 1);
        c.push(lone);
        cliques[si].length = 0;
      }
      // Emit: the first surviving clique replaces the bucket in place, the
      // rest append. pileKey is each clique's own lowest sortKey — the same
      // stable-identity rule step 5 uses, one level down.
      let first = true;
      for (const c of cliques) {
        if (c.length === 0) continue;
        let k = items[c[0]].sortKey;
        for (let m = 1; m < c.length; m++) {
          if (byteLess(items[c[m]].sortKey, k)) k = items[c[m]].sortKey;
        }
        let target: DeferralBucket;
        if (first) { target = bucket; first = false; }
        else {
          const bi = bucketCount++;
          if (!st.buckets[bi]) st.buckets[bi] = { room: "", rooms: [], pileKey: "", members: [] };
          target = st.buckets[bi];
        }
        target.pileKey = k;
        target.members.length = 0;
        for (const i of c) target.members.push(i);
        target.rooms.length = 0; // recomputed at the top of every round below
      }
    }
  }

  // ── 7. Buckets that are really the room, and the chip cascade ────────────
  // Two renderings of the same content is how a viewer learns to distrust
  // both: a group covering everything its room has to show IS the room, and
  // renders as the room chip instead.
  //
  // "Covering the room" now needs the SINGLE-ROOM qualifier. A bucket that
  // holds both of the Living Room's badges plus one of the bedroom's is not
  // the Living Room — it is a crowd that happens to straddle a wall, and
  // collapsing it to a Living Room chip both mislabels it and loses the
  // bedroom badge. Only a bucket whose every member is in one room can BE that
  // room.
  //
  // The loop runs to a fixed point because chipping is contagious in one
  // direction: a chipped room hides all of its badges (the all-or-nothing
  // contract below), so any bucket holding one of them loses that member, and
  // a bucket dropping under two members chips ITS rooms in turn. Rooms are
  // only ever added to `chipped`, and there are finitely many, so this
  // terminates; the round guard is belt and braces.
  const chipped = st.chipped;
  chipped.clear();
  if (st.bucketDead.length < bucketCount) st.bucketDead = new Uint8Array(bucketCount * 2);
  const dead = st.bucketDead;
  dead.fill(0, 0, bucketCount);

  // ── ⚠️ A ROUND DECIDES FROM THE STATE IT STARTED WITH ────────────────────
  // `chipped` used to be added to IN the sweep below, so a bucket judged later
  // in a round saw rooms that a bucket judged earlier had just chipped — which
  // made the outcome a function of BUCKET INDEX ORDER, and bucket indices come
  // from the order deferrals are encountered, i.e. from the caller's input
  // order. `?debug`'s purity guard reported it from a phone as
  // `ORDER DEPENDENT — 12 vs 4 accepted on a reversed input`, on most passes.
  //
  // It is not enough that chipping is monotone. Pruning chipped members only
  // ever SHRINKS a bucket, and the two halves of the kill test pull opposite
  // ways under that: `< 2` gets easier to satisfy as members are removed, but
  // `> drawableMax` gets HARDER — a bucket of 8 with drawableMax 6 dies as
  // undrawable, yet the same bucket, judged after two of its members' rooms
  // chipped, is a drawable 6 and lives. So "who is looked at first" genuinely
  // changed which rooms collapsed, and a solver that accepts 4 or 12 badges
  // depending on argument order is not computing anything meaningful.
  //
  // The fix is to make each round a pure function of the previous round's
  // state: rooms chipped during a round are collected here and applied only
  // once every bucket has been judged against the same `chipped` set. Sweep
  // order within a round then cannot matter. Termination is unchanged — both
  // `chipped` and `dead` still only ever grow.
  const pendingRooms: string[] = [];
  for (let round = 0; round <= bucketCount + 1; round++) {
    let changed = false;
    pendingRooms.length = 0;
    for (let b = 0; b < bucketCount; b++) {
      if (dead[b]) continue;
      const bucket = st.buckets[b];
      if (chipped.size > 0) {
        let w = 0;
        for (const i of bucket.members) if (!chipped.has(items[i].room)) bucket.members[w++] = i;
        if (w !== bucket.members.length) { bucket.members.length = w; changed = true; }
      }
      // Rooms present, unique, sorted — deterministic on every device. The
      // member list is short (a crowded pile is a handful of badges), so the
      // linear scan is cheaper than any set.
      bucket.rooms.length = 0;
      for (const i of bucket.members) {
        const r = items[i].room;
        if (!bucket.rooms.includes(r)) bucket.rooms.push(r);
      }
      bucket.rooms.sort();
      bucket.room = bucket.rooms[0] ?? "";
      // ── …AND ONLY IF THE CALLER CANNOT DRAW IT ───────────────────────
      // The rule exists because two renderings of the same content is how a
      // viewer learns to distrust both: a summary covering everything its room
      // shows IS the room. That is true while the summary is a COUNT — a room
      // name beside a number, against a number, is the same non-information
      // twice. It stops being true the moment the caller can draw every one of
      // the bucket's devices as its own pictogram with its own tap target,
      // which is strictly MORE than the chip says rather than a duplicate of
      // it. `drawableMax` is where the caller states how many it can draw.
      //
      // ⚠️ UNDRAWABLE IS THE WHOLE TEST, since 2.308.0. It used to ALSO require
      // the bucket to be exactly one room and to cover all of it, which left
      // every bucket that was neither — a pile spanning two rooms, or only part
      // of one — with no tier to fall to: too many members to draw as cards,
      // not "whole" enough to escalate. So it drew a bare number, and stayed a
      // bare number at every zoom rung, forever. That number is precisely the
      // non-information the paragraph above exists to forbid, minus even a room
      // name to hang it on. Reported against 2.307.0 with a screenshot of an
      // "18" standing among five named chips.
      //
      // ⚠️ Since 2.406.0 this branch is only REACHABLE when drawableMax < 2:
      // step 6b splits every larger bucket into cliques of at most drawableMax
      // before this loop runs, so crowding yields several cards rather than a
      // room-wide kill. What survives here is the genuine "the caller can draw
      // nothing" configuration, where escalating is the only honest move.
      const undrawable = bucket.members.length > drawableMax;
      if (bucket.members.length >= 2 && !undrawable) continue;
      // Attributed, not just counted: see PlacementStats.chipUndrawable.
      if (undrawable) stats.chipUndrawable++; else stats.chipDegenerate++;
      dead[b] = 1;
      changed = true;
      // A bucket that cannot stand as a group hands its rooms to their chips.
      // With the pile-wide pull-back above, "stuck at one member" is only
      // reachable by the drop just performed, not by a failed partner search.
      //
      // Staged, not applied: see the note above the round loop. Every bucket in
      // this round is judged against the `chipped` set the round began with.
      for (const r of bucket.rooms) pendingRooms.push(r);
    }
    // Now the round is over, every bucket having seen the same state.
    for (const r of pendingRooms) {
      if (!chipped.has(r)) { chipped.add(r); changed = true; }
    }
    if (!changed) break;
  }

  let live = 0;
  for (let b = 0; b < bucketCount; b++) {
    if (dead[b]) continue;
    if (live !== b) {
      const tmp = st.buckets[live];
      st.buckets[live] = st.buckets[b];
      st.buckets[b] = tmp;
    }
    if (st.buckets[live].rooms.length > 1) stats.crossRoom++;
    live++;
  }
  bucketCount = live;

  // A room that chipped takes ALL of its badges, including any that were
  // accepted elsewhere in the pass — all-or-nothing per room is the readable
  // contract, and a room that is half chip and half badges asks the viewer to
  // work out which devices the chip stands for.
  for (const r of chipped) st.chipRooms.push(r);
  st.chipRooms.sort();
  if (st.chipRooms.length > 0) {
    for (let i = 0; i < n; i++) if (chipped.has(items[i].room)) accepted[i] = 0;
  }

  stats.buckets = bucketCount;
  stats.chipRooms = st.chipRooms.length;
  for (let i = 0; i < n; i++) if (accepted[i]) stats.accepted++;

  return { accepted, buckets: st.buckets, bucketCount, chipRooms: st.chipRooms, stats };
}

/** An axis-aligned box on the view plane: centre plus half-extents. */
export interface PileBox { cx: number; cy: number; hw: number; hh: number; }

/**
 * Merge piles whose DRAWN boxes overlap, repeatedly, until none do.
 *
 * Lives here — a module that imports nothing — rather than inline in the
 * renderer, because it is a pure fixpoint over boxes and this is the third
 * fixpoint in this subsystem to ship wrong. It is now testable without a
 * browser, which is the only reason the bug below could be pinned.
 *
 * ⚠️ THE LOOP BOUND IS THE WHOLE POINT. The original was
 * `for (let round = 0; round < piles.length; round++)`, and `piles.length`
 * shrinks by one on every merge while `round` grows — so the two walk toward
 * each other and meet in the middle. It performs at most ceil(N/2) merges; a
 * full collapse needs N-1. At two or three piles those happen to be the same
 * number, which is why it looked correct for two releases. From FOUR piles up
 * it exits early and leaves overlapping cards drawn — reported against
 * 2.314.0 as a tapped room showing two summary cards on top of each other.
 *
 * The comment on the original said "bounded by the pile count, since every
 * round strictly reduces it". The reasoning was right and the code did not
 * express it: a strictly-reducing quantity is the TERMINATION argument, not
 * the iteration bound. Expressed as a while-loop, termination is obvious
 * (every pass either breaks or removes a pile) and there is no bound to get
 * wrong.
 *
 * Merges the FIRST colliding pair found in index order, which is the canonical
 * (rank, entity_id) order its caller built the piles in — so the result is a
 * function of geometry and rank only, like everything else here.
 *
 * Mutates `piles` in place and returns it.
 */
export function mergeCollidingPiles<T>(
  piles: T[][],
  boxOf: (pile: T[]) => PileBox,
): T[][] {
  while (piles.length > 1) {
    const boxes = piles.map(boxOf);
    let a = -1, b = -1;
    outer:
    for (let i = 0; i < piles.length; i++) {
      for (let j = i + 1; j < piles.length; j++) {
        if (Math.abs(boxes[i].cx - boxes[j].cx) < boxes[i].hw + boxes[j].hw
          && Math.abs(boxes[i].cy - boxes[j].cy) < boxes[i].hh + boxes[j].hh) {
          a = i; b = j; break outer;
        }
      }
    }
    if (a < 0) break;
    piles[a] = piles[a].concat(piles[b]);
    piles.splice(b, 1);
  }
  return piles;
}

/**
 * Partition a focused room's badges into CLIQUES — sets where every member
 * overlaps every other, so a card's claim ("these could not be drawn apart")
 * is true of every pair, not just of a chain.
 *
 * ── Why the candidate order matters, and why it changed in 2.316.0 ─────────
 * The clique CONDITION has no freedom in it. The order candidates are OFFERED
 * in has plenty, and it decides which of several valid partitions you get.
 *
 * It used to be the canonical (rank, entity_id) order — the same order the
 * card lays its cells out in. That is blind to position, and `badgeRank` is
 * largely a function of CATEGORY, so the sweep reached every camera in the
 * room consecutively regardless of where any of them stood. A seed would take
 * both cameras from the far side of a terrace before it took the socket beside
 * it, purely because cameras sort earlier. The resulting cliques were valid —
 * every pair really did overlap at that zoom — but their members were spread,
 * so the card, which is drawn at its members' CENTROID, landed nowhere near
 * the devices it contained. Reported with three zoom levels of the same
 * terrace: the card holding the cameras was drawn to the LEFT of the card
 * holding the sockets, while at full zoom the cameras were plainly on the
 * right.
 *
 * Candidates are now offered NEAREST-FIRST, measured from the pile's running
 * centroid, with category as the tiebreak inside one badge-width. So:
 *
 *   * a pile stays spatially tight, and its card is drawn among its members;
 *   * "same type together" becomes a real preference instead of an accident of
 *     `badgeRank`, and one that can no longer drag a pile across the room —
 *     it only chooses between candidates that are already about equally close.
 *
 * Distance is on the view plane, in the same quantised GUI pixels as
 * everything else here, so this stays a pure function of world position,
 * quantised zoom and static rank. `order` (canonical) still decides which
 * badge SEEDS a pile and still breaks every remaining tie, so the output is
 * deterministic and does not depend on input order.
 */
export function buildCliques(
  items: readonly PlacementItem[],
  order: readonly number[],
  gap: number,
  minSep: number,
  maxSize: number,
): number[][] {
  const taken = new Uint8Array(items.length);
  const piles: number[][] = [];
  // Rank in the canonical order, for the final tiebreak — O(1) instead of
  // indexOf inside the inner loop.
  const seq = new Int32Array(items.length).fill(Number.MAX_SAFE_INTEGER);
  for (let k = 0; k < order.length; k++) seq[order[k]] = k;

  for (const seed of order) {
    if (taken[seed]) continue;
    taken[seed] = 1;
    const pile = [seed];
    let cx = items[seed].sx, cy = items[seed].sy;
    // The "about equally close" band the category preference lives inside.
    // Taken from the SEED so it cannot drift as the pile grows, and floored at
    // 1px so a degenerate reach cannot divide by zero.
    //
    // ⚠️ A QUARTER of a badge, not a whole one. At a full badge-width the band
    // swallowed the distance signal outright: in the reported terrace every
    // candidate — the sockets at 35px and the cameras at 60px — landed in the
    // same bucket, the comparison fell straight through to category and then
    // to rank, and the sweep behaved exactly as the rank-ordered one it
    // replaced. Distance has to DOMINATE and category has to be a tiebreak
    // between candidates that are genuinely near-equidistant; a band wide
    // enough for category to win an argument is a band wide enough to lose the
    // one this function exists to win.
    const band = Math.max(1, items[seed].reach / 4);
    const seedCat = items[seed].category;

    while (pile.length < maxSize) {
      let best = -1, bestBucket = 0, bestCat = 0, bestSeq = 0;
      for (const cand of order) {
        if (taken[cand]) continue;
        let all = true;
        for (const m of pile) {
          if (!conflicts(items[cand], items[m], gap, minSep)) { all = false; break; }
        }
        if (!all) continue;
        const dx = items[cand].sx - cx, dy = items[cand].sy - cy;
        // Quantised to the band so the category tiebreak can actually fire —
        // raw distances tie only by accident.
        const bucket = Math.floor(Math.hypot(dx, dy) / band);
        const cat = items[cand].category === seedCat ? 0 : 1;
        const s = seq[cand];
        if (best < 0 || bucket < bestBucket
          || (bucket === bestBucket && (cat < bestCat
            || (cat === bestCat && s < bestSeq)))) {
          best = cand; bestBucket = bucket; bestCat = cat; bestSeq = s;
        }
      }
      if (best < 0) break;
      taken[best] = 1;
      cx = (cx * pile.length + items[best].sx) / (pile.length + 1);
      cy = (cy * pile.length + items[best].sy) / (pile.length + 1);
      pile.push(best);
    }
    piles.push(pile);
  }
  return piles;
}
