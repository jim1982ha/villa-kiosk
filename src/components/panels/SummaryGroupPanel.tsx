// src/components/panels/SummaryGroupPanel.tsx
// The modal a SummaryBar tile opens: a comprehensive, contextual view of ALL
// the entities that tile represents (e.g. tapping "Lights" lists every light),
// each individually controllable inline (a quick on/off, lock/unlock) AND
// drill-downable into its FULL type panel (the same PanelRouter panel a 3D
// badge tap opens) — so nothing here re-implements rich control; it reuses it.
//
// Built on the shared BasePanel (same modal chrome/header/close as every other
// panel) and the shared gradient badge (badgeImageDataUrl) so it feels native.

import type { ComponentType } from "react";
import { ChevronRight } from "lucide-react";
import BasePanel from "./BasePanel";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { badgeImageDataUrl } from "@/babylon/badgeIcons";
import { iconKeyFor } from "@/babylon/badgeIconKeys";
import { effectiveCategory } from "@/config/EntityCategories";
import { inferTypeFromEntityId, displayLabelFor } from "@/config/EntityMap";
import { isUnavailable } from "@/utils/stateColors";
import type { HassEntity } from "@/types/ha.types";
import type { Category, EntityType } from "@/types/scene.types";

export interface SummaryGroup {
  title: string;
  icon: ComponentType<{ size?: number | string }>;
  entityIds: string[];
}

interface Props {
  group: SummaryGroup;
  /** Whether the profile may control these devices (else the modal is read-only). */
  canControl: boolean;
  /** Entities with real geometry in the loaded model. Anything NOT in here
   *  exists only in Home Assistant — it's listed last and tinted, so it's
   *  obvious it can't be found on the 3D map. */
  mappedEntityIds: Set<string>;
  onClose: () => void;
  /** Drill into an entity's full type panel (PanelRouter) — wired to
   *  Dashboard's setActivePanel, so it opens the exact same rich panel a 3D
   *  badge tap does. */
  onOpenEntity: (entityId: string) => void;
}

const OFF = new Set(["off", "unavailable", "unknown", ""]);
const TOGGLEABLE = new Set(["light", "switch", "input_boolean", "fan"]);
const NO_ROOM = "Other";

const pretty = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

/** Bucket a list of entities by their configured room (EntityMapping.room),
 *  alphabetical with the no-room bucket always last — so scanning a long
 *  device group (e.g. every light in the villa) reads by physical location
 *  instead of one long flat list. */
function groupByRoom(
  rows: HassEntity[], roomOf: (id: string) => string,
): [string, HassEntity[]][] {
  const buckets = new Map<string, HassEntity[]>();
  for (const e of rows) {
    const room = roomOf(e.entity_id) || NO_ROOM;
    const list = buckets.get(room) ?? [];
    list.push(e);
    buckets.set(room, list);
  }
  return [...buckets.entries()].sort(([a], [b]) => {
    if (a === NO_ROOM) return b === NO_ROOM ? 0 : 1;
    if (b === NO_ROOM) return -1;
    return a.localeCompare(b);
  });
}

export default function SummaryGroupPanel({
  group, canControl, mappedEntityIds, onClose, onOpenEntity,
}: Props) {
  const { entities, callService } = useHA();
  const { config } = useConfig();
  const { role } = useProfile();

  const roomOf = (id: string) => config.entityMap[id]?.room?.trim() ?? "";

  const all = group.entityIds.map((id) => entities[id]).filter((e): e is NonNullable<typeof e> => !!e);
  // Devices you can see in the villa first; HA-only ones (no geometry in this
  // model) grouped after them under their own heading — HIDDEN entirely for
  // Guest: a device with no map presence is exactly the kind of "behind the
  // scenes" plumbing (a relay, a spare contact sensor…) a guest profile has
  // no reason to see or toggle, on top of the RBAC control gating already
  // covering whether they could act on it.
  const onMap = all.filter((e) => mappedEntityIds.has(e.entity_id));
  const offMap = role === "guest" ? [] : all.filter((e) => !mappedEntityIds.has(e.entity_id));
  const rows = [...onMap, ...offMap];
  const toggleables = rows.filter((e) => TOGGLEABLE.has(e.entity_id.split(".")[0]));
  const anyOn = toggleables.some((e) => !OFF.has(e.state));

  const typeOf = (id: string): EntityType =>
    (config.entityMap[id]?.type ?? inferTypeFromEntityId(id) ?? "sensor");

  const Icon = group.icon;

  return (
    <BasePanel
      title={group.title}
      icon={<Icon size={22} />}
      className="summary-group-modal"
      onClose={onClose}
      // Same idea as Settings' theme buttons living in ITS header: the one
      // action that applies to the WHOLE group belongs where it's always
      // visible, not scrolled past a long, room-grouped device list.
      headerActions={canControl && toggleables.length > 1 && (
        <button
          className="btn ghost"
          onClick={() =>
            callService(
              toggleables[0].entity_id.split(".")[0],
              anyOn ? "turn_off" : "turn_on",
              {},
              { entity_id: toggleables.map((e) => e.entity_id) },
            )
          }
        >
          {anyOn ? "Turn all off" : "Turn all on"}
        </button>
      )}
    >
      {rows.length === 0 && <div className="muted body-text">No devices in this group.</div>}

      {/* On-map devices first, ROOM-grouped, then (if any, and not Guest) the
          HA-only ones under their own heading, ALSO room-grouped — one
          renderer for both, so the two lists can't drift. */}
      {onMap.length > 0 && groupByRoom(onMap, roomOf).map(([room, list]) => (
        <div key={room}>
          <div className="summary-room-heading">{room}</div>
          <div className="summary-entity-grid">{list.map(renderRow)}</div>
        </div>
      ))}
      {offMap.length > 0 && (
        <>
          <div className="summary-offmap-heading" title="These devices exist in Home Assistant but have no 3D geometry in this villa model">
            Not on the map
          </div>
          {groupByRoom(offMap, roomOf).map(([room, list]) => (
            <div key={room}>
              <div className="summary-room-heading">{room}</div>
              <div className="summary-entity-grid">{list.map(renderRow)}</div>
            </div>
          ))}
        </>
      )}
    </BasePanel>
  );

  function renderRow(e: NonNullable<(typeof all)[number]>) {
    const id = e.entity_id;
    const domain = id.split(".")[0];
    const type = typeOf(id);
    const cat: Category = effectiveCategory(
      id, type, config.entityMap[id]?.category, e.attributes.device_class as string | undefined);
    const label = displayLabelFor(id, config.entityMap[id]?.label, e.attributes.friendly_name);
    const unit = (e.attributes.unit_of_measurement as string | undefined) ?? "";
    const stateText = isUnavailable(e)
      ? "Unavailable"
      : domain === "climate"
        ? `${Math.round((e.attributes.current_temperature as number | undefined) ?? 0)}°`
        : `${pretty(e.state)}${unit ? ` ${unit}` : ""}`;

    const isLock = domain === "lock";
    const canToggle = canControl && (TOGGLEABLE.has(domain) || isLock);
    const toggleOn = isLock ? e.state !== "locked" : !OFF.has(e.state);
    const offMapRow = !mappedEntityIds.has(id);
    const doToggle = () =>
      isLock
        ? callService("lock", e.state === "locked" ? "unlock" : "lock", {}, { entity_id: id })
        : callService(domain, "toggle", {}, { entity_id: id });

    return (
      <div className={`summary-entity-row${offMapRow ? " is-offmap" : ""}`} key={id}>
        <button
          className="summary-entity-main"
          onClick={() => onOpenEntity(id)}
          title={offMapRow ? `${label} — not on the 3D map` : `Open ${label}`}
        >
          <img
            className="summary-entity-badge"
            src={badgeImageDataUrl(cat, iconKeyFor(type, e), config.entityMap[id]?.badgeColor, 0, isUnavailable(e))}
            alt=""
            draggable={false}
          />
          <span className="summary-entity-text">
            <span className="summary-entity-name" title={label}>{label}</span>
            <span className="summary-entity-state">{stateText}</span>
          </span>
          <ChevronRight size={18} className="summary-entity-chevron" />
        </button>
        {canToggle && (
          <button
            className={`summary-entity-toggle${toggleOn ? " on" : ""}`}
            onClick={doToggle}
            role="switch"
            aria-checked={toggleOn}
            aria-label={`${label}: ${toggleOn ? "on" : "off"}`}
            title={toggleOn ? "Turn off" : "Turn on"}
          >
            <span className="knob" />
          </button>
        )}
      </div>
    );
  }
}
