// src/components/common/TruncatedList.tsx
//
// "Show the first few, and a button for the rest" — the app's ONE answer to a
// list that can run to hundreds of rows inside a dialog.
//
// ⚠️ IT REPLACES A COLLAPSE, AND THE DIFFERENCE IS WHAT THE READER SEES FIRST.
// Advanced Settings' long sections were behind collapse toggles, so the Devices
// tab opened on two headings and nothing else: every visit began with a click
// that told you nothing, and whether a section had 3 rows or 400 was invisible
// until you opened it. Showing the first few inverts that — the content is
// there, its size is stated, and the click is only needed by someone who wants
// the whole list. Reported from the screen: the tab read as empty.
//
// ⚠️ THE FILTER COMES FIRST, THE TRUNCATION SECOND. `visible` is the top of
// whatever the caller passes in, so a search box narrows the list and the first
// few of the RESULTS are what show — which is what makes a 400-row table usable
// without ever expanding it. A truncation applied before the filter would show
// three rows that ignore what was typed.

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

/** How many rows a truncated list shows before the button. ⚠️ NOT PER CALLER:
 *  two sections showing different numbers of "the first few" is the kind of
 *  drift this file exists to stop, and the number was asked for as one. Not
 *  exported — a caller that needs to override it passes `rows`, and an exported
 *  constant with no consumer is what the audit's residue sweep flags. */
const TRUNCATED_ROWS = 3;

export interface Truncated<T> {
  visible: T[];
  hidden: number;
  expanded: boolean;
  toggle: () => void;
}

export function useTruncated<T>(items: T[], rows = TRUNCATED_ROWS): Truncated<T> {
  const [expanded, setExpanded] = useState(false);
  // ⚠️ COLLAPSE AGAIN WHEN THE LIST CHANGES SIZE UNDER AN EXPANSION. Typing in
  // a filter after pressing "Show all" would otherwise leave the flag on for a
  // result set of two, so the button vanished and could not be got back — and
  // the next search silently showed everything. Keyed on the count rather than
  // the contents: identity churn from a re-render must not close a list the
  // reader deliberately opened.
  useEffect(() => { setExpanded(false); }, [items.length]);
  return {
    visible: expanded ? items : items.slice(0, rows),
    hidden: Math.max(0, items.length - rows),
    expanded,
    toggle: () => setExpanded((e) => !e),
  };
}

/** The button under the rows. Renders nothing when nothing is hidden — a
 *  control that says "Show all 0 more" is noise on every short list. */
export function ShowAll<T>({ list, noun }: { list: Truncated<T>; noun: string }) {
  if (list.hidden === 0) return null;
  return (
    <button className="btn ghost mt" onClick={list.toggle}
            aria-expanded={list.expanded}>
      <ChevronDown size={16}
                   style={{ transform: list.expanded ? "rotate(180deg)" : undefined }} />
      {list.expanded
        ? "Show fewer"
        : `Show all — ${list.hidden} more ${noun}${list.hidden === 1 ? "" : "s"}`}
    </button>
  );
}
