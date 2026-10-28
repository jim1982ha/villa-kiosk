// src/components/cockpit/MessagesTab.tsx
// The Cockpit's first tab, Messages (ticket 17 of "One inbox", owner 2026-10-28; proposal B): the Overview's open
// issues and the villa's announcements in one list on the left, the item chosen open on the right. What is listed,
// counted and open is the Messages model's (messages/messagesModel); this draws it.
//
// ⚠️ OPEN ISSUES IS TODAY'S OVERVIEW, MOVED (owner): one line per device in the same order, its card with the same
// buttons (Open Ticket, Close, Edit ticket) opened on the right, "Open a ticket" and the (i) above the list, Watched
// folded at the end, a device window's warning opening on its issue. On a phone the list and the item take the
// screen in turn.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bell, CheckCircle2, ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { Doors } from "@/auth/doors";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useVillaModel } from "@/config/VillaModel";
import { cardFocused } from "@/config/attention";
import type { CardView } from "@/config/cockpitCard";
import { localStamp } from "@/fm/fmEngine";
import { useAnnouncementPress, useAnnouncements } from "@/messages/AnnouncementsContext";
import { announcementWords, cardsOfIssue, messagesView, openingFilter, readOnScreen, type MessageItem,
  type MessagesFilter } from "@/messages/messagesModel";
import { buildDeviceOptions } from "@/components/fm/DeviceSearchPicker";
import FaultForm from "@/components/fm/FaultForm";
import FaultTiming from "@/components/fm/FaultTiming";
import { SourceIcons } from "@/components/fm/sourceIcons";
import InfoTip from "@/components/common/InfoTip";
import { Pager, usePaged } from "@/components/common/Paged";
import { AnnouncementContent } from "@/components/messages/AnnouncementContent";
import type { Announcement } from "@/messages/announcements";
import type { PressState } from "@/messages/presses";
import { AttentionCard, CockpitAttentionRow } from "./IssueCard";
import { useCockpitIssues } from "./useVillaAttention";

/** One line of the list — pure (a check draws it): its icon, its title, the line under it, its time. */
export function MessageRow({ item, selected, onSelect }: {
  item: MessageItem;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const row = rowOf(item);
  return (
    <button type="button" className={`messages-row${selected ? " on" : ""}`} aria-current={selected || undefined}
      onClick={() => onSelect(item.key)}>
      <span className="messages-row-icon">{row.icon}</span>
      <span className="messages-row-text">
        <b>{row.title}</b>
        {row.sub && <span>{row.sub}</span>}
      </span>
      {row.time && <span className="messages-row-time">{row.time}</span>}
    </button>
  );
}

/** One section of the list — Open issues, Notifications, Watch — its name, count and (i) on one line with its actions,
 *  folded or open by its chevron (owner, 2026-10-28: the three at one level, each collapsible). */
export function MessagesSection({ title, count, open, onToggle, tip, actions, children }: {
  title: string; count?: number; open: boolean; onToggle: () => void; tip?: ReactNode; actions?: ReactNode;
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
          {tip && <InfoTip label={`About ${title}`}>{tip}</InfoTip>}
        </div>
        {actions && <div className="cockpit-issues-actions">{actions}</div>}
      </div>
      {open && children}
    </section>
  );
}

/** A section that only grows (Watch, Closed): its lines a page at a time; `empty` said while it has none (it is always
 *  there: owner, 2026-10-28). */
function FoldedRows({ rows, unit, selected, onSelect, empty, ...section }: {
  title: string; rows: MessageItem[]; unit: string; open: boolean; onToggle: () => void; tip?: ReactNode;
  selected?: string; onSelect: (key: string) => void; empty: string;
}) {
  const paged = usePaged(rows);
  return (
    <MessagesSection {...section} count={rows.length}>
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
    return {
      icon: card.look === "watched"
        ? <CheckCircle2 className="fault-watched-icon" size={18} aria-hidden="true" />
        : card.lead ? <SourceIcons {...card.lead} /> : null,
      title: card.title,
      sub: [card.room, first?.text].filter(Boolean).join(" · "),
      time: first?.story.length ? localStamp(first.story[first.story.length - 1].at) : "",
    };
  }
  // its words as every screen says them (messagesModel.announcementWords)
  const w = announcementWords(item.announcement);
  return {
    icon: <Bell size={18} aria-hidden="true" />,
    title: w.title,
    sub: w.line,
    time: w.at ? localStamp(w.at) : "",
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
  const { kept, unread, shown } = useAnnouncements();
  // something unread: opened on Notifications, the newest open (ticket 18 of "One inbox"); a warning or the wrench first
  const [filter, setFilter] = useState<MessagesFilter>(
    () => openingFilter(unread, { warning: !!focusFaults?.length, form: !!reportFaultFor && canManage }));
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
    setFilter("issues");
    setFocusDone(false);
  }, [focusKey]);
  const isFocus = focusKey && !focusDone
    ? (card: CardView) => cardFocused(card.entityId, focusFaults, devices.deviceOf) : undefined;

  const view = messagesView({ open, watched, announcements: kept, filter, selected, focus: isFocus });
  const paged = usePaged(view.notifications);
  // which sections are open: Open issues and Notifications open, Watch and Closed folded (owner, 2026-10-25, 2026-10-28)
  const [folds, setFolds] = useState({ issues: true, notes: true, watch: false, closed: false });
  const fold = (k: keyof typeof folds) => setFolds((f) => ({ ...f, [k]: !f[k] }));
  const choose = (key: string) => { setSelected(key); setRaising(null); setFocusDone(true); };
  const raise = () => setRaising({});
  // the list again (a phone's Back): nothing asked, the warning's issue let go
  const back = () => { setSelected(null); setRaising(null); setFocusDone(true); };
  const { issues: showsIssues, notifications: showsNotes } = view.shows;
  const item = raising ? null : view.selected;
  // A phone shows the item someone chose (a line, a warning, the ticket form), else the list: an item that went (an
  // issue cleared, the form done) never leaves another open in its place.
  const reading = !!raising || view.openedBy === "asked" || view.openedBy === "focus";
  // read on this tablet once in view, as the model says (messagesModel.readOnScreen)
  const onScreen = readOnScreen(filter, paged.page, item);
  const onScreenKey = onScreen.map((a) => a.seq).join(",");
  useEffect(() => {
    if (onScreen.length) shown(onScreen);
    // keyed on what is shown: a re-draw showing the same lines marks nothing again
  }, [onScreenKey, shown]);

  return (
    <div className={`messages${reading ? " reading" : ""}`}>
      <div className="messages-list">
        {/* the filters, always on one line (owner: the list pane keeps its width) */}
        <div className="messages-filters" role="group" aria-label="Show">
          {view.filters.map((f) => (
            <button key={f.id} type="button" className={`messages-filter${filter === f.id ? " on" : ""}`}
              aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}{f.count ? <span className="messages-filter-count">{f.count}</span> : null}
            </button>
          ))}
        </div>
        <div className="messages-scroll">
          {showsIssues && (
            <MessagesSection title="Open issues" count={open.length} open={folds.issues} onToggle={() => fold("issues")}
              actions={canManage ? (
                <>
                  <FaultTiming />
                  <button className="btn ghost" onClick={raise}><Plus size={16} /> Open a ticket</button>
                </>
              ) : canReport ? (
                <button className="btn ghost" onClick={onReportProblem}><Plus size={16} /> Report a problem</button>
              ) : null}>
              {view.issues.map((i) => <MessageRow key={i.key} item={i} selected={item?.key === i.key} onSelect={choose} />)}
              {open.length === 0 && <p className="muted body-text messages-empty">Nothing needs attention.</p>}
            </MessagesSection>
          )}
          {showsNotes && (
            <MessagesSection title="Notifications" open={folds.notes} onToggle={() => fold("notes")}>
              {paged.page.map((n) => <MessageRow key={n.key} item={n} selected={item?.key === n.key} onSelect={choose} />)}
              {view.notifications.length === 0
                ? <p className="muted body-text messages-empty">Nothing announced yet.</p>
                : <Pager paged={paged} unit="notification" />}
            </MessagesSection>
          )}
          {/* last, and not in Open issues' count: closed, the VESTA Agent confirming it (fm/faultConfirm); folded by
              default (owner, 2026-10-25); a section of its own, below Notifications (owner, 2026-10-28) */}
          {/* a problem's later life, with the issues and always there, empty or not (owner, 2026-10-28) */}
          {showsIssues && (
            <>
              <FoldedRows title="Watch" rows={view.watched} unit="watched fault" open={folds.watch}
                onToggle={() => fold("watch")} selected={item?.key} onSelect={choose} empty="Nothing is being watched."
                tip="Closed faults VESTA still watches: back before the time on its card, a fault reopens as the same problem; after it, VESTA lets it go." />
              {/* alerts that are closed: folded, last */}
              <FoldedRows title="Closed" rows={view.closed} unit="closed alert" open={folds.closed}
                onToggle={() => fold("closed")} selected={item?.key} onSelect={choose} empty="Nothing closed yet." />
            </>
          )}
        </div>
      </div>

      <div className="messages-detail">
        <button type="button" className="btn ghost messages-back" onClick={back}>
          <ArrowLeft size={16} aria-hidden /> Messages
        </button>
        {raising && (
          <FaultForm key={raising.entity ?? "new"} presetEntity={raising.entity} deviceOptions={deviceOptions}
            onDone={() => setRaising(null)} />
        )}
        {/* an alert's open issue: VESTA's card of it first, as Telegram shows it, then the tablet's own buttons */}
        {item?.kind === "issue" && cardsOfIssue(item.card, kept).map((a) => <NoteDetail key={a.key} announcement={a} />)}
        {item?.kind === "issue" && (item.card.look === "watched"
          ? <AttentionCard card={item.card} onOpenEntity={onOpenEntity} />
          : <CockpitAttentionRow key={item.key} card={item.card} onOpenEntity={onOpenEntity} canManage={canManage}
              onEditTicket={onEditTicket} focused={!!isFocus?.(item.card)} />)}
        {item?.kind === "notification" && <NotificationDetail item={item} />}
        {!raising && !item && <p className="muted body-text messages-empty">Nothing to show.</p>}
      </div>
    </div>
  );
}

/** A notification, open on the right: its title and when it came, then all it says, its photo and its buttons. */
function NotificationDetail({ item }: { item: Extract<MessageItem, { kind: "notification" }> }) {
  const { presses, press } = useAnnouncementPress(item.announcement);
  return <NoteDetail announcement={item.announcement} onPress={press} presses={presses} />;
}

/** A notification's title, when it came and all it says: on its own, or VESTA's card of an open issue's alert above the
 *  issue's own card (no buttons of its own: announcements.parseVestaMessage). */
function NoteDetail({ announcement: a, onPress, presses }: {
  announcement: Announcement; onPress?: (command: string) => void; presses?: PressState;
}) {
  return (
    <div className="messages-note">
      <div className="messages-note-head">
        <strong>{a.title}</strong>
        {a.at && <span className="muted">{localStamp(a.at)}</span>}
      </div>
      <AnnouncementContent announcement={a} onPress={onPress} presses={presses} />
    </div>
  );
}
