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
import SegmentedGroup from "./SegmentedGroup";

/** THE "this opens more" control (owner, 2026-11-06: a chevron after the title in one place, an outlined button in
 *  another): its chevron before its words, pointing down while open. A section's title (ListSection) and a list inside
 *  a section ("Show all, 114 more entities") are each this one button, the section's in its
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
 *  one shown at a time, the one shown marked (Devices: "120 on the map | 88 not on the map"; Grouped devices: "9 groups
 *  | 15 suggested", whose suggestions had a fold of their own beside "Show fewer", owner 2026-11-06). */
export interface SectionViews {
  items: readonly { key: string; words: string }[];
  /** The list shown while the section is open. */
  shown: string;
  onShow: (key: string) => void;
}

/** A section's counts after its title, each showing its own list: the app's one segmented control (SegmentedGroup),
 *  compact, the list shown filled (owner, 2026-11-06: the shown count was underlined like a link, the other plain, and
 *  a tap on the underlined one was expected to do something). Devices' title (never folded: settings/ConfigEditor) and
 *  a folded section's (ListSection `views`: Grouped devices), where none is filled while it is folded. */
export function SectionViewButtons({ title, views, open = true }: { title: string; views: SectionViews; open?: boolean }) {
  return (
    <SegmentedGroup className="segmented-compact section-views" ariaLabel={`${title}: which list`}
      active={open ? views.shown : null} onChange={views.onShow}
      options={views.items.map((v) => ({ key: v.key, label: v.words }))} />
  );
}

/** One section of a list — Open issues, Notifications, Closed, Recent work — its name and count, its (i) right after
 *  them (`tip`, owner 2026-10-31: next to the words, not at the far end), folded or open by its chevron (owner,
 *  2026-10-28: each collapsible). Advanced Settings' folded sections are this too (settings/Fold): `summary` says what
 *  is inside where a count alone would not ("3 devices"), `views` its counts that each show a list ("1 group · 2
 *  suggested"), drawn with its (i) as one unit (as Devices' title, InfoTip TipTitle), `bare` leaves its content as it is drawn (a
 *  section's working part, not a list of cards). */
export function ListSection({ title, count, summary, views, open, onToggle, tip, bare = false, children }: {
  title: string; count?: number; summary?: string; views?: SectionViews; open: boolean; onToggle: () => void; tip?: ReactNode;
  bare?: boolean; children: ReactNode;
}) {
  return (
    <section className="messages-section">
      <div className="cockpit-issues-head">
        <div className="with-tip">
          <FoldToggle className="messages-section-toggle settings-section-title" open={open} onToggle={onToggle}>
            <span className="fold-toggle-words">{title}{count ? ` (${count})` : ""}</span>
            {summary && !views && <span className="section-summary">{summary}</span>}
          </FoldToggle>
          {views ? <span className="title-after"><SectionViewButtons title={title} views={views} open={open} />{tip}</span> : tip}
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
