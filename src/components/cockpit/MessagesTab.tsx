// src/components/cockpit/MessagesTab.tsx
// The Cockpit's first tab, Messages (ticket 17 of "One inbox", owner 2026-10-28): the open issues and the villa's
// announcements. What is listed, counted and open is the Messages model's (messages/messagesModel); this draws it.
//
// ⚠️ ONE COLUMN OF CARDS, AS TICKETS (owner, 2026-11-01): a list of rows on the left, the item chosen on the right, and
// a phone showing them in turn, were replaced by the cards themselves: whole under Issues, a notification or a report
// folded until tapped. All are ONE card (InboxCard → RecordCard): the row and the opened card were two drawings of the
// same thing, kept alike by hand.
//
// Open issues keep the Overview's order: one card per device, Watch folded at the end, a device window's warning
// opening on its issue. ⚠️ OPENING A TICKET IS THE TICKETS TAB'S (owner, 2026-11-02: "it makes no sense to see the
// dedicated button in the Inbox page"): the filters' line keeps only a guest's "Report a problem"; a card's own Open
// Ticket for a device with no record opens the Tickets tab's form pointed at it.

import { momentText } from "@/utils/dateText";
import { useEffect, useState } from "react";
import { Bell, FileText, Plus } from "lucide-react";
import type { Doors } from "@/auth/doors";
import { useVillaModel } from "@/config/VillaModel";
import { cardFocused } from "@/config/attention";
import type { CardView } from "@/config/cockpitCard";

import { useAnnouncements } from "@/messages/AnnouncementsContext";
import { backendFetch } from "@/auth/sessionLost";
import { useInView } from "@/hooks/useInView";
import { announcementWords, isReport, messagesView, followingFilter, openingFilter, type MessageItem,
  type MessagesFilter } from "@/messages/messagesModel";
import FaultTiming from "@/components/fm/FaultTiming";
import { Pager, usePaged } from "@/components/common/Paged";
import FoldedList, { ListSection } from "@/components/common/FoldedList";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import { AnnouncementContent, RecordButtons } from "@/components/messages/AnnouncementContent";
import RecordCard, { type RecordCardProps } from "@/components/fm/RecordCard";
import { eraseMessage, titleSentences, type Announcement } from "@/messages/announcements";
import { QUIET_PILL } from "@/fm/tone";
import { CockpitAttentionRow } from "./IssueCard";
import { useCockpitIssues } from "./useVillaAttention";
import { withCount } from "@/utils/countBadge";

/** ⚠️ ONE CARD OF THE INBOX, WHATEVER IT HOLDS (owner, 2026-11-01: "NEVER add dedicated lines of code for specific
 *  cards"): whole under Issues (`opened`, no `onToggle`: the card itself is not pressed, its buttons are); a notification
 *  or a report folded until tapped, opened in its place and brought into view. A device window's warning brings its
 *  issue into view too. The look is RecordCard's alone, here only which card it is. */
export function InboxCard({ item, opened, onToggle, canManage, onOpenEntity, onEditTicket, onRaiseTicket, focused }: {
  item: MessageItem;
  opened: boolean;
  onToggle?: () => void;
  /** This profile may manage Facility work: an issue's buttons, a report's page. */
  canManage: boolean;
  onOpenEntity: (id: string) => void;
  onEditTicket: (ticketId: string) => void;
  onRaiseTicket: (entityId: string) => void;
  focused?: boolean;
}) {
  const ref = useInView<HTMLDivElement>(!!focused || (opened && !!onToggle), "start");
  return (
    <div ref={ref} className="messages-card">
      {item.kind === "issue"
        ? <CockpitAttentionRow card={item.card} onOpenEntity={onOpenEntity} canManage={canManage} onEditTicket={onEditTicket}
            onRaiseTicket={onRaiseTicket} focused={focused} />
        : <AnnouncementCard item={item} canManage={canManage} folded={opened ? undefined : announcementWords(item.announcement).line}
            onToggle={onToggle} />}
    </div>
  );
}

function AnnouncementCard({ item, canManage, ...shown }: CardShown & { item: Exclude<MessageItem, { kind: "issue" }>; canManage: boolean }) {
  return <NoteDetail announcement={item.announcement} canOpenPage={canManage} {...shown} />;
}

export default function MessagesTab({ onOpenEntity, doors, onRaiseTicket, onEditTicket, onReportProblem, focusFaults }: {
  onOpenEntity: (entityId: string) => void;
  /** What this profile may do (auth/doors): `facility` takes faults on and opens tickets, `reportFault` reports a
   *  problem. */
  doors: Doors;
  /** A card's "Open Ticket" for a device with no record: the Tickets tab, its "Open a ticket" form pointed at it. */
  onRaiseTicket: (entityId: string) => void;
  /** A card's "Edit ticket": the Tickets tab, that record's form open. */
  onEditTicket: (ticketId: string) => void;
  /** A guest's "Report a problem". */
  onReportProblem: () => void;
  /** The devices whose issue opens (a device window's warning, screen "openFaults"). */
  focusFaults?: readonly string[];
}) {
  const { devices } = useVillaModel();
  const canManage = doors.facility;
  const canReport = doors.reportFault;

  const { open, watched, closed } = useCockpitIssues();
  const { kept, unread, unreadReports } = useAnnouncements();
  // something unread: opened on Notifications (ticket 18 of "One inbox"); a warning first
  const opening = { warning: !!focusFaults?.length };
  const [filter, setFilter] = useState<MessagesFilter>(() => openingFilter(unread, opening, unreadReports));
  // ⚠️ UNTIL ONE IS CHOSEN, IT FOLLOWS WHAT IS UNREAD (architecture review, 2026-10-30): VESTA's feed may be read a moment
  // after the Cockpit opened (a reload), and the Inbox stayed on Issues over unread notifications
  const [chosen, setChosen] = useState(false);
  const pickFilter = (f: MessagesFilter) => { setChosen(true); setFilter(f); };
  useEffect(() => {
    if (!chosen) setFilter((f) => followingFilter(f, unread, opening, unreadReports));
  }, [chosen, unread, unreadReports]);     // `opening`: the Cockpit's, fixed while the tab is open
  const [selected, setSelected] = useState<string | null>(null);
  // a device window's warning: the list on Open issues, its issue in view
  const focusKey = (focusFaults ?? []).join("|");
  useEffect(() => {
    if (!focusKey) return;
    setSelected(null);
    pickFilter("issues");
  }, [focusKey]);
  const isFocus = focusKey
    ? (card: CardView) => cardFocused(card.entityId, focusFaults, devices.deviceOf) : undefined;

  const view = messagesView({ open, watched, closed, announcements: kept, filter, selected });
  const paged = usePaged(view.notifications);
  const reportsPaged = usePaged(view.reports);
  // which sections are open: Open issues, Notifications and Reports open, Watch and Closed folded (owner, 2026-10-25,
  // 2026-10-28)
  const [folds, setFolds] = useState({ issues: true, notes: true, reports: true, watch: false, closed: false });
  const fold = (k: keyof typeof folds) => setFolds((f) => ({ ...f, [k]: !f[k] }));
  const { issues: showsIssues, notifications: showsNotes, reports: showsReports } = view.shows;
  const item = view.selected;
  // ⚠️ UNDER ISSUES EVERY CARD IS WHOLE AND NOT PRESSED (owner, 2026-11-01); elsewhere a tap opens one, or folds the one open
  const card = (i: MessageItem) => (
    <InboxCard key={i.key} item={i} opened={showsIssues || item?.key === i.key} canManage={canManage}
      onToggle={showsIssues ? undefined : () => setSelected(item?.key === i.key ? null : i.key)}
      onOpenEntity={onOpenEntity} onEditTicket={onEditTicket} onRaiseTicket={onRaiseTicket}
      focused={i.kind === "issue" && !!isFocus?.(i.card)} />
  );

  return (
    <div className="fm-stack">
      {/* always in view while the cards scroll (owner, 2026-11-01): the filters, always on one line, and on the same line at
          its right a guest's "Report a problem" (Open Ticket is the Tickets tab's, owner 2026-11-02): two groups, so a
          narrow phone wraps the button whole under the filters, never squeezing them */}
      <div className="messages-toolbar">
        <SegmentedGroup layout="natural" ariaLabel="Show" active={filter} onChange={pickFilter}
          options={view.filters.map((f) => ({ key: f.id, label: withCount(f.label, f.count) }))} />
        {/* only while the issues are listed, as when it sat over Open issues */}
        {showsIssues && !canManage && canReport && (
          <div className="messages-toolbar-actions">
            <button type="button" className="btn" onClick={onReportProblem}><Plus size={16} /> Report a problem</button>
          </div>
        )}
      </div>
      {showsIssues && (
        <ListSection title="Open issues" count={open.length} open={folds.issues} onToggle={() => fold("issues")}
          tip={canManage ? <FaultTiming /> : undefined}>
          {view.issues.map(card)}
          {open.length === 0 && <p className="muted body-text messages-empty">Nothing needs attention.</p>}
        </ListSection>
      )}
      {showsNotes && (
        <ListSection title="Notifications" count={view.notifications.length} open={folds.notes} onToggle={() => fold("notes")}>
          {paged.page.map(card)}
          {view.notifications.length === 0
            ? <p className="muted body-text messages-empty">{view.notificationsEmpty}</p>
            : <Pager paged={paged} />}
        </ListSection>
      )}
      {/* VESTA's reports (ticket 20 of "One inbox"): the daily digest, the weekly and monthly reports, the night check */}
      {showsReports && (
        <ListSection title="Reports" count={view.reports.length} open={folds.reports} onToggle={() => fold("reports")}>
          {reportsPaged.page.map(card)}
          {view.reports.length === 0
            ? <p className="muted body-text messages-empty">No report yet.</p>
            : <Pager paged={reportsPaged} />}
        </ListSection>
      )}
      {/* last, and not in Open issues' count: cleared, the VESTA Agent still watching it (fm/faultConfirm); folded by
          default (owner, 2026-10-25); a section of its own, below Notifications (owner, 2026-10-28) */}
      {/* a problem's later life, with the issues and always there, empty or not (owner, 2026-10-28) */}
      {showsIssues && (
        <>
          <FoldedList title="Watch" rows={view.watched} open={folds.watch}
            onToggle={() => fold("watch")} empty="Nothing is being watched."
            tip="Cleared problems VESTA still watches: VESTA closes each at the time on its card if all is still well; a problem back before then reopens as the same problem.">
            {card}
          </FoldedList>
          {/* what is finished (placeOf, closedCards): faults and alerts that ended, requests and rings answered or over; folded, last */}
          <FoldedList title="Closed" rows={view.closed} open={folds.closed}
            onToggle={() => fold("closed")} empty="Nothing closed yet."
            tip="Finished: faults and alerts that ended, and messages that asked something and were answered or are over (a request approved, refused or expired, a ring opened or missed).">
            {card}
          </FoldedList>
        </>
      )}
    </div>
  );
}

/** Folded or opened, as every Inbox card (InboxCard). */
type CardShown = Pick<RecordCardProps, "folded"> & { onToggle?: () => void };

/** A notification's title, when it came and all it says, or a report. ⚠️ THE COCKPIT'S ONE CARD (owner, 2026-10-29: "the
 *  notification cards styled the same way as the Issue cards, text colour, font, size"): its frame, title and text sizes
 *  are an issue's (RecordCard), its buttons under it on the right; held, then the superadmin code, it is erased as a
 *  Facility record is (owner, 2026-10-29: a card left from an older format). ⚠️ IT OWNS ITS PRESS (architecture review
 *  2026-10-29 #4): the screens each decided whether to pass one — an issue's card and a report passed none — so whatever
 *  buttons a message carries are pressed here, the same wherever it shows (RecordButtons, the one button row). */
export function NoteDetail({ announcement: a, canOpenPage = false, folded, onToggle }: CardShown & {
  announcement: Announcement;
  /** This profile is served VESTA's pages (the owner and the facility manager: fm-document), so no one is offered a
   *  page they cannot open. */
  canOpenPage?: boolean;
}) {
  // ⚠️ ITS PAGE WITH ITS BUTTONS, FOLDED TOO (owner, 2026-11-03: "show the button directly in the collapsed version of
  // the card"): the card's own button row (RecordCard `actions`) is drawn folded or opened, so a report's or a
  // notification's page is one tap away without opening it first
  const said = titleSentences(a.title);
  return (
    // its strip names it by its title's first sentence, its first line says the rest (titleSentences)
    <RecordCard title={said.name} status={said.rest ? { text: said.rest, tone: QUIET_PILL } : undefined}
      folded={folded} onOpen={onToggle}
      lead={isReport(a) ? <FileText size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}
      when={a.at ? momentText(a.at) : undefined}
      erase={{ title: "Delete message", detail: a.title, run: (token) => eraseMessage(a, token, backendFetch) }}
      body={<div className="messages-card-body"><AnnouncementContent announcement={a} /></div>}
      pages={a.page && canOpenPage ? [{ id: a.page, label: "Open the page", short: "Page" }] : undefined}
      actions={a.buttons.length > 0 ? <RecordButtons record={a} /> : undefined} />
  );
}
