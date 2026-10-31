// src/components/cockpit/MessagesTab.tsx
// The Cockpit's first tab, Messages (ticket 17 of "One inbox", owner 2026-10-28; proposal B): the Overview's open
// issues and the villa's announcements in one list on the left, the item chosen open on the right. What is listed,
// counted and open is the Messages model's (messages/messagesModel); this draws it.
//
// ⚠️ OPEN ISSUES IS TODAY'S OVERVIEW, MOVED (owner): one line per device in the same order, its card with the same
// buttons (Open Ticket, Close, Edit ticket) opened on the right, "Open Ticket" on the filters' line, Watch
// folded at the end, a device window's warning opening on its issue. On a phone the list and the item take the
// screen in turn.

import { momentText } from "@/utils/dateText";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bell, CheckCircle2, ChevronDown, ChevronRight, FileText, Plus } from "lucide-react";
import { CARD_BUTTON, WorkLabel } from "@/components/fm/WorkButtons";
import type { ReactNode } from "react";
import type { Doors } from "@/auth/doors";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useVillaModel } from "@/config/VillaModel";
import { cardFocused } from "@/config/attention";
import { rowTime, type CardView } from "@/config/cockpitCard";

import { useAnnouncements } from "@/messages/AnnouncementsContext";
import { backendFetch } from "@/auth/sessionLost";
import { useSuperadminDelete } from "@/hooks/useSuperadminDelete";
import type { LongPressHandlers } from "@/hooks/useLongPress";
import { announcementWords, cardsOfIssue, messageOfLine, messagesView, followingFilter, openingFilter, type MessageItem,
  type MessagesFilter } from "@/messages/messagesModel";
import { buildDeviceOptions } from "@/components/fm/DeviceSearchPicker";
import FaultForm from "@/components/fm/FaultForm";
import FaultTiming from "@/components/fm/FaultTiming";
import { SourceIcons } from "@/components/fm/sourceIcons";
import InfoTip from "@/components/common/InfoTip";
import { Pager, usePaged } from "@/components/common/Paged";
import { AnnouncementContent, PageLink, RecordButtons } from "@/components/messages/AnnouncementContent";
import RecordCard from "@/components/fm/RecordCard";
import { eraseMessage, type Announcement } from "@/messages/announcements";
import { AlertIssueCard, AttentionCard, CockpitAttentionRow } from "./IssueCard";
import { useCockpitIssues } from "./useVillaAttention";

/** One line of the list — pure (a check draws it): its icon, its title, the line under it, its time. */
export function MessageRow({ item, selected, onSelect, hold }: {
  item: MessageItem;
  selected: boolean;
  onSelect: (key: string) => void;
  /** Held, then the superadmin code: the message is erased (ErasableMessageRow). */
  hold?: LongPressHandlers;
}) {
  const row = rowOf(item);
  const { consumeClick, ...holding } = hold ?? { consumeClick: () => false };
  return (
    <button type="button" className={`messages-row${selected ? " on" : ""}${hold ? " fm-erasable" : ""}`}
      aria-current={selected || undefined}
      // a completed hold is followed by a click: opening the message under the code's prompt would be wrong
      onClick={() => { if (!consumeClick()) onSelect(item.key); }} {...holding}>
      <span className="messages-row-icon">{row.icon}</span>
      <span className="messages-row-text">
        <b>{row.title}</b>
        {row.sub && <span>{row.sub}</span>}
      </span>
      {row.time && <span className="messages-row-time">{row.time}</span>}
      {hold && <span className="fm-erasable-dot" aria-hidden="true" />}
    </button>
  );
}

/** A notification's or a report's line, erased as a Facility record is (owner, 2026-10-29: a card left from an
 *  older format): held, then the superadmin code (hooks/useSuperadminDelete, the add-on's /message-erase). */
function ErasableMessageRow({ item, selected, onSelect }: {
  item: MessageItem;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const a = item.kind === "issue" ? null : item.announcement;
  const hold = useSuperadminDelete({ title: "Delete message", detail: a ? announcementWords(a).title : "" },
    async (token) => (a ? eraseMessage(a, token, backendFetch) : false), { nativeButton: true });
  return <MessageRow item={item} selected={selected} onSelect={onSelect} hold={a ? hold : undefined} />;
}

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
      {open && children}
    </section>
  );
}

/** A section that only grows (Watch, Closed): its lines a page at a time; `empty` said while it has none (it is always
 *  there: owner, 2026-10-28). */
function FoldedRows({ rows, unit, selected, onSelect, empty, tip, ...section }: {
  title: string; rows: MessageItem[]; unit: string; open: boolean; onToggle: () => void; tip: string;
  selected?: string; onSelect: (key: string) => void; empty: string;
}) {
  const paged = usePaged(rows);
  return (
    <MessagesSection {...section} count={rows.length} tip={<InfoTip label={`About ${section.title}`}>{tip}</InfoTip>}>
      {paged.page.map((r) => <MessageRow key={r.key} item={r} selected={selected === r.key} onSelect={onSelect} />)}
      {rows.length === 0 ? <p className="muted body-text messages-empty">{empty}</p> : <Pager paged={paged} unit={unit} />}
    </MessagesSection>
  );
}

/** What a line says about its item: an issue its device, room and first problem; a notification its title and first
 *  words, and when it came. */
function rowOf(item: MessageItem) {
  if (item.kind === "issue") {
    const { card } = item;
    const first = card.lines[0];
    const when = rowTime(card);
    return {
      icon: card.look === "watched"
        ? <CheckCircle2 className="fault-watched-icon" size={18} aria-hidden="true" />
        : card.lead ? <SourceIcons {...card.lead} /> : null,
      title: card.title,
      sub: [card.room, first?.text].filter(Boolean).join(" · "),
      time: when ? momentText(when) : "",
    };
  }
  // its words as every screen says them (messagesModel.announcementWords)
  const w = announcementWords(item.announcement);
  return {
    icon: item.kind === "report" ? <FileText size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />,
    title: w.title,
    sub: w.line,
    time: w.at ? momentText(w.at) : "",
  };
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
  // something unread: opened on Notifications, the newest open (ticket 18 of "One inbox"); a warning or the wrench first
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
  // a device window's warning opens its issue until Back (or another line) is chosen
  const [focusDone, setFocusDone] = useState(false);
  /** The "Open a ticket" form, on the right: closed, or open (pointed at a device when it came from a wrench). */
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
  const choose = (key: string) => { setSelected(key); setRaising(null); setFocusDone(true); };
  const raise = () => setRaising({});
  // the list again (a phone's Back): nothing asked, the warning's issue let go
  const back = () => { setSelected(null); setRaising(null); setFocusDone(true); };
  const { issues: showsIssues, notifications: showsNotes, reports: showsReports } = view.shows;
  const item = raising ? null : view.selected;
  // A phone shows the item someone chose (a line, a warning, the ticket form), else the list: an item that went (an
  // issue cleared, the form done) never leaves another open in its place.
  const reading = !!raising || view.openedBy === "asked" || view.openedBy === "focus";

  return (
    <div className={`messages${reading ? " reading" : ""}`}>
      <div className="messages-list">
        {/* the filters, always on one line (owner: the list pane keeps its width), and on the same line at its right the
            Issues' own button (owner, 2026-10-31: "Open Ticket", the card's own words and wrench): two groups, so a
            narrow phone wraps the button whole under the filters, never squeezing them */}
        <div className="messages-toolbar">
          <div className="messages-filters" role="group" aria-label="Show">
            {view.filters.map((f) => (
              <button key={f.id} type="button" className={`messages-filter${filter === f.id ? " on" : ""}`}
                aria-pressed={filter === f.id} onClick={() => pickFilter(f.id)}>
                {f.label}{f.count ? <span className="messages-filter-count">{f.count}</span> : null}
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
        <div className="messages-scroll">
          {showsIssues && (
            <MessagesSection title="Open issues" count={open.length} open={folds.issues} onToggle={() => fold("issues")}
              tip={canManage ? <FaultTiming /> : undefined}>
              {view.issues.map((i) => <MessageRow key={i.key} item={i} selected={item?.key === i.key} onSelect={choose} />)}
              {open.length === 0 && <p className="muted body-text messages-empty">Nothing needs attention.</p>}
            </MessagesSection>
          )}
          {showsNotes && (
            <MessagesSection title="Notifications" open={folds.notes} onToggle={() => fold("notes")}>
              {paged.page.map((n) => <ErasableMessageRow key={n.key} item={n} selected={item?.key === n.key} onSelect={choose} />)}
              {view.notifications.length === 0
                ? <p className="muted body-text messages-empty">{view.notificationsEmpty}</p>
                : <Pager paged={paged} unit="notification" />}
            </MessagesSection>
          )}
          {/* VESTA's reports (ticket 20 of "One inbox"): the daily digest, the weekly and monthly reports, the night check */}
          {showsReports && (
            <MessagesSection title="Reports" open={folds.reports} onToggle={() => fold("reports")}>
              {reportsPaged.page.map((r) => <ErasableMessageRow key={r.key} item={r} selected={item?.key === r.key} onSelect={choose} />)}
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
                onToggle={() => fold("watch")} selected={item?.key} onSelect={choose} empty="Nothing is being watched."
                tip="Cleared problems VESTA still watches: VESTA closes each at the time on its card if all is still well; a problem back before then reopens as the same problem." />
              {/* what is finished (placeOf): alerts that ended, requests and rings answered or over; folded, last */}
              <FoldedRows title="Closed" rows={view.closed} unit="closed item" open={folds.closed}
                onToggle={() => fold("closed")} selected={item?.key} onSelect={choose} empty="Nothing closed yet."
                tip="Finished: alerts that ended, and messages that asked something and were answered or are over (a request approved, refused or expired, a ring opened or missed)." />
            </>
          )}
        </div>
      </div>

      <div className="messages-detail">
        <button type="button" className="btn ghost messages-back" onClick={back}>
          <ArrowLeft size={16} aria-hidden /> Inbox
        </button>
        {raising && (
          <FaultForm key={raising.entity ?? "new"} presetEntity={raising.entity} deviceOptions={deviceOptions}
            onDone={() => setRaising(null)} />
        )}
        {/* an alert's open issue: VESTA's card of it first, as Telegram shows it, then the tablet's own buttons */}
        {/* an alert's issue: ONE card, VESTA's message inside it and every card's buttons (owner, 2026-10-29, 2026-10-30) */}
        {item?.kind === "issue" && cardsOfIssue(item.card, kept).length > 0 && (
          <AlertIssueCard card={item.card} messages={(line) => messageOfLine(line, kept)} onOpenEntity={onOpenEntity}
            focused={!!isFocus?.(item.card)} canManage={canManage} onEditTicket={onEditTicket}
            onRaiseTicket={(entity) => setRaising({ entity })} />
        )}
        {item?.kind === "issue" && cardsOfIssue(item.card, kept).length === 0 && (item.card.look === "watched"
          ? <AttentionCard card={item.card} onOpenEntity={onOpenEntity} />
          : <CockpitAttentionRow key={item.key} card={item.card} onOpenEntity={onOpenEntity} canManage={canManage}
              onEditTicket={onEditTicket} onRaiseTicket={(entity) => setRaising({ entity })}
              focused={!!isFocus?.(item.card)} />)}
        {item?.kind === "notification" && <NoteDetail announcement={item.announcement} />}
        {item?.kind === "report" && <ReportDetail announcement={item.announcement} canOpenPage={canManage} />}
        {!raising && !item && <p className="muted body-text messages-empty">Nothing to show.</p>}
      </div>
    </div>
  );
}

/** A report, open on the right: what VESTA wrote, then its page in the document viewer — for the profiles the add-on
 *  serves pages to (the owner and the facility manager: fm-document), so no one is offered a page they cannot open. */
export function ReportDetail({ announcement: a, canOpenPage }: { announcement: Announcement; canOpenPage: boolean }) {
  return (
    <NoteDetail announcement={a}>
      {a.page && canOpenPage && <PageLink page={a.page} />}
    </NoteDetail>
  );
}

/** A notification's title, when it came and all it says: on its own, VESTA's card of an open issue's alert above the
 *  issue's own card, or a report. ⚠️ THE COCKPIT'S ONE CARD (owner, 2026-10-29: "the notification cards styled the same
 *  way as the Issue cards, text colour, font, size"): its frame, title and text sizes are an issue's (RecordCard), its
 *  buttons under it on the right. ⚠️ IT OWNS ITS PRESS (architecture review 2026-10-29 #4): the screens each decided
 *  whether to pass one — an issue's card and a report passed none — so whatever buttons a message carries are pressed
 *  here, the same wherever it shows (RecordButtons, the one button row). */
export function NoteDetail({ announcement: a, children }: { announcement: Announcement; children?: ReactNode }) {
  return (
    <RecordCard title={a.title}
      titlePills={a.at ? <span className="fm-entity-chip fm-chip-static">{momentText(a.at)}</span> : undefined}
      body={<div className="messages-card-body"><AnnouncementContent announcement={a} />{children}</div>}
      actions={a.buttons.length > 0 ? <RecordButtons record={a} /> : undefined} />
  );
}
