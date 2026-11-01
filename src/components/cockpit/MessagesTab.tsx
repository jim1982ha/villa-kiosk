// src/components/cockpit/MessagesTab.tsx
// The Cockpit's first tab, Messages (ticket 17 of "One inbox", owner 2026-10-28): the open issues and the villa's
// announcements. What is listed, counted and open is the Messages model's (messages/messagesModel); this draws it.
//
// ⚠️ ONE COLUMN OF CARDS, AS TICKETS (owner, 2026-11-01): a list of rows on the left, the item chosen on the right, and
// a phone showing them in turn, were replaced by the cards themselves, folded, a tap opening one in its place. An issue,
// a notification, a report, a Watch and a Closed item are ONE card (InboxCard → RecordCard): the row and the opened
// card were two drawings of the same thing, kept alike by hand.
//
// Open issues keep the Overview's order: one card per device, "Open Ticket" on the filters' line, Watch folded at the
// end, a device window's warning opening on its issue.

import { momentText } from "@/utils/dateText";
import { useEffect, useMemo, useState } from "react";
import { Bell, ChevronDown, ChevronRight, FileText, Plus } from "lucide-react";
import { CARD_BUTTON, WorkLabel } from "@/components/fm/WorkButtons";
import type { ReactNode } from "react";
import type { Doors } from "@/auth/doors";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useVillaModel } from "@/config/VillaModel";
import { cardFocused } from "@/config/attention";
import type { CardView } from "@/config/cockpitCard";

import { useAnnouncements } from "@/messages/AnnouncementsContext";
import { backendFetch } from "@/auth/sessionLost";
import { useInView } from "@/hooks/useInView";
import { announcementWords, isReport, issueRowLines, messagesView, followingFilter, openingFilter, type MessageItem,
  type MessagesFilter } from "@/messages/messagesModel";
import { buildDeviceOptions } from "@/components/fm/DeviceSearchPicker";
import FaultForm from "@/components/fm/FaultForm";
import FaultTiming from "@/components/fm/FaultTiming";
import InfoTip from "@/components/common/InfoTip";
import { Pager, usePaged } from "@/components/common/Paged";
import { AnnouncementContent, PageLink, RecordButtons } from "@/components/messages/AnnouncementContent";
import RecordCard, { type RecordCardProps } from "@/components/fm/RecordCard";
import { eraseMessage, type Announcement } from "@/messages/announcements";
import { CockpitAttentionRow } from "./IssueCard";
import { useCockpitIssues } from "./useVillaAttention";

/** One section of the list — Open issues, Notifications, Watch — its name and count, its (i) right after them (`tip`,
 *  owner 2026-10-31: next to the words, not at the far end), folded or open by its chevron (owner, 2026-10-28: the
 *  three at one level, each collapsible). Its buttons are the filters' line's (the Inbox's "Open Ticket"). */
export function MessagesSection({ title, count, open, onToggle, tip, children }: {
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

/** A section that only grows (Watch, Closed): its cards a page at a time; `empty` said while it has none (it is always
 *  there: owner, 2026-10-28). */
function FoldedRows({ rows, unit, card, empty, tip, ...section }: {
  title: string; rows: MessageItem[]; unit: string; open: boolean; onToggle: () => void; tip: string;
  card: (item: MessageItem) => ReactNode; empty: string;
}) {
  const paged = usePaged(rows);
  return (
    <MessagesSection {...section} count={rows.length} tip={<InfoTip label={`About ${section.title}`}>{tip}</InfoTip>}>
      {paged.page.map(card)}
      {rows.length === 0 ? <p className="muted body-text messages-empty">{empty}</p> : <Pager paged={paged} unit={unit} />}
    </MessagesSection>
  );
}

/** What stands under a folded card's pills: each of an issue's problems (in the words its opened card says it: the
 *  issue as told, messagesModel issueAsTold), a notification's first words. */
export function foldedLines(item: MessageItem): string[] {
  return item.kind === "issue" ? issueRowLines(item.card) : [announcementWords(item.announcement).line];
}

/** ⚠️ ONE CARD OF THE INBOX, WHATEVER IT HOLDS (owner, 2026-11-01: "NEVER add dedicated lines of code for specific
 *  cards"): folded until tapped, opened in its place and brought into view (an open card above it folds as it opens).
 *  The look is RecordCard's alone, here only which card it is. */
export function InboxCard({ item, opened, onToggle, canManage, onOpenEntity, onEditTicket, onRaiseTicket, focused }: {
  item: MessageItem;
  opened: boolean;
  onToggle: () => void;
  /** This profile may manage Facility work: an issue's buttons, a report's page. */
  canManage: boolean;
  onOpenEntity: (id: string) => void;
  onEditTicket: (ticketId: string) => void;
  onRaiseTicket: (entityId: string) => void;
  focused?: boolean;
}) {
  const ref = useInView<HTMLDivElement>(opened, "start");
  const shown = { folded: opened ? undefined : foldedLines(item), onToggle };
  return (
    <div ref={ref}>
      {item.kind === "issue"
        ? <CockpitAttentionRow card={item.card} onOpenEntity={onOpenEntity} canManage={canManage} onEditTicket={onEditTicket}
            onRaiseTicket={onRaiseTicket} focused={focused} {...shown} />
        : item.kind === "report" ? <ReportDetail announcement={item.announcement} canOpenPage={canManage} {...shown} />
        : <NoteDetail announcement={item.announcement} {...shown} />}
    </div>
  );
}

export default function MessagesTab({ onOpenEntity, doors, reportFaultFor, onFaultFormOpened, onEditTicket,
  onReportProblem, focusFaults }: {
  onOpenEntity: (entityId: string) => void;
  /** What this profile may do (auth/doors): `facility` takes faults on and opens tickets, `reportFault` reports a
   *  problem. */
  doors: Doors;
  /** "Open a ticket" opens pointed at this device (a device panel's wrench); dropped once the form has it. */
  reportFaultFor?: string;
  onFaultFormOpened?: () => void;
  /** A card's "Edit ticket": the Tickets tab, that record's form open. */
  onEditTicket: (ticketId: string) => void;
  /** A guest's "Report a problem". */
  onReportProblem: () => void;
  /** The devices whose issue opens (a device window's warning, screen "openFaults"). */
  focusFaults?: readonly string[];
}) {
  const { entities } = useHA();
  const { config, resolvedRooms } = useConfig();
  const { devices } = useVillaModel();
  const canManage = doors.facility;
  const canReport = doors.reportFault;
  const deviceOptions = useMemo(
    () => (canManage ? buildDeviceOptions(devices, config.entityMap, entities, resolvedRooms) : []),
    [canManage, devices, config.entityMap, entities, resolvedRooms]);

  const { open, watched } = useCockpitIssues();
  const { kept, unread, unreadReports } = useAnnouncements();
  // something unread: opened on Notifications (ticket 18 of "One inbox"); a warning or the wrench first
  const opening = { warning: !!focusFaults?.length, form: !!reportFaultFor && canManage };
  const [filter, setFilter] = useState<MessagesFilter>(() => openingFilter(unread, opening, unreadReports));
  // ⚠️ UNTIL ONE IS CHOSEN, IT FOLLOWS WHAT IS UNREAD (architecture review, 2026-10-30): VESTA's feed may be read a moment
  // after the Cockpit opened (a reload), and the Inbox stayed on Issues over unread notifications
  const [chosen, setChosen] = useState(false);
  const pickFilter = (f: MessagesFilter) => { setChosen(true); setFilter(f); };
  useEffect(() => {
    if (!chosen) setFilter((f) => followingFilter(f, unread, opening, unreadReports));
  }, [chosen, unread, unreadReports]);     // `opening`: the Cockpit's, fixed while the tab is open
  const [selected, setSelected] = useState<string | null>(null);
  // a device window's warning opens its issue until it is folded (or another card opened)
  const [focusDone, setFocusDone] = useState(false);
  /** The "Open a ticket" form, above the cards: closed, or open (pointed at a device when it came from a wrench). */
  const [raising, setRaising] = useState<{ entity?: string } | null>(null);
  useEffect(() => {
    if (!reportFaultFor || !canManage) return;
    setRaising({ entity: reportFaultFor });
    onFaultFormOpened?.();
    // once per request: the form keeps what was typed while the rest re-renders
  }, [reportFaultFor]);
  // a device window's warning: its issue open, the list on Open issues
  const focusKey = (focusFaults ?? []).join("|");
  useEffect(() => {
    if (!focusKey) return;
    setSelected(null);
    pickFilter("issues");
    setFocusDone(false);
  }, [focusKey]);
  const isFocus = focusKey && !focusDone
    ? (card: CardView) => cardFocused(card.entityId, focusFaults, devices.deviceOf) : undefined;

  const view = messagesView({ open, watched, announcements: kept, filter, selected, focus: isFocus });
  const paged = usePaged(view.notifications);
  const reportsPaged = usePaged(view.reports);
  // which sections are open: Open issues, Notifications and Reports open, Watch and Closed folded (owner, 2026-10-25,
  // 2026-10-28)
  const [folds, setFolds] = useState({ issues: true, notes: true, reports: true, watch: false, closed: false });
  const fold = (k: keyof typeof folds) => setFolds((f) => ({ ...f, [k]: !f[k] }));
  const raise = () => setRaising({});
  const { issues: showsIssues, notifications: showsNotes, reports: showsReports } = view.shows;
  const item = view.selected;
  // a tap opens a card, or folds the one open; one card open at a time, the warning's issue let go
  const toggle = (key: string) => { setSelected(item?.key === key ? null : key); setFocusDone(true); };
  const card = (i: MessageItem) => (
    <InboxCard key={i.key} item={i} opened={item?.key === i.key} onToggle={() => toggle(i.key)} canManage={canManage}
      onOpenEntity={onOpenEntity} onEditTicket={onEditTicket} onRaiseTicket={(entity) => setRaising({ entity })}
      focused={i.kind === "issue" && !!isFocus?.(i.card)} />
  );

  return (
    <div className="fm-stack">
      {/* the filters, always on one line, and on the same line at its right the
          Issues' own button (owner, 2026-10-31: "Open Ticket", the card's own words and wrench): two groups, so a
          narrow phone wraps the button whole under the filters, never squeezing them */}
      <div className="messages-toolbar">
        <div className="messages-filters" role="group" aria-label="Show">
          {view.filters.map((f) => (
            <button key={f.id} type="button" className={`messages-filter${filter === f.id ? " on" : ""}`}
              aria-pressed={filter === f.id} onClick={() => pickFilter(f.id)}>
              {/* both words drawn, the line's width shows one (08-shared.css .messages-filter-short) */}
              {f.short ? <><span className="messages-filter-long">{f.label}</span><span className="messages-filter-short">{f.short}</span></>
                : f.label}
              {f.count ? <span className="messages-filter-count">{f.count}</span> : null}
            </button>
          ))}
        </div>
        {/* only while the issues are listed, as when it sat over Open issues */}
        {showsIssues && (canManage || canReport) && (
          <div className="messages-toolbar-actions">
            {canManage
              ? <button type="button" className={CARD_BUTTON} onClick={raise}><WorkLabel kind="raiseTicket" /></button>
              : <button type="button" className="btn ghost" onClick={onReportProblem}><Plus size={16} /> Report a problem</button>}
          </div>
        )}
      </div>
      {raising && (
        <FaultForm key={raising.entity ?? "new"} presetEntity={raising.entity} deviceOptions={deviceOptions}
          onDone={() => setRaising(null)} />
      )}
      {showsIssues && (
        <MessagesSection title="Open issues" count={open.length} open={folds.issues} onToggle={() => fold("issues")}
          tip={canManage ? <FaultTiming /> : undefined}>
          {view.issues.map(card)}
          {open.length === 0 && <p className="muted body-text messages-empty">Nothing needs attention.</p>}
        </MessagesSection>
      )}
      {showsNotes && (
        <MessagesSection title="Notifications" open={folds.notes} onToggle={() => fold("notes")}>
          {paged.page.map(card)}
          {view.notifications.length === 0
            ? <p className="muted body-text messages-empty">{view.notificationsEmpty}</p>
            : <Pager paged={paged} unit="notification" />}
        </MessagesSection>
      )}
      {/* VESTA's reports (ticket 20 of "One inbox"): the daily digest, the weekly and monthly reports, the night check */}
      {showsReports && (
        <MessagesSection title="Reports" open={folds.reports} onToggle={() => fold("reports")}>
          {reportsPaged.page.map(card)}
          {view.reports.length === 0
            ? <p className="muted body-text messages-empty">No report yet.</p>
            : <Pager paged={reportsPaged} unit="report" />}
        </MessagesSection>
      )}
      {/* last, and not in Open issues' count: cleared, the VESTA Agent still watching it (fm/faultConfirm); folded by
          default (owner, 2026-10-25); a section of its own, below Notifications (owner, 2026-10-28) */}
      {/* a problem's later life, with the issues and always there, empty or not (owner, 2026-10-28) */}
      {showsIssues && (
        <>
          <FoldedRows title="Watch" rows={view.watched} unit="watched item" open={folds.watch}
            onToggle={() => fold("watch")} card={card} empty="Nothing is being watched."
            tip="Cleared problems VESTA still watches: VESTA closes each at the time on its card if all is still well; a problem back before then reopens as the same problem." />
          {/* what is finished (placeOf): alerts that ended, requests and rings answered or over; folded, last */}
          <FoldedRows title="Closed" rows={view.closed} unit="closed item" open={folds.closed}
            onToggle={() => fold("closed")} card={card} empty="Nothing closed yet."
            tip="Finished: alerts that ended, and messages that asked something and were answered or are over (a request approved, refused or expired, a ring opened or missed)." />
        </>
      )}
    </div>
  );
}

/** Folded or opened, as every Inbox card (InboxCard). */
type CardShown = Pick<RecordCardProps, "folded"> & { onToggle?: () => void };

/** A report: what VESTA wrote, then its page in the document viewer — for the profiles the add-on serves pages to (the
 *  owner and the facility manager: fm-document), so no one is offered a page they cannot open. */
export function ReportDetail({ announcement: a, canOpenPage, ...shown }: CardShown & { announcement: Announcement; canOpenPage: boolean }) {
  return (
    <NoteDetail announcement={a} {...shown}>
      {a.page && canOpenPage && <PageLink page={a.page} />}
    </NoteDetail>
  );
}

/** A notification's title, when it came and all it says, or a report. ⚠️ THE COCKPIT'S ONE CARD (owner, 2026-10-29: "the
 *  notification cards styled the same way as the Issue cards, text colour, font, size"): its frame, title and text sizes
 *  are an issue's (RecordCard), its buttons under it on the right; held, then the superadmin code, it is erased as a
 *  Facility record is (owner, 2026-10-29: a card left from an older format). ⚠️ IT OWNS ITS PRESS (architecture review
 *  2026-10-29 #4): the screens each decided whether to pass one — an issue's card and a report passed none — so whatever
 *  buttons a message carries are pressed here, the same wherever it shows (RecordButtons, the one button row). */
export function NoteDetail({ announcement: a, children, folded, onToggle }: CardShown & { announcement: Announcement; children?: ReactNode }) {
  return (
    <RecordCard title={a.title} folded={folded} onOpen={onToggle}
      lead={isReport(a) ? <FileText size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}
      when={a.at ? momentText(a.at) : undefined}
      erase={{ title: "Delete message", detail: a.title, run: (token) => eraseMessage(a, token, backendFetch) }}
      body={<div className="messages-card-body"><AnnouncementContent announcement={a} />{children}</div>}
      actions={a.buttons.length > 0 ? <RecordButtons record={a} /> : undefined} />
  );
}
