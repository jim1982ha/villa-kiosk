// src/components/common/paging.ts
//
// HOW LONG IS A PAGE HERE, and where does the reader stand in the list.
//
// ⚠️ THERE WERE TWO PAGING MODULES IN THIS DIRECTORY AND EACH HEADER SAID IT
// WAS THE ONLY ONE. `Paged.tsx` called itself "the app's ONE answer"; `Pager.tsx`
// called itself "THE one answer to 'how many rows before a reader pages'" and
// insisted "THE SIZE IS THE SHARED DECISION, not a prop with a default" —
// while `Paged.usePaged` took exactly that. Three sizes (20 / 10 / 5), two
// control strips, and both modules exporting the identifiers `usePaged` and
// `Pager`, so two imports one character apart were two different behaviours.
//
// ⚠️ `test_there_is_exactly_ONE_page_size_in_the_app` was green through it, and
// missed it twice: it walked only `src/components`, so the Briefings callers
// under `src/vesta/brief/components/` were never read — and its regex looked
// for `usePaged(rows, N)`, while the rival's `usePaged` took no size argument
// at all.
//
// ⚠️ THIS FILE IS THE ARITHMETIC ONLY, and imports nothing at runtime, so the
// reset-on-shrink rule both headers describe ("looking at nothing and reading
// it as an empty ledger") is finally executable.

/** Rows per page. ⚠️ ONE NUMBER FOR EVERY LOG IN THE APP. */
export const PAGE_ROWS = 20;

/** Cards per page, where a "row" is several lines with children nested under
 *  it. ⚠️ A SECOND NUMBER ON PURPOSE: the rule is that no page size is a
 *  literal scattered through a module, not that every list pages identically —
 *  which was never true of lists whose entries are different heights. Twenty
 *  one-line rows is a page; twenty checks each carrying their own flagged items
 *  is a scroll with no end in sight, reported as exactly that. */
export const PAGE_CARDS = 10;

/** Rows per page inside a modal. ⚠️ THE THIRD NUMBER, AND IT WAS ALREADY REAL —
 *  it lived in the rival module as `PAGE_SIZE`. About what a phone shows above
 *  the fold of a dialog without the footer buttons leaving the screen. */
export const PAGE_COMPACT = 5;

/** Every page size this app uses. A fourth needs a reason, here, beside these. */
export const PAGE_SIZES = [PAGE_ROWS, PAGE_CARDS, PAGE_COMPACT] as const;

export interface PageView<T> {
  page: T[];
  /** 1-based index of the first row on this page, for the "n–m of N" line. */
  first: number;
  total: number;
  pageNo: number;
  lastPage: number;
}

/** The last page index for a list of this length. Never negative: an empty
 *  list has one page, not minus one. */
export function lastPageOf(total: number, size: number): number {
  return Math.max(0, Math.ceil(Math.max(0, total) / Math.max(1, size)) - 1);
}

/** Keep a page number inside the list. ⚠️ CLAMPS AT BOTH ENDS — a reader who
 *  presses back on page one must stay on page one, not land on minus one. */
export function clampPage(pageNo: number, total: number, size: number): number {
  return Math.max(0, Math.min(lastPageOf(total, size), Math.floor(pageNo || 0)));
}

/**
 * The slice a reader is looking at, and where it sits in the whole.
 *
 * ⚠️ THE CLAMP IS THE RESET-ON-SHRINK RULE. A refresh that shortens the list
 * would otherwise leave the reader on a page past the end — looking at nothing
 * and reading it as an empty ledger rather than a stale page. Both former
 * modules described that failure in prose; neither could execute it.
 */
export function pageOf<T>(rows: readonly T[], size: number,
                          pageNo: number): PageView<T> {
  const total = rows.length;
  const width = Math.max(1, size);
  const clamped = clampPage(pageNo, total, width);
  const start = clamped * width;
  return {
    page: rows.slice(start, start + width) as T[],
    first: start + 1,
    total,
    pageNo: clamped,
    lastPage: lastPageOf(total, width),
  };
}
