// src/babylon/badgePlacement.ts
// Decides which badges are drawn at their own anchors and which fall back to a
// summary. Pure: no Babylon, no scene, no DOM, no time — sibling to
// labelLayout.ts and held to the same discipline.
//
// ── The invariant this file exists to protect ──────────────────────────────
// The output is a pure function of (world anchor positions, the QUANTISED
// zoom baked into each item's `reach`, and each item's STATIC rank). Nothing
// about where the camera stands or which way it looks appears anywhere, and
// no previous frame's result is an input — `solvePlacement` takes no
// previous-frame argument at all, so a "keep last frame's winner" stabiliser
// is not merely discouraged, it is inexpressible.
//
// That is not stylistic. Six rewrites of this subsystem failed by testing
// overlap in SCREEN space, which made grouping a function of the whole camera
// pose: panning silently regrouped rooms, and the hysteresis added to damp the
// resulting flicker made the result depend on the PATH taken rather than the
// destination — so returning to the exact view you started from did not
// restore what you started with. EntityVisuals' header has the full account.
// Hysteresis cannot fix path-dependence; it IS path-dependence.
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
// So union-find no longer decides what draws. It decides who competes.

/** One badge offered to the solver. */
export interface PlacementItem {
  /** World-space anchor. THE input — see the header. */
  wx: number;
  wy: number;
  wz: number;
  /** How much world space this badge's drawn half-width covers, i.e. its
   *  on-screen footprint converted through the quantised zoom. */
  reach: number;
  /** Static placement rank; LOWER is placed first (see badgePriority). */
  rank: number;
  /** Total, locale-independent tiebreak — the entity_id. */
  sortKey: string;
  /** roomKey() form, never a raw name. Buckets deferrals and keys chips. */
  room: string;
  /** The focused room's badges: accepted unconditionally, AND never counted
   *  as a blocker for anyone else. "Tap a room, see its devices" is a promise
   *  the layout is not allowed to renegotiate. */
  exempt: boolean;
}

/** Badges that could not be drawn, gathered into one summary badge. */
export interface DeferralBucket {
  /** roomKey — one room per bucket, always. */
  room: string;
  /** Stable identity across frames: the lowest sortKey of the whole PILE, not
   *  of the surviving members, so the group's GUI controls are not rebuilt
   *  (and do not flicker) when membership shifts by one at a zoom step. */
  pileKey: string;
  /** Indices into the input array. Always ≥ 2 — see solvePlacement. */
  members: number[];
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
  /** roomKeys that must fall all the way to their chip. */
  chipRooms: string[];
}

/** Reusable working set. One per caller — see solvePlacement. */
export interface PlacementScratch {
  parent: Int32Array;
  order: Int32Array;
  accepted: Uint8Array;
  deferred: Int32Array;
  cells: Map<number, number[]>;
  piles: number[][];
  buckets: DeferralBucket[];
  chipRooms: string[];
  roomCount: Map<string, number>;
  roomOfBucket: Map<string, number>;
  contacts: Uint8Array;
}

export function createPlacementScratch(): PlacementScratch {
  return {
    parent: new Int32Array(0),
    order: new Int32Array(0),
    accepted: new Uint8Array(0),
    deferred: new Int32Array(0),
    cells: new Map(),
    piles: [],
    buckets: [],
    chipRooms: [],
    roomCount: new Map(),
    roomOfBucket: new Map(),
    contacts: new Uint8Array(0),
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
  const dx = b.wx - a.wx;
  const dy = b.wy - a.wy;
  const dz = b.wz - a.wz;
  // HEIGHT COUNTS: a ceiling fan and the lamp beneath it share a ground
  // position but are drawn metres apart, so a ground-plane-only test called
  // them the same point and grouped two badges that never overlapped.
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
      Math.floor(it.wx / cell), Math.floor(it.wy / cell), Math.floor(it.wz / cell),
    );
    let bucket = cells.get(k);
    if (!bucket) { bucket = []; cells.set(k, bucket); }
    bucket.push(i);
  }
  for (let i = 0; i < n; i++) {
    const a = items[i];
    if (a.exempt) continue;
    const cx = Math.floor(a.wx / cell), cy = Math.floor(a.wy / cell), cz = Math.floor(a.wz / cell);
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

  if (n === 0) {
    return { accepted, buckets: st.buckets, bucketCount: 0, chipRooms: st.chipRooms };
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
    return { accepted, buckets: st.buckets, bucketCount: 0, chipRooms: st.chipRooms };
  }

  const cells = st.cells;
  // Truncate rather than clear: the bucket arrays are reused across frames, so
  // the steady state allocates nothing.
  for (const arr of cells.values()) arr.length = 0;
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const k = hashCell(
      Math.floor(it.wx / cell), Math.floor(it.wy / cell), Math.floor(it.wz / cell),
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
    const cx = Math.floor(a.wx / cell), cy = Math.floor(a.wy / cell), cz = Math.floor(a.wz / cell);
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
  for (let i = 0; i < n; i++) {
    if (items[i].exempt) { accepted[i] = 1; continue; }
    const r = find(i);
    let p = pileOf.get(r);
    if (p === undefined) {
      p = pileCount++;
      pileOf.set(r, p);
      if (!piles[p]) piles[p] = [];
      piles[p].length = 0;
    }
    piles[p].push(i);
  }

  // How many badges each room is showing — the denominator for "this bucket
  // covers the whole room, so it IS the room".
  const roomCount = st.roomCount;
  roomCount.clear();
  for (let i = 0; i < n; i++) {
    roomCount.set(items[i].room, (roomCount.get(items[i].room) ?? 0) + 1);
  }

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

  // ── 5. Bucket the deferrals by room ──────────────────────────────────────
  const roomOfBucket = st.roomOfBucket;
  roomOfBucket.clear();
  const pileKeyOf = (i: number): string => {
    // The whole pile's lowest sortKey — stable even as membership shifts.
    const members = piles[pileIndexOf(i)];
    let k = items[members[0]].sortKey;
    for (let m = 1; m < members.length; m++) {
      if (byteLess(items[members[m]].sortKey, k)) k = items[members[m]].sortKey;
    }
    return k;
  };
  const pileIdx = new Int32Array(n);
  for (let p = 0; p < pileCount; p++) for (const i of piles[p]) pileIdx[i] = p;
  function pileIndexOf(i: number): number { return pileIdx[i]; }

  for (let d = 0; d < deferredCount; d++) {
    const i = deferred[d];
    const room = items[i].room;
    let bi = roomOfBucket.get(room);
    if (bi === undefined) {
      bi = bucketCount++;
      roomOfBucket.set(room, bi);
      if (!st.buckets[bi]) st.buckets[bi] = { room, pileKey: "", members: [] };
      const b = st.buckets[bi];
      b.room = room;
      b.pileKey = pileKeyOf(i);
      b.members.length = 0;
    }
    st.buckets[bi].members.push(i);
  }

  // ── 6. A bucket of one is not a group ────────────────────────────────────
  // A summary badge showing "1" is a worse drawing of a badge. So a lone
  // deferral pulls its NEAREST accepted room-mate down with it, making an
  // honest group of two.
  //
  // This rule is load-bearing rather than cosmetic: a ceiling fan and its own
  // light are one pile of two in one room, so the fan is accepted, the light
  // deferred, and the pull-back turns them back into the group of 2 that
  // 2.231.0 drew. New behaviour therefore appears only at pile size 3 and up,
  // which is exactly where it was wanted — and the rule that two devices at
  // one point can never be two readable badges is untouched.
  //
  // NEAREST rather than lowest-priority, and BOUNDED, because the group is
  // drawn at its members' centroid. An unbounded search happily paired a
  // device with a room-mate ten metres away and drew the summary at the
  // midpoint — a badge sitting where neither of the two devices it claims to
  // stand for actually is, which is a worse lie than the crowding it set out
  // to solve. The partner must be within PULLBACK_REACH_FACTOR of the
  // distance at which the two would have conflicted, so the summary lands
  // within about a badge's width of both.
  //
  // Note no accepted room-mate can ever be closer than that conflict distance
  // itself: if it were, the two would have conflicted, so it would be in the
  // same pile and deferred rather than accepted.
  for (let b = 0; b < bucketCount; b++) {
    const bucket = st.buckets[b];
    if (bucket.members.length !== 1) continue;
    const lone = bucket.members[0];
    const li = items[lone];
    let best = -1, bestD2 = Infinity;
    for (let i = 0; i < n; i++) {
      if (!accepted[i] || items[i].room !== bucket.room || items[i].exempt) continue;
      const dx = items[i].wx - li.wx, dy = items[i].wy - li.wy, dz = items[i].wz - li.wz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const bound = PULLBACK_REACH_FACTOR
        * Math.max(li.reach + items[i].reach + gap, minSeparation);
      if (d2 > bound * bound) continue;
      // Deterministic on ties, so two equidistant room-mates cannot alternate.
      if (d2 < bestD2 || (d2 === bestD2 && best >= 0 && byteLess(items[i].sortKey, items[best].sortKey))) {
        best = i; bestD2 = d2;
      }
    }
    if (best < 0) continue; // nothing near enough — falls to the chip below
    accepted[best] = 0;
    bucket.members.push(best);
  }

  // ── 7. Buckets that are really the room ──────────────────────────────────
  // Two renderings of the same content is how a viewer learns to distrust
  // both: a group covering everything its room has to show IS the room, and
  // renders as the room chip. A bucket still stuck at one member has nothing
  // to summarise with, so its room falls to the chip too — which for a room
  // whose only badge that is, is exactly what the chip means.
  let live = 0;
  for (let b = 0; b < bucketCount; b++) {
    const bucket = st.buckets[b];
    const whole = bucket.members.length >= (roomCount.get(bucket.room) ?? 0);
    if (bucket.members.length < 2 || whole) {
      st.chipRooms.push(bucket.room);
      for (const i of bucket.members) accepted[i] = 0;
      continue;
    }
    if (live !== b) {
      const tmp = st.buckets[live];
      st.buckets[live] = bucket;
      st.buckets[b] = tmp;
    }
    live++;
  }
  bucketCount = live;

  // A room that chipped takes ALL of its badges, including any that were
  // accepted elsewhere in the pass — all-or-nothing per room is the readable
  // contract, and a room that is half chip and half badges asks the viewer to
  // work out which devices the chip stands for.
  if (st.chipRooms.length > 0) {
    const chipped = new Set(st.chipRooms);
    for (let i = 0; i < n; i++) if (chipped.has(items[i].room)) accepted[i] = 0;
    for (let b = 0; b < bucketCount; b++) {
      if (!chipped.has(st.buckets[b].room)) continue;
      // Its members are already hidden by the chip; drop the duplicate group.
      st.buckets[b] = st.buckets[bucketCount - 1];
      bucketCount--;
      b--;
    }
  }

  return { accepted, buckets: st.buckets, bucketCount, chipRooms: st.chipRooms };
}
