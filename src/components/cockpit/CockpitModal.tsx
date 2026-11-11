// src/components/cockpit/CockpitModal.tsx
// The villa's whole-house status report — a graceful, non-technical "how is
// everything" glance, reachable from the same alert icon that used to open a
// bare Unavailable-devices list directly (see HUD.tsx/FacilityModal.tsx —
// repointed, not a new button). That list isn't gone: Needs Attention below
// already lists every unavailable device individually (nothing is capped),
// so there is no separate drill-down any more — one that only ever showed
// the exact same rows already on screen was pure ceremony.
//
// Every section here is read-only reporting on its own face; a device opens its own window (onOpenEntity).

import Window, { WindowHeader } from "@/components/common/Window";
import { useEffect, useMemo } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import type { Doors } from "@/auth/doors";
import { updatesWaiting } from "@/config/updatesWaiting";
import { formatCountBadge } from "@/utils/countBadge";
import ModalFooter from "@/components/common/ModalFooter";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import FacilitySections, { FACILITY_TABS, type FacilityTab } from "@/components/fm/FacilitySections";
import { useFacilityLiveView, useFmData } from "@/fm/FmDataContext";
import { fmRecordLine, heldLine } from "@/fm/fmSave";
import { openCounts } from "@/fm/deviceWork";
import { useDeviceIdentity } from "@/config/VillaModel";
import MessagesTab from "./MessagesTab";
import { useAnnouncements } from "@/messages/AnnouncementsContext";
import InfoTip from "@/components/common/InfoTip";
import { countOf } from "@/utils/countOf";

interface CockpitModalProps {
  onClose: () => void;
  onOpenEntity: (entityId: string) => void;
  /** What this profile may see and do (auth/doors): the updates count only with `doors.updates`. */
  doors: Doors;
  /** The open tab: the Cockpit's own view, or one of the Facility tabs (with
   *  `doors.facility`). Held by the caller, so "Edit ticket" lands on
   *  Tickets and Back from a device returns to the tab it left. */
  tab: CockpitTab;
  onTab: (tab: CockpitTab) => void;
  /** Tickets opens "Open a ticket" pointed at this device (a device
   *  window's Open Ticket, an Inbox card's); the request is dropped once the form has it. */
  reportFaultFor?: string;
  onFaultFormOpened?: () => void;
  /** An Inbox card's Open Ticket for a device with no record. */
  onRaiseTicket: (entityId: string) => void;
  /** The Tickets tab opens this record's form (an open issue's "Edit ticket"). */
  editTicket?: string;
  onEditTicket: (ticketId: string) => void;
  onTicketEditOpened?: () => void;
  /** A guest's "Report a problem" (Messages). */
  onReportProblem: () => void;
  /** The devices whose open issue Messages opens (a device window's warning). */
  focusFaults?: readonly string[];
  /** Inbox › Open issues on these devices' faults (a readiness check's "faults", screen.openFaults). */
  onOpenFaults: (ids: string[]) => void;
}

/** Messages, then the Facility tabs (2.496.273: the Facility window merged in — one top-bar button, one window, the
 *  same workflows). Messages replaced the Overview (ticket 17 of "One inbox", owner 2026-10-28): its open issues are
 *  Messages › Open issues. */
export type CockpitTab = "messages" | FacilityTab;
// ⚠️ "INBOX" (owner, 2026-10-29: "rename the Messages tab to something more consistent"): one word beside Tickets,
// Schedule, Recap, Spend — its issues, notifications and reports, VESTA's conversation having its own window
const MESSAGES_TAB: ModalTab<CockpitTab> = { id: "messages", label: "Inbox", icon: Inbox };

export default function CockpitModal({
  onClose, onOpenEntity, doors, tab, onTab, reportFaultFor, onFaultFormOpened, onRaiseTicket,
  editTicket, onEditTicket, onTicketEditOpened, onReportProblem, focusFaults, onOpenFaults,
}: CockpitModalProps) {
  // A profile without the Facility door sees the Cockpit's view alone, no strip.
  const tabs: ModalTab<CockpitTab>[] = doors.facility ? [MESSAGES_TAB, ...FACILITY_TABS] : [MESSAGES_TAB];
  const shownTab: CockpitTab = doors.facility ? tab : "messages";
  // The maintenance record is watched live WHILE THIS WINDOW IS OPEN, whichever tab shows (useFacilityLiveView: every
  // STORE_ACTIVE_MS instead of the heartbeat). ⚠️ ONE REGISTRATION, THE WINDOW'S (architecture review, 2026-10-19):
  // it was the Facility tabs' alone, so the Overview's "Open issues" — the list the (i) promised was "read again every
  // 15 seconds while it is open" — was read every three minutes until someone opened Tickets.
  useFacilityLiveView();
  // ⚠️ OPENING THE COCKPIT CLEARS THE UNREAD MARK (owner, 2026-10-31), whichever tab it opens on: everything kept now is
  // read on this tablet (messagesModel.readAtOpening). Once, at the opening: what comes while it is open lights the mark
  // again. Inbox picked its filter from what was unread in its first draw, before this runs (effects run after it).
  const { opened } = useAnnouncements();
  useEffect(() => { opened(); }, []);
  // ⚠️ THE RECORD'S STATE IS SAID OVER EVERY TAB, THE OVERVIEW'S TOO (architecture review H, 2026-10-23): unread, its
  // faults are missing from "Open issues" as much as from Tickets. A save's problem ("This fault was just changed on
  // another device") is said where every save that did not happen is (hud/ProblemNotices), over this window.
  const { data, ready, unreachable, heldFor } = useFmData();
  // the tickets in progress, counted on the Tickets tab's name as its cards are (openCounts: one per device)
  const { deviceOfRecord } = useDeviceIdentity();
  const ticketsOpen = useMemo(() => openCounts(data.tickets, deviceOfRecord).tickets, [data.tickets, deviceOfRecord]);
  const held = heldLine(heldFor);
  const recordLine = fmRecordLine({ ready, unreachable });
  // Firmware / add-on updates waiting — Home Assistant's own `update` domain counts them, per device and per add-on.
  const { entities, hiddenInHaEntityIds } = useHA();
  const { config } = useConfig();
  // ...and WHICH (owner, 2026-10-20), in the card a tap or a mouse opens (config/updatesWaiting).
  const updates = useMemo(() => (doors.updates ? updatesWaiting(entities, hiddenInHaEntityIds, config.entityMap) : []),
    [entities, hiddenInHaEntityIds, config.entityMap, doors.updates]);
  const updatesAvailable = updates.length;

  return (
    <Window kind="content" label="Cockpit" onClose={onClose} className="settings-modal cockpit-modal">
      <WindowHeader title="Cockpit">
        {/* Updates Home Assistant has waiting (firmware, add-ons — this one included): in the header, a window's
            header button (.btn.icon-only, as a device window's), for the profiles holding `doors.updates` (owner,
            2026-10-14). It only SAYS so: a press opens the list of them, the (i)'s card (common/InfoTip); it used to
            be a line at the bottom of the Overview, then a hover text a finger never read. */}
        {/* the updates waiting, at the right as Advanced Settings' header buttons are (the gear to Settings › Messages
            was removed: owner, 2026-10-29) */}
        {updatesAvailable > 0 && (
          <InfoTip label={`${countOf(updatesAvailable, "update")} available`} button="btn icon-only" trigger={<>
            <RefreshCw size={18} />
            <span className="icon-btn-count" aria-hidden="true">{formatCountBadge(updatesAvailable)}</span>
          </>}>
            <strong className="info-pop-title">Updates available for</strong>
            {updates.map((n) => <div key={n}>{n}</div>)}
          </InfoTip>
        )}
      </WindowHeader>
      {tabs.length > 1 && <ModalTabs tabs={tabs} active={shownTab} onSelect={onTab} label="Cockpit sections"
        counts={{ tickets: ticketsOpen }} />}

      <div className="modal-body">
        {recordLine && <p className="muted body-text">{recordLine}</p>}
        {held && <p className="muted body-text">{held}</p>}
        {shownTab !== "messages" ? (
          <FacilitySections tab={shownTab} onOpenEntity={onOpenEntity} editTicket={editTicket}
            onTicketEditOpened={onTicketEditOpened} reportFaultFor={reportFaultFor} onFaultFormOpened={onFaultFormOpened}
            onTab={onTab} onOpenFaults={onOpenFaults} />
        ) : (
          <MessagesTab onOpenEntity={onOpenEntity} doors={doors} onRaiseTicket={onRaiseTicket}
            onEditTicket={onEditTicket} onReportProblem={onReportProblem} focusFaults={focusFaults} />
        )}
      </div>

      <ModalFooter onClose={onClose} />
    </Window>
  );
}
