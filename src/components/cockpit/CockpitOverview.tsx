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

import { useMemo, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  TriangleAlert, AlertOctagon, MapPin, Building2, LayoutGrid,
  Activity, RefreshCw, ChevronRight, X,
} from "lucide-react";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import { fmtChartTime } from "@/components/panels/chartUtils";
import { useHistory } from "@/hooks/useHistory";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { useFmData, fmSaveOutcome } from "@/fm/FmDataContext";
import InlineConfirm from "@/components/common/InlineConfirm";
import { roleCan } from "@/auth/permissions";
import type { Doors } from "@/auth/doors";
import { CATEGORY_LABELS, CATEGORY_ICONS } from "@/config/EntityCategories";
import { categoryChipStyle } from "@/components/common/categoryChip";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { fetchLogbookEvents } from "@/ha/HALogbookAPI";
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import { useVillaAttention } from "./useVillaAttention";
import { storeLookSource } from "@/utils/deviceActivity";
import {
  buildCategoryTiles, buildRoomGroups, buildFloorGroups,
  buildActivityFeed, pivotTiles, tileLine, type Pivot, type ActivityEntry,
} from "./cockpitData";
import { attentionLineIn, type AttentionGroup, type AttentionItem, type AttentionKind } from "@/config/attention";


const ATTENTION_ICON: Record<AttentionKind, typeof TriangleAlert> = {
  unavailable: TriangleAlert,
  fault: AlertOctagon,
  schedule: AlertOctagon,
  alarm: TriangleAlert,
};

const PIVOT_ICON = { room: MapPin, floor: Building2 } as const;

export default function CockpitOverview({ onOpenEntity, doors }: {
  onOpenEntity: (entityId: string) => void;
  /** `doors.updates`: the updates count is drawn only with it. */
  doors: Doors;
}) {
  const { entities, ws, entityFloorNumbers } = useHA();
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
  // Closing a fault from here is Facility work: the profiles that manage it.
  const canCloseFaults = roleCan(role, "manageFacility");

  // Shared with HUD's own top-bar alert icon/overflow-menu badge — see
  // useVillaAttention's own docstring for why that sharing is load-bearing,
  // not just tidiness (the two used to disagree).
  const { selectableIds, attentionGroups } = useVillaAttention();
  const categoryTiles = useMemo(
    () => buildCategoryTiles(selectableIds, entities, config.entityMap),
    [selectableIds, entities, config.entityMap],
  );
  const roomGroups = useMemo(
    () => buildRoomGroups(selectableIds, resolvedRooms, config.sh3dRooms, entityFloorNumbers),
    [selectableIds, resolvedRooms, config.sh3dRooms, entityFloorNumbers],
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

  // Firmware/add-on updates available — HA's own `update` domain already
  // tracks this per device AND per add-on (including this one). A small
  // Owner-only count, not a version list — this is a maintenance signal, not
  // something a guest needs to see or act on.
  const updatesAvailable = useMemo(() => {
    if (!doors.updates) return null;
    return Object.values(entities).filter((e) => e.entity_id.startsWith("update.") && e.state === "on").length;
  }, [entities, doors.updates]);

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
      {/* ── Needs attention ────────────────────────────────────── */}
      {attentionGroups.length > 0 && (
        <>
          <div className="settings-section-title">Needs attention ({attentionGroups.length})</div>
          <div className="cockpit-attention-list">
            {attentionGroups.map((group) => (
              <CockpitAttentionRow key={group.key} group={group} onOpenEntity={onOpenEntity}
                canCloseFault={canCloseFaults} />
            ))}
          </div>
        </>
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
      <div className="settings-section-title"><Activity size={16} style={{ verticalAlign: -2 }} /> Recent activity</div>
      {villaActivity === "loading" && <p className="muted body-text">Loading…</p>}
      {villaActivity === "error" && <p className="muted body-text">Couldn't reach Home Assistant's activity log.</p>}
      {Array.isArray(villaActivity) && villaActivity.length === 0 && (
        <p className="muted body-text">Nothing in the last 6 hours.</p>
      )}
      {Array.isArray(villaActivity) && villaActivity.length > 0 && (
        <div className="cockpit-activity-list">
          {villaActivity.map((e, i) => (
            <div key={`${e.t}-${i}`} className="cockpit-activity-row">
              <span className="cockpit-activity-time muted">{fmtChartTime(e.t)}</span>
              <span className="cockpit-activity-text"><strong>{e.name}</strong> {e.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Updates available (Owner only, small) ──────────────── */}
      {updatesAvailable !== null && updatesAvailable > 0 && (
        <p className="cockpit-updates muted body-text">
          <RefreshCw size={16} style={{ verticalAlign: -2 }} /> {updatesAvailable} update{updatesAvailable === 1 ? "" : "s"} available
        </p>
      )}
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

/** One row of "Needs attention", ONE SHAPE whatever it holds (owner, 2026-10-10: "make sure each reported issue
 *  appears in a consistent way"): a card titled by the device (or by the problem, when no device stands behind it)
 *  with its room, and every problem as a line INSIDE the card — one or several — a fault's Close at the end of its
 *  own line. It had three shapes: one problem in the subtitle, a fault titled by its own text with a tall Close box
 *  beside the card (cutting the title), and several problems as lines outside the card. */
function CockpitAttentionRow({ group, onOpenEntity, canCloseFault }: {
  group: AttentionGroup;
  onOpenEntity: (id: string) => void;
  canCloseFault: boolean;
}) {
  const Icon = ATTENTION_ICON[group.kind];
  const tappable = !!group.entityId;
  const Head = tappable ? "button" : "div";
  return (
    <div className="cockpit-attention-item">
      <Head
        type={tappable ? "button" : undefined}
        className={`cockpit-attention-row${tappable ? " tappable" : ""}`}
        {...(tappable ? { onClick: () => onOpenEntity(group.entityId as string) } : {})}
      >
        <Icon size={16} className={`cockpit-attention-icon cockpit-attention-${group.kind}`} />
        <span className="cockpit-attention-body">
          <span className="cockpit-attention-title">{group.title}</span>
          {group.room && <span className="muted body-text" style={{ fontSize: "var(--text-2xs)" }}>{group.room}</span>}
        </span>
        {tappable && <ChevronRight size={16} className="muted" />}
      </Head>
      <ul className="cockpit-attention-subs">
        {group.items.map((item) => (
          <CockpitAttentionSub key={item.id} group={group} item={item} canCloseFault={canCloseFault} />
        ))}
      </ul>
    </div>
  );
}

function CockpitAttentionSub({ group, item, canCloseFault }: {
  group: AttentionGroup; item: AttentionItem; canCloseFault: boolean;
}) {
  const Icon = ATTENTION_ICON[item.kind];
  const close = useFaultClose(item, canCloseFault);
  return (
    <li className="cockpit-attention-sub">
      <div className="cockpit-attention-sub-line">
        <Icon size={14} className={`cockpit-attention-icon cockpit-attention-${item.kind}`} />
        <span className="cockpit-attention-sub-text">{attentionLineIn(group, item)}</span>
        {close.button}
      </div>
      {close.panel}
    </li>
  );
}

/** A fault can be closed from its line in one step ("no action needed" — the
 *  same write as the Faults tab's, FmDataContext.closeTicket). The button ends
 *  the fault's own line, never inside the card's head: that may be a <button>. */
function useFaultClose(item: AttentionItem | null, canCloseFault: boolean) {
  const { closeTicket } = useFmData();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const closable = !!item && canCloseFault && item.kind === "fault" && !!item.ticketId;
  const close = async () => {
    if (!item?.ticketId) return;
    setProblem(null);
    const { done, note: why } = fmSaveOutcome(await closeTicket(item.ticketId));
    const failed = done ? null : why;
    // On success the fault leaves this list; only a failure stays to say so.
    setConfirming(false);
    setProblem(failed);
  };
  return {
    button: closable && !confirming ? (
      <button type="button" className="btn ghost cockpit-attention-close"
        aria-label={`Close the fault “${item?.title}”`}
        onClick={() => { setProblem(null); setConfirming(true); }}>
        <X size={14} /> Close
      </button>
    ) : null,
    panel: (
      <>
        {confirming && (
          <div className="cockpit-attention-confirm">
            <InlineConfirm
              question="Close this fault? No action needed."
              confirmLabel="Close fault"
              onConfirm={close}
              onCancel={() => setConfirming(false)}
            />
          </div>
        )}
        {problem && <div className="fm-inline-error" role="alert">{problem}</div>}
      </>
    ),
  };
}
