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

export interface SyncedDocumentSpec<D, Diff, F extends StoreFetch<D> = StoreFetch<D>> {
  /** The server's copy, in baseline form; null when it cannot be reached. */
  fetch: () => Promise<F | null>;
  save: (next: D, rev: string, carryOver: Record<string, unknown>) => Promise<StoreSaveResult>;
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
}

export type PullResult<F> =
  | { action: "wait" | "unreachable" | "repush"; fetched?: undefined }
  | { action: "seed" | "noop" | "apply"; fetched: F };

export type PushResult<D> = PushOutcome<D> | { ok: false; reason: "not-allowed" | "not-pulled" };

export class SyncedDocument<D, Diff, F extends StoreFetch<D> = StoreFetch<D>> {
  /** What the server is known to hold; null until the first pull when the
   *  document starts unknown (a push waits for it: pull before push). */
  baseline: D | null;
  rev = "0";
  private inFlight = 0;
  private writes = 0;
  private unsaved = false;
  private readonly spec: SyncedDocumentSpec<D, Diff, F>;

  constructor(spec: SyncedDocumentSpec<D, Diff, F>, initial: D | null) {
    this.spec = spec;
    this.baseline = initial;
  }

  /** A write from this device failed and its work is only here. */
  get hasUnsaved(): boolean { return this.unsaved; }

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
   * Send what this device changed since the baseline — replayed onto the
   * server's freshest copy, under optimistic concurrency, retried on a
   * conflict (utils/keyedSync). On success the baseline is the merged result.
   */
  async push(
    local: D,
    /** This write's own save — the Facility store's deletes carry a
     *  single-use elevation token. Default: the spec's. */
    save: SyncedDocumentSpec<D, Diff, F>["save"] = this.spec.save,
  ): Promise<PushResult<D>> {
    if (this.spec.canWrite && !this.spec.canWrite()) return { ok: false, reason: "not-allowed" };
    const baseline = this.baseline;
    if (baseline === null) return { ok: false, reason: "not-pulled" };
    this.inFlight += 1;
    this.writes += 1;
    let outcome: PushOutcome<D>;
    try {
      outcome = await pushWithRebase({
        diff: this.spec.diff(baseline, local),
        isEmpty: this.spec.isEmpty,
        baseline,
        fetchFresh: async () => {
          const f = await this.spec.fetch();
          return f === null ? null : { doc: f.doc, rev: f.rev, raw: f.raw };
        },
        rebase: this.spec.rebase,
        apply: this.spec.apply,
        save,
        maxAttempts: this.spec.maxAttempts,
      });
    } finally {
      this.inFlight -= 1;
    }
    if (outcome.ok) {
      this.unsaved = false;
      this.commit(outcome.next, outcome.rev);
    } else if (outcome.reason === "nothing-to-push") {
      this.unsaved = false;
    } else {
      this.unsaved = true;
    }
    return outcome;
  }
}
