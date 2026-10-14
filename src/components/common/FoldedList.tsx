// src/components/common/FoldedList.tsx
// A list that only grows — closed tickets, work done — folded under its name and count, a page of cards at a time
// (owner, 2026-10-14: "the list risks to increase indefinitely: re-use exactly the layout of the Tickets tab"). ONE
// piece for every such list: Tickets' "Closed", Schedule's "Recent work".

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Pager, usePaged, PAGE_CARDS } from "./Paged";

export default function FoldedList<T>({ title, rows, unit, children }: {
  /** Its name, before the count: "Closed", "Recent work". */
  title: string;
  /** Every row, in the order shown. */
  rows: T[];
  /** What a row is, singular, for the pager ("closed record"). */
  unit: string;
  /** One row, drawn. */
  children: (row: T) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const paged = usePaged(rows, PAGE_CARDS);
  if (rows.length === 0) return null;
  return (
    <div className="fm-field">
      <button type="button" className="fm-disclosure" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {title} ({rows.length})
      </button>
      {open && (
        <>
          <div className="fm-list">{paged.page.map(children)}</div>
          <Pager paged={paged} unit={unit} />
        </>
      )}
    </div>
  );
}
