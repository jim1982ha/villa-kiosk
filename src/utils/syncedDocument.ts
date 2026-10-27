// src/utils/syncedDocument.ts
// A document shared through one of the add-on's stores — its whole sync state
// machine, in one place, with no React: what the server is known to hold (the
// baseline) and at which revision, which writes are in flight, which were
// started, which failed — and the one decision a pull makes from those facts.
//
// ⚠️ THE MACHINE WAS WRITTEN TWICE (round 10, 2.496.154). The device-config
// store and the Facility store each kept their own baseline, revision and
// write tracking and fed utils/pullDecision their own facts — "is local
// ahead" was a JSON compare in one and a pair of counters in the other.
// Three fixes had already paid for the split (c81bcdce, bd9efc30, 67c32ccb),
// and one hole was still open: only the Facility store knew a write had
// started DURING a pull's fetch, so on the config store a pull whose fetch
// began before a push landed could apply the older copy over the edit just
// pushed. Both stores are adapters of this now; each keeps only its own
// policy (the config store's debounce, derived rows and persisted baseline;
// the Facility store's elevation and restoring a refused delete).
//
// Pure, framework-free: tests/oracles/synced_document.mjs drives it with a
// fake store.

import { decidePull, type PullAction } from "./pullDecision";
import { notDoneLine, saveProblemLine } from "./storeSave";
import {
  keepItems, names, ownWrites, pushWithRebase, withItems, withoutOwnWrites,
  type KeyedParts, type PushOutcome, type StoreFetch, type StoreSaveResult,
} from "./keyedSync";

/** How long ONE push may take, all its attempts, before it ends as a transport failure (2.496.500): its work stays
 *  marked unsaved, so the next refresh sends it again, and the pushes and pulls waiting behind it go on. Before, a
 *  request that never answered (Wi-Fi gone half-way) held every later save and refresh of this store for good. */
export const PUSH_DEADLINE_MS = 15_000;

/** This device's work the store has not confirmed, as kept across a reload: the confirmed baseline it was made against
 *  (or the part of it the work touches: the keeper decides) and the change itself. */
export interface UnsentCopy<D, Diff> {
  baseline: D;
  unsent: Diff;
}

/** Where a document keeps its unsent work across a reload (the Facility store: fm/fmApi fmUnsentKeeper), one copy per
 *  author (spec.author). `load` returns null for nothing kept, or a copy it cannot trust (another format, storage
 *  disabled); `save(author, null)` forgets it. Neither may throw. */
export interface UnsentKeeper<D, Diff> {
  load: (author: string) => UnsentCopy<D, Diff> | null;
  save: (author: string, copy: UnsentCopy<D, Diff> | null) => void;
  /** Every author whose work is kept now (heldAuthors). Default: none listed. */
  authors?: () => string[];
}

/** The documents a page holds now (SyncedDocument.track): the daily reload asks them (unsentWorkHeld). */
const tracked = new Set<{ readonly holdsUnsentWork: boolean }>();

/** Some store of this page holds work the add-on has not confirmed: a write out, or one that failed. The daily reload
 *  waits (utils/autoReload): a reload drops what only this page holds (architecture review i_k3, 2026-10-23). */
export function unsentWorkHeld(): boolean {
  for (const d of tracked) if (d.holdsUnsentWork) return true;
  return false;
}

export interface SyncedDocumentSpec<D, Diff extends KeyedParts, F extends StoreFetch<D> = StoreFetch<D>> {
  /** The server's copy, in baseline form; null when it cannot be reached. `signal`: a push that ran out of time
   *  aborts the request it was waiting on. */
  fetch: (signal?: AbortSignal) => Promise<F | null>;
  save: (next: D, rev: string, carryOver: Record<string, unknown>, signal?: AbortSignal) => Promise<StoreSaveResult>;
  diff: (base: D, local: D) => Diff;
  isEmpty: (diff: Diff) => boolean;
  apply: (target: D, diff: Diff) => D;
  /** The server's fresh copy under this device's baseline (keys it omits). */
  rebase: (baseline: D, fresh: D) => D;
  /** A fetched copy that is an EMPTY STORE (nothing written yet) — seeded
   *  rather than applied. Default: never. */
  serverEmpty?: (fetched: F) => boolean;
  /** The confirmed baseline to seed with when the store is empty. */
  empty: D;
  /** Whether this device may write at all (checked when a push RUNS). ⚠️ "NOT ALLOWED" IS NOT "KEEP WAITING"
   *  (architecture review J, 2026-10-23): an owner's setup change that could not be sent, then the tablet handed back
   *  to the guest, re-pushed at every refresh and was refused before it went: the tablet stopped reading the store
   *  (other tablets' changes never came) and the 04:00 reload waited for an owner, for weeks. Work this profile may
   *  not send is PARKED: kept, never sent, not counted as held (unsentWorkHeld), and the refreshes read the store. */
  canWrite?: () => boolean;
  /** Whose work this is: the profile signed in now. Unsent work is kept per author (spec.keep) and replayed only
   *  under its author (switchAuthor). ⚠️ ONE COPY PER TABLET (to 2.496.511, architecture review J): a facility
   *  manager's "Started" held offline was shown to the guest signed in after a reload, sent under the guest's
   *  sign-in and refused, and the guest's own report, which carried it, was refused too. Default: one author. */
  author?: () => string;
  /** Whether the author signed in now sends the work kept for `other` too (its steps keep their own author). ⚠️ HELD
   *  WORK WAS NEVER SENT BY ANYONE ELSE (to 2.496.516, architecture review K): a facility manager's Started held
   *  offline, then the owner signed in and the add-on came back: nothing was sent, nothing said, and it went only if
   *  that same profile signed in again on that same tablet. Default: only its own. */
  carries?: (other: string) => boolean;
  /** Called every time the baseline moves — the config store persists it. */
  onBaseline?: (baseline: D) => void;
  /** Where the unsent work is kept across a reload, and read back from when this document starts. ⚠️ THE FACILITY
   *  STORE'S WORK LIVED IN THE PAGE ALONE (architecture review i_k3, 2026-10-23): a fault reported while the add-on
   *  could not be reached was told "Saved on this device, it will be sent automatically", and the 04:00 reload, iOS
   *  dropping the tab or a pull to refresh lost it, nothing said. The config store keeps its own (its baseline here,
   *  its document in ConfigContext). */
  keep?: UnsentKeeper<D, Diff>;
  maxAttempts?: number;
  /** The push deadline. The stores never set it (PUSH_DEADLINE_MS); an oracle shortens it. */
  deadlineMs?: number;
}

export type PullResult<F> =
  | { action: "wait" | "unreachable" | "repush"; fetched?: undefined }
  | { action: "seed" | "noop" | "apply"; fetched: F };

/** On success: `synced`, the baseline this push's diff was computed against, and `others`, what the OTHER devices
 *  changed in the store since then, item by item: the store's copy this push went onto against `synced`, without this
 *  device's own writes coming back (keyedSync withoutOwnWrites). Each store lays `others` under its own edits
 *  (keyedSync mineWins). ⚠️ NOT THE STORE'S COPY ITSELF (`base`, to 2.496.500): against `synced`, a write of this
 *  device's that landed after its push gave up on it read as another device's change. */
export type PushResult<D, Diff> =
  | (Omit<Extract<PushOutcome<D>, { ok: true }>, "base"> & { synced: D; others: Diff })
  | Exclude<Extract<PushOutcome<D>, { ok: false }>, { reason: "refused" }>
  /** `takeBack`: what puts every item this push SENT back as the store holds it, for the adapter to lay on its local
   *  document (an edit made since on the same item stays). ⚠️ THE ADAPTER UNDID ITS OWN ACTION (to 2.496.511,
   *  architecture review J): a refresh's retry of held work is an action that changes nothing, so a refused retry took
   *  nothing back, the work was kept again, refused again at every refresh, and every later save carried it and was
   *  refused too. */
  | (Extract<PushOutcome<D>, { reason: "refused" }> & { takeBack: Diff })
  | { ok: false; reason: "not-allowed" | "not-pulled" };

/** What a push's answer made of a screen's change (landPush): it landed; there was nothing to send (or this profile
 *  may not, or the store was never read); the add-on said no (taken back); it is kept on this device and sent again;
 *  it could not be sent again and was taken back (`once`). */
export type SaveVerdict = "saved" | "unchanged" | "refused" | "unsent" | "undone";

/** A store's own way of laying a push's answer on its screen copy as it is NOW (each store's copy and its merge are
 *  its own: the device setup's mergeRemote, the Facility record's foldOthers). */
export interface ScreenCopy<D, Diff> {
  /** The push landed: other tablets' changes (`others`, against `synced`) laid under this device's own edits. Returns
   *  what the screen says of them (a record both changed, one removed elsewhere), or null. */
  landed: (o: Extract<PushResult<D, Diff>, { ok: true }>) => string | null;
  /** The add-on said no: what this push SENT, taken back (an edit made since stays). */
  takeBack: (diff: Diff) => void;
  /** A write that cannot be sent again (a delete's single-use code): when it did not land, `undo` takes it back and
   *  the screen says `what` was not done, and why. */
  once?: { undo: () => void; what: string };
}

/**
 * THE meaning of a push's answer for a screen, for both stores (architecture review O, 2026-10-27): which answers say
 * nothing, which are taken back, which are kept and sent again, and the one line the screen shows. Each store did it
 * itself and they drifted: eight releases in ten days repaired the same case once per store, and the Facility store
 * said "refused by the add-on" for a delete the Wi-Fi had dropped.
 */
export function landPush<D, Diff>(outcome: PushResult<D, Diff>, screen: ScreenCopy<D, Diff>): {
  verdict: SaveVerdict; line: string | null;
} {
  if (outcome.ok) return { verdict: "saved", line: screen.landed(outcome) };
  if (outcome.reason === "nothing-to-push" || outcome.reason === "not-allowed" || outcome.reason === "not-pulled") {
    return { verdict: "unchanged", line: null };
  }
  if (outcome.reason === "refused") {
    screen.takeBack(outcome.takeBack);
    return { verdict: "refused", line: saveProblemLine(outcome) };
  }
  if (screen.once) {
    screen.once.undo();
    return { verdict: "undone", line: notDoneLine(outcome, screen.once.what) };
  }
  return { verdict: "unsent", line: saveProblemLine(outcome) };
}

/** One push's own change, from the moment it is sent until the store is known to hold it. */
interface Unconfirmed<Diff> {
  sent: Diff;
  /** It ended unsent as far as this device knows (a transport failure) — it may still have landed. */
  failed: boolean;
}

export class SyncedDocument<D, Diff extends KeyedParts, F extends StoreFetch<D> = StoreFetch<D>> {
  /** What the server is known to hold; null until the first pull when the
   *  document starts unknown (a push waits for it: pull before push). */
  baseline: D | null;
  rev = "0";
  private inFlight = 0;
  private writes = 0;
  /** The push running now, which the next one waits for (push). */
  private queue: Promise<unknown> = Promise.resolve();
  private unsaved = false;
  /** The local document the latest push was handed (what `promised` is while pushes are out). */
  private lastPushed: D | null = null;
  /** What this device has sent and not seen confirmed: the push out, and those that failed (they may have landed all
   *  the same) until a push succeeds or the work is dropped (2.496.501). */
  private readonly unconfirmed = new Set<Unconfirmed<Diff>>();
  /** `promised` while no push is out, kept for as long as the baseline and the failed pushes stay the same. */
  private held: { baseline: D; failed: number; doc: D } | null = null;
  private failedVersion = 0;
  private read = false;
  private readonly spec: SyncedDocumentSpec<D, Diff, F>;

  /** The local document the unsent work kept before a reload makes (spec.keep): the adapter starts from it. Null:
   *  nothing was kept. */
  readonly restored: D | null = null;
  /** Whose unsent work this document holds (spec.author). */
  private author: string;
  private readonly initial: D | null;

  constructor(spec: SyncedDocumentSpec<D, Diff, F>, initial: D | null) {
    this.spec = spec;
    this.baseline = initial;
    this.initial = initial;
    this.author = spec.author?.() ?? "";
    this.restored = this.takeKept();
  }

  /** The author's kept work, and the kept work of every author it carries (spec.carries), laid on this document as
   *  pushes that failed: they may have landed before the reload (then merged as this device's own write, never
   *  another's), and the next refresh sends them again (pull "repush"), onto the store's fresh copy, item by item. A
   *  carried author's copy becomes this author's (one copy, sent once). Returns the local document it makes, or null
   *  when nothing is kept. */
  private takeKept(): D | null {
    const keep = this.spec.keep;
    if (!keep) return null;
    const others = (keep.authors?.() ?? []).filter((a) => a !== this.author && (this.spec.carries?.(a) ?? false));
    const copies = [this.author, ...others]
      .map((a) => ({ a, kept: keep.load(a) }))
      .filter((c): c is { a: string; kept: UnsentCopy<D, Diff> } => !!c.kept && !this.spec.isEmpty(c.kept.unsent));
    if (!copies.length) return null;
    // The records the work touches, as its authors last saw them: all this device knows of the store for them. A copy
    // read under another profile is not one (a guest reads an empty record): the next push reads the store afresh.
    let baseline = copies[0].kept.baseline;
    for (const c of copies.slice(1)) baseline = this.spec.apply(baseline, this.spec.diff(this.spec.empty, c.kept.baseline));
    let local = baseline;
    for (const c of copies) local = this.spec.apply(local, c.kept.unsent);
    this.baseline = baseline;
    this.read = false;
    for (const c of copies) this.unconfirmed.add({ sent: c.kept.unsent, failed: true });
    this.failedVersion += 1;
    this.unsaved = true;
    if (copies.some((c) => c.a !== this.author)) {
      keep.save(this.author, { baseline, unsent: this.spec.diff(baseline, local) });
      for (const c of copies) if (c.a !== this.author) keep.save(c.a, null);
    }
    return local;
  }

  /** The authors whose work is kept on this device and that the author signed in now does not send: a screen says it
   *  waits ("Work by the facility manager is waiting on this tablet"). */
  heldAuthors(): string[] {
    return (this.spec.keep?.authors?.() ?? []).filter((a) => a !== this.author && !(this.spec.carries?.(a) ?? false));
  }

  /**
   * Another profile signed in on this page (spec.author): the unsent work of the one before is kept for them (spec.keep)
   * and taken off this document, never shown to, nor sent as, the next one; the new author's kept work is laid on it.
   * Returns the local document the adapter shows now, or null when the author is the same. The adapter then refreshes:
   * the store as this profile may read it, and its kept work sent.
   */
  switchAuthor(local: D): D | null {
    const author = this.spec.author?.() ?? "";
    if (author === this.author) return null;
    if (this.unsaved) this.keepUnsent(local);
    // ⚠️ A SAVE STILL OUT IS NOT FORGOTTEN (architecture review K, 2026-10-24): a facility manager's Started on a slow
    // connection, the owner signed in before it answered: the new profile got the confirmed copy from BEFORE that save,
    // the save landed, and the owner's next refresh read the screen as unsent work and sent the old "open" back. The
    // write out stays awaited (only the failed ones belong to the author before), and the screen shows what the store
    // will hold once it lands.
    const out = this.inFlight > 0 ? this.lastPushed : null;
    this.author = author;
    for (const u of this.unconfirmed) if (u.failed) this.unconfirmed.delete(u);
    this.failedVersion += 1;
    this.unsaved = false;
    if (!this.read) this.baseline = this.initial;
    const kept = this.takeKept();
    if (kept !== null && out !== null && this.baseline !== null) {
      // the new author's kept work, laid on what the write out will leave in the store
      return this.spec.apply(out, this.spec.diff(this.baseline, kept));
    }
    return kept ?? out ?? this.baseline ?? this.spec.empty;
  }

  /** This profile may send (spec.canWrite). */
  private get writable(): boolean { return !this.spec.canWrite || this.spec.canWrite(); }

  /** Counted by unsentWorkHeld while the page holds it (its adapter's effect). Returns the untrack. */
  track(): () => void {
    tracked.add(this);
    return () => { tracked.delete(this); };
  }

  /** A write from this device failed and its work is only here. */
  get hasUnsaved(): boolean { return this.unsaved; }

  /** Work the store has not confirmed: a failed write, or one out. Work this profile may not send is parked, not held
   *  (spec.canWrite): kept as it is, a reload loses nothing of it. */
  get holdsUnsentWork(): boolean { return (this.unsaved && this.writable) || this.inFlight > 0; }

  /**
   * Keep `local` against the confirmed baseline as this device's unsent work (spec.keep), or forget it when there is
   * none. A push calls it as it is handed its document, so a write out when the page reloads is kept too; the adapter
   * calls it after it takes a change back. Against the CONFIRMED baseline, never a newer copy of the store: a newer one
   * holds other devices' changes `local` lacks, which replayed would take them away.
   */
  keepUnsent(local: D): void {
    const keep = this.spec.keep;
    if (!keep || this.baseline === null) return;
    const unsent = this.spec.diff(this.baseline, local);
    keep.save(this.author, this.spec.isEmpty(unsent) ? null : { baseline: this.baseline, unsent });
  }

  /** The store has been read (or written) at least once: until then the baseline is only the one this document was
   *  started with, and a screen must not show it as the store's (architecture review H, 2026-10-23: the Facility
   *  record unread on opening showed as an empty one, no fault anywhere and nothing said). */
  get hasRead(): boolean { return this.read; }

  /**
   * What the server WILL hold once the pushes out and waiting land: the confirmed baseline with each of them laid on
   * it, i.e. the local document the latest push was handed (2.496.500). Nothing out: the baseline. A push sends what
   * the local document changed against THIS, and the config store's push gate compares with it. Against the
   * confirmed baseline, a value put back while the push carrying it was out (Cancel, a toggle undone) read as no
   * change at all: the undo was never sent, and every other tablet kept the cancelled value.
   */
  get promised(): D | null {
    if (this.inFlight > 0) return this.lastPushed;
    // ⚠️ A PUSH THAT ENDED AS A FAILURE MAY HAVE LANDED (architecture review H, 2026-10-23): a save that answered after
    // the deadline was in the store, and against the confirmed baseline a Cancel of it was no change: the push gate
    // never fired, the next push found nothing to send, and the next refresh brought the cancelled value back here.
    const baseline = this.baseline;
    const failed = [...this.unconfirmed].filter((u) => u.failed);
    if (baseline === null || failed.length === 0) return baseline;
    if (this.held?.baseline !== baseline || this.held.failed !== this.failedVersion) {
      this.held = { baseline, failed: this.failedVersion,
        doc: failed.reduce<D>((doc, u) => this.spec.apply(doc, u.sent), baseline) };
    }
    return this.held.doc;
  }

  /** This device holds work the server has not got: a failed write, or a
   *  local document that differs from the confirmed baseline. */
  isAhead(local: D): boolean {
    return this.unsaved || (this.baseline !== null && !this.spec.isEmpty(this.spec.diff(this.baseline, local)));
  }

  private commit(next: D, rev: string): void {
    this.read = true;
    this.baseline = next;
    this.rev = rev;
    this.spec.onBaseline?.(next);
  }

  /**
   * Read the server's copy and decide what to do with it (utils/pullDecision).
   * `local()` is read AFTER the fetch — the edit most at risk is the one made
   * while it was in flight — and `wouldChange(fetched)` says whether applying
   * it would change what this device shows. The baseline advances on seed,
   * apply and noop; on "repush" the caller pushes its local document.
   */
  async pull(local: () => D, wouldChange: (fetched: F) => boolean): Promise<PullResult<F>> {
    if (this.inFlight > 0) return { action: "wait" };
    const writable = this.writable;
    if (this.unsaved && writable) return { action: "repush" };
    const writesBefore = this.writes;
    const fetched = await this.spec.fetch();
    const action: PullAction = decidePull({
      writeInFlight: this.inFlight > 0,
      reached: fetched !== null,
      serverEmpty: fetched !== null && (this.spec.serverEmpty?.(fetched) ?? false),
      // A write STARTED during the fetch makes the fetched copy older than
      // this device — whether or not it has finished by now.
      // Work this profile may not send is parked (spec.canWrite): the store's copy is read under it, never over it (the
      // adapter lays another tablet's change only on what this one has not changed itself).
      localAhead: this.writes !== writesBefore || (writable && this.isAhead(local())),
      wouldChange: fetched !== null && wouldChange(fetched),
    });
    if (action === "wait" || action === "unreachable" || action === "repush") return { action };
    const f = fetched as F;
    this.commit(action === "seed" ? this.spec.empty : f.doc, f.rev);
    // the store holds everything this device had: a copy kept for this author is stale, never to be sent again
    if (!this.unsaved && this.inFlight === 0 && writable) this.spec.keep?.save(this.author, null);
    return { action, fetched: f };
  }

  /**
   * Send what this device changed — replayed onto the server's freshest copy, under optimistic concurrency, retried
   * on a conflict (utils/keyedSync). On success the baseline is the merged result.
   *
   * ⚠️ ONE AT A TIME (2.496.499). A push started while another is out waits for it, then sends its change against the
   * baseline that one committed. Two at once both diffed against the same old baseline: the second re-sent the first's
   * change and read it back as ANOTHER tablet's, so an open dialog took the first edit for a remote one, and Cancel
   * after two quick edits undid only the second. A pull waits for both.
   *
   * ⚠️ ITS CHANGE IS `local` AGAINST WHAT IS PROMISED (2.496.500), the pushes ahead of it included: so an edit put
   * back while the push carrying it is out is a change, and it is sent. Against the confirmed baseline it was none.
   * That holds only if `local` is this device's TRUE document when the push is called: a caller that builds it from a
   * copy older than its last push would send that push's change back undone (the Facility store moves its copy at
   * once, FmDataContext mutate). After a push ahead of it FAILED, that push's work is only here: the whole of `local`
   * against the confirmed baseline is sent.
   */
  async push(
    local: D,
    /** This write's own save — the Facility store's deletes carry a
     *  single-use elevation token. Default: the spec's. */
    save: SyncedDocumentSpec<D, Diff, F>["save"] = this.spec.save,
  ): Promise<PushResult<D, Diff>> {
    const from = this.promised;
    if (from === null) return { ok: false, reason: "not-pulled" };
    this.keepUnsent(local);
    this.lastPushed = local;
    this.inFlight += 1;
    const author = this.author;
    const run = this.queue.then(() => this.pushNow(from, local, save, author));
    this.queue = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.inFlight -= 1;
    }
  }

  /** The unsent work is settled (`unsaved` cleared): the failed pushes' writes are no longer awaited. */
  private settle(mine: Unconfirmed<Diff>): void {
    this.unconfirmed.delete(mine);
    for (const u of this.unconfirmed) if (u.failed) this.unconfirmed.delete(u);
    this.failedVersion += 1;
  }

  private async pushNow(
    from: D, local: D, save: SyncedDocumentSpec<D, Diff, F>["save"], author: string,
  ): Promise<PushResult<D, Diff>> {
    if (this.spec.canWrite && !this.spec.canWrite()) return { ok: false, reason: "not-allowed" };
    const baseline = this.baseline ?? from;
    const own = this.unsaved || baseline === from ? local : this.spec.apply(baseline, this.spec.diff(from, local));
    const diff = this.spec.diff(baseline, own);
    const mine: Unconfirmed<Diff> = { sent: diff, failed: false };
    // ⚠️ WHAT A FAILED PUSH MAY HAVE LEFT IN THE STORE IS TAKEN BACK WHERE THIS DEVICE NO LONGER HOLDS IT (architecture
    // review H, 2026-10-23). Against the confirmed baseline, a rename whose save landed after the deadline and was then
    // cancelled was no change at all ("nothing to push"): the store kept the rename, and the next refresh brought it
    // back here and to every tablet. Read against the store's fresh copy: each item of those pushes the store holds
    // as this device sent it, and this device's document no longer does, is sent again as this device has it.
    const failed = [...this.unconfirmed].filter((u) => u.failed).map((u) => u.sent);
    const atBase = failed.length === 0 ? undefined : (base: D, d: Diff): Diff => {
      const landed = ownWrites(this.spec.diff(baseline, base), failed);
      mine.sent = withItems(d, keepItems(this.spec.diff(base, own), (part, id) => names(landed[part], id)));
      return mine.sent;
    };
    this.unconfirmed.add(mine);
    this.writes += 1;
    // ⚠️ ONE DEADLINE FOR THE WHOLE PUSH, HERE AND NOWHERE ELSE (2.496.500). Past it, the request is aborted and every
    // later step of this push refuses to run, so a late answer can neither commit a baseline nor send a stale retry
    // after the next push has gone.
    const abort = new AbortController();
    const live = () => { if (abort.signal.aborted) throw new Error("push past its deadline"); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), this.spec.deadlineMs ?? PUSH_DEADLINE_MS);
    });
    const work = pushWithRebase({
      diff,
      isEmpty: this.spec.isEmpty,
      baseline,
      fetchFresh: async () => {
        live();
        const f = await this.spec.fetch(abort.signal);
        live();
        return f === null ? null : { doc: f.doc, rev: f.rev, raw: f.raw };
      },
      rebase: this.spec.rebase,
      apply: this.spec.apply,
      save: async (next, rev, carryOver) => {
        live();
        const r = await save(next, rev, carryOver, abort.signal);
        live();
        return r;
      },
      maxAttempts: this.spec.maxAttempts,
      atBase,
    });
    let outcome: PushOutcome<D> | "late";
    try {
      outcome = await Promise.race([work, deadline]);
    } catch {
      // a store call that threw is a transport failure like any other: its work is only here
      outcome = { ok: false, reason: "transport" };
    } finally {
      clearTimeout(timer);
    }
    if (outcome === "late") {
      abort.abort();
      work.catch(() => undefined);
      outcome = { ok: false, reason: "transport" };
    }
    if (outcome.ok) {
      const { base, ...landed } = outcome;
      // ⚠️ THIS DEVICE'S OWN WRITES ARE NEVER ANOTHER DEVICE'S CHANGE (2.496.501): a push that landed after it gave up
      // (the deadline) left its write in the store, and against `baseline` it read as someone else's. The settings
      // took it as the value to put back on Cancel; the Facility screen laid it over a later status change.
      const others = withoutOwnWrites(this.spec.diff(baseline, base), [...this.unconfirmed].map((u) => u.sent));
      this.settle(mine);
      this.unsaved = false;
      this.commit(outcome.next, outcome.rev);
      // the last push out landed: nothing of this device's is unsent (one still waiting kept its own copy)
      if (this.inFlight <= 1) this.spec.keep?.save(author, null);
      return { ...landed, synced: baseline, others };
    }
    if (outcome.reason === "nothing-to-push" || outcome.reason === "refused") {
      // A refusal is FINAL: re-pushing it on every pull would loop for good
      // and keep this device from ever accepting a newer copy (2.496.184).
      // The caller lays `takeBack` on its local document: what was SENT, taken back.
      this.settle(mine);
      this.unsaved = false;
      if (this.inFlight <= 1) this.spec.keep?.save(author, null);
      if (outcome.reason === "refused") {
        const takeBack = this.spec.diff(this.spec.apply(baseline, mine.sent), baseline);
        return { ...outcome, takeBack };
      }
    } else {
      mine.failed = true;
      this.failedVersion += 1;
      this.unsaved = true;
    }
    return outcome;
  }
}
