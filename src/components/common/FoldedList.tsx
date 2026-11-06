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

/** THE "this opens more" control (owner, 2026-11-06: a chevron after the title in one place, an outlined button in
 *  another): its chevron before its words, pointing down while open. A section's title (ListSection) and a list inside
 *  a section ("3 suggested groups", "Show all, 114 more entities") are each this one button, the section's in its
 *  title's style. */
export function FoldToggle({ open, onToggle, children, className = "" }: {
  open: boolean; onToggle: () => void; children: ReactNode; className?: string;
}) {
  return (
    <button type="button" className={`fold-toggle${className ? ` ${className}` : ""}`} onClick={onToggle} aria-expanded={open}>
      {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
      {children}
    </button>
  );
}

/** ⚠️ A SECTION'S COUNTS OPEN ITS LISTS (owner, 2026-11-06: a section said "4 bound · 829 unbound · 88 not shown" in
 *  its title and again as a line of three toggles under it): each count after the title is the way to its own list,
 *  one shown at a time, the one shown marked (Devices: "120 on the map · 88 not on the map"). */
export interface SectionViews {
  items: readonly { key: string; words: string }[];
  /** The list shown while the section is open. */
  shown: string;
  onShow: (key: string) => void;
}

/** A section's counts after its title, each a button showing its own list, the one shown marked (Devices' title,
 *  never folded: settings/ConfigEditor; a folded section's were too, until its one, Villa's Bound 3D objects, went). */
export function SectionViewButtons({ title, views }: { title: string; views: SectionViews }) {
  return (
    <span className="section-summary section-views" role="group" aria-label={`${title}: which list`}>
      {views.items.map((v) => {
        const shown = v.key === views.shown;
        return (
          <button key={v.key} type="button" className={`section-view${shown ? " shown" : ""}`} aria-pressed={shown}
            onClick={() => views.onShow(v.key)}>{v.words}</button>
        );
      })}
    </span>
  );
}

/** One section of a list — Open issues, Notifications, Closed, Recent work — its name and count, its (i) right after
 *  them (`tip`, owner 2026-10-31: next to the words, not at the far end), folded or open by its chevron (owner,
 *  2026-10-28: each collapsible). Advanced Settings' folded sections are this too (settings/Fold): `summary` says what
 *  is inside where a count alone would not ("1 group · 2 suggested"), `bare` leaves its content as it is drawn (a
 *  section's working part, not a list of cards). */
export function ListSection({ title, count, summary, open, onToggle, tip, bare = false, children }: {
  title: string; count?: number; summary?: string; open: boolean; onToggle: () => void; tip?: ReactNode;
  bare?: boolean; children: ReactNode;
}) {
  return (
    <section className="messages-section">
      <div className="cockpit-issues-head">
        <div className="with-tip">
          <FoldToggle className="messages-section-toggle settings-section-title" open={open} onToggle={onToggle}>
            <span className="fold-toggle-words">{title}{count ? ` (${count})` : ""}</span>
            {summary && <span className="section-summary">{summary}</span>}
          </FoldToggle>
          {tip}
        </div>
      </div>
      {open && <div className={bare ? "fold-body" : "fm-list"}>{children}</div>}
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
