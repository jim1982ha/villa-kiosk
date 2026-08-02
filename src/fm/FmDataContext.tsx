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
  fetchFmData, saveFmData, fmId, diffFmData, fmDiffIsEmpty, applyFmDiff,
} from "./fmApi";
import { pushWithRebase } from "@/utils/keyedSync";
import { useStoreRefresh, STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } from "@/hooks/useStoreRefresh";
import { useSyncReporter } from "@/utils/syncTelemetry";
import {
  EMPTY_FM_DATA,
  type FmCompletion, type FmCost, type FmData, type FmSavedDocument, type FmSchedule, type FmTicket,
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
  updateTicket: (id: string, patch: Partial<FmTicket>) => Promise<void>;
  /** Erase a spend entry for good. Needs a single-use superadmin token — the
   *  server rejects the write without one, so this is not a UI-level rule. */
  removeCost: (id: string, elevation: string) => Promise<void>;
  /** Erase a fault, its history and its evidence photos. Superadmin only. */
  removeTicket: (id: string, elevation: string) => Promise<void>;
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

  /** What the server is known to hold, so a write can send only what THIS
   *  device changed (see utils/keyedSync.ts). Empty until the first read —
   *  which is the truth, and makes the first write push everything local. */
  const baseline = useRef<FmData>(EMPTY_FM_DATA);

  /** Writes this device has started but not yet had confirmed. */
  const inFlight = useRef(0);
  /** A write that FAILED and is still only on this device. */
  const unsaved = useRef(false);
  /** Retries a failed write. Assigned below, because `mutate` and `reload`
   *  refer to each other: a refresh that finds unsent work re-pushes it. */
  const retryRef = useRef<(() => Promise<void>) | null>(null);

  // Reports this store's pulls/pushes into the same telemetry ring the
  // device-config sync uses, tagged `store:"fm"`. Without it the entire
  // maintenance store was invisible in a dump.
  const reportSync = useSyncReporter("fm");

  const reload = useCallback(async () => {
    // NEVER clobber a change this device hasn't got onto the server yet.
    // `mutate` applies locally first and pushes after, so between those two
    // moments local legitimately differs from the server — and a refresh
    // landing right then would wipe a completion somebody just walked across
    // the villa to log. Losing a beat of remote changes is fine, losing the
    // operator's entry is not.
    if (inFlight.current > 0) {
      reportSync({ op: "pull", skipped: "write-in-flight" });
      return;
    }
    // A write that already FAILED is different, and used to be a dead end:
    // local stayed ahead of the baseline forever, so this device silently
    // stopped accepting remote changes for the rest of the session while
    // showing no reason for it. Re-push instead — that both saves the work
    // and clears the block, and the push returns the merged document so the
    // remote changes arrive in the same step.
    if (unsaved.current) {
      reportSync({ op: "pull", deferred: "retrying-unsaved-write" });
      await retryRef.current?.();
      return;
    }
    const fresh = await fetchFmData();
    if (!fresh) {
      reportSync({ op: "pull", aborted: "unreachable" });
      setReady(true);
      return;
    }
    const changed = JSON.stringify(fresh.doc) !== JSON.stringify(baseline.current);
    setData(fresh.doc);
    baseline.current = fresh.doc;
    setReady(true);
    reportSync({
      op: "pull",
      rev: fresh.rev,
      changed,
      tickets: fresh.doc.tickets.length,
      openTickets: fresh.doc.tickets.filter((t) => t.status !== "resolved").length,
      costs: fresh.doc.costs.length,
      completions: fresh.doc.completions.length,
    });
  }, [reportSync]);

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
    inFlight.current += 1;
    // Send ONLY what this action changed, replayed onto the server's freshest
    // copy under the revision it came at. This used to PUT the whole document
    // with no revision, so two people working the villa at once — which is the
    // normal case, the owner and the facility manager both hold
    // manageFacility — silently overwrote each other's records.
    const outcome = await pushWithRebase({
      diff: diffFmData(baseline.current, next),
      isEmpty: fmDiffIsEmpty,
      baseline: baseline.current,
      fetchFresh: fetchFmData,
      rebase: (_base, fresh) => fresh,
      apply: applyFmDiff,
      save: (doc, rev, carryOver) => saveFmData(doc, rev, carryOver, elevation),
    });
    inFlight.current -= 1;
    if (outcome.ok) {
      baseline.current = outcome.next;
      unsaved.current = false;
      // Fold in whatever another device contributed in the meantime, so this
      // screen reflects the merged truth rather than only its own edit.
      setData(outcome.next);
      reportSync({
        op: "push", ok: true, elevated: Boolean(elevation),
        tickets: outcome.next.tickets.length,
        openTickets: outcome.next.tickets.filter((t) => t.status !== "resolved").length,
        costs: outcome.next.costs.length,
      });
      return;
    }
    if (outcome.reason === "nothing-to-push") { unsaved.current = false; return; }
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
    // Local is now ahead of the server. Flagged rather than merely inferred
    // from a deep-compare, so the next refresh knows to RETRY this write
    // instead of skipping forever (see reload).
    unsaved.current = true;
    setSaveError("Couldn't save to the add-on — the change is only on this device.");
  }, [reportSync]);

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
  ) => mutate((d) => {
    const costId = cost ? fmId("co") : undefined;
    const completion: FmCompletion = { ...c, id: fmId("cp"), costId };
    const costs = cost
      // The cost inherits the completion's photos and date: it is the same
      // event, and the report needs them to line up.
      ? [...d.costs, { ...cost, id: costId!, at: c.at, photoIds: c.photoIds }]
      : d.costs;
    return { ...d, completions: [...d.completions, completion], costs };
  }), [mutate]);

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
    mutate((d) => ({
      ...d,
      costs: d.costs.filter((c) => c.id !== id),
      // A completion pointing at a cost that no longer exists would render as
      // a job with an unknown price. Drop the link, keep the completion —
      // the work still happened.
      completions: d.completions.map((c) => (c.costId === id ? { ...c, costId: undefined } : c)),
    }), elevation), [mutate]);

  const removeTicket = useCallback((id: string, elevation: string) =>
    mutate((d) => ({ ...d, tickets: d.tickets.filter((t) => t.id !== id) }), elevation), [mutate]);

  const addTicket = useCallback((t: Omit<FmTicket, "id" | "openedAt" | "status">) =>
    mutate((d) => ({
      ...d,
      tickets: [...d.tickets, {
        ...t, id: fmId("tk"), status: "open", openedAt: new Date().toISOString(),
      }],
    })), [mutate]);

  const updateTicket = useCallback((id: string, patch: Partial<FmTicket>) =>
    mutate((d) => ({
      ...d,
      tickets: d.tickets.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        // Stamp the resolution time automatically — the operator marks it done,
        // the app records WHEN, which is what the MTTR evidence rests on.
        if (patch.status === "resolved" && !next.resolvedAt) {
          next.resolvedAt = new Date().toISOString();
        }
        return next;
      }),
    })), [mutate]);

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
      removeCost, removeTicket,
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
