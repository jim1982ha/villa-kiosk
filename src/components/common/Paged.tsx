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

/** Rows per page. ⚠️ ONE NUMBER FOR EVERY LOG IN THE APP — two logs paging at
 *  different sizes is exactly the drift this file replaces. */
export const PAGE_ROWS = 20;

/** Cards per page, where a "row" is several lines with children nested under
 *  it. ⚠️ A SECOND NUMBER, IN THE SAME FILE, ON PURPOSE. The rule this module
 *  enforces is that no page size is a literal scattered through a component —
 *  not that every list must page identically, which was never true of lists
 *  whose entries are different heights. Twenty one-line rows is a page; twenty
 *  checks each carrying its own flagged items is a scroll with no end in sight,
 *  reported as exactly that. Both numbers live here so there is still ONE place
 *  that owns pagination. */
export const PAGE_CARDS = 10;

export interface Paged<T> {
  page: T[];
  /** 1-based index of the first row on this page, for the "n–m of N" line. */
  first: number;
  total: number;
  pageNo: number;
  lastPage: number;
  go: (to: number) => void;
}

export function usePaged<T>(rows: T[], size = PAGE_ROWS): Paged<T> {
  const [pageNo, setPageNo] = useState(0);
  // ⚠️ BACK TO THE FIRST PAGE WHEN THE DATA CHANGES UNDER THE READER. A refresh
  // that shortens the list would otherwise leave them on a page past the end,
  // looking at nothing and reading it as an empty ledger rather than a stale
  // page. Keyed on length, like `useTruncated`, for the same reason: identity
  // churn from a re-render must not move a page the reader chose.
  useEffect(() => { setPageNo(0); }, [rows.length]);

  const lastPage = Math.max(0, Math.ceil(rows.length / size) - 1);
  const clamped = Math.min(pageNo, lastPage);
  const start = clamped * size;
  return {
    page: rows.slice(start, start + size),
    first: start + 1,
    total: rows.length,
    pageNo: clamped,
    lastPage,
    go: (to) => setPageNo(Math.max(0, Math.min(lastPage, to))),
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
  paged: Paged<T>;
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
