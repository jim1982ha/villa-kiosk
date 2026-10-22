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
import { pushWithRebase, type PushOutcome, type StoreFetch, type StoreSaveResult } from "./keyedSync";

/** How long ONE push may take, all its attempts, before it ends as a transport failure (2.496.500): its work stays
 *  marked unsaved, so the next refresh sends it again, and the pushes and pulls waiting behind it go on. Before, a
 *  request that never answered (Wi-Fi gone half-way) held every later save and refresh of this store for good. */
export const PUSH_DEADLINE_MS = 15_000;

export interface SyncedDocumentSpec<D, Diff, F extends StoreFetch<D> = StoreFetch<D>> {
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
  /** Whether this device may write at all (checked when a push RUNS). */
  canWrite?: () => boolean;
  /** Called every time the baseline moves — the config store persists it. */
  onBaseline?: (baseline: D) => void;
  maxAttempts?: number;
  /** The push deadline. The stores never set it (PUSH_DEADLINE_MS); an oracle shortens it. */
  deadlineMs?: number;
}

export type PullResult<F> =
  | { action: "wait" | "unreachable" | "repush"; fetched?: undefined }
  | { action: "seed" | "noop" | "apply"; fetched: F };

/** `synced`, on success: the baseline this push's diff was computed against — so `base` against it is what the OTHER
 *  devices changed, and nothing of this device's own earlier push (config/deviceConfig remoteChange). */
export type PushResult<D> =
  | (Extract<PushOutcome<D>, { ok: true }> & { synced: D })
  | Extract<PushOutcome<D>, { ok: false }>
  | { ok: false; reason: "not-allowed" | "not-pulled" };

export class SyncedDocument<D, Diff, F extends StoreFetch<D> = StoreFetch<D>> {
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
  private readonly spec: SyncedDocumentSpec<D, Diff, F>;

  constructor(spec: SyncedDocumentSpec<D, Diff, F>, initial: D | null) {
    this.spec = spec;
    this.baseline = initial;
  }

  /** A write from this device failed and its work is only here. */
  get hasUnsaved(): boolean { return this.unsaved; }

  /**
   * What the server WILL hold once the pushes out and waiting land: the confirmed baseline with each of them laid on
   * it, i.e. the local document the latest push was handed (2.496.500). Nothing out: the baseline. A push sends what
   * the local document changed against THIS, and the config store's push gate compares with it. Against the
   * confirmed baseline, a value put back while the push carrying it was out (Cancel, a toggle undone) read as no
   * change at all: the undo was never sent, and every other tablet kept the cancelled value.
   */
  get promised(): D | null {
    return this.inFlight > 0 ? this.lastPushed : this.baseline;
  }

  /** This device holds work the server has not got: a failed write, or a
   *  local document that differs from the confirmed baseline. */
  isAhead(local: D): boolean {
    return this.unsaved || (this.baseline !== null && !this.spec.isEmpty(this.spec.diff(this.baseline, local)));
  }

  private commit(next: D, rev: string): void {
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
    if (this.unsaved) return { action: "repush" };
    const writesBefore = this.writes;
    const fetched = await this.spec.fetch();
    const action: PullAction = decidePull({
      writeInFlight: this.inFlight > 0,
      reached: fetched !== null,
      serverEmpty: fetched !== null && (this.spec.serverEmpty?.(fetched) ?? false),
      // A write STARTED during the fetch makes the fetched copy older than
      // this device — whether or not it has finished by now.
      localAhead: this.writes !== writesBefore || this.isAhead(local()),
      wouldChange: fetched !== null && wouldChange(fetched),
    });
    if (action === "wait" || action === "unreachable" || action === "repush") return { action };
    const f = fetched as F;
    this.commit(action === "seed" ? this.spec.empty : f.doc, f.rev);
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
  ): Promise<PushResult<D>> {
    const from = this.promised;
    if (from === null) return { ok: false, reason: "not-pulled" };
    this.lastPushed = local;
    this.inFlight += 1;
    const run = this.queue.then(() => this.pushNow(from, local, save));
    this.queue = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.inFlight -= 1;
    }
  }

  private async pushNow(from: D, local: D, save: SyncedDocumentSpec<D, Diff, F>["save"]): Promise<PushResult<D>> {
    if (this.spec.canWrite && !this.spec.canWrite()) return { ok: false, reason: "not-allowed" };
    const baseline = this.baseline ?? from;
    const own = this.unsaved || baseline === from ? local : this.spec.apply(baseline, this.spec.diff(from, local));
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
      diff: this.spec.diff(baseline, own),
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
      this.unsaved = false;
      this.commit(outcome.next, outcome.rev);
      return { ...outcome, synced: baseline };
    }
    if (outcome.reason === "nothing-to-push" || outcome.reason === "refused") {
      // A refusal is FINAL: re-pushing it on every pull would loop for good
      // and keep this device from ever accepting a newer copy (2.496.184).
      // The caller undoes its local change.
      this.unsaved = false;
    } else {
      this.unsaved = true;
    }
    return outcome;
  }
}
