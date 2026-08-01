// src/utils/keyedSync.ts
// THE shared machinery for reconciling a document that several devices can
// edit at once, used by BOTH server-backed stores in this app: the shared
// device configuration (config/deviceConfig.ts) and the Facility Manager
// working set (fm/fmApi.ts).
//
// It exists because the same three rules have to hold for any such store, and
// getting one of them wrong is not a cosmetic bug — it silently destroys work
// somebody did on another device:
//
//   1. DIFF PER ITEM, NEVER PUT THE WHOLE DOCUMENT. Sending "everything this
//      device currently has" cannot distinguish "I changed this" from "I'm
//      just carrying this unchanged", so whichever write lands last wins for
//      the WHOLE document and erases the other device's edit. Diffing against
//      the baseline this device last synced against, then replaying only the
//      changed items onto the server's freshest copy, makes concurrent edits
//      to different items commute.
//
//   2. WRITE UNDER OPTIMISTIC CONCURRENCY. The write carries the revision it
//      was computed against; if another write landed in the gap the server
//      rejects it (409) and we rebase and retry rather than clobber.
//
//   3. CARRY UNKNOWN KEYS BACK. Reads deliberately drop keys this app version
//      doesn't recognise, but a write rebuilt from the parsed shape alone
//      would then DELETE a newer version's field for every device. A mixed
//      fleet is normal for a while after any release (and longer for an
//      installed PWA), so a write must preserve what it didn't understand.
//
// All three were learned from real field failures on the device-config store;
// the FM store had the same shape and none of the protections, which is why
// this is shared code now instead of a second hand-rolled copy.

export type Keyed<T> = Record<string, T>;

export interface KeyedDiff<T> {
  set: Keyed<T>;
  del: string[];
}

/** Index a list of records by their own id. Both stores key everything this
 *  way (entity_id, mesh name, group id, room name, fm record id). */
export function keyBy<T>(items: readonly T[], id: (item: T) => string): Keyed<T> {
  return Object.fromEntries(items.map((item) => [id(item), item]));
}

/** What did `next` actually change relative to `base`, per item? */
export function diffKeyed<T>(base: Keyed<T>, next: Keyed<T>): KeyedDiff<T> {
  const set: Keyed<T> = {};
  for (const [id, item] of Object.entries(next)) {
    if (JSON.stringify(base[id]) !== JSON.stringify(item)) set[id] = item;
  }
  const del: string[] = [];
  for (const id of Object.keys(base)) if (!(id in next)) del.push(id);
  return { set, del };
}

/** Replay a diff onto some other snapshot (normally the server's freshest),
 *  leaving every item the diff doesn't mention exactly as it was. */
export function applyKeyed<T>(target: Keyed<T>, diff: KeyedDiff<T>): Keyed<T> {
  const out = { ...target, ...diff.set };
  for (const id of diff.del) delete out[id];
  return out;
}

export function keyedDiffIsEmpty<T>(diff: KeyedDiff<T>): boolean {
  return Object.keys(diff.set).length === 0 && diff.del.length === 0;
}

/** One fetch of a shared store: the parsed document, the revision it was read
 *  at, and the raw stored object (for rule 3's carry-over). */
export interface StoreFetch<TDoc> {
  doc: TDoc;
  /** Opaque revision token. A STRING deliberately: the server derives it from
   *  a nanosecond timestamp, which is far past JavaScript's safe integer range
   *  — as a number it silently rounded and every conditional write 409'd
   *  forever. Never parse it, only pass it back. */
  rev: string;
  raw: Record<string, unknown>;
}

export type StoreSaveResult =
  | { ok: true; rev: string }
  | { ok: false; conflict: boolean };

export type PushOutcome<TDoc> =
  | { ok: true; next: TDoc; rev: string; attempts: number }
  | { ok: false; reason: "nothing-to-push" | "transport" | "conflict-retries-exhausted" };

/** Rules 1-3 as one loop: fetch the freshest copy, replay THIS device's diff
 *  onto it, write under the revision that copy came at, and rebase-retry if
 *  another write beat us to it. Callers own what a "diff" means for their
 *  document and what to report — this owns the concurrency protocol, which is
 *  the part that must not be reimplemented per store. */
export async function pushWithRebase<TDoc, TDiff>(opts: {
  diff: TDiff;
  isEmpty: (diff: TDiff) => boolean;
  /** Fallback when the server can't be read this attempt. */
  baseline: TDoc;
  fetchFresh: () => Promise<StoreFetch<TDoc> | null>;
  /** Merge the freshest server doc under this device's own baseline, so keys
   *  the server omits still resolve to something sane. */
  rebase: (baseline: TDoc, fresh: TDoc) => TDoc;
  apply: (target: TDoc, diff: TDiff) => TDoc;
  save: (next: TDoc, rev: string, carryOver: Record<string, unknown>) => Promise<StoreSaveResult>;
  maxAttempts?: number;
}): Promise<PushOutcome<TDoc>> {
  if (opts.isEmpty(opts.diff)) return { ok: false, reason: "nothing-to-push" };
  const maxAttempts = opts.maxAttempts ?? 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const fresh = await opts.fetchFresh();
    const base = fresh ? opts.rebase(opts.baseline, fresh.doc) : opts.baseline;
    const next = opts.apply(base, opts.diff);
    const result = await opts.save(next, fresh?.rev ?? "0", fresh?.raw ?? {});
    if (result.ok) return { ok: true, next, rev: result.rev, attempts: attempt + 1 };
    if (!result.conflict) return { ok: false, reason: "transport" };
    // Someone else's write landed between our read and our write — loop and
    // rebase this device's diff onto the copy the 409 tells us now exists.
  }
  return { ok: false, reason: "conflict-retries-exhausted" };
}
