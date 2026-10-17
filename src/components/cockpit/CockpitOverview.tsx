// src/components/cockpit/CockpitOverview.tsx
// The Cockpit's own view — its Overview tab: what needs attention, the
// villa by room / floor / category, recent activity, updates. Split from
// CockpitModal (2.496.274), which is now only the window: its tabs, the
// Facility sections and the footer. The grid's tiles are cockpitData.pivotTiles
// (pure, tested by value).
//
// Every section here is read-only on its own face — the one exception is the
// grid, whose tiles drill into SummaryGroupPanel (the same device list every
// other "all the devices in X" view opens). Everything routes through
// selectableDeviceIds/entityMap/resolvedRooms, never a raw HA domain query
// (see cockpitData.ts's own docstring).

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  MapPin, Building2, LayoutGrid,
  Activity, ChevronRight, Plus,
} from "lucide-react";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import { fmtChartTime } from "@/components/panels/chartUtils";
import { useHistory } from "@/hooks/useHistory";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { useFmData } from "@/fm/FmDataContext";
import WorkButtons, { useConfirmedClose } from "@/components/fm/WorkButtons";
import { roleCan } from "@/auth/permissions";
import type { Doors } from "@/auth/doors";
import { CATEGORY_LABELS, CATEGORY_ICONS } from "@/config/EntityCategories";
import { categoryChipStyle } from "@/components/common/categoryChip";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { fetchLogbookEvents } from "@/ha/HALogbookAPI";
import { useRoomFloors } from "@/config/useRoomFloors";
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import { useVillaAttention } from "./useVillaAttention";
import { storeLookSource } from "@/utils/deviceActivity";
import {
  buildCategoryTiles, buildRoomGroups, buildFloorGroups,
  buildActivityFeed, pivotTiles, tileLine, type Pivot, type ActivityEntry,
} from "./cockpitData";
import { attentionLineIn, cardActions, lineIcon, lineSources, type AttentionGroup, type AttentionItem } from "@/config/attention";
import { SourceIcons } from "@/components/fm/sourceIcons";
import RecordCard from "@/components/fm/RecordCard";
import FoldedList from "@/components/common/FoldedList";
import { useVillaModel } from "@/config/VillaModel";
import { buildDeviceOptions } from "@/components/fm/DeviceSearchPicker";
import FaultForm from "@/components/fm/FaultForm";
import FaultTiming from "@/components/fm/FaultTiming";
import { nextCheck } from "@/fm/faultTiming";
import { useAgent } from "@/agent/AgentContext";
import type { AgentCadence } from "@/agent/agentApi";
import FaultStageModal from "@/components/fm/FaultStageModal";
import { localStamp } from "@/fm/fmEngine";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";



const PIVOT_ICON = { room: MapPin, floor: Building2 } as const;

export default function CockpitOverview({ onOpenEntity, doors, reportFaultFor, onFaultFormOpened, onEditTicket, onReportProblem }: {
  onOpenEntity: (entityId: string) => void;
  /** What this profile may do (auth/doors): `facility` takes faults on and opens tickets, `reportFault` reports a
   *  problem. */
  doors: Doors;
  /** "Raise a fault" opens pointed at this device (a device panel's wrench); dropped once the form has it. */
  reportFaultFor?: string;
  onFaultFormOpened?: () => void;
  /** A card's "Edit ticket": the Tickets tab, that record's form open. */
  onEditTicket: (ticketId: string) => void;
  /** A guest's "Report a problem". */
  onReportProblem: () => void;
}) {
  const { entities, ws } = useHA();
  // Each room's floor: the villa's one answer (config/devicePlace), the category lists' too.
  const roomFloors = useRoomFloors();
  const { config, resolvedRooms } = useConfig();
  // How every device looks, read from the store (utils/deviceActivity) — a
  // tile's "N on" is its POWER count.
  const looks = useMemo(() => storeLookSource(entities, config), [entities, config]);
  const { role } = useProfile();
  // Category tiles below composite their colours in JS — see the hook.
  const theme = useResolvedTheme();
  const [pivot, setPivot] = useState<Pivot>("room");
  // Drill-down opened by tapping a room/floor row below — reuses
  // SummaryGroupPanel, the same device-list modal every other "all the
  // devices in X" view in the app already opens (room clusters on the map,
  // the bottom Summary bar's tiles), rather than a bespoke list here.
  const [pivotDrill, setPivotDrill] = useState<{ label: string; entityIds: string[]; icon: ComponentType<{ size?: number | string }> } | null>(null);
  const canControl = roleCan(role, "controlEntities");
  // Taking a fault on, closing it and raising one are Facility work: the profiles that manage it. Everyone else
  // who may report (a guest) gets "Report a problem".
  const canManage = doors.facility;
  const canReport = doors.reportFault;
  const { devices } = useVillaModel();
  const deviceOptions = useMemo(
    () => (canManage ? buildDeviceOptions(devices, config.entityMap, entities, resolvedRooms) : []),
    [canManage, devices, config.entityMap, entities, resolvedRooms]);
  /** The raise form: closed, or open (pointed at a device when it came from a device's wrench). */
  const [raising, setRaising] = useState<{ entity?: string } | null>(null);
  useEffect(() => {
    if (!reportFaultFor || !canManage) return;
    setRaising({ entity: reportFaultFor });
    onFaultFormOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportFaultFor]);

  // Shared with HUD's own top-bar alert icon/overflow-menu badge — see
  // useVillaAttention's own docstring for why that sharing is load-bearing,
  // not just tidiness (the two used to disagree).
  const { selectableIds, attentionGroups } = useVillaAttention();
  const categoryTiles = useMemo(
    () => buildCategoryTiles(selectableIds, entities, config.entityMap),
    [selectableIds, entities, config.entityMap],
  );
  const roomGroups = useMemo(
    () => buildRoomGroups(selectableIds, resolvedRooms, roomFloors),
    [selectableIds, resolvedRooms, roomFloors],
  );
  const floorGroups = useMemo(() => buildFloorGroups(roomGroups), [roomGroups]);

  // Recent activity — HA's own Logbook (via websocket, see HALogbookAPI.ts
  // for why not the classic REST endpoint), fetched once on open (a report
  // you glance at, not a live-updating feed; re-opening Cockpit re-fetches).
  // Described + filtered to this villa's own selectable devices in
  // cockpitData.ts's buildActivityFeed — HA's raw logbook is unfiltered and
  // genuinely noisy (a bare date/time helper alone produced roughly one
  // entry every six seconds in a real pull).
  // The fetch-and-say-where-it-stands effect is hooks/useHistory's, the one
  // every chart uses (architecture review 11: this was its eighth copy).
  const activity = useHistory("logbook-6h", () => fetchLogbookEvents(ws, 6), [] as Awaited<ReturnType<typeof fetchLogbookEvents>>);
  const villaActivity = useMemo((): ActivityEntry[] | "loading" | "error" => {
    if (activity.status === "loading") return "loading";
    if (activity.status === "failed") return "error";
    return buildActivityFeed(activity.data, entities, config.entityMap, selectableIds);
  }, [activity.status, activity.data, entities, config.entityMap, selectableIds]);

  // "Other" (not "Unplaced" or any other invented word) for the no-floor
  // bucket — the SAME label the room pivot's own no-room bucket already
  // uses (cockpitData.ts's NO_ROOM), which is itself the one term every
  // room/category grouping across the app already uses for "doesn't
  // resolve to one of the real ones". Reusing it here, not a second word
  // for the same idea.
  // ONE tile for every grouping (2.496.235): rooms and floors were bars, the
  // categories tiles — the same question ("what is in here, how much is on,
  // is any of it lost?") drawn two ways. Every tile opens its device list.
  const tiles = useMemo(
    () => pivotTiles(pivot, { categories: categoryTiles, rooms: roomGroups, floors: floorGroups }, CATEGORY_LABELS, looks),
    [pivot, categoryTiles, roomGroups, floorGroups, looks],
  );

  return (
    <>
          {/* No headline (owner, 2.496.237): the list below IS the message,
          its count in its title — and when nothing needs attention, the
          Cockpit simply starts with the villa's rooms. */}
      {/* ── Live issues: ONE list (owner, 2026-10-14) ──────────────── */}
      {/* Everything open, one card per device: what Home Assistant reports right now (no buttons — it clears when the
          device does), the faults the VESTA Agent or a person opened, and the tickets in progress. It replaced
          "Needs attention" AND the Faults tab's open list, which showed the same faults twice. Raising a fault is
          here, beside what it is raised about. */}
      {/* The title, and on its right the (i) then "Open a ticket" (owner, 2026-10-14) — a guest's "Report a problem". */}
      {(attentionGroups.length > 0 || canReport) && (
        <div className="cockpit-issues-head">
          <div className="settings-section-title">Open issues{attentionGroups.length > 0 ? ` (${attentionGroups.length})` : ""}</div>
          {canManage && !raising && (
            <div className="cockpit-issues-actions">
              <FaultTiming />
              <button className="btn ghost" onClick={() => setRaising({})}><Plus size={16} /> Open a ticket</button>
            </div>
          )}
          {!canManage && canReport && (
            <div className="cockpit-issues-actions">
              <button className="btn ghost" onClick={onReportProblem}><Plus size={16} /> Report a problem</button>
            </div>
          )}
        </div>
      )}
      {raising && (
        <FaultForm key={raising.entity ?? "new"} presetEntity={raising.entity} deviceOptions={deviceOptions}
          onDone={() => setRaising(null)} />
      )}
      {attentionGroups.length > 0 && (
        <div className="cockpit-attention-list">
          {attentionGroups.map((group) => (
            <CockpitAttentionRow key={group.key} group={group} onOpenEntity={onOpenEntity}
              canManage={canManage} onEditTicket={onEditTicket} />
          ))}
        </div>
      )}

      {/* ── Room / floor / category breakdown ──────────────────── */}
      {/* One selector, one section — category used to be its own
          always-visible block above this pivot, which meant the modal
          showed two overlapping "how are devices grouped" views at
          once. Now a third tab on the same Room/Floor toggle, so only
          one grouping is ever on screen and the section title always
          names whichever is showing. */}
      <div className="settings-section-title cockpit-pivot-header">
        <span>By {pivot}</span>
        <SegmentedGroup ariaLabel="Group by" className="cockpit-pivot" active={pivot} onChange={setPivot} options={[
          { key: "room", label: <><MapPin size={16} /> Room</> },
          { key: "floor", label: <><Building2 size={16} /> Floor</> },
          { key: "category", label: <><LayoutGrid size={16} /> Category</> },
        ]} />
      </div>
      <div className="cockpit-category-grid">
        {tiles.map((t) => {
          // A category's own colour while any of its devices is on
          // (VESTA-DESIGN.md §0 — a house at rest reports nothing as
          // active); a room or floor neutral, amber while a device in it
          // is offline.
          const chip = t.category ? categoryChipStyle(t.category, t.stats.onCount > 0) : null;
          const Icon = t.category ? CATEGORY_ICONS[t.category] : PIVOT_ICON[t.pivot as "room" | "floor"];
          return (
            // Keyed by theme too: the category surface is composited in
            // JS from the theme's tokens, frozen at render time.
            <button
              key={`${t.key}:${theme}`}
              type="button"
              className="cockpit-category-tile"
              onClick={() => setPivotDrill({ label: t.label, entityIds: t.entityIds, icon: Icon })}
              aria-label={`Show ${t.label}'s devices — ${tileLine(t.stats)}`}
            >
              <div
                className={`cockpit-category-icon${chip ? "" : t.stats.offline > 0 ? " is-warn" : " is-neutral"}`}
                style={chip ?? undefined}
              >
                <Icon size={18} />
              </div>
              <div className="cockpit-tile-text">
                <div className="cockpit-category-label">{t.label}</div>
                <div className={`body-text cockpit-tile-line${t.stats.offline > 0 ? " is-warn" : " muted"}`}>
                  {tileLine(t.stats)}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Recent activity ─────────────────────────────────────── */}
      {/* Folded by default, as Tickets' Closed (owner, 2026-10-18): the same FoldedList, a page at a time. */}
      {Array.isArray(villaActivity) && villaActivity.length > 0 ? (
        <FoldedList title="Recent activity" rows={villaActivity} unit="event">
          {(e) => (
            <div key={`${e.t}-${e.name}-${e.message}`} className="cockpit-activity-row">
              <span className="cockpit-activity-time muted">{fmtChartTime(e.t)}</span>
              <span className="cockpit-activity-text"><strong>{e.name}</strong> {e.message}</span>
            </div>
          )}
        </FoldedList>
      ) : (
        <>
          <div className="settings-section-title"><Activity size={16} style={{ verticalAlign: -2 }} /> Recent activity</div>
          {villaActivity === "loading" && <p className="muted body-text">Loading…</p>}
          {villaActivity === "error" && <p className="muted body-text">Couldn't read the activity log.</p>}
          {Array.isArray(villaActivity) && <p className="muted body-text">Nothing in the last 6 hours.</p>}
        </>
      )}

      {/* ── Updates available (Owner only, small) ──────────────── */}
    {/* Out of the Cockpit window's box, as it was before the Overview had its
        own file: a fixed overlay inside the scrolling body could be clipped. */}
    {pivotDrill && createPortal(
      <SummaryGroupPanel
        group={{ title: pivotDrill.label, icon: pivotDrill.icon, entityIds: pivotDrill.entityIds }}
        canControl={canControl}
        onClose={() => setPivotDrill(null)}
        onOpenEntity={(id) => { setPivotDrill(null); onOpenEntity(id); }}
      />,
      document.body,
    )}
    </>
  );
}

/** One card of the Live issues, ONE SHAPE whatever it holds (owner, 2026-10-10: "make sure each reported issue
 *  appears in a consistent way"): titled by the device (or by the problem, when no device stands behind it) with its
 *  room, every problem a line INSIDE the card. A card holding a fault carries its actions (owner, 2026-10-14):
 *  "Open Ticket" (was "Mark in progress"; the Tickets tab's wrench and Title Case, owner 2026-10-14) makes the device's faults ONE ticket (each still its own record, so the VESTA Agent can clear
 *  one alone), then "Edit ticket" opens it in the Tickets tab; "Close" closes them all ("no action needed"). A line
 *  that is only what Home Assistant reports has no button: it goes when the device is back. */
function CockpitAttentionRow({ group, onOpenEntity, canManage, onEditTicket }: {
  group: AttentionGroup;
  onOpenEntity: (id: string) => void;
  canManage: boolean;
  onEditTicket: (ticketId: string) => void;
}) {
  const { status } = useAgent();
  return <AttentionCard group={group} onOpenEntity={onOpenEntity} cadence={status?.cadence ?? null}
    actions={useCardActions(group, canManage, onEditTicket)} />;
}

/** The card itself, drawn — THE Cockpit card (RecordCard), as every list's (architecture review, 2026-10-15): its
 *  source icons before the device's name, the room under it, its problems' lines, its buttons on the right of them.
 *  Tapping it opens the device; its buttons take their own presses. Pure: a check draws it. */
export function AttentionCard({ group, onOpenEntity, cadence, actions }: {
  group: AttentionGroup;
  onOpenEntity: (id: string) => void;
  /** The VESTA Agent's own timing (its heartbeat), for the card's "Next check" — null: it did not say. */
  cadence: AgentCadence | null;
  actions?: ReactNode;
}) {
  const tappable = !!group.entityId;
  return (
    <RecordCard
      title={group.title}
      subtitle={group.room}
      // where its (first) problem comes from, in place of a warning sign (owner, 2026-10-14) — legend: the (i)
      lead={group.items[0] ? <SourceIcons {...lineSources(group.items[0])} /> : undefined}
      trailing={tappable ? <ChevronRight size={16} className="muted" aria-hidden /> : undefined}
      // when its problems are read again, on the room's line under the chevron (owner, 2026-10-15)
      aside={nextCheck(group.items, cadence)}
      onOpen={tappable ? () => onOpenEntity(group.entityId as string) : undefined}
      body={(
        <ul className="cockpit-attention-subs">
          {group.items.map((item) => <CockpitAttentionSub key={item.id} group={group} item={item} />)}
        </ul>
      )}
      actions={actions ?? undefined}
    />
  );
}

function CockpitAttentionSub({ group, item }: { group: AttentionGroup; item: AttentionItem }) {
  const icons = lineIcon(group, item);
  // what last happened about it on Telegram — a reminder, an escalation, a button pressed (owner, 2026-10-14)
  const latest = item.latest ?? item.fault?.latest;
  return (
    <li className="cockpit-attention-sub">
      <div className="cockpit-attention-sub-line">
        {icons && <SourceIcons {...icons} size={14} />}
        <span className="cockpit-attention-sub-text">
          {attentionLineIn(group, item)}
          {latest && <span className="cockpit-attention-latest">{latest.note} · {localStamp(latest.at)}</span>}
        </span>
      </div>
    </li>
  );
}

/** A card's buttons, for the profiles that manage Facility work — WHICH buttons, on which records and with which
 *  question is attention.cardActions' answer (fm/deviceWork, tested by value); WorkButtons draws them. */
function useCardActions(group: AttentionGroup, canManage: boolean, onEditTicket: (ticketId: string) => void) {
  const { data } = useFmData();
  const closer = useConfirmedClose();
  const [staging, setStaging] = useState<{ tickets: FmTicket[]; to: FmTicketStatus } | null>(null);
  const acts = cardActions(group);
  if (!canManage || acts.length === 0) return null;
  const records = (ids: readonly string[]) => ids.map((id) => data.tickets.find((t) => t.id === id)).filter((t): t is FmTicket => !!t);
  const problem = closer.problemFor(group.key);
  return (
    <>
      <WorkButtons actions={acts} cardKey={group.key} closer={closer} name={group.title} className="fm-fault-actions"
        onAction={(a) => (a.step.kind === "stage" ? setStaging({ tickets: records(a.ids), to: a.step.to }) : onEditTicket(a.ids[0]))} />
      {problem && <div className="fm-inline-error" role="alert">{problem}</div>}
      {staging && <FaultStageModal tickets={staging.tickets} to={staging.to} onClose={() => setStaging(null)} />}
    </>
  );
}
