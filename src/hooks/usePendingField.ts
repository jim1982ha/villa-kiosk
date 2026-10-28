// src/hooks/usePendingField.ts
// A field of a dialog whose typed value waits a moment before it is written (a coordinate, a device's label, a
// slider): its value waits in the DIALOG's one pending store (config/pendingEdits, owned by hooks/useDraftedSlice), so
// the dialog's Save lights while it is typed, Save keeps it, Cancel drops it and Back writes it (2.496.500).
//
// The dialog puts its store around its fields (PendingFields); a field outside one is a mistake, said at once.

import { createContext, createElement, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { PendingEdits, PendingWrite } from "@/config/pendingEdits";

const PendingContext = createContext<PendingEdits | null>(null);

/** Around a dialog's fields: their typed values wait in this dialog draft's store (DraftedSlice.pending). */
export function PendingFields({ pending, children }: { pending: PendingEdits; children: ReactNode }) {
  return createElement(PendingContext.Provider, { value: pending }, children);
}

export interface PendingField<T> {
  /** The value typed and not yet written; undefined when nothing waits (the field shows the stored value). */
  shown: T | undefined;
  /** Show `value` at once and write `write` after the pause (null: write nothing, a half-typed number). */
  draft: (value: T, write: PendingWrite | null) => void;
  /** Write it now (leaving the field, Enter, a drag released). */
  flush: () => void;
}

/** `key`: unique in the dialog (a device's field carries its entity id). */
/** How long a typed number waits before it is written: long enough to finish typing (a coordinate, a count of
 *  days, a number of seconds); leaving the field or Enter writes it at once. One pause for every such field. */
export const FIELD_COMMIT_MS = 1500;

export function usePendingField<T>(key: string, delayMs: number): PendingField<T> {
  const pending = useContext(PendingContext);
  if (!pending) throw new Error("usePendingField must be used inside PendingFields");
  const shown = useSyncExternalStore(pending.subscribe, () => pending.shown(key)) as T | undefined;
  const draft = useCallback((value: T, write: PendingWrite | null) => pending.stage(key, value, write, delayMs),
    [pending, key, delayMs]);
  const flush = useCallback(() => pending.commit(key), [pending, key]);
  return { shown, draft, flush };
}
