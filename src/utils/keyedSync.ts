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

const owns = (o: object, id: string) => Object.prototype.hasOwnProperty.call(o, id);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface KeyedDiff<T> {
  set: Keyed<T>;
  del: string[];
  /** Each changed item as the copy this change was made against held it (diffKeyed `keepWas`): a store that merges an
   *  item field by field (applyKeyedMerging) tells from it whether the item it lands on moved since. Absent: the item
   *  is replaced whole, as it always was (the device-setup store). */
  was?: Keyed<T>;
}

/** Index a list of records by their own id. Both stores key everything this
 *  way (entity_id, mesh name, group id, room name, fm record id). */
export function keyBy<T>(items: readonly T[], id: (item: T) => string): Keyed<T> {
  return Object.fromEntries(items.map((item) => [id(item), item]));
}

/** What did `next` actually change relative to `base`, per item? `keepWas`: with each changed item's `base` copy. */
export function diffKeyed<T>(base: Keyed<T>, next: Keyed<T>, keepWas = false): KeyedDiff<T> {
  const set: Keyed<T> = {};
  const was: Keyed<T> = {};
  for (const [id, item] of Object.entries(next)) {
    if (JSON.stringify(base[id]) !== JSON.stringify(item)) {
      set[id] = item;
      if (keepWas && owns(base, id)) was[id] = base[id];
    }
  }
  const del: string[] = [];
  for (const id of Object.keys(base)) if (!(id in next)) del.push(id);
  return keepWas ? { set, del, was } : { set, del };
}

/** Replay a diff onto some other snapshot (normally the server's freshest),
 *  leaving every item the diff doesn't mention exactly as it was. */
export function applyKeyed<T>(target: Keyed<T>, diff: KeyedDiff<T>): Keyed<T> {
  const out = { ...target, ...diff.set };
  for (const id of diff.del) delete out[id];
  return out;
}

/** How the fields of one item merge when two devices changed it (mergeItem). */
export interface FieldMerge {
  /** Fields that only make sense together (a fault's status and when it was resolved): when one of them was changed on
   *  both sides, the whole group keeps the other side's values. */
  groups?: readonly (readonly string[])[];
  /** List fields kept append-only (a fault's steps): changed on both sides, they hold both sides' entries, each once by
   *  `id`, the other side's in its order, then this side's new ones. `dropMine`: a new entry of this side's left out
   *  because a field it goes with kept the other side's value (`clashed`). */
  lists?: Readonly<Record<string, { id: (entry: unknown) => string; dropMine?: (entry: unknown, clashed: ReadonlySet<string>) => boolean }>>;
}

/**
 * ONE ITEM CHANGED ON TWO DEVICES, merged field by field against the copy both started from (`was`): a field only this
 * side changed takes `mine`; one only the other side changed keeps `theirs`; one both changed to different values keeps
 * `theirs` (it got there first) and is named in `clashed`, for the device to say. Lists and groups: `rules`.
 *
 * ⚠️ THE WHOLE ITEM WAS REPLAYED (to 2.496.501, architecture review H 2026-10-23): a fault closed on the phone, then
 * marked "Started" on a tablet whose copy predated the close, came back open, and "Closed without action" vanished from
 * its history on every device. Pure: tests/oracles/fm_field_merge.mjs.
 */
export function mergeItem<T>(was: T, mine: T, theirs: T, rules: FieldMerge = {}): { item: T; clashed: string[] } {
  const w = (was ?? {}) as Record<string, unknown>, m = (mine ?? {}) as Record<string, unknown>;
  const t = (theirs ?? {}) as Record<string, unknown>;
  const lists = rules.lists ?? {};
  const keys = [...new Set([...Object.keys(t), ...Object.keys(m), ...Object.keys(w)])];
  const bothMoved = (k: string) => !same(m[k], w[k]) && !same(t[k], w[k]);
  const clashed = new Set(keys.filter((k) => !owns(lists, k) && bothMoved(k) && !same(m[k], t[k])));
  for (const group of rules.groups ?? []) if (group.some((k) => clashed.has(k))) for (const k of group) clashed.add(k);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const list = owns(lists, k) ? lists[k] : undefined;
    let v: unknown;
    if (list && bothMoved(k)) {
      const entries = (x: unknown) => (Array.isArray(x) ? (x as unknown[]) : []);
      const had = new Set(entries(w[k]).map(list.id)), theirIds = new Set(entries(t[k]).map(list.id));
      v = [...entries(t[k]), ...entries(m[k]).filter((e) => !theirIds.has(list.id(e))
        && !(!had.has(list.id(e)) && list.dropMine?.(e, clashed)))];
    } else if (clashed.has(k)) v = t[k];
    else v = same(m[k], w[k]) ? t[k] : m[k];
    if (v !== undefined) out[k] = v;
  }
  return { item: out as T, clashed: [...clashed].filter((k) => bothMoved(k) && !same(m[k], t[k])) };
}

/** applyKeyed for a store that merges an item two devices changed (`merge`, normally mergeItem): an item the diff
 *  carries its `was` for, and that `target` holds changed since, is merged; one `target` no longer holds was removed
 *  elsewhere (removedElsewhere) and stays removed; every other one is replayed as it is. */
export function applyKeyedMerging<T>(target: Keyed<T>, diff: KeyedDiff<T>, merge: (was: T, mine: T, theirs: T) => T): Keyed<T> {
  const set: Keyed<T> = {};
  for (const [id, item] of Object.entries(diff.set)) {
    if (removedElsewhere(diff, target, id)) continue;
    const moved = diff.was && owns(diff.was, id) && owns(target, id) && !same(target[id], diff.was[id]);
    set[id] = moved ? merge(diff.was![id], item, target[id]) : item;
  }
  return applyKeyed(target, { set, del: diff.del });
}

/**
 * A change to an item the copy it was made against held (`was`), landing on a copy that no longer holds it: another
 * device removed it meanwhile, and in a store that merges items (applyKeyedMerging) the removal stands. ⚠️ IT WAS
 * REPLAYED AS A NEW ITEM (to 2.496.511, architecture review J): a fault the owner erased on the phone came back "in
 * progress" on every device when a tablet that had marked it Started offline caught up, its photos already gone.
 */
export function removedElsewhere<T>(diff: KeyedDiff<T>, target: Keyed<T>, id: string): boolean {
  return !!diff.was && owns(diff.was, id) && owns(diff.set, id) && !owns(target, id);
}

export function keyedDiffIsEmpty<T>(diff: KeyedDiff<T>): boolean {
  return Object.keys(diff.set).length === 0 && diff.del.length === 0;
}

/** A change to a document of several keyed parts (the config store's shared keys, the Facility store's collections). */
export type KeyedParts = Record<string, KeyedDiff<unknown>>;

/** `diff` with only the items `keep` accepts (`deleted`: the item is a removal, `item` undefined). */
export function keepItems<P extends KeyedParts>(
  diff: P,
  keep: (part: string, id: string, item: unknown, deleted: boolean) => boolean,
): P {
  const out: Record<string, KeyedDiff<unknown>> = {};
  for (const [part, d] of Object.entries(diff)) {
    const set = Object.fromEntries(Object.entries(d.set).filter(([id, item]) => keep(part, id, item, false)));
    out[part] = {
      set,
      del: d.del.filter((id) => keep(part, id, undefined, true)),
      ...(d.was ? { was: Object.fromEntries(Object.entries(d.was).filter(([id]) => owns(set, id))) } : {}),
    };
  }
  return out as P;
}

/** `diff` with every item of `more` added, each with its value and its `was` (an item in both takes `more`'s). */
export function withItems<P extends KeyedParts>(diff: P, more: P): P {
  const out: Record<string, KeyedDiff<unknown>> = {};
  for (const [part, d] of Object.entries(diff)) {
    const x = more[part];
    if (!x || keyedDiffIsEmpty(x)) { out[part] = d; continue; }
    const was = d.was || x.was ? { ...d.was, ...x.was } : undefined;
    out[part] = {
      set: { ...Object.fromEntries(Object.entries(d.set).filter(([id]) => !x.del.includes(id))), ...x.set },
      del: [...new Set([...d.del.filter((id) => !owns(x.set, id)), ...x.del])],
      ...(was ? { was } : {}),
    };
  }
  return out as P;
}

/** Whether `d` names the item, as a change or a removal. */
export function names(d: KeyedDiff<unknown> | undefined, id: string): boolean {
  return !!d && (owns(d.set, id) || d.del.includes(id));
}

/**
 * THIS DEVICE'S OWN EDIT WINS, the one rule for both stores: what the other devices changed (`others`) without the
 * items this device has changed itself (`mine`: its document against the copy it synced with). The store already
 * holds this device's version of them, or will once its push goes; laid on the screen, theirs would undo this
 * device's edit there, and the next refresh would send that undo to every device (2.496.501).
 */
export function mineWins<P extends KeyedParts>(others: P, mine: P): P {
  // ...except a removal of an item this device changed from a copy that held it (`was`, a merging store): it stands
  // in the store (applyKeyedMerging), so it stands on the screen too
  return keepItems(others, (part, id, _item, deleted) => !names(mine[part], id)
    || (deleted && !!mine[part]?.was && owns(mine[part]!.was!, id)));
}

/**
 * The store's changes (`changed`) without this device's OWN writes coming back: an item whose new value is one this
 * device itself sent (`sent`, its pushes not yet confirmed) is not another device's change. A push that landed but
 * answered too late ends as a failure here, so the next push finds that write in the store as if someone else had made
 * it (2.496.501).
 */
export function withoutOwnWrites<P extends KeyedParts>(changed: P, sent: readonly P[]): P {
  return keepItems(changed, (part, id, item, deleted) => !sentIt(sent, part, id, item, deleted));
}

/** The other half: only the items whose new value is one this device sent (a push that ended as a failure may have
 *  landed all the same: utils/syncedDocument looks for it in the store before taking it back). */
export function ownWrites<P extends KeyedParts>(changed: P, sent: readonly P[]): P {
  return keepItems(changed, (part, id, item, deleted) => sentIt(sent, part, id, item, deleted));
}

function sentIt(sent: readonly KeyedParts[], part: string, id: string, item: unknown, deleted: boolean): boolean {
  return sent.some((s) => {
    const d = s[part];
    if (!d) return false;
    return deleted ? d.del.includes(id) : owns(d.set, id) && same(d.set[id], item);
  });
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
  | { ok: false; conflict: boolean }
  /** The server said NO (400/401/403/413) — final, not a blip. ⚠️ It was
   *  `{ conflict: false }` like a dropped connection, so a refused write was
   *  kept, marked unsaved and re-pushed on every reload for good, while that
   *  device stopped accepting anyone else's changes (round 13, 2.496.184). */
  | { ok: false; conflict: false; refused: true; message?: string };

export type PushOutcome<TDoc> =
  /** `base`: the server's copy this device's diff was replayed onto, i.e. what the OTHER devices had changed since
   *  this one last synced (config/deviceConfig remoteChange), before its own diff went on top. */
  | { ok: true; next: TDoc; base: TDoc; rev: string; attempts: number }
  | { ok: false; reason: "nothing-to-push" | "transport" | "conflict-retries-exhausted" }
  | { ok: false; reason: "refused"; message?: string };

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
  /** The diff as sent onto THIS copy of the store, when it depends on what the store holds (utils/syncedDocument: a
   *  write of this device's that may have landed after its push gave up). Given, an empty `diff` still reads the store. */
  atBase?: (base: TDoc, diff: TDiff) => TDiff;
}): Promise<PushOutcome<TDoc>> {
  if (opts.isEmpty(opts.diff) && !opts.atBase) return { ok: false, reason: "nothing-to-push" };
  const maxAttempts = opts.maxAttempts ?? 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const fresh = await opts.fetchFresh();
    const base = fresh ? opts.rebase(opts.baseline, fresh.doc) : opts.baseline;
    const diff = opts.atBase ? opts.atBase(base, opts.diff) : opts.diff;
    // nothing to send onto the store as it is; unread, that is not known
    if (opts.isEmpty(diff)) return fresh ? { ok: false, reason: "nothing-to-push" } : { ok: false, reason: "transport" };
    const next = opts.apply(base, diff);
    const result = await opts.save(next, fresh?.rev ?? "0", fresh?.raw ?? {});
    if (result.ok) return { ok: true, next, base, rev: result.rev, attempts: attempt + 1 };
    if ("refused" in result && result.refused) return { ok: false, reason: "refused", message: result.message };
    if (!result.conflict) return { ok: false, reason: "transport" };
    // Someone else's write landed between our read and our write — loop and
    // rebase this device's diff onto the copy the 409 tells us now exists.
  }
  return { ok: false, reason: "conflict-retries-exhausted" };
}
