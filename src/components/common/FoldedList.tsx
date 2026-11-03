// src/components/common/FoldedList.tsx
// A list that only grows — closed tickets, work done — folded under its name and count, a page of cards at a time
// (owner, 2026-10-14: "the list risks to increase indefinitely: re-use exactly the layout of the Tickets tab").
//
// ⚠️ ONE PIECE FOR EVERY SUCH LIST, AND ONE SECTION FOR EVERY LIST (architecture review 19 #2, 2026-11-03): the Inbox's
// Watch and Closed were a second piece (MessagesTab's FoldedRows), drawn as the Inbox's sections (an uppercase name,
// its (i), always there with a line when empty), while Tickets' Closed and Schedule's Recent work drew a grey line,
// no (i) on Closed, and vanished when empty. Now every one is a ListSection: the Inbox's Open issues, Notifications and
// Reports, and these.

import InfoTip from "@/components/common/InfoTip";
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Pager, usePaged, PAGE_CARDS } from "./Paged";

/** One section of a list — Open issues, Notifications, Closed, Recent work — its name and count, its (i) right after
 *  them (`tip`, owner 2026-10-31: next to the words, not at the far end), folded or open by its chevron (owner,
 *  2026-10-28: each collapsible). */
export function ListSection({ title, count, open, onToggle, tip, children }: {
  title: string; count?: number; open: boolean; onToggle: () => void; tip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="messages-section">
      <div className="cockpit-issues-head">
        <div className="with-tip">
          <button type="button" className="messages-section-toggle settings-section-title" onClick={onToggle}
            aria-expanded={open}>
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            {title}{count ? ` (${count})` : ""}
          </button>
          {tip}
        </div>
      </div>
      {open && <div className="fm-list">{children}</div>}
    </section>
  );
}

export default function FoldedList<T>({ title, rows, children, tip, empty, open, onToggle }: {
  /** Its name, before the count: "Closed", "Recent work". */
  title: string;
  /** Its (i): what it keeps, and for how long (owner, 2026-10-22: never a visible line under it). */
  tip?: string;
  /** Said while it has none: it is always there (owner, 2026-10-28). */
  empty: string;
  /** Every row, in the order shown. */
  rows: T[];
  /** One row, drawn. */
  children: (row: T) => ReactNode;
  /** Folded or open when the screen holds it (the Inbox's sections); otherwise its own, folded at first. */
  open?: boolean;
  onToggle?: () => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const paged = usePaged(rows, PAGE_CARDS);
  const shown = open ?? ownOpen;
  return (
    <ListSection title={title} count={rows.length} open={shown} onToggle={onToggle ?? (() => setOwnOpen((v) => !v))}
      tip={tip ? <InfoTip label={`About ${title}`}>{tip}</InfoTip> : undefined}>
      {paged.page.map(children)}
      {/* its count is in its title: the pager only past a page (owner, 2026-11-03) */}
      {rows.length === 0 ? <p className="muted body-text messages-empty">{empty}</p> : <Pager paged={paged} />}
    </ListSection>
  );
}
