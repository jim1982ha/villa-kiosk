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
import { fetchFmData, saveFmData, fmId } from "./fmApi";
import {
  DEFAULT_SCHEDULES, EMPTY_FM_DATA,
  type FmCompletion, type FmCost, type FmData, type FmSchedule, type FmTicket,
} from "./fmTypes";

interface FmDataContextValue {
  data: FmData;
  /** False until the first load resolves — screens show a loading state rather
   *  than an empty maintenance record, which would read as "nothing is due". */
  ready: boolean;
  /** Set when the last write failed, so the UI can say so instead of pretending. */
  saveError: string | null;
  reload: () => Promise<void>;
  addSchedule: (s: Omit<FmSchedule, "id">) => Promise<void>;
  updateSchedule: (id: string, patch: Partial<FmSchedule>) => Promise<void>;
  removeSchedule: (id: string) => Promise<void>;
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
  /** Seed Clause 3.7's schedule. Idempotent: only adds builtins not already
   *  present, so it can't duplicate on a second press. */
  seedDefaults: () => Promise<void>;
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

  const reload = useCallback(async () => {
    const d = await fetchFmData();
    if (d) setData(d);
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
    const ok = await saveFmData(next);
    if (!ok) setSaveError("Couldn't save to the add-on — the change is only on this device.");
  }, []);

  const addSchedule = useCallback((s: Omit<FmSchedule, "id">) =>
    mutate((d) => ({ ...d, schedules: [...d.schedules, { ...s, id: fmId("sc") }] })), [mutate]);

  const updateSchedule = useCallback((id: string, patch: Partial<FmSchedule>) =>
    mutate((d) => ({
      ...d, schedules: d.schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })), [mutate]);

  const removeSchedule = useCallback((id: string) =>
    mutate((d) => ({ ...d, schedules: d.schedules.filter((s) => s.id !== id) })), [mutate]);

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

  const seedDefaults = useCallback(() => mutate((d) => {
    const have = new Set(d.schedules.map((s) => s.builtinKey).filter(Boolean));
    const additions = DEFAULT_SCHEDULES
      .filter((s) => !have.has(s.builtinKey))
      .map((s) => ({ ...s, id: fmId("sc") }));
    return additions.length ? { ...d, schedules: [...d.schedules, ...additions] } : d;
  }), [mutate]);

  return (
    <FmDataContext.Provider value={{
      data, ready, saveError, reload,
      addSchedule, updateSchedule, removeSchedule,
      logCompletion, addCost, removeCost, addTicket, updateTicket, seedDefaults,
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
