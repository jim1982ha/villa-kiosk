// src/fm/FmDataContext.tsx
// Holds the Facility Manager working set and writes every change through to the
// add-on's shared store.
//
// Contrast with DeviceConfigSync, which reconciles a store that BOTH sides can
// change: here every write originates from a deliberate operator action ("log
// this completion", "resolve this ticket"), so the model is simply
// optimistic-local-then-persist. No pull/push loop, no divergence to reconcile
// — the only thing that can disagree is a second device edited concurrently,
// and re-opening the panel re-reads the store.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import { isTicketOpen, type FmStamp } from "./fmEngine";
import { applyFmCommand, type FmCommand } from "./fmCommands";

/** The real clock and id maker the record changes are stamped with (fmEngine). */
const stamp = (): FmStamp => ({ now: new Date().toISOString(), id: fmId });
import {
  fetchFmData, saveFmData, fmId, diffFmData, fmDiffIsEmpty, applyFmDiff, foldOthers, fmUnsentKeeper,
} from "./fmApi";
import { SyncedDocument } from "@/utils/syncedDocument";
import { useProfile } from "@/auth/ProfileContext";
import { ROLE_LABELS } from "@/auth/roles";
import { useStoreRefresh, STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } from "@/hooks/useStoreRefresh";
import { useSyncReporter } from "@/utils/syncTelemetry";
import {
  EMPTY_FM_DATA,
  type FmCompletion, type FmCost, type FmData, type FmSavedDocument, type FmSchedule,
  type FmTicket, type FmTicketStatus,
} from "./fmTypes";

// The write's result and what a screen does with it live in fm/fmSave.ts (pure,
// so an oracle can drive them); re-exported here for the screens.
import type { FmRetention } from "./fmEngine";
import { CHANGED_ON_ANOTHER_DEVICE, REMOVED_ON_ANOTHER_DEVICE, fmSaveOutcome, type FmSaveOutcome, type FmWriteResult } from "./fmSave";
import { saveProblemLine } from "@/utils/storeSave";

interface FmDataContextValue {
  data: FmData;
  /** False until the record has been READ — screens show a loading state rather
   *  than an empty maintenance record, which would read as "nothing is due".
   *  ⚠️ A FAILED FIRST READ IS NOT A READ (architecture review H, 2026-10-23): it
   *  set this, and every screen showed the empty record as the villa's. */
  ready: boolean;
  /** The record has never been read and the last try could not reach the add-on (the next refresh tries again). */
  unreachable: boolean;
  /** Set when the last write failed, so the UI can say so instead of pretending. */
  saveError: string | null;
  /** How long the server keeps a closed fault, as it published it with the record (null until read, or not said). */
  retention: FmRetention | null;
  reload: () => Promise<void>;
  addSchedule: (s: Omit<FmSchedule, "id" | "createdAt">) => Promise<FmSaveOutcome>;
  updateSchedule: (id: string, patch: Partial<FmSchedule>) => Promise<FmSaveOutcome>;
  removeSchedule: (id: string) => Promise<FmSaveOutcome>;
  /** Delete every schedule in one write — the Today tab's "delete all" action.
   *  Same policy as a single removeSchedule: completions already logged stay
   *  (they're evidence of work actually done, not of the task still existing),
   *  only the schedule entries themselves go. */
  removeAllSchedules: () => Promise<FmSaveOutcome>;
  /** Log a completion, optionally recording what it cost in the same action —
   *  the two belong together and splitting them loses the link. */
  logCompletion: (
    c: Omit<FmCompletion, "id" | "costId">,
    cost?: Omit<FmCost, "id" | "at" | "photoIds">,
  ) => Promise<FmSaveOutcome>;
  addCost: (c: Omit<FmCost, "id">) => Promise<FmSaveOutcome>;
  /** Correct a recorded spend entry. Amending is ordinary work (a mistyped
   *  amount, a missing receipt photo) — only ERASING one needs the superadmin
   *  code, because that destroys the record rather than fixing it. */
  updateCost: (id: string, patch: Partial<FmCost>) => Promise<FmSaveOutcome>;
  /** `asTicket`: "Open a ticket" — it starts in progress (fmCommands); otherwise a fault (a guest's report). */
  addTicket: (t: Omit<FmTicket, "id" | "openedAt" | "status">, opts?: { asTicket?: boolean }) => Promise<FmSaveOutcome>;
  /** Move a fault to its next stage AND record the proof behind that move.
   *
   *  One mutator for every transition rather than one per stage: they differ
   *  only in whether money changed hands. Resolving additionally files a
   *  completion linked back to the ticket (FmCompletion.ticketId), so the
   *  fault and the work that fixed it stop being unrelated records — that
   *  link is what lets a report say "this fault, fixed on this date, at this
   *  cost". */
  advanceTickets: (
    /** One device's faults, moved together (owner, 2026-10-14: Mark in progress takes on the whole card — one
     *  ticket per device, each fault still its own record so the VESTA Agent can clear it alone). */
    ids: readonly string[],
    to: FmTicketStatus,
    step: { who?: string; note?: string; photoIds: string[] },
    /** Filed once, on the first of them. */
    cost?: Omit<FmCost, "id" | "at" | "photoIds">,
  ) => Promise<FmSaveOutcome>;
  /** Close a fault in ONE step, nothing done ("Close": no action needed):
   *  resolved now, with a "Closed without action" update, and no completion
   *  or cost (the "closeTickets" command). The same write as every other. */
  closeTickets: (ids: readonly string[]) => Promise<FmSaveOutcome>;
  updateTicket: (id: string, patch: Partial<FmTicket>) => Promise<FmSaveOutcome>;
  /** Erase a spend entry for good. Needs a single-use superadmin token — the
   *  server rejects the write without one, so this is not a UI-level rule. */
  removeCost: (id: string, elevation: string) => Promise<FmSaveOutcome>;
  /** Erase a fault, its history and its evidence photos. Superadmin only. */
  removeTicket: (id: string, elevation: string) => Promise<FmSaveOutcome>;
  /** Erase a logged completion and the cost logged with it. Superadmin only. */
  removeCompletion: (id: string, elevation: string) => Promise<FmSaveOutcome>;
  /** Keep a generated report/spend statement (see FmSavedDocument) so it can
   *  be reopened or handed over later without regenerating it. */
  saveDocument: (doc: Omit<FmSavedDocument, "id" | "generatedAt">) => Promise<FmSaveOutcome>;
  removeDocument: (id: string) => Promise<FmSaveOutcome>;
  /** Internal — see useFacilityLiveView. Declares that this screen is showing
   *  the data right now, so the store polls at the on-screen cadence. Returns
   *  its own unregister. */
  registerWatcher: () => () => void;
}

const FmDataContext = createContext<FmDataContextValue | null>(null);

export function FmDataProvider({ children }: { children: ReactNode }) {
  const [retention, setRetention] = useState<FmRetention | null>(null);
  // Who works now: stamped on every step (run), and the author of this page's unsent work (spec.author).
  const { role } = useProfile();
  const roleRef = useRef(role);
  roleRef.current = role;

  /** The sync state machine — utils/syncedDocument, the SAME one the device-
   *  config store runs (round 10, 2.496.154): the baseline the server is known
   *  to hold (EMPTY until the first read — the truth, so the first write
   *  pushes everything local), its revision, writes in flight, writes started
   *  during a fetch, a failed write still only on this device — and that work
   *  KEPT across a reload (fmApi fmUnsentKeeper, architecture review i_k3,
   *  2026-10-23): it starts from what was kept, and the first refresh sends it.
   *  Made ONCE (a lazy state): it reads the kept copy as it starts. */
  const [doc] = useState(() => new SyncedDocument({
    // the record's retention windows ride along with it (fmApi.fetchFmData), kept for the Tickets figures
    fetch: async (signal?: AbortSignal) => { const got = await fetchFmData(signal); if (got) setRetention(got.retention); return got; },
    save: (next: FmData, rev: string, carryOver: Record<string, unknown>, signal?: AbortSignal) =>
      saveFmData(next, rev, carryOver, undefined, signal),
    diff: diffFmData,
    isEmpty: fmDiffIsEmpty,
    apply: applyFmDiff,
    rebase: (_base: FmData, fresh: FmData) => fresh,
    empty: EMPTY_FM_DATA,
    keep: fmUnsentKeeper,
    // held work belongs to the profile that did it: kept for them, never shown to or sent as the next one
    author: () => roleRef.current ?? "none",
  }, EMPTY_FM_DATA));
  // the daily reload waits while this store holds work the add-on has not got (utils/autoReload)
  useEffect(() => doc.track(), [doc]);

  const [data, setData] = useState<FmData>(() => doc.restored ?? EMPTY_FM_DATA);
  const [ready, setReady] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Read the latest data inside a mutator without making every mutator depend
  // on it (which would re-create them all on every keystroke elsewhere).
  const ref = useRef(data);
  ref.current = data;
  /** Retries a failed write. Assigned below, because `mutate` and `reload`
   *  refer to each other: a refresh that finds unsent work re-pushes it. */
  const retryRef = useRef<(() => Promise<unknown>) | null>(null);

  // Reports this store's pulls/pushes into the same telemetry ring the
  // device-config sync uses, tagged `store:"fm"`. Without it the entire
  // maintenance store was invisible in a dump.
  const reportSync = useSyncReporter("fm");

  const reload = useCallback(async (): Promise<void> => {
    // NEVER clobber a change this device hasn't got onto the server — a write
    // in flight, one that failed, or one started while this read was out (a
    // completion somebody just walked across the villa to log). The document
    // decides (utils/syncedDocument); losing a beat of remote changes is fine,
    // losing the operator's entry is not.
    const baselineBefore = doc.baseline;
    const r = await doc.pull(
      () => ref.current,
      (f) => JSON.stringify(f.doc) !== JSON.stringify(baselineBefore),
    );
    switch (r.action) {
      case "wait":
        reportSync({ op: "pull", skipped: "write-in-flight" });
        return;
      case "repush":
        // A write that FAILED used to be a dead end (this device stopped
        // accepting remote changes, silently); re-pushing both saves the work
        // and returns the merged document.
        reportSync({ op: "pull", deferred: "retrying-unsaved-write" });
        await retryRef.current?.();
        // the add-on refused the work kept from before a reload (taken back): the record is read now, not called unreachable
        if (!doc.hasRead && !doc.hasUnsaved) return reload();
        // work kept from before a reload, the add-on still out of reach: the record was never read, and the screens say so
        if (!doc.hasRead) setUnreachable(true);
        return;
      case "unreachable":
        reportSync({ op: "pull", aborted: "unreachable" });
        // a record read before stays on the screens as it was; never read, the screens say so (fm/fmSave fmRecordLine)
        if (!doc.hasRead) setUnreachable(true);
        return;
    }
    const fresh = r.fetched;
    if (r.action === "apply") { ref.current = fresh.doc; setData(fresh.doc); }
    setReady(true);
    setUnreachable(false);
    reportSync({
      op: "pull",
      rev: fresh.rev,
      changed: r.action === "apply",
      tickets: fresh.doc.tickets.length,
      openTickets: fresh.doc.tickets.filter(isTicketOpen).length,
      costs: fresh.doc.costs.length,
      completions: fresh.doc.completions.length,
    });
  }, [doc, reportSync]);

  // Re-read on mount, on focus/visibility, and on a heartbeat — the SAME
  // triggers the device-config store uses. The heartbeat speeds up while the
  // Facility panel is actually open (see useFacilityLiveView): a status
  // changed on another device should land in seconds on a screen someone is
  // watching, not in up to three minutes.
  const [watchers, setWatchers] = useState(0);
  const registerWatcher = useCallback(() => {
    setWatchers((n) => n + 1);
    return () => setWatchers((n) => n - 1);
  }, []);
  useStoreRefresh(
    useCallback(() => { void reload(); }, [reload]),
    watchers > 0 ? STORE_ACTIVE_MS : STORE_HEARTBEAT_MS,
  );

  /** Apply a change locally for immediate feedback, then persist. On failure
   *  the local state is KEPT (so the operator doesn't lose what they typed)
   *  and the error surfaced — losing a completion someone just walked across
   *  the villa to log would be worse than showing it as unsaved. */
  const mutate = useCallback(async (fn: (d: FmData) => FmData, elevation?: string): Promise<FmWriteResult> => {
    const before = ref.current;
    const next = fn(before);
    // ⚠️ THE COPY MOVES AT ONCE, not at the next render (2.496.500): the push below sends what this changed against
    // what the pushes still out will make the store (utils/syncedDocument `promised`), so a second action before the
    // render must build on this one. Built on the copy before it, it would send this change back undone.
    ref.current = next;
    setData(next);
    setSaveError(null);
    // Send ONLY what this action changed, replayed onto the server's freshest
    // copy under the revision it came at (utils/syncedDocument). This used to
    // PUT the whole document with no revision, so two people working the villa
    // at once — the owner and the facility manager both hold manageFacility —
    // silently overwrote each other's records.
    const outcome = await doc.push(next, (d, rev, carryOver, signal) => saveFmData(d, rev, carryOver, elevation, signal));
    // Takes back THIS action only, on the screen as it is now: an action made since stays.
    const undo = () => {
      const undone = applyFmDiff(ref.current, diffFmData(next, before));
      ref.current = undone;
      setData(undone);
      // what is kept for after a reload no longer holds it (a refused delete replayed there would be refused again,
      // and take the rest of the unsent work with it)
      doc.keepUnsent(undone);
    };
    if (outcome.ok) {
      // Fold in whatever another device contributed in the meantime (`others`), onto this screen as it is NOW, under
      // every record this device has changed itself (keyedSync mineWins: the store holds this device's version of it).
      // ⚠️ NEVER `outcome.next` (to 2.496.499): that is the store when this push landed, so a record removed while it
      // was out came back on the screen. ⚠️ NEVER EVERY RECORD THE OTHERS TOUCHED (to 2.496.500): a fault this device
      // had just marked started and someone retitled meanwhile came back "open" here, and the next refresh sent that
      // to every device.
      // ⚠️ A FAULT BOTH DEVICES CHANGED IS MERGED FIELD BY FIELD (architecture review H, 2026-10-23), as the push merged it
      // in the store (fmApi mergeTicket): a "Started" tapped on a tablet whose copy predated a close on the phone
      // reopened the fault, and "Closed without action" vanished from its history. A field both changed keeps the
      // other device's value, and this device says so.
      const { doc: merged, changedOnBoth, removedElsewhere } = foldOthers(ref.current, outcome);
      ref.current = merged;
      setData(merged);
      setReady(true);
      setUnreachable(false);
      if (changedOnBoth.length > 0) setSaveError(CHANGED_ON_ANOTHER_DEVICE);
      if (removedElsewhere.length > 0) setSaveError(REMOVED_ON_ANOTHER_DEVICE);
      reportSync({
        op: "push", ok: true, elevated: Boolean(elevation),
        tickets: outcome.next.tickets.length,
        openTickets: outcome.next.tickets.filter(isTicketOpen).length,
        costs: outcome.next.costs.length,
      });
      return "saved";
    }
    if (outcome.reason === "nothing-to-push" || outcome.reason === "not-allowed" || outcome.reason === "not-pulled") return "unchanged";
    reportSync({ op: "push", ok: false, reason: outcome.reason, elevated: Boolean(elevation) });
    // A rejected DELETE is the one failure that must not be left showing as
    // applied: the record still exists on the server, and every other device
    // still sees it. Put it back rather than leaving this screen quietly
    // disagreeing with the store until the next refresh.
    // The add-on said NO: final. Undo it here and say why — it will never be
    // accepted, and keeping it would leave this screen disagreeing with the
    // store (and, before 2.496.184, re-pushed on every refresh for good).
    if (outcome.reason === "refused") {
      // what the push SENT, taken back (utils/syncedDocument `takeBack`): a refresh's retry of held work is this same
      // call with an action that changes nothing, so undoing the ACTION took nothing back (architecture review J)
      const undone = applyFmDiff(ref.current, outcome.takeBack);
      ref.current = undone;
      setData(undone);
      doc.keepUnsent(undone);
      setSaveError(saveProblemLine(outcome));
      return "refused";
    }
    if (elevation) {
      undo();
      setSaveError("The delete was refused by the add-on, nothing was removed.");
      return "refused";
    }
    // Local is now ahead of the server; the document has flagged it, so the
    // next refresh RETRIES this write instead of skipping forever (reload).
    setSaveError(saveProblemLine(outcome));
    return "offline";
  }, [doc, reportSync]);

  // Re-pushing is just an identity mutation: the diff is still computed
  // against the un-advanced baseline, so it carries exactly the work that
  // failed — no separate retry path to keep in step with the real one.
  retryRef.current = useCallback(() => mutate((d) => d), [mutate]);

  // Another profile signed in on this page: the work held for the one before is kept for them and leaves the screen;
  // the new one's kept work comes on it and is sent now, and the record is read as this profile may read it
  // (utils/syncedDocument switchAuthor).
  useEffect(() => {
    const next = doc.switchAuthor(ref.current);
    if (next === null) return;
    ref.current = next;
    setData(next);
    setSaveError(null);
    void reload();
  }, [doc, role, reload]);

  // ONE way in for every change (fmCommands.applyFmCommand): this says WHICH command; who did it — the signed-in
  // profile, on every step of a fault, for the card's "by …" and the VESTA Agent's notes — when, and the new ids are
  // stamped there, the same for every write. And ONE answer to "did it save?" (fmSave.fmSaveOutcome): every mutator
  // returns done / note / queued, so no screen decides it for itself — the 2.496.252 defect was a form that skipped
  // that line (architecture review, 2026-10-19).
  const run = useCallback(async (cmd: FmCommand, elevation?: string): Promise<FmSaveOutcome> =>
    fmSaveOutcome(await mutate((d) => applyFmCommand(d, cmd, { ...stamp(), by: role ? ROLE_LABELS[role] : undefined }), elevation)),
  [mutate, role]);

  const addSchedule = useCallback((schedule: Omit<FmSchedule, "id" | "createdAt">) => run({ type: "addSchedule", schedule }), [run]);
  const updateSchedule = useCallback((id: string, patch: Partial<FmSchedule>) => run({ type: "updateSchedule", id, patch }), [run]);
  const removeSchedule = useCallback((id: string) => run({ type: "removeSchedule", id }), [run]);
  const removeAllSchedules = useCallback(() => run({ type: "removeAllSchedules" }), [run]);
  const logCompletion = useCallback((completion: Omit<FmCompletion, "id" | "costId">, cost?: Omit<FmCost, "id" | "at" | "photoIds">) =>
    run({ type: "logCompletion", completion, cost }), [run]);
  const addCost = useCallback((cost: Omit<FmCost, "id">) => run({ type: "addCost", cost }), [run]);
  const updateCost = useCallback((id: string, patch: Partial<FmCost>) => run({ type: "updateCost", id, patch }), [run]);
  const addTicket = useCallback((ticket: Omit<FmTicket, "id" | "openedAt" | "status">, opts?: { asTicket?: boolean }) =>
    run({ type: "addTicket", ticket, asTicket: opts?.asTicket }), [run]);
  const updateTicket = useCallback((id: string, patch: Partial<FmTicket>) => run({ type: "updateTicket", id, patch }), [run]);
  // Several records, ONE write: a device's faults move or close together, or not at all.
  const advanceTickets = useCallback((ids: readonly string[], to: FmTicketStatus,
    step: { who?: string; note?: string; photoIds: string[] }, cost?: Omit<FmCost, "id" | "at" | "photoIds">) =>
    run({ type: "advanceTickets", ids, to, step, cost }), [run]);
  const closeTickets = useCallback((ids: readonly string[]) => run({ type: "closeTickets", ids }), [run]);
  const saveDocument = useCallback((doc: Omit<FmSavedDocument, "id" | "generatedAt">) => run({ type: "saveDocument", doc }), [run]);
  const removeDocument = useCallback((id: string) => run({ type: "removeDocument", id }), [run]);

  // ── Superadmin erasures ────────────────────────────────────────────────
  // These take a single-use elevation token and destroy evidence permanently (the server also purges the entry's
  // evidence photos from /data). No ordinary code path can reach them by accident: a token exists only because
  // someone entered the superadmin code seconds earlier for this specific action.
  const removeCost = useCallback((id: string, elevation: string) => run({ type: "removeCost", id }, elevation), [run]);
  const removeTicket = useCallback((id: string, elevation: string) => run({ type: "removeTicket", id }, elevation), [run]);
  const removeCompletion = useCallback((id: string, elevation: string) => run({ type: "removeCompletion", id }, elevation), [run]);

  return (
    <FmDataContext.Provider value={{
      data, ready, unreachable, saveError, retention, reload,
      addSchedule, updateSchedule, removeSchedule, removeAllSchedules,
      logCompletion, addCost, updateCost, addTicket, updateTicket,
      removeCost, removeTicket, removeCompletion, advanceTickets, closeTickets,
      saveDocument, removeDocument, registerWatcher,
    }}>
      {children}
    </FmDataContext.Provider>
  );
}

/** Call from the WINDOW that displays facility records (CockpitModal — once, whichever tab shows: its Overview lists
 *  the open faults too). While one is mounted the store re-reads every STORE_ACTIVE_MS instead of every three
 *  minutes, so a fault marked in progress on another device lands in seconds on the screen someone is actually
 *  watching. Costs nothing when no window is open. */
export function useFacilityLiveView(): void {
  const { registerWatcher } = useFmData();
  useEffect(() => registerWatcher(), [registerWatcher]);
}

export function useFmData(): FmDataContextValue {
  const ctx = useContext(FmDataContext);
  if (!ctx) throw new Error("useFmData must be used within an FmDataProvider");
  return ctx;
}
