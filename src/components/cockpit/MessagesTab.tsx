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
import { ArrowLeft, Bell, CheckCircle2, Plus } from "lucide-react";
import type { Doors } from "@/auth/doors";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useVillaModel } from "@/config/VillaModel";
import { cardFocused } from "@/config/attention";
import type { CardView } from "@/config/cockpitCard";
import { localStamp } from "@/fm/fmEngine";
import { useAnnouncements } from "@/messages/AnnouncementsContext";
import { messagesView, openingFilter, type MessageItem, type MessagesFilter } from "@/messages/messagesModel";
import { buildDeviceOptions } from "@/components/fm/DeviceSearchPicker";
import FaultForm from "@/components/fm/FaultForm";
import FaultTiming from "@/components/fm/FaultTiming";
import { SourceIcons } from "@/components/fm/sourceIcons";
import FoldedList from "@/components/common/FoldedList";
import { Pager, usePaged } from "@/components/common/Paged";
import { AnnouncementContent, useAnnouncementPress } from "@/components/messages/AnnouncementContent";
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
      time: first?.latest ? localStamp(first.latest.at) : "",
    };
  }
  const a = item.announcement;
  return {
    icon: <Bell size={18} aria-hidden="true" />,
    title: a.title,
    sub: a.text.split("\n")[0] || a.status,
    time: a.at ? localStamp(a.at) : "",
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
  const choose = (key: string) => { setSelected(key); setRaising(null); setFocusDone(true); };
  const raise = () => setRaising({});
  // the list again (a phone's Back): nothing asked, the warning's issue let go
  const back = () => { setSelected(null); setRaising(null); setFocusDone(true); };
  const { issues: showsIssues, notifications: showsNotes } = view.shows;
  const item = raising ? null : view.selected;
  // A phone shows the item someone chose (a line, a warning, the ticket form), else the list: an item that went (an
  // issue cleared, the form done) never leaves another open in its place.
  const reading = !!raising || view.openedBy === "asked" || view.openedBy === "focus";
  // Read on this tablet once in view: the Notifications filter's page, and the one open on the right. On All they sit
  // under the open issues, maybe below the fold: drawn there is not seen.
  const onScreen = [...(filter === "notifications" ? paged.page : []), ...(item?.kind === "notification" ? [item] : [])]
    .flatMap((i) => (i.kind === "notification" ? [i.announcement] : []));
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
            <div className="cockpit-issues-head">
              <div className="settings-section-title">Open issues{open.length > 0 ? ` (${open.length})` : ""}</div>
              {canManage && (
                <div className="cockpit-issues-actions">
                  <FaultTiming />
                  <button className="btn ghost" onClick={raise}><Plus size={16} /> Open a ticket</button>
                </div>
              )}
              {!canManage && canReport && (
                <div className="cockpit-issues-actions">
                  <button className="btn ghost" onClick={onReportProblem}><Plus size={16} /> Report a problem</button>
                </div>
              )}
            </div>
          )}
          {view.issues.map((i) => <MessageRow key={i.key} item={i} selected={item?.key === i.key} onSelect={choose} />)}
          {showsIssues && open.length === 0 && <p className="muted body-text messages-empty">Nothing needs attention.</p>}
          {/* after every open issue, and not in its count: closed, the VESTA Agent confirming it (fm/faultConfirm);
              folded by default (owner, 2026-10-25) */}
          <FoldedList title="Watched" rows={view.watched} unit="watched fault"
            tip="Closed faults VESTA still watches: back before the time on its card, a fault reopens as the same problem; after it, VESTA lets it go.">
            {(w) => <MessageRow key={w.key} item={w} selected={item?.key === w.key} onSelect={choose} />}
          </FoldedList>
          {showsNotes && (
            <>
              <div className="settings-section-title">Notifications</div>
              {paged.page.map((n) => <MessageRow key={n.key} item={n} selected={item?.key === n.key} onSelect={choose} />)}
              {view.notifications.length === 0
                ? <p className="muted body-text messages-empty">Nothing announced yet.</p>
                : <Pager paged={paged} unit="notification" />}
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
  const a = item.announcement;
  const { presses, press } = useAnnouncementPress(a);
  return (
    <div className="messages-note">
      <div className="messages-note-head">
        <strong>{a.title}</strong>
        {a.at && <span className="muted">{localStamp(a.at)}</span>}
      </div>
      <AnnouncementContent announcement={a} onPress={press} presses={presses} />
    </div>
  );
}
