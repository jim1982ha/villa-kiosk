// src/components/cockpit/CockpitModal.tsx
// The villa's whole-house status report — a graceful, non-technical "how is
// everything" glance, reachable from the same alert icon that used to open a
// bare Unavailable-devices list directly (see HUD.tsx/FacilityModal.tsx —
// repointed, not a new button). That list isn't gone: Needs Attention below
// already lists every unavailable device individually (nothing is capped),
// so there is no separate drill-down any more — one that only ever showed
// the exact same rows already on screen was pure ceremony.
//
// Every section here is read-only reporting on its own face — the one
// exception is the room/floor pivot below, whose rows drill into
// SummaryGroupPanel (the same device-list-with-inline-controls modal every
// other "all the devices in X" view in the app already opens), rather than
// only being able to jump to one device's own panel. Everything here routes
// through selectableDeviceIds/entityMap/resolvedRooms, never a raw HA domain
// query (see cockpitData.ts's own docstring for why that matters concretely,
// not just in principle). See the villa-kiosk memory's Cockpit plan for the
// full design history and what was deliberately left out (Zigbee/Z-Wave
// radio health, HA's own Area registry for grouping, presence tracking) and
// why.

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  TriangleAlert, AlertOctagon, MapPin, Building2, LayoutGrid,
  Activity, RefreshCw, ChevronRight, X, Bot,
} from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import { fmtChartTime } from "@/components/panels/chartUtils";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { useFmData, fmSaveOutcome } from "@/fm/FmDataContext";
import InlineConfirm from "@/components/common/InlineConfirm";
import { roleCan } from "@/auth/permissions";
import type { Doors } from "@/auth/doors";
import { CATEGORY_LABELS, CATEGORY_ICONS, categorySurface } from "@/config/EntityCategories";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { fetchLogbookEvents } from "@/ha/HALogbookAPI";
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import { formatCountBadge } from "@/utils/countBadge";
import { useVillaAttention } from "./useVillaAttention";
import { storeLookSource } from "@/utils/deviceActivity";
import {
  buildCategoryTiles, buildRoomGroups, buildFloorGroups,
  buildActivityFeed, tileStats, tileLine, attentionLine, type TileStats, type AttentionGroup, type AttentionItem, type AttentionKind, type ActivityEntry,
} from "./cockpitData";
import type { Category } from "@/types/scene.types";
import ModalFooter from "@/components/common/ModalFooter";

export interface CockpitModalProps {
  onClose: () => void;
  onOpenEntity: (entityId: string) => void;
  /** Which windows this profile may open (auth/doors): the footer's "VESTA
   *  Agent" is drawn only with `doors.agent`, the updates count only with
   *  `doors.updates`. */
  doors: Doors;
  /** Open the VESTA Agent window. */
  onOpenAgent: () => void;
  /** The agent's presence and what waits for this profile's answer, for the
   *  footer button's label. */
  agentOnline?: boolean;
  agentWaiting?: number;
}

const ATTENTION_ICON: Record<AttentionKind, typeof TriangleAlert> = {
  unavailable: TriangleAlert,
  fault: AlertOctagon,
  schedule: AlertOctagon,
  alarm: TriangleAlert,
};

/** One tile of the Room / Floor / Category grid. */
interface PivotTile {
  key: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  /** Set for a category tile: it takes that category's colour. */
  category: Category | null;
  entityIds: string[];
  stats: TileStats;
}

export default function CockpitModal({
  onClose, onOpenEntity, doors, onOpenAgent, agentOnline = false, agentWaiting = 0,
}: CockpitModalProps) {
  const { entities, ws, entityFloorNumbers } = useHA();
  const { config, resolvedRooms } = useConfig();
  // How every device looks, read from the store (utils/deviceActivity) — a
  // tile's "N on" is its POWER count.
  const looks = useMemo(() => storeLookSource(entities, config), [entities, config]);
  const { role } = useProfile();
  const dialogRef = useModalA11y(onClose);
  // Category tiles below composite their colours in JS — see the hook.
  const theme = useResolvedTheme();
  const [pivot, setPivot] = useState<"room" | "floor" | "category">("room");
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
  const [rawActivity, setRawActivity] = useState<Awaited<ReturnType<typeof fetchLogbookEvents>> | "loading" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    fetchLogbookEvents(ws, 6)
      .then((entries) => { if (!cancelled) setRawActivity(entries); })
      .catch(() => { if (!cancelled) setRawActivity("error"); });
    return () => { cancelled = true; };
  }, [ws]);
  const villaActivity = useMemo((): ActivityEntry[] | "loading" | "error" => {
    if (!Array.isArray(rawActivity)) return rawActivity;
    return buildActivityFeed(rawActivity, entities, config.entityMap, selectableIds);
  }, [rawActivity, entities, config.entityMap, selectableIds]);

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
  const pivotTiles = useMemo((): PivotTile[] => {
    if (pivot === "category") {
      return categoryTiles.map((t) => ({
        key: t.category, label: CATEGORY_LABELS[t.category], icon: CATEGORY_ICONS[t.category],
        category: t.category, entityIds: t.entityIds, stats: tileStats(t.entityIds, looks),
      }));
    }
    const rows = pivot === "room"
      ? roomGroups.map((g) => ({ key: g.room, label: g.room, entityIds: g.entityIds }))
      // "Other" for the no-floor bucket — the room pivot's own word for it.
      : floorGroups.map((g) => ({ key: String(g.floor), label: g.floor != null ? `Floor ${g.floor}` : "Other", entityIds: g.entityIds }));
    const icon = pivot === "room" ? MapPin : Building2;
    return rows.map((r) => ({ ...r, icon, category: null, stats: tileStats(r.entityIds, looks) }));
  }, [pivot, categoryTiles, roomGroups, floorGroups, looks]);

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal settings-modal cockpit-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Villa Cockpit"
      >
        <div className="modal-header">
          <h2>Cockpit</h2>
        </div>

        <div className="modal-body">
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
            {pivotTiles.map((t) => {
              // A category's own colour while any of its devices is on
              // (VESTA-DESIGN.md §0 — a house at rest reports nothing as
              // active); a room or floor neutral, amber while a device in it
              // is offline.
              const surface = t.category
                ? categorySurface(t.category, t.stats.onCount > 0 ? "active" : "off")
                : null;
              const Icon = t.icon;
              return (
                // Keyed by theme too: the category surface is composited in
                // JS from the theme's tokens, frozen at render time.
                <button
                  key={`${t.key}:${theme}`}
                  type="button"
                  className="cockpit-category-tile"
                  onClick={() => setPivotDrill({ label: t.label, entityIds: t.entityIds, icon: t.icon })}
                  aria-label={`Show ${t.label}'s devices — ${tileLine(t.stats)}`}
                >
                  <div
                    className={`cockpit-category-icon${surface ? "" : t.stats.offline > 0 ? " is-warn" : " is-neutral"}`}
                    style={surface ? { background: surface.fill, color: surface.glyph } : undefined}
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
        </div>

        {/* The VESTA Agent's door on the left when there is an agent — placed
            the way Settings places "Advanced Settings": a ghost button that
            leaves the dialog, never beside Close. */}
        <ModalFooter onClose={onClose} leading={doors.agent ? (
          <button className="btn ghost" onClick={() => { onClose(); onOpenAgent(); }}
            title={`VESTA Agent — ${agentOnline ? "online" : "offline"}`
              + (agentWaiting > 0 ? `, ${agentWaiting} message${agentWaiting === 1 ? "" : "s"} to answer` : "")}>
            <Bot size={18} /> VESTA Agent{agentWaiting > 0 ? ` (${formatCountBadge(agentWaiting)})` : ""}
          </button>
        ) : undefined} />
      </div>
    </div>
    {pivotDrill && (
      <SummaryGroupPanel
        group={{ title: pivotDrill.label, icon: pivotDrill.icon, entityIds: pivotDrill.entityIds }}
        canControl={canControl}
        onClose={() => setPivotDrill(null)}
        onOpenEntity={(id) => { setPivotDrill(null); onOpenEntity(id); }}
      />
    )}
    </>
  );
}

/** One device's row: its name, room and most serious problem's icon. With
 *  more than one problem, each is a line of its own under it — a fault keeps
 *  its own Close (cockpitData.groupAttention, 2.496.246). With one, the row
 *  reads exactly as it did before grouping. */
function CockpitAttentionRow({ group, onOpenEntity, canCloseFault }: {
  group: AttentionGroup;
  onOpenEntity: (id: string) => void;
  canCloseFault: boolean;
}) {
  const Icon = ATTENTION_ICON[group.kind];
  const tappable = !!group.entityId;
  const Row = tappable ? "button" : "div";
  const lone = group.items.length === 1 ? group.items[0] : null;
  const loneClose = useFaultClose(lone, canCloseFault);
  return (
    <div className="cockpit-attention-item">
      <div className="cockpit-attention-line">
        <Row
          className={`cockpit-attention-row${tappable ? " tappable" : ""}`}
          {...(tappable ? { onClick: () => onOpenEntity(group.entityId as string) } : {})}
        >
          <Icon size={16} className={`cockpit-attention-icon cockpit-attention-${group.kind}`} />
          <span className="cockpit-attention-body">
            <span className="cockpit-attention-title">{group.title}</span>
            <span className="muted body-text" style={{ fontSize: "var(--text-2xs)" }}>
              {lone ? lone.detail : `${group.items.length} problems`}{group.room ? ` · ${group.room}` : ""}
            </span>
          </span>
          {tappable && <ChevronRight size={16} className="muted" />}
        </Row>
        {loneClose.button}
      </div>
      {loneClose.panel}
      {!lone && (
        <ul className="cockpit-attention-subs">
          {group.items.map((item) => (
            <CockpitAttentionSub key={item.id} item={item} canCloseFault={canCloseFault} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CockpitAttentionSub({ item, canCloseFault }: { item: AttentionItem; canCloseFault: boolean }) {
  const Icon = ATTENTION_ICON[item.kind];
  const close = useFaultClose(item, canCloseFault);
  return (
    <li className="cockpit-attention-sub">
      <div className="cockpit-attention-sub-line">
        <Icon size={14} className={`cockpit-attention-icon cockpit-attention-${item.kind}`} />
        <span className="cockpit-attention-sub-text">{attentionLine(item)}</span>
        {close.button}
      </div>
      {close.panel}
    </li>
  );
}

/** A fault can be closed from its line in one step ("no action needed" — the
 *  same write as the Faults tab's, FmDataContext.closeTicket). The button is
 *  BESIDE the row, never inside it: the row itself may be a <button>. */
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
