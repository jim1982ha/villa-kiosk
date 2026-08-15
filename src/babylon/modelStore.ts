// src/babylon/modelStore.ts
//
// "Answers about THIS GLB's geometry that are expensive to recompute."
//
// Two subsystems need exactly this and had no business writing it twice: the
// floor probe (what is the floor height at this point) and the camera beams
// (how far can this cone reach before it pokes through a wall). Both answers
// are pure functions of the model's geometry, both cost a ~21ms raycast against
// a fused ~1.4M-triangle mesh with no picking octree, and both are recomputed
// from scratch on every single load unless something like this exists.
//
// ── Why keyed by the VERSIONED model URL ───────────────────────────────────
// It is what makes reuse SAFE rather than merely fast: a stale answer cannot
// outlive the model it describes, because a new upload changes the key and the
// old entry is never read again. Recentring and scale normalisation run before
// any of these queries and are deterministic, so the same bytes really do
// produce the same world positions.
//
// ── Why one model at a time ────────────────────────────────────────────────
// An older GLB's entries are dead weight the moment a new one is uploaded, and
// this runs on devices where storage pressure is real — an iPad that has been
// on a wall for a year, and an Android PWA that gets evicted whenever it is
// backgrounded (which is exactly why reloads are the common case here, and
// therefore why any of this is worth doing).
//
// ⚠️ The one rule that matters, learned the hard way in 2.346.0/2.349.0: what
// you SAVE must be the accumulated set, never a per-pass lookup map that some
// other code path is entitled to clear. This class deliberately takes the data
// to write as an argument rather than owning a mutable map, so that decision
// stays visible at the call site instead of hiding in here.

/** Bumping a prefix silently invalidates every stored answer under it — which
 *  is correct when the MEANING of a key changes (see FloorProbe's `vk.probe2.`,
 *  bumped because reading a grid-keyed entry as room-keyed would have
 *  reinstated a real bug) and pure waste otherwise. */
export type StorePrefix = string;

export class ModelKeyedStore<T> {
  private storeKey: string | null = null;

  /** `sweepPattern` must match every key this store has ever used, including
   *  retired prefixes, so an old naming scheme is evicted rather than orphaned
   *  forever in a storage area nobody looks at. */
  constructor(private prefix: StorePrefix, private sweepPattern: RegExp) {}

  /** `key` is the versioned model URL; null disables persistence entirely (and
   *  is the honest state before a model is known, rather than a guess). */
  setModel(key: string | null): void {
    this.storeKey = key ? `${this.prefix}${key}` : null;
  }

  get enabled(): boolean {
    return this.storeKey !== null;
  }

  /** Everything stored for the current model, or an empty map. Never throws:
   *  an unreadable or quota-evicted store is a cache miss, not an error. */
  load(): Map<string, T> {
    const out = new Map<string, T>();
    if (!this.storeKey) return out;
    try {
      const raw = localStorage.getItem(this.storeKey);
      if (!raw) return out;
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, T>)) out.set(k, v);
    } catch { /* unreadable or evicted — just recompute */ }
    return out;
  }

  /** Replace this model's entries, and evict every other model's. */
  save(data: ReadonlyMap<string, T>): void {
    if (!this.storeKey) return;
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i);
        if (k && this.sweepPattern.test(k) && k !== this.storeKey) localStorage.removeItem(k);
      }
      localStorage.setItem(this.storeKey, JSON.stringify(Object.fromEntries(data)));
    } catch { /* quota / private mode — this is an optimisation, not state */ }
  }
}
