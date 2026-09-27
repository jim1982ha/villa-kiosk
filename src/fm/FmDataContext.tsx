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
import {
  isTicketOpen, withCompletion, withoutCost, withoutCompletion, withTicketPatch, withTicketAdvanced, type FmStamp,
} from "./fmEngine";

/** The real clock and id maker the record changes are stamped with (fmEngine). */
const stamp = (): FmStamp => ({ now: new Date().toISOString(), id: fmId });
import {
  fetchFmData, saveFmData, fmId, diffFmData, fmDiffIsEmpty, applyFmDiff,
} from "./fmApi";
import { SyncedDocument } from "@/utils/syncedDocument";
import { useStoreRefresh, STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } from "@/hooks/useStoreRefresh";
import { useSyncReporter } from "@/utils/syncTelemetry";
import {
  EMPTY_FM_DATA,
  type FmCompletion, type FmCost, type FmData, type FmSavedDocument, type FmSchedule,
  type FmTicket, type FmTicketStatus,
} from "./fmTypes";

interface FmDataContextValue {
  data: FmData;
  /** False until the first load resolves — screens show a loading state rather
   *  than an empty maintenance record, which would read as "nothing is due". */
  ready: boolean;
  /** Set when the last write failed, so the UI can say so instead of pretending. */
  saveError: string | null;
  reload: () => Promise<void>;
  addSchedule: (s: Omit<FmSchedule, "id" | "createdAt">) => Promise<void>;
  updateSchedule: (id: string, patch: Partial<FmSchedule>) => Promise<void>;
  removeSchedule: (id: string) => Promise<void>;
  /** Delete every schedule in one write — the Today tab's "delete all" action.
   *  Same policy as a single removeSchedule: completions already logged stay
   *  (they're evidence of work actually done, not of the task still existing),
   *  only the schedule entries themselves go. */
  removeAllSchedules: () => Promise<void>;
  /** Log a completion, optionally recording what it cost in the same action —
   *  the two belong together and splitting them loses the link. */
  logCompletion: (
    c: Omit<FmCompletion, "id" | "costId">,
    cost?: Omit<FmCost, "id" | "at" | "photoIds">,
  ) => Promise<void>;
  addCost: (c: Omit<FmCost, "id">) => Promise<void>;
  /** Correct a recorded spend entry. Amending is ordinary work (a mistyped
   *  amount, a missing receipt photo) — only ERASING one needs the superadmin
   *  code, because that destroys the record rather than fixing it. */
  updateCost: (id: string, patch: Partial<FmCost>) => Promise<void>;
  addTicket: (t: Omit<FmTicket, "id" | "openedAt" | "status">) => Promise<void>;
  /** Move a fault to its next stage AND record the proof behind that move.
   *
   *  One mutator for every transition rather than one per stage: they differ
   *  only in whether money changed hands. Resolving additionally files a
   *  completion linked back to the ticket (FmCompletion.ticketId), so the
   *  fault and the work that fixed it stop being unrelated records — that
   *  link is what lets a report say "this fault, fixed on this date, at this
   *  cost". */
  advanceTicket: (
    id: string,
    to: FmTicketStatus,
    step: { by?: string; note?: string; photoIds: string[] },
    cost?: Omit<FmCost, "id" | "at" | "photoIds">,
  ) => Promise<void>;
  updateTicket: (id: string, patch: Partial<FmTicket>) => Promise<void>;
  /** Erase a spend entry for good. Needs a single-use superadmin token — the
   *  server rejects the write without one, so this is not a UI-level rule. */
  removeCost: (id: string, elevation: string) => Promise<void>;
  /** Erase a fault, its history and its evidence photos. Superadmin only. */
  removeTicket: (id: string, elevation: string) => Promise<void>;
  /** Erase a logged completion and the cost logged with it. Superadmin only. */
  removeCompletion: (id: string, elevation: string) => Promise<void>;
  /** Keep a generated report/spend statement (see FmSavedDocument) so it can
   *  be reopened or handed over later without regenerating it. */
  saveDocument: (doc: Omit<FmSavedDocument, "id" | "generatedAt">) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  /** Internal — see useFacilityLiveView. Declares that this screen is showing
   *  the data right now, so the store polls at the on-screen cadence. Returns
   *  its own unregister. */
  registerWatcher: () => () => void;
}

const FmDataContext = createContext<FmDataContextValue | null>(null);

export function FmDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FmData>(EMPTY_FM_DATA);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Read the latest data inside a mutator without making every mutator depend
  // on it (which would re-create them all on every keystroke elsewhere).
  const ref = useRef(data);
  ref.current = data;

  /** The sync state machine — utils/syncedDocument, the SAME one the device-
   *  config store runs (round 10, 2.496.154): the baseline the server is known
   *  to hold (EMPTY until the first read — the truth, so the first write
   *  pushes everything local), its revision, writes in flight, writes started
   *  during a fetch, a failed write still only on this device. */
  const doc = useRef(new SyncedDocument({
    fetch: fetchFmData,
    save: (next: FmData, rev: string, carryOver: Record<string, unknown>) => saveFmData(next, rev, carryOver),
    diff: diffFmData,
    isEmpty: fmDiffIsEmpty,
    apply: applyFmDiff,
    rebase: (_base: FmData, fresh: FmData) => fresh,
    empty: EMPTY_FM_DATA,
  }, EMPTY_FM_DATA)).current;
  /** Retries a failed write. Assigned below, because `mutate` and `reload`
   *  refer to each other: a refresh that finds unsent work re-pushes it. */
  const retryRef = useRef<(() => Promise<void>) | null>(null);

  // Reports this store's pulls/pushes into the same telemetry ring the
  // device-config sync uses, tagged `store:"fm"`. Without it the entire
  // maintenance store was invisible in a dump.
  const reportSync = useSyncReporter("fm");

  const reload = useCallback(async () => {
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
        return;
      case "unreachable":
        reportSync({ op: "pull", aborted: "unreachable" });
        setReady(true);
        return;
    }
    const fresh = r.fetched;
    if (r.action === "apply") setData(fresh.doc);
    setReady(true);
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
  const mutate = useCallback(async (fn: (d: FmData) => FmData, elevation?: string) => {
    const before = ref.current;
    const next = fn(before);
    setData(next);
    setSaveError(null);
    // Send ONLY what this action changed, replayed onto the server's freshest
    // copy under the revision it came at (utils/syncedDocument). This used to
    // PUT the whole document with no revision, so two people working the villa
    // at once — the owner and the facility manager both hold manageFacility —
    // silently overwrote each other's records.
    const outcome = await doc.push(next, (d, rev, carryOver) => saveFmData(d, rev, carryOver, elevation));
    if (outcome.ok) {
      // Fold in whatever another device contributed in the meantime, so this
      // screen reflects the merged truth rather than only its own edit.
      setData(outcome.next);
      reportSync({
        op: "push", ok: true, elevated: Boolean(elevation),
        tickets: outcome.next.tickets.length,
        openTickets: outcome.next.tickets.filter(isTicketOpen).length,
        costs: outcome.next.costs.length,
      });
      return;
    }
    if (outcome.reason === "nothing-to-push" || outcome.reason === "not-allowed" || outcome.reason === "not-pulled") return;
    reportSync({ op: "push", ok: false, reason: outcome.reason, elevated: Boolean(elevation) });
    // A rejected DELETE is the one failure that must not be left showing as
    // applied: the record still exists on the server, and every other device
    // still sees it. Put it back rather than leaving this screen quietly
    // disagreeing with the store until the next refresh.
    if (elevation) {
      setData(before);
      setSaveError("The delete was refused by the add-on — nothing was removed.");
      return;
    }
    // Local is now ahead of the server; the document has flagged it, so the
    // next refresh RETRIES this write instead of skipping forever (reload).
    setSaveError("Couldn't save to the add-on — the change is only on this device.");
  }, [doc, reportSync]);

  // Re-pushing is just an identity mutation: the diff is still computed
  // against the un-advanced baseline, so it carries exactly the work that
  // failed — no separate retry path to keep in step with the real one.
  retryRef.current = useCallback(() => mutate((d) => d), [mutate]);

  const addSchedule = useCallback((s: Omit<FmSchedule, "id" | "createdAt">) =>
    mutate((d) => ({
      ...d,
      schedules: [...d.schedules, { ...s, id: fmId("sc"), createdAt: new Date().toISOString() }],
    })), [mutate]);

  const updateSchedule = useCallback((id: string, patch: Partial<FmSchedule>) =>
    mutate((d) => ({
      ...d, schedules: d.schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })), [mutate]);

  const removeSchedule = useCallback((id: string) =>
    mutate((d) => ({ ...d, schedules: d.schedules.filter((s) => s.id !== id) })), [mutate]);

  const removeAllSchedules = useCallback(() =>
    mutate((d) => ({ ...d, schedules: [] })), [mutate]);

  const logCompletion = useCallback((
    c: Omit<FmCompletion, "id" | "costId">,
    cost?: Omit<FmCost, "id" | "at" | "photoIds">,
  ) => mutate((d) => withCompletion(d, c, cost, stamp())), [mutate]);

  const addCost = useCallback((c: Omit<FmCost, "id">) =>
    mutate((d) => ({ ...d, costs: [...d.costs, { ...c, id: fmId("co") }] })), [mutate]);

  // ── Superadmin erasures ────────────────────────────────────────────────
  // These take a single-use elevation token and destroy evidence permanently
  // (the server also purges the entry's evidence photos from /data). They are
  // separate from the ordinary mutators above precisely so that no ordinary
  // code path can reach them by accident — you cannot erase a fault without
  // holding a token, and a token exists only because someone entered the
  // superadmin code seconds earlier for this specific action.

  const updateCost = useCallback((id: string, patch: Partial<FmCost>) =>
    mutate((d) => ({
      ...d, costs: d.costs.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })), [mutate]);

  const removeCost = useCallback((id: string, elevation: string) =>
    mutate((d) => withoutCost(d, id), elevation), [mutate]);

  const removeTicket = useCallback((id: string, elevation: string) =>
    mutate((d) => ({ ...d, tickets: d.tickets.filter((t) => t.id !== id) }), elevation), [mutate]);

  const removeCompletion = useCallback((id: string, elevation: string) =>
    mutate((d) => withoutCompletion(d, id), elevation), [mutate]);

  const addTicket = useCallback((t: Omit<FmTicket, "id" | "openedAt" | "status">) =>
    mutate((d) => ({
      ...d,
      tickets: [...d.tickets, {
        ...t, id: fmId("tk"), status: "open", openedAt: new Date().toISOString(),
      }],
    })), [mutate]);

  const updateTicket = useCallback((id: string, patch: Partial<FmTicket>) =>
    mutate((d) => withTicketPatch(d, id, patch, stamp())), [mutate]);

  const advanceTicket = useCallback((
    id: string,
    to: FmTicketStatus,
    step: { by?: string; note?: string; photoIds: string[] },
    cost?: Omit<FmCost, "id" | "at" | "photoIds">,
  ) => mutate((d) => withTicketAdvanced(d, id, to, step, cost, stamp())), [mutate]);

  const saveDocument = useCallback((doc: Omit<FmSavedDocument, "id" | "generatedAt">) =>
    mutate((d) => ({
      ...d,
      savedDocuments: [
        ...d.savedDocuments,
        { ...doc, id: fmId("doc"), generatedAt: new Date().toISOString() },
      ],
    })), [mutate]);

  const removeDocument = useCallback((id: string) =>
    mutate((d) => ({ ...d, savedDocuments: d.savedDocuments.filter((r) => r.id !== id) })), [mutate]);

  return (
    <FmDataContext.Provider value={{
      data, ready, saveError, reload,
      addSchedule, updateSchedule, removeSchedule, removeAllSchedules,
      logCompletion, addCost, updateCost, addTicket, updateTicket,
      removeCost, removeTicket, removeCompletion, advanceTicket,
      saveDocument, removeDocument, registerWatcher,
    }}>
      {children}
    </FmDataContext.Provider>
  );
}

/** Call from any panel that DISPLAYS facility records. While one is mounted
 *  the store re-reads every STORE_ACTIVE_MS instead of every three minutes,
 *  so a fault marked in progress on another device lands in seconds on the
 *  screen someone is actually watching. Costs nothing when no panel is open. */
export function useFacilityLiveView(): void {
  const { registerWatcher } = useFmData();
  useEffect(() => registerWatcher(), [registerWatcher]);
}

export function useFmData(): FmDataContextValue {
  const ctx = useContext(FmDataContext);
  if (!ctx) throw new Error("useFmData must be used within an FmDataProvider");
  return ctx;
}
