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

import { useEffect, useMemo, useState } from "react";
import {
  TriangleAlert, CheckCircle2, AlertOctagon, MapPin, Building2, LayoutGrid,
  Activity, Zap, RefreshCw, ChevronRight,
} from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability } from "@/auth/permissions";
import { CATEGORY_LABELS, CATEGORY_ICONS, categorySurface } from "@/config/EntityCategories";
import { fetchLogbookEvents } from "@/ha/HALogbookAPI";
import { fetchEnergyToday, type EnergyToday } from "@/ha/HAEnergyAPI";
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import { useVillaAttention } from "./useVillaAttention";
import {
  buildCategoryTiles, buildRoomGroups, buildFloorGroups,
  buildActivityFeed, type AttentionItem, type AttentionKind, type ActivityEntry,
} from "./cockpitData";

export interface CockpitModalProps {
  onClose: () => void;
  mappedEntityIds: Set<string>;
  onOpenEntity: (entityId: string) => void;
}

const ATTENTION_ICON: Record<AttentionKind, typeof TriangleAlert> = {
  unavailable: TriangleAlert,
  fault: AlertOctagon,
  schedule: AlertOctagon,
  alarm: TriangleAlert,
};

export default function CockpitModal({ onClose, mappedEntityIds, onOpenEntity }: CockpitModalProps) {
  const { entities, ws, entityFloorNumbers } = useHA();
  const { config, resolvedRooms } = useConfig();
  const { role } = useProfile();
  const dialogRef = useModalA11y(onClose);
  const [pivot, setPivot] = useState<"room" | "floor" | "category">("room");
  // Drill-down opened by tapping a room/floor row below — reuses
  // SummaryGroupPanel, the same device-list modal every other "all the
  // devices in X" view in the app already opens (room clusters on the map,
  // the bottom Summary bar's tiles), rather than a bespoke list here.
  const [pivotDrill, setPivotDrill] = useState<{ label: string; entityIds: string[] } | null>(null);
  const canControl = role != null && hasCapability(role, "controlEntities");

  // Shared with HUD's own top-bar alert icon/overflow-menu badge — see
  // useVillaAttention's own docstring for why that sharing is load-bearing,
  // not just tidiness (the two used to disagree).
  const { selectableIds, attentionItems, health } = useVillaAttention(mappedEntityIds);
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

  // Energy today — only when the install has an Energy Dashboard configured
  // AND its grid source actually resolves to recorded statistics (see
  // HAEnergyAPI's own docstring — a configured source pointing at a
  // statistic ID with no recorded data is a real, confirmed case, not a
  // theoretical one). null (not shown) either way it doesn't resolve;
  // undefined only while the fetch is in flight.
  const [energy, setEnergy] = useState<EnergyToday | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetchEnergyToday(ws)
      .then((r) => { if (!cancelled) setEnergy(r); })
      .catch(() => { if (!cancelled) setEnergy(null); });
    return () => { cancelled = true; };
  }, [ws]);

  // Firmware/add-on updates available — HA's own `update` domain already
  // tracks this per device AND per add-on (including this one). A small
  // Owner-only count, not a version list — this is a maintenance signal, not
  // something a guest needs to see or act on.
  const updatesAvailable = useMemo(() => {
    if (role !== "owner") return null;
    return Object.values(entities).filter((e) => e.entity_id.startsWith("update.") && e.state === "on").length;
  }, [entities, role]);

  // "Other" (not "Unplaced" or any other invented word) for the no-floor
  // bucket — the SAME label the room pivot's own no-room bucket already
  // uses (cockpitData.ts's NO_ROOM), which is itself the one term every
  // room/category grouping across the app already uses for "doesn't
  // resolve to one of the real ones". Reusing it here, not a second word
  // for the same idea.
  const pivotRows = useMemo(
    () => (pivot === "room"
      ? roomGroups.map((g) => ({ key: g.room, label: g.room, count: g.count, entityIds: g.entityIds }))
      : pivot === "floor"
        ? floorGroups.map((g) => ({
            key: String(g.floor), label: g.floor != null ? `Floor ${g.floor}` : "Other",
            count: g.count, entityIds: g.entityIds,
          }))
        : []
    ),
    [pivot, roomGroups, floorGroups],
  );
  const pivotTotal = pivotRows.reduce((sum, g) => sum + g.count, 0);

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal settings-modal cockpit-modal modal-fixed-height"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Villa Cockpit"
      >
        <div className="settings-header">
          <h2>Cockpit</h2>
        </div>

        <div className="settings-body">
          {/* ── Villa health headline ──────────────────────────────── */}
          <div className={`cockpit-health cockpit-health-${health.level}`}>
            {health.level === "ok" ? <CheckCircle2 size={22} /> : <TriangleAlert size={22} />}
            <span>{health.summary}</span>
          </div>

          {/* ── Needs attention ────────────────────────────────────── */}
          {attentionItems.length > 0 && (
            <>
              <div className="settings-section-title">Needs attention</div>
              <div className="cockpit-attention-list">
                {attentionItems.map((item) => (
                  <CockpitAttentionRow key={item.id} item={item} onOpenEntity={onOpenEntity} />
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
            <div className="segmented" role="group" aria-label="Group by" style={{ flex: "0 0 auto" }}>
              <button className={pivot === "room" ? "active" : ""} onClick={() => setPivot("room")} aria-pressed={pivot === "room"}>
                <MapPin size={16} /> Room
              </button>
              <button className={pivot === "floor" ? "active" : ""} onClick={() => setPivot("floor")} aria-pressed={pivot === "floor"}>
                <Building2 size={16} /> Floor
              </button>
              <button className={pivot === "category" ? "active" : ""} onClick={() => setPivot("category")} aria-pressed={pivot === "category"}>
                <LayoutGrid size={16} /> Category
              </button>
            </div>
          </div>
          {pivot === "category" ? (
            <div className="cockpit-category-grid">
              {categoryTiles.map((tile) => {
                const Icon = CATEGORY_ICONS[tile.category];
                // Neutral unless at least one device in the category is on
                // (VESTA-DESIGN.md §0) — a house at rest shouldn't report
                // every category as if it were doing something.
                const surface = categorySurface(tile.category, tile.onCount > 0 ? "active" : "off");
                return (
                  <div key={tile.category} className="cockpit-category-tile">
                    <div className="cockpit-category-icon" style={{ background: surface.fill, color: surface.glyph }}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <div className="cockpit-category-label">{CATEGORY_LABELS[tile.category]}</div>
                      <div className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>
                        {tile.total === 0 ? "None" : `${tile.total} device${tile.total === 1 ? "" : "s"}${tile.onCount > 0 ? ` · ${tile.onCount} on` : ""}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cockpit-pivot-list">
              {pivotRows.map((row) => {
                const pct = pivotTotal > 0 ? Math.round((row.count / pivotTotal) * 100) : 0;
                return (
                  <button
                    key={row.key}
                    type="button"
                    className="cockpit-pivot-row"
                    onClick={() => setPivotDrill({ label: row.label, entityIds: row.entityIds })}
                    title={`Show ${row.label}'s devices`}
                    aria-label={`Show ${row.label}'s devices — ${row.count} device${row.count === 1 ? "" : "s"}`}
                  >
                    <span className="cockpit-pivot-label">{row.label}</span>
                    <div className="cockpit-pivot-bar"><div className="cockpit-pivot-bar-fill" style={{ width: `${pct}%` }} /></div>
                    <span className="cockpit-pivot-count muted">{row.count}</span>
                    <ChevronRight size={16} className="cockpit-pivot-chevron muted" />
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Energy today (only when it resolves) ───────────────── */}
          {energy && (
            <>
              <div className="settings-section-title"><Zap size={16} style={{ verticalAlign: -2 }} /> Energy today</div>
              <p className="cockpit-energy-value">{energy.kwh.toFixed(1)} <span className="muted body-text">kWh</span></p>
            </>
          )}

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
                  <span className="cockpit-activity-time muted">{new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
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

        <div className="settings-footer">
          {/* .settings-footer is `justify-content: space-between` for the
              common case of TWO children (a left-side action + the primary
              button on the right) — every other single-button footer in the
              app (SettingsModal, LegendModal, FirstRunTips) pairs the button
              with an empty spacer as its first child so space-between still
              pushes it to the right; this one was missing that spacer,
              which is why it rendered on the left instead. */}
          <span />
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
    {pivotDrill && (
      <SummaryGroupPanel
        group={{ title: pivotDrill.label, icon: pivot === "room" ? MapPin : Building2, entityIds: pivotDrill.entityIds }}
        canControl={canControl}
        mappedEntityIds={mappedEntityIds}
        onClose={() => setPivotDrill(null)}
        onOpenEntity={(id) => { setPivotDrill(null); onOpenEntity(id); }}
      />
    )}
    </>
  );
}

function CockpitAttentionRow({ item, onOpenEntity }: { item: AttentionItem; onOpenEntity: (id: string) => void }) {
  const Icon = ATTENTION_ICON[item.kind];
  const tappable = !!item.entityId;
  const Row = tappable ? "button" : "div";
  return (
    <Row
      className={`cockpit-attention-row${tappable ? " tappable" : ""}`}
      {...(tappable ? { onClick: () => onOpenEntity(item.entityId as string) } : {})}
    >
      <Icon size={16} className={`cockpit-attention-icon cockpit-attention-${item.kind}`} />
      <span className="cockpit-attention-body">
        <span className="cockpit-attention-title">{item.title}</span>
        <span className="muted body-text" style={{ fontSize: "var(--text-2xs)" }}>
          {item.detail}{item.room ? ` · ${item.room}` : ""}
        </span>
      </span>
      {tappable && <ChevronRight size={16} className="muted" />}
    </Row>
  );
}
