// src/components/common/Pager.tsx
// THE one answer to "how many rows before a reader pages, and what do the
// controls look like".
//
// ⚠️ EXTRACTED FROM `HistoryTab` ON ITS SECOND CALLER (2026-08-30, owner: "force
// DRY to make sure it is styled the same way as any other paginated table").
// The delivery record grew a pager first; the record's own table needed the
// same one, and copying it would have been the badge-style defect in a new
// place — two page sizes and two control strips that agree on the day they are
// written and drift on the first tweak.
//
// ⚠️ THE SIZE IS THE SHARED DECISION, not a prop with a default. A caller that
// could pass its own would make "how many rows is a page in this app" a
// question with as many answers as callers, which is exactly what this file
// exists to prevent. If a surface ever genuinely needs a different count, it
// changes HERE with a reason, so the next reader sees both.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Rows per page, app-wide. ⚠️ FIVE, the number the spend log settled on and
 *  the delivery record adopted: about what a phone shows above the fold of a
 *  modal without the footer buttons leaving the screen. */
export const PAGE_SIZE = 5;

/** Paginate a list, and render the controls. `page` resets when the list
 *  shrinks below the current page — otherwise filtering to a short result
 *  leaves the reader on an empty page with no way back that they can see. */
export function usePaged<T>(rows: readonly T[]): {
  shown: T[]; pager: { page: number; pages: number; set: (n: number) => void };
} {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = useMemo(
    () => rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE) as T[],
    [rows, current],
  );
  return { shown, pager: { page: current, pages, set: setPage } };
}

/** The control strip. Renders nothing for a single page — a pager on a list
 *  that cannot be paged is furniture that asks to be pressed. */
export default function Pager(
  { page, pages, set, newerLabel = "Newer", olderLabel = "Older" }:
  { page: number; pages: number; set: (n: number) => void;
    newerLabel?: string; olderLabel?: string },
) {
  if (pages <= 1) return null;
  return (
    <div className="reports-pager">
      <button className="btn ghost" disabled={page === 0}
              onClick={() => set(page - 1)} aria-label={newerLabel}>
        <ChevronLeft size={16} aria-hidden="true" />
        <span>{newerLabel}</span>
      </button>
      <span className="muted">{page + 1} of {pages}</span>
      <button className="btn ghost" disabled={page >= pages - 1}
              onClick={() => set(page + 1)} aria-label={olderLabel}>
        <span>{olderLabel}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
