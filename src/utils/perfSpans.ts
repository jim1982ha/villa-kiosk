// src/utils/perfSpans.ts
// Attribution for the freezes bootTimeline already detects.
//
// ── What this exists to settle ─────────────────────────────────────────────
// The `freeze` records have been arriving for months and say the same thing
// every time: a main-thread task of roughly 1.2s, `src: longtask`, on a villa
// that is already up. That is a symptom, and every attempt to name the cause
// from it has been a guess. One of those guesses — that it was a major GC of
// the heap the reload leak kept growing — was argued from a correlation across
// nine points (r = 0.93) and then DISPROVED outright: with the leak fixed and
// the heap back under control, the same ~1.2s block still arrives at 384-423MB
// exactly as it did at 271MB. Heap size does not predict it.
//
// So this stops reasoning about the shape of the number and records what the
// app was actually doing across the blocked interval.
//
// ── Why spans and not a profiler ───────────────────────────────────────────
// The JS Self-Profiling API would give real stacks, and is the obvious answer
// until you check where this has to run: it is Chromium-only (so absent on the
// iPad, which is the device the app is mounted on a wall to run), it needs a
// Document-Policy header, and its frame names on the shipped bundle are
// minified to one and two letters. It answers a question we can only ask on
// the developer's own desk, about a build that is not the one in the field.
//
// Named spans work on every engine, cost two clock reads, and survive
// minification because the names are string literals.
//
// ── The reading that matters most is the NEGATIVE one ──────────────────────
// If a freeze arrives and NOTHING in this ring overlaps it, that is not a
// failed measurement — it is the answer that the time is not in any code this
// app instruments: GC, compositing, layout, shader linkage inside the driver,
// or another task the page did not schedule. `cover` reports exactly that, and
// a near-zero cover redirects the whole investigation. Which is the point:
// the current state is that we cannot even tell whether the block is ours.

/** Only spans at least this long are kept. A span is meant to be coarse — a
 *  mesh re-index, a state burst, a calibration — but some of the call sites
 *  sit in per-frame code, and recording those would fill the ring with sub-
 *  millisecond noise and evict the history a freeze needs. Well under the
 *  50ms that makes a task "long", so nothing that could plausibly build into a
 *  freeze is filtered out. */
const SPAN_MIN_MS = 8;

/** Bounded history. Sized to comfortably span the longest freeze seen plus the
 *  work leading into it, without becoming a second memory problem — this file
 *  exists downstream of one of those. */
const RING = 64;

interface Span {
  name: string;
  /** performance.now() at begin/end. */
  t0: number;
  t1: number;
}

const ring: Span[] = [];

// ── The census: how many times, and for how long in total ──────────────────
// The ring answers "what was running across THIS block". It cannot answer "did
// that block run once or twice", which is the question the load now turns on:
// `calibrateRooms` is called from two places (after import, and again from
// updateConfig when a structural config change lands), its cost across three
// versions went 2660ms -> under 1126ms -> 2475ms with nothing in it changing,
// and both expensive runs coincided with a `sync … changed:true` arriving
// mid-load. Two runs and one slow run need opposite fixes — stop repeating it,
// versus chunk it — so guessing between them is exactly the mistake the header
// above documents.
//
// The ring cannot be made to answer it either: at 64 entries and a 30s freeze
// cooldown, a repeat arriving seconds later has no report of its own and its
// predecessor may already be evicted. So counts and totals live OUTSIDE the
// ring, unbounded in time and bounded in size by the number of distinct span
// names (four), and are reported once per load by scheduleSpanCensus().
//
// Delete this — the maps, spanCensus, the `spans` telemetry kind and its
// caller — once the count is known. It is a diagnostic, not a permanent
// boundary; the `back-press` record was removed this way after it had answered.
const runs = new Map<string, number>();
const totals = new Map<string, number>();

/**
 * Time a named stretch of work. Returns the function that ends it.
 *
 *   const end = beginSpan("indexMeshes");
 *   …
 *   end();
 *
 * Safe to call from anywhere and safe to never call the ender (the span is
 * simply never recorded) — this must not be able to break the code it
 * measures. Not re-entrant by name, and deliberately so: two overlapping
 * spans with the same name are two entries, which is what the overlap
 * arithmetic below wants.
 */
export function beginSpan(name: string): () => void {
  const t0 = performance.now();
  // Counted on ENTRY, so a run that never ends (an exception past a missing
  // finally, a teardown mid-pass) still shows up as having started. That is
  // the honest reading for "how many times was this attempted".
  runs.set(name, (runs.get(name) ?? 0) + 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const t1 = performance.now();
    // Totalled BEFORE the ring's 8ms floor: the floor exists to keep the ring
    // free of noise a freeze report would have to page past, and a per-name
    // sum has no such pressure. A pass that is fast because it had nothing to
    // do is part of the truth about how often it runs.
    totals.set(name, (totals.get(name) ?? 0) + (t1 - t0));
    if (t1 - t0 < SPAN_MIN_MS) return;
    if (ring.length >= RING) ring.shift();
    ring.push({ name, t0, t1 });
  };
}

/**
 * Fold an externally-accumulated total into the census WITHOUT touching the
 * ring.
 *
 * For work that happens in many small pieces: spanning each piece would report
 * a per-piece figure nobody can act on AND evict the 64-entry ring that freeze
 * attribution depends on (856 `beginSpan` calls inside `indexScan` is the case
 * that made that a rule). A plain accumulator at the call site, folded in here
 * once at the end, gets the total and the call count into the same census row
 * as a real span while leaving the ring alone.
 *
 * `calls` is the real number of invocations, so `name:runs:ms` still reads as
 * "ran N times, cost M in total" whichever way it was measured.
 */
export function addSpanTotal(name: string, ms: number, calls = 1): void {
  runs.set(name, (runs.get(name) ?? 0) + calls);
  totals.set(name, (totals.get(name) ?? 0) + ms);
}

/**
 * Every span name entered since the last reset, as `name:runs:totalMs`,
 * costliest first — e.g. `indexMeshes:2:2650,calibrateRooms:2:2475`.
 *
 * A compact string for the same reason `spans` is one: it rides on a telemetry
 * event whose size the server caps. Empty when nothing has been spanned.
 */
export function spanCensus(): string {
  return [...runs.entries()]
    .map(([name, n]) => [name, n, Math.round(totals.get(name) ?? 0)] as const)
    .sort((a, b) => b[2] - a[2])
    .map(([name, n, ms]) => `${name}:${n}:${ms}`)
    .join(",");
}

/** Wrap a synchronous call. The ender runs even if `fn` throws — an exception
 *  mid-work is exactly when the timing is interesting. */
export function span<T>(name: string, fn: () => T): T {
  const end = beginSpan(name);
  try {
    return fn();
  } finally {
    end();
  }
}

/** Milliseconds of `[aStart,aEnd]` also inside `[bStart,bEnd]`. */
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export interface FreezeAttribution {
  /** The spans overlapping the blocked interval, longest overlap first, as
   *  `name:ms` — a compact string because it rides on a telemetry event whose
   *  size the server caps. */
  spans?: string;
  /** Percent of the freeze covered by instrumented spans, 0-100. Near 0 means
   *  the time is not in any code this app measures — see the header. */
  cover?: number;
}

/**
 * What was running across a blocked interval.
 *
 * Spans are matched by OVERLAP rather than containment: a freeze is regularly
 * one long task made of several pieces, and a span that started before the
 * task and finished inside it is still part of the explanation. Overlaps are
 * summed per name so a phase that ran in several bursts reads as its total.
 *
 * `cover` deliberately sums the overlaps of MERGED intervals rather than of
 * every span: spans nest (a re-index inside a config apply), and adding them
 * naively reports well over 100% coverage, which then reads as a bug in the
 * instrument rather than as nesting.
 */
export function attributeFreeze(startedAt: number, durationMs: number): FreezeAttribution {
  const endAt = startedAt + durationMs;
  const byName = new Map<string, number>();
  const hits: Array<[number, number]> = [];
  for (const s of ring) {
    const ov = overlapMs(s.t0, s.t1, startedAt, endAt);
    if (ov <= 0) continue;
    byName.set(s.name, (byName.get(s.name) ?? 0) + ov);
    hits.push([Math.max(s.t0, startedAt), Math.min(s.t1, endAt)]);
  }
  if (hits.length === 0) return { cover: 0 };

  hits.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let [curStart, curEnd] = hits[0];
  for (let i = 1; i < hits.length; i++) {
    const [s, e] = hits[i];
    if (s > curEnd) { covered += curEnd - curStart; curStart = s; curEnd = e; }
    else if (e > curEnd) curEnd = e;
  }
  covered += curEnd - curStart;

  const top = [...byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, ms]) => `${name}:${Math.round(ms)}`)
    .join(",");

  return {
    spans: top || undefined,
    cover: durationMs > 0 ? Math.round((covered / durationMs) * 100) : 0,
  };
}

/** Drop the history. Called when a scene is torn down, so the next load's
 *  freezes are never explained by the previous villa's work. */
export function resetSpans(): void {
  ring.length = 0;
  runs.clear();
  totals.clear();
}
