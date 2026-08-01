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
  removeCost: (id: string) => Promise<void>;
  addTicket: (t: Omit<FmTicket, "id" | "openedAt" | "status">) => Promise<void>;
  updateTicket: (id: string, patch: Partial<FmTicket>) => Promise<void>;
  /** Keep a generated report/spend statement (see FmSavedDocument) so it can
   *  be reopened or handed over later without regenerating it. */
  saveDocument: (doc: Omit<FmSavedDocument, "id" | "generatedAt">) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
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

  const reload = useCallback(async () => {
    const fresh = await fetchFmData();
    if (fresh) {
      setData(fresh.doc);
      baseline.current = fresh.doc;
    }
    setReady(true);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /** Apply a change locally for immediate feedback, then persist. On failure
   *  the local state is KEPT (so the operator doesn't lose what they typed)
   *  and the error surfaced — losing a completion someone just walked across
   *  the villa to log would be worse than showing it as unsaved. */
  const mutate = useCallback(async (fn: (d: FmData) => FmData) => {
    const next = fn(ref.current);
    setData(next);
    setSaveError(null);
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
      save: (doc, rev, carryOver) => saveFmData(doc, rev, carryOver),
    });
    if (outcome.ok) {
      baseline.current = outcome.next;
      // Fold in whatever another device contributed in the meantime, so this
      // screen reflects the merged truth rather than only its own edit.
      setData(outcome.next);
      return;
    }
    if (outcome.reason === "nothing-to-push") return;
    setSaveError("Couldn't save to the add-on — the change is only on this device.");
  }, []);

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

  const removeCost = useCallback((id: string) =>
    mutate((d) => ({ ...d, costs: d.costs.filter((c) => c.id !== id) })), [mutate]);

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
      logCompletion, addCost, removeCost, addTicket, updateTicket,
      saveDocument, removeDocument,
    }}>
      {children}
    </FmDataContext.Provider>
  );
}

export function useFmData(): FmDataContextValue {
  const ctx = useContext(FmDataContext);
  if (!ctx) throw new Error("useFmData must be used within an FmDataProvider");
  return ctx;
}
