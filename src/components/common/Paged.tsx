// src/components/common/Paged.tsx
//
// "20 at a time, with a count and a way to the rest" — the app's ONE answer to
// a long append-only log rendered inside a dialog.
//
// ⚠️ IT IS THE SECOND LIST PATTERN AND THAT IS DELIBERATE, NOT DRIFT. The other
// is `useTruncated` — "first three plus Show all" — and the two answer different
// questions. A CONFIG list (bindings, devices, people) is read to see whether
// something is there, so three rows plus a count is the whole answer and any
// pager is friction. A LOG (usage requests, telemetry events) runs to hundreds
// of chronological rows nobody wants dumped into a dialog at once. One
// component for both would either page a three-row list or dump a five-hundred
// row one. Written down because "use the shared one" is the right instinct and
// would be the wrong call here.
//
// ⚠️ WHAT WAS ACTUALLY WRONG BEFORE THIS FILE: there were FOUR mechanisms, not
// two. `useTruncated` (3 + Show all), UsagePanel's own pager (20 + prev/next),
// and two silent `slice(0, N)` caps — TelemetryPanel and ReadinessTab — that
// showed a prefix and gave no way to reach the rest and no hint that there WAS
// a rest. A cap with no affordance is not a small list; it is a list lying
// about its size.

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_ROWS, pageOf, clampPage, type PageView } from "./paging";

// ⚠️ THE SIZES AND THE ARITHMETIC MOVED TO `paging.ts` (2.955.0), with the
// rival module `Pager.tsx` folded in — see that file's header. Re-exported so
// callers keep one import.
export { PAGE_ROWS, PAGE_CARDS, PAGE_COMPACT, PAGE_SIZES } from "./paging";
export type { PageView as Paged } from "./paging";

export function usePaged<T>(rows: T[], size = PAGE_ROWS): PageView<T> & {
  go: (to: number) => void;
} {
  const [pageNo, setPageNo] = useState(0);
  // ⚠️ BACK TO THE FIRST PAGE WHEN THE DATA CHANGES UNDER THE READER. Keyed on
  // length, like `useTruncated`, for the same reason: identity churn from a
  // re-render must not move a page the reader chose. The CLAMP in `pageOf`
  // covers the same hazard from the other side, and is the executable half.
  useEffect(() => { setPageNo(0); }, [rows.length]);
  const view = pageOf(rows, size, pageNo);
  return {
    ...view,
    go: (to) => setPageNo(clampPage(to, rows.length, size)),
  };
}

/**
 * The count line and the arrows. Renders nothing above the fold that a short
 * list does not need.
 *
 * ⚠️ THE COUNT SHOWS EVEN WHEN THERE IS ONLY ONE PAGE, and the arrows do not.
 * "12 requests" is information; two greyed arrows are furniture. This is the
 * one asymmetry in the component and it is the reason a short log does not look
 * like a broken pager.
 */
export function Pager<T>({ paged, unit, children }: {
  paged: PageView<T> & { go: (to: number) => void };
  /** What a row IS, singular — "request", "event". Pluralised naively, which
   *  is correct for every unit this app has. */
  unit: string;
  /** Anything that belongs on the same row — an export button, typically. */
  children?: React.ReactNode;
}) {
  const { first, total, page, pageNo, lastPage, go } = paged;
  const many = lastPage > 0;
  return (
    <div className="pager">
      <span className="muted">
        {many ? `${first}–${first + page.length - 1} of ${total}`
              : `${total} ${unit}${total === 1 ? "" : "s"}`}
      </span>
      <span className="pager-controls">
        {children}
        {many && (
          <>
            <button className="btn ghost" disabled={pageNo === 0}
                    onClick={() => go(pageNo - 1)} aria-label="Previous page">
              <ChevronLeft size={16} aria-hidden />
            </button>
            <button className="btn ghost" disabled={pageNo >= lastPage}
                    onClick={() => go(pageNo + 1)} aria-label="Next page">
              <ChevronRight size={16} aria-hidden />
            </button>
          </>
        )}
      </span>
    </div>
  );
}


/**
 * The compact strip: "Newer / Older" either side of "1 of 4".
 *
 * ⚠️ THE OTHER PRESENTATION, KEPT AS A CHOICE RATHER THAN A SECOND MODULE
 * (2.955.0). This was `Pager.tsx`'s default export — a whole rival paging
 * module in this directory whose header claimed to be the only one, exporting
 * the same two identifiers as this file. The LOOK is a genuine design decision
 * (a dialog's log reads better with words than with bare arrows); the
 * ARITHMETIC underneath was the drift, and it is `paging.ts` for both now.
 */
export function PagerCompact<T>({ paged, newerLabel = "Newer",
                                  olderLabel = "Older" }: {
  paged: PageView<T> & { go: (to: number) => void };
  newerLabel?: string;
  olderLabel?: string;
}) {
  const { pageNo, lastPage, go } = paged;
  // Renders nothing for a single page — a pager on a list that cannot be paged
  // is furniture that asks to be pressed.
  if (lastPage <= 0) return null;
  return (
    <div className="reports-pager">
      <button className="btn ghost" disabled={pageNo === 0}
              onClick={() => go(pageNo - 1)} aria-label={newerLabel}>
        <ChevronLeft size={16} aria-hidden="true" />
        <span>{newerLabel}</span>
      </button>
      <span className="muted">{pageNo + 1} of {lastPage + 1}</span>
      <button className="btn ghost" disabled={pageNo >= lastPage}
              onClick={() => go(pageNo + 1)} aria-label={olderLabel}>
        <span>{olderLabel}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
