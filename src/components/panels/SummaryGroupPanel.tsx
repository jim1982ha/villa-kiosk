// src/components/panels/SummaryGroupPanel.tsx
// The modal a SummaryBar tile opens: a comprehensive, contextual view of ALL
// the entities that tile represents (e.g. tapping "Lights" lists every light),
// each individually controllable inline (a quick on/off, lock/unlock) AND
// drill-downable into its FULL type panel (the same PanelRouter panel a 3D
// badge tap opens) — so nothing here re-implements rich control; it reuses it.
//
// Built on the shared BasePanel (same modal chrome/header/close as every other
// panel) and the shared gradient badge (badgeImageDataUrl) so it feels native.

import { useState, type ComponentType } from "react";
import { OFF_STATES } from "@/utils/entityState";
import { ChevronRight, Sparkles, Power, PowerOff, EyeOff } from "lucide-react";
import BasePanel from "./BasePanel";
import EntityRowToggle from "./EntityRowToggle";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import type { HaSceneInfo } from "@/config/haScenes";
import { badgeImageDataUrl } from "@/babylon/badgeIcons";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { iconKeyFor } from "@/babylon/badgeIconKeys";
import { effectiveCategory } from "@/config/EntityCategories";
import { badgeFaceAndRing } from "@/utils/deviceActivity";
import { inferTypeFromEntityId } from "@/config/EntityMap";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { isUnavailable } from "@/utils/stateColors";
import { phantomEntity } from "@/utils/phantomEntity";
import { TOGGLEABLE_DOMAINS } from "@/utils/quickAction";
import type { HassEntity } from "@/types/ha.types";
import type { Category, EntityType } from "@/types/scene.types";
import { NO_ROOM_LABEL } from "@/config/roomKey";

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
  /** Suppress the header's "Turn all on/off" bulk action — for a group that
   *  isn't really "all the X devices" (e.g. HUD's unavailable-devices list,
   *  a cross-category diagnostic view), bulk-toggling makes no sense even
   *  when the list happens to contain toggleable domains. */
  hideBulkToggle?: boolean;
  /** Default true: drop entities the user hid in HA or that HA filed under
   *  entity_category config/diagnostic (see useHA().suppressedEntityIds).
   *  Set false for a genuine troubleshooting/health list — HUD's unavailable-
   *  devices modal shares its entityIds (and count badge) with the Facility
   *  Readiness tab's guest-readiness check, where a hidden or "diagnostic"
   *  sensor going offline (RSSI, battery…) is exactly the kind of thing that
   *  list exists to surface, not hide; it also keeps that modal's row count
   *  always equal to the badge's number, since nothing here would filter it
   *  down further. */
  filterSuppressed?: boolean;
  /** HA scenes touching a device in this group's room — rendered as a "Scenes
   *  for this room" strip above the device list. Only the ROOM-cluster caller
   *  (Dashboard's clusterGroup) passes this; every other use of this panel
   *  (Lights, AC, Unavailable devices, Facility…) isn't room-scoped, so it's
   *  omitted there rather than guessed at. See config/haScenes.ts. */
  roomScenes?: HaSceneInfo[];
}


const pretty = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

/** Bucket a list of entities by their resolved room (ConfigContext's
 *  resolvedRooms — HA's own Area assignment, falling back to GLB geometric
 *  detection), alphabetical with the no-room bucket always last — so scanning a long
 *  device group (e.g. every light in the villa) reads by physical location
 *  instead of one long flat list. */
function groupByRoom(
  rows: HassEntity[], roomOf: (id: string) => string,
): [string, HassEntity[]][] {
  const buckets = new Map<string, HassEntity[]>();
  for (const e of rows) {
    const room = roomOf(e.entity_id) || NO_ROOM_LABEL;
    const list = buckets.get(room) ?? [];
    list.push(e);
    buckets.set(room, list);
  }
  return [...buckets.entries()].sort(([a], [b]) => {
    if (a === NO_ROOM_LABEL) return b === NO_ROOM_LABEL ? 0 : 1;
    if (b === NO_ROOM_LABEL) return -1;
    return a.localeCompare(b);
  });
}

export default function SummaryGroupPanel({
  group, canControl, mappedEntityIds, onClose, onOpenEntity, hideBulkToggle,
  filterSuppressed = true, roomScenes,
}: Props) {
  const { entities, suppressedEntityIds, hiddenInHaEntityIds, callService } = useHA();
  const { config, resolvedRooms } = useConfig();
  // Each row's badge is a PNG baked from the theme's tokens — see the hook.
  const theme = useResolvedTheme();
  /** The live state of an entity another one is LINKED to, if any — the input
   *  badgeSurfaceFor needs to paint a row exactly as the map paints its badge.
   *  A linked entity is frequently not itself in this group (a pump's switch
   *  lives elsewhere), so this reads the whole store, not the group's list. */
  const linkedStateOf = (linkedId?: string) => (linkedId ? entities[linkedId]?.state : undefined);
  const { role } = useProfile();
  const entityLabel = useEntityLabel();
  // Bulk-toggling an entire group (potentially dozens of devices) from one
  // tap is easy to trigger by accident — require an explicit second tap
  // before it actually fires, same pattern as LockPanel's unlock confirm.
  const [confirming, setConfirming] = useState(false);

  const roomOf = (id: string) => resolvedRooms[id]?.trim() ?? "";

  // Substitute a phantom "unavailable" stand-in for any id Home Assistant has
  // no live entity for, rather than dropping it. Dropping was silently hiding
  // exactly the devices most worth showing — one renamed/deleted in HA while
  // the villa model still references it. It also made this list disagree with
  // the count that opened it (badge said 30, list showed 3), since the caller
  // counts ids and this counted live entities. Same stand-in the 3D badge
  // layer uses, so a device faded on the map is now guaranteed to appear here.
  // Entities the user hid in HA, or that HA itself filed under Configuration/
  // Diagnostics (entity_category), are excluded regardless of which caller
  // built `group` — HA's own auto-populated dashboards honour both the same
  // way, and this modal IS this app's auto-populated device list. Neither is
  // touched in HA itself — the entity stays exactly as visible there as before.
  const all = group.entityIds
    .filter((id) => !filterSuppressed || !suppressedEntityIds.has(id))
    .map((id) => entities[id] ?? phantomEntity(id));
  // Devices you can see in the villa first; HA-only ones (no geometry in this
  // model) grouped after them under their own heading — HIDDEN entirely for
  // Guest: a device with no map presence is exactly the kind of "behind the
  // scenes" plumbing (a relay, a spare contact sensor…) a guest profile has
  // no reason to see or toggle, on top of the RBAC control gating already
  // covering whether they could act on it.
  // ── THREE buckets, because there are three different facts ─────────────
  // "on the map", "in HA but not modelled" and "modelled but HA has no such
  // entity" were being answered with two headings, and the third case — a GLB
  // object still named after a device whose integration was removed — was
  // simply hidden. It was dismissible ("Remove", in the unavailable-devices
  // flow) and a dismissal deleted it from every list AND from the map, which
  // reported nothing at all: the mesh still glowed blue and still opened a
  // panel, so the app knew about a device it refused to name anywhere.
  //
  // A phantom row IS the signal (see utils/phantomEntity — the same stand-in
  // the 3D badge layer paints from), so the test is simply "did Home
  // Assistant have an entity for this id".
  const inHa = (e: HassEntity) => !!entities[e.entity_id];
  // NOT hidden for Guest, unlike the off-map bucket below. An off-map device
  // has no presence a guest could see, so omitting it creates no
  // contradiction; a not-in-HA device is drawn on the map (unavailable, with
  // the dashed amber ring) and is tappable, so leaving it out of the room's
  // own list would put the two surfaces back into disagreement about a device
  // one tap apart — the exact bug this section exists to end.
  const notInHa = all.filter((e) => !inHa(e));
  const onMap = all.filter((e) => inHa(e) && mappedEntityIds.has(e.entity_id));
  const offMap = role === "guest"
    ? []
    : all.filter((e) => inHa(e) && !mappedEntityIds.has(e.entity_id));
  const rows = [...onMap, ...offMap, ...notInHa];
  // Deliberately NOT `rows`: a bulk turn-on must never address an entity Home
  // Assistant does not have. The service call would be rejected for that id
  // and the row could never reflect it either way.
  const toggleables = [...onMap, ...offMap]
    .filter((e) => TOGGLEABLE_DOMAINS.has(e.entity_id.split(".")[0]));
  const anyOn = toggleables.some((e) => !OFF_STATES.has(e.state));

  const typeOf = (id: string): EntityType =>
    (config.entityMap[id]?.type ?? inferTypeFromEntityId(id) ?? "sensor");

  const Icon = group.icon;

  const doToggleAll = () => {
    callService(
      toggleables[0].entity_id.split(".")[0],
      anyOn ? "turn_off" : "turn_on",
      {},
      { entity_id: toggleables.map((e) => e.entity_id) },
    );
    setConfirming(false);
  };

  return (
    <BasePanel
      title={group.title}
      icon={<Icon size={22} />}
      className="summary-group-modal"
      onClose={onClose}
      // Same idea as Settings' theme buttons living in ITS header: the one
      // action that applies to the WHOLE group belongs where it's always
      // visible, not scrolled past a long, room-grouped device list.
      headerActions={!hideBulkToggle && canControl && toggleables.length > 1 && (
        confirming ? (
          <div className="modal-actions" style={{ margin: 0 }}>
            <button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="btn danger" onClick={doToggleAll}>
              {anyOn ? "Turn off?" : "Turn on?"}
            </button>
          </div>
        ) : (
          // Icon-only — the text label ("Turn all on/off") cost too much
          // horizontal space in the header, especially on a phone. The icon
          // itself carries the direction (Power = will turn on, PowerOff =
          // will turn off); the tooltip/aria-label still spell it out.
          <button
            className="icon-btn"
            onClick={() => setConfirming(true)}
            title={anyOn ? "Turn all off" : "Turn all on"}
            aria-label={anyOn ? "Turn all off" : "Turn all on"}
          >
            {anyOn ? <PowerOff size={18} /> : <Power size={18} />}
          </button>
        )
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
      {notInHa.length > 0 && (
        <>
          <div
            className="summary-offmap-heading summary-notinha-heading"
            title="This villa model has 3D geometry named after these devices, but Home Assistant has no such entity — most often the integration was removed, or the entity was renamed. Update the model, or re-add them in Home Assistant."
          >
            Not in Home Assistant
          </div>
          {groupByRoom(notInHa, roomOf).map(([room, list]) => (
            <div key={room}>
              <div className="summary-room-heading">{room}</div>
              <div className="summary-entity-grid">{list.map(renderRow)}</div>
            </div>
          ))}
        </>
      )}

      {/* Scenes last — the room's own devices are why this modal was opened,
          scenes are a secondary shortcut for the same room. */}
      {!!roomScenes?.length && (
        <div className="summary-room-scenes">
          <div className="summary-room-heading">Scenes for this room</div>
          <div className="summary-room-scenes-row">
            {roomScenes.map((s) => (
              <button
                key={s.entityId}
                type="button"
                className="btn ghost"
                disabled={!canControl}
                onClick={() => callService("scene", "turn_on", {}, { entity_id: s.entityId })}
              >
                <Sparkles size={16} /> {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </BasePanel>
  );

  function renderRow(e: NonNullable<(typeof all)[number]>) {
    const id = e.entity_id;
    const domain = id.split(".")[0];
    const type = typeOf(id);
    const cat: Category = effectiveCategory(
      id, type, config.entityMap[id]?.category, e.attributes.device_class as string | undefined);
    const label = entityLabel(id);
    const unit = (e.attributes.unit_of_measurement as string | undefined) ?? "";
    const curTemp = e.attributes.current_temperature as number | null | undefined;
    const targetTemp = e.attributes.temperature as number | null | undefined;
    // Current AND target, not current alone — the bottom summary bar's own
    // "AC" tile only ever shows a real current-temperature average (never a
    // target substituted in its place, see SummaryBar.tsx), and a lone
    // number here with no label reads exactly as ambiguously: reported as
    // "is this 26° the room or the setpoint?". "→" keeps both in the same
    // compact space this row already had for one.
    const stateText = isUnavailable(e)
      ? "Unavailable"
      : domain === "climate"
        ? (curTemp == null
            ? (targetTemp == null ? "--" : `→ ${Math.round(targetTemp)}°`)
            : (targetTemp == null ? `${Math.round(curTemp)}°` : `${Math.round(curTemp)}° → ${Math.round(targetTemp)}°`))
        : `${pretty(e.state)}${unit ? ` ${unit}` : ""}`;

    const isLock = domain === "lock";
    // `rowInHa` gates every CONTROL on the row. A phantom is rendered so the
    // device is reported, not so it can be operated: Home Assistant would
    // reject the service call, and nothing would ever come back to change the
    // row's state, so the control could only ever look broken.
    const rowInHa = !!entities[id];
    const canToggle = canControl && rowInHa && (TOGGLEABLE_DOMAINS.has(domain) || isLock);
    const toggleOn = isLock ? e.state !== "locked" : !OFF_STATES.has(e.state);
    // EXACTLY what the map paints, via the one shared rule — see
    // deviceActivity.badgeSurfaceFor. This used to re-derive the surface from
    // classifyDeviceActivity plus its own unavailable check, which matched the
    // map for most devices and silently disagreed for any entity with a
    // `linkedEntityId`: a pump's power sensor rings red on the map while its
    // pump runs, and every one of them listed here as plain grey. Reported by
    // tapping an entity group of four pump-power badges — two red on the map,
    // four identical rows in the modal.
    const badge = badgeFaceAndRing(
      type, e,
      // "Is the entity this one is linked to switched on" — the map holds the
      // same fact as a live set fed by state events (linkActiveIds); here the
      // store already has every state, so it is one lookup.
      linkedStateOf(config.entityMap[id]?.linkedEntityId) === "on",
    );
    const notInHaRow = !rowInHa;
    // An id HA has no entity for is reported as THAT, not as "not on the map"
    // — it may well have geometry, and saying it is missing from the model
    // would send someone to fix the wrong thing.
    const offMapRow = rowInHa && !mappedEntityIds.has(id);
    // A user explicitly hid this in HA (registry hidden_by) — distinct from
    // being merely diagnostic-category, and worth surfacing explicitly: a
    // caller that opted out of filterSuppressed (the room/category browses)
    // can now show this row at all, but the user should still be able to
    // tell "HA itself says this is hidden" from an ordinary device at a
    // glance, not just infer it silently.
    const hiddenInHa = hiddenInHaEntityIds.has(id);
    const doToggle = () =>
      isLock
        ? callService("lock", e.state === "locked" ? "unlock" : "lock", {}, { entity_id: id })
        : callService(domain, "toggle", {}, { entity_id: id });

    return (
      <div
        className={`summary-entity-row${offMapRow ? " is-offmap" : ""}${notInHaRow ? " is-notinha" : ""}`}
        key={id}
      >
        <button
          className="summary-entity-main"
          onClick={() => onOpenEntity(id)}
          title={notInHaRow
            ? `${label} — Home Assistant has no entity with this id`
            : offMapRow ? `${label} — not on the 3D map` : `Open ${label}`}
        >
          <img
            className="summary-entity-badge"
            src={badgeImageDataUrl(
              cat, iconKeyFor(type, e), badge.face, config.entityMap[id]?.badgeColor, 0, badge.ring)}
            key={theme}
            alt=""
            draggable={false}
          />
          <span className="summary-entity-text">
            <span className="summary-entity-name-row">
              <span className="summary-entity-name" title={label}>{label}</span>
              {hiddenInHa && (
                <EyeOff size={16} className="summary-entity-hidden-icon" aria-label="Hidden in HA" />
              )}
            </span>
            <span className="summary-entity-state">{stateText}</span>
          </span>
          <ChevronRight size={18} className="summary-entity-chevron" />
        </button>
        {canToggle && (
          <EntityRowToggle
            entityId={id}
            actualOn={toggleOn}
            label={label}
            onToggle={doToggle}
          />
        )}
      </div>
    );
  }
}
