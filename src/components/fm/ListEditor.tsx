// src/components/fm/ListEditor.tsx
// THE list with an editor: which record of a Cockpit list is open as its form (or whether a new one is being added),
// the form drawn in its card's place, and what happens when that record leaves the list. Tickets, Spend, Schedule and
// Today (a task's Log) all ask it; FmForm is the frame each form is drawn in.
//
// ⚠️ ONE NOTE OF THE OPEN FORM, NOT FOUR (architecture review round 13, 2026-11-01): each list kept its own, and only
// some forgot it when the record left the list. Editing a spend entry then changing the Month left no form and no
// Record spend; a task erased on another tablet while open left no form and no Add a task, until the tab was left. A
// record that leaves the list now closes its form and brings the list's add button back, in every list alike.

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

/** What the list has open: nothing, a new record's form, or the form of the record `id`. */
type ListEditorState = { open: "none" } | { open: "add" } | { open: "edit"; id: string };

export const NOTHING_OPEN: ListEditorState = { open: "none" };

/** What the list draws, from what it has open and the records it lists now (`ids`). Pure: tests/oracles/
 *  form_in_place.mjs drives it. A record edited that is no longer listed (the month changed, erased on another tablet,
 *  closed by VESTA) is nothing open: its form closed, the add button back. */
export function listEditorView(state: ListEditorState, ids: readonly string[]): {
  /** The record drawn as its form, in its card's place; null: none. */
  editing: string | null;
  /** A new record's form is open (drawn where the list draws it, above its records). */
  adding: boolean;
  /** The list's add button shows: no form open. */
  addButton: boolean;
} {
  const editing = state.open === "edit" && ids.includes(state.id) ? state.id : null;
  const adding = state.open === "add";
  return { editing, adding, addButton: !adding && editing === null };
}

/** The list's editor: `ids`, the records it lists now; `onClosed`, called whenever its form closes (saved, cancelled,
 *  or its record gone), so a form's typed fields never carry into the next one. */
export function useListEditor(ids: readonly string[], onClosed?: () => void) {
  const [state, setState] = useState<ListEditorState>(NOTHING_OPEN);
  const view = listEditorView(state, ids);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const gone = state.open === "edit" && view.editing === null;
  // the record left the list: forgotten for good (it does not reopen if it comes back), its fields cleared
  useEffect(() => {
    if (!gone) return;
    setState(NOTHING_OPEN);
    closedRef.current?.();
  }, [gone]);
  return {
    ...view,
    /** Open a new record's form. */
    add: () => setState({ open: "add" }),
    /** Open record `id`'s form in its card's place. */
    edit: (id: string) => setState({ open: "edit", id }),
    /** Close the form (saved or cancelled). */
    close: () => { setState(NOTHING_OPEN); closedRef.current?.(); },
    /** Record `id` as the list draws it: its form in its card's place while it is edited, else its card. */
    inPlace: (id: string, card: ReactNode, form: () => ReactNode): ReactNode =>
      (view.editing === id ? <Fragment key={id}>{form()}</Fragment> : card),
  };
}
