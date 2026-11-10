// src/hooks/usePendingField.ts
// A field of a dialog whose typed value waits a moment before it is written (a coordinate, a device's label, a
// slider): its value waits in the DIALOG's one pending store (config/pendingEdits, owned by hooks/useDraftedSlice), so
// the dialog's Save lights while it is typed, Save keeps it, Cancel drops it and Back writes it (2.496.500).
//
// The dialog puts its store around its fields (PendingFields); a field outside one is a mistake, said at once.

import { createContext, createElement, useCallback, useContext, useSyncExternalStore, type ChangeEvent, type KeyboardEvent,
  type ReactNode } from "react";
import type { PendingEdits, PendingWrite } from "@/config/pendingEdits";

const PendingContext = createContext<PendingEdits | null>(null);

/** Around a dialog's fields: their typed values wait in this dialog draft's store (DraftedSlice.pending). */
export function PendingFields({ pending, children }: { pending: PendingEdits; children: ReactNode }) {
  return createElement(PendingContext.Provider, { value: pending }, children);
}

export interface PendingField<T> {
  /** The value typed and not yet written; undefined when nothing waits (the field shows the stored value). */
  shown: T | undefined;
  /** Show `value` at once and write `write` after the pause (null: write nothing, a half-typed number, and say
   *  `unwritable` when it is let go so). */
  draft: (value: T, write: PendingWrite | null, unwritable?: string) => void;
  /** Write it now (leaving the field, Enter, a drag released). */
  flush: () => void;
}

/** `key`: unique in the dialog (a device's field carries its entity id). */
/** How long a typed number waits before it is written: long enough to finish typing (a coordinate, a count of
 *  days, a number of seconds); leaving the field or Enter writes it at once. One pause for every such field. */
export const FIELD_COMMIT_MS = 1500;

/** The dialog's pending store itself, for a section holding several changes of its own (Who gets the messages: one
 *  held change per list, pendingEdits `hold`), re-rendered on each change. */
export function usePendingStore(): PendingEdits {
  const pending = useContext(PendingContext);
  if (!pending) throw new Error("usePendingStore must be used inside PendingFields");
  const version = () => pending.version;
  useSyncExternalStore(pending.subscribe, version, version);
  return pending;
}

export function usePendingField<T>(key: string, delayMs: number): PendingField<T> {
  const pending = useContext(PendingContext);
  if (!pending) throw new Error("usePendingField must be used inside PendingFields");
  const read = () => pending.shown(key);
  // the same read on a server render (the oracles draw a dialog's fields to a string)
  const shown = useSyncExternalStore(pending.subscribe, read, read) as T | undefined;
  const draft = useCallback((value: T, write: PendingWrite | null, unwritable?: string) =>
    pending.stage(key, value, write, delayMs, unwritable), [pending, key, delayMs]);
  const flush = useCallback(() => pending.commit(key), [pending, key]);
  return { shown, draft, flush };
}

/** A NUMBER TYPED IN ONE OF THE DIALOG'S FIELDS, what its `<input>` takes: the text as typed while it waits (else
 *  `stored`), written after the pause, at once on leaving the field or Enter. `write`: what the text writes, null while
 *  it is no accepted number; the field then goes back to the stored one and says so, naming itself (`name`) and what
 *  it takes (`needs`: "a number", "a whole number from 0 to 3650").
 *  ⚠️ ONE DEFINITION (owner, 2026-11-10): the coordinates, the days records are kept and a full-screen announcement's
 *  seconds each wrote these four lines out, and each went back to the old value with no word. */
export function typedNumber(field: PendingField<string>, stored: string, write: (text: string) => PendingWrite | null,
  name: string, needs: string) {
  return {
    value: field.shown ?? stored,
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      field.draft(e.target.value, write(e.target.value), `"${name}" needs ${needs}: the one before was kept.`),
    onBlur: field.flush,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") field.flush(); },
  };
}
