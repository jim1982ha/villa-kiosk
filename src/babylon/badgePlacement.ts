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
  /** The badge's drawn half-width, in the same GUI pixels as `sx`/`sy` — no
   *  conversion, because both sides of every comparison are already on the
   *  glass. */
  reach: number;
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
): boolean {
  const dx = b.sx - a.sx;
  const dy = b.sy - a.sy;
  const dz = b.sz - a.sz;
  // THIS IS A DISTANCE ON THE GLASS, AND THAT IS THE WHOLE POINT. Every axis
  // arrives already drawn — height at cos(tilt), depth at sin(tilt), and the
  // two of them SUMMED onto one screen axis rather than added in quadrature,
  // so a device that is both higher and further away correctly measures as
  // being where a lower, nearer one is. Getting that wrong is what drew badges
  // and whole summary cards on top of each other, harmlessly at a steep camera
  // and 5.9x wrong at a shallow one. See badgeProjection for the derivation and
  // for the hardware numbers that graded it by tilt.
  //
  // `dz` is zero under the orbit camera. Under the walk camera it is the
  // along-view residual, which is why this stays a three-term sum.
  const d2 = dx * dx + dy * dy + dz * dz;
  const need = Math.max(a.reach + b.reach + gap, minSeparation);
  return d2 < need * need;
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
  for (let i = 0; i < n; i++) if (items[i].reach > maxReach) maxReach = items[i].reach;
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
  for (let i = 0; i < n; i++) if (items[i].reach > maxReach) maxReach = items[i].reach;
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
      const dx = items[i].sx - li.sx, dy = items[i].sy - li.sy, dz = items[i].sz - li.sz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const bound = PULLBACK_REACH_FACTOR
        * Math.max(li.reach + items[i].reach + gap, minSeparation);
      if (d2 > bound * bound) continue;
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

  for (let round = 0; round <= bucketCount + 1; round++) {
    let changed = false;
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
      // Escalating hands each of the pile's rooms to its own chip, and the chip
      // merge downstream turns a cross-room pile into a single "Kitchen +2"
      // pill — named, tappable, and the tier that was already designed to be
      // the last one. The cost is deliberate and is the point: a room where 7
      // devices collide becomes one chip rather than some badges plus a number.
      const undrawable = bucket.members.length > drawableMax;
      if (bucket.members.length >= 2 && !undrawable) continue;
      dead[b] = 1;
      changed = true;
      // A bucket that cannot stand as a group hands its rooms to their chips.
      // With the pile-wide pull-back above, "stuck at one member" is only
      // reachable by the drop just performed, not by a failed partner search.
      for (const r of bucket.rooms) chipped.add(r);
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
