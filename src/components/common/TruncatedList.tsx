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

// ⚠️ THE REST IS PAGED BY TEN, WITH A WAY BACK (architecture review 2026-10-31 round 12 #3; the owner's rule "long
// lists are tables paged ten rows at a time"). "Show all" dumped 412 entities at once; "Also on this device" had its
// own "Show all (9)" with no way back; Readiness showed 8 devices and a "+12 more" that could not be tapped. One list
// now: the first few and a count, then the rest a page of ten at a time (paging.ts, the Pager), and "Show fewer".

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Pager } from "./Paged";
import { PAGE_ROWS, pageOf, type PageView } from "./paging";

/** How many rows a truncated list shows before the button. ⚠️ NOT PER CALLER:
 *  two sections showing different numbers of "the first few" is the kind of
 *  drift this file exists to stop, and the number was asked for as one. Not
 *  exported — a caller that needs to override it passes `rows`, and an exported
 *  constant with no consumer is what the audit's residue sweep flags. */
const TRUNCATED_ROWS = 3;

/** What a truncated list shows. Pure. */
export interface TruncatedView<T> {
  visible: T[];
  /** How many the first few leave out (the button's count); 0: nothing to show more of. */
  hidden: number;
  expanded: boolean;
  /** Expanded: the page of ten being read, for the Pager. */
  paged: PageView<T> | null;
}

/** The first `rows` of `items`; expanded, page `page` of the whole, ten rows a page (PAGE_ROWS). Pure. */
export function truncatedView<T>(items: readonly T[], expanded: boolean, page: number, rows = TRUNCATED_ROWS):
  TruncatedView<T> {
  const hidden = Math.max(0, items.length - rows);
  if (!expanded || hidden === 0) return { visible: items.slice(0, rows) as T[], hidden, expanded: false, paged: null };
  const paged = pageOf(items, PAGE_ROWS, page);
  return { visible: paged.page, hidden, expanded: true, paged };
}

export interface Truncated<T> extends TruncatedView<T> {
  toggle: () => void;
  go: (page: number) => void;
}

/** `resetOn`: what the list is about (the device whose readings it lists): another one starts again at the first few. */
export function useTruncated<T>(items: T[], rows = TRUNCATED_ROWS, resetOn?: string): Truncated<T> {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  // ⚠️ COLLAPSE AGAIN WHEN THE LIST CHANGES SIZE UNDER AN EXPANSION. Typing in
  // a filter after pressing "Show all" would otherwise leave the flag on for a
  // result set of two, so the button vanished and could not be got back — and
  // the next search silently showed everything. Keyed on the count rather than
  // the contents: identity churn from a re-render must not close a list the
  // reader deliberately opened.
  useEffect(() => { setExpanded(false); setPage(0); }, [items.length, resetOn]);
  const view = truncatedView(items, expanded, page, rows);
  return {
    ...view,
    toggle: () => { setExpanded((e) => !e); setPage(0); },
    go: (to) => setPage(view.paged ? Math.max(0, Math.min(view.paged.lastPage, to)) : 0),
  };
}

/** The button under the rows, and expanded, the page of ten's count and arrows (Pager). Renders nothing when nothing
 *  is hidden — a control that says "Show all 0 more" is noise on every short list. */
export function ShowAll<T>({ list, noun, plural = `${noun}s` }: { list: Truncated<T>; noun: string; plural?: string }) {
  if (list.hidden === 0) return null;
  return (
    <>
      {/* more than a page: where the reader stands and the arrows (the count alone would repeat the button's) */}
      {list.paged && list.paged.lastPage > 0 && <Pager paged={{ ...list.paged, go: list.go }} unit={noun} />}
      <button className="btn ghost mt" onClick={list.toggle}
              aria-expanded={list.expanded}>
        <ChevronDown size={16}
                     style={{ transform: list.expanded ? "rotate(180deg)" : undefined }} />
        {list.expanded
          ? "Show fewer"
          : `Show all, ${list.hidden} more ${list.hidden === 1 ? noun : plural}`}
      </button>
    </>
  );
}
