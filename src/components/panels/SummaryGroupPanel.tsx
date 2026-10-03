// src/components/panels/SummaryGroupPanel.tsx
// The modal a SummaryBar tile opens: a comprehensive, contextual view of ALL
// the entities that tile represents (e.g. tapping "Lights" lists every light),
// each individually controllable inline (a quick on/off, lock/unlock) AND
// drill-downable into its FULL type panel (the same PanelRouter panel a 3D
// badge tap opens) — so nothing here re-implements rich control; it reuses it.
//
// Built on the shared BasePanel (same modal chrome/header/close as every other
// panel) and the shared gradient badge (badgeImage) so it feels native.

import { roleCan } from "@/auth/permissions";
import { useState } from "react";
import { deviceRowText } from "@/utils/entityValue";
import { ChevronRight, Sparkles, Power, PowerOff, EyeOff } from "lucide-react";
import BasePanel from "./BasePanel";
import EntityRowToggle from "./EntityRowToggle";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useSceneConfirm } from "@/hooks/useSceneConfirm";
import { useProfile } from "@/auth/ProfileContext";
import type { HaSceneInfo } from "@/config/haScenes";
import { badgeImage } from "@/babylon/badgeIcons";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { iconKeyFor } from "@/babylon/badgeIconKeys";
import { effectiveCategory, subjectOf } from "@/config/EntityCategories";
import { deviceLook, groupLook, storeLookSource } from "@/utils/deviceActivity";
import { bulkSwitchPlan } from "@/config/activeDevices";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { phantomEntity } from "@/utils/phantomEntity";
import { TOGGLEABLE_DOMAINS } from "@/utils/quickAction";
import type { HassEntity } from "@/types/ha.types";
import type { Category } from "@/types/scene.types";
import { NO_ROOM_LABEL } from "@/config/roomKey";

// The group's shape is config/summaryGroups' (this screen only draws one).
export type { SummaryGroup } from "@/config/summaryGroups";
import type { SummaryGroup } from "@/config/summaryGroups";
import { useVillaModel } from "@/config/VillaModel";
import { deviceSwitch } from "@/utils/devicePower";
import InlineConfirm from "@/components/common/InlineConfirm";
import { NOT_SENT } from "@/ha/serviceOutcome";
import { domainOf } from "@/utils/entityDomain";

interface Props {
  group: SummaryGroup;
  /** Whether the profile may control these devices (else the modal is read-only). */
  canControl: boolean;
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

// ⚠️ THE SECOND PRETTIFIER AND THE SECOND OFF-SET ARE BOTH GONE. The prettifier
// capitalised first and replaced underscores after, where `entityValue`'s does
// it the other way round — they disagreed on a state beginning with an
// underscore. The off-set was a byte-identical copy of `entityState.OFF_STATES`
// in a file that already imported from that very module; `isOn` is the same
// question asked of the owner. Both are the defect this repo has now produced
// three times: a rule copied beside the module that owns it, where nothing can
// see the two drift apart.

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
  group, canControl, onClose, onOpenEntity, hideBulkToggle,
  filterSuppressed = true, roomScenes,
}: Props) {
  // Entities on the 3D map; anything else exists only in Home Assistant and
  // is listed last and tinted (config/VillaModel).
  const { mappedEntityIds } = useVillaModel();
  const { entities, suppressedEntityIds, hiddenInHaEntityIds, callService } = useHA();
  const { config, resolvedRooms } = useConfig();
  // Each row's badge is a PNG baked from the theme's tokens — see the hook.
  const theme = useResolvedTheme();
  /** How every row looks — utils/deviceActivity's deviceLook over the store,
   *  the SAME rule and the same inputs the map badge is painted from (its
   *  linked entity through devicePower, its alert override from config). A
   *  linked entity is frequently not itself in this group (a pump's switch
   *  lives elsewhere), so this reads the whole store, not the group's list. */
  const looks = storeLookSource(entities, config);
  const { role } = useProfile();
  const entityLabel = useEntityLabel();
  // Bulk-toggling an entire group (potentially dozens of devices) from one
  // tap is easy to trigger by accident — require an explicit second tap
  // before it actually fires, same pattern as LockPanel's unlock confirm.
  const [confirming, setConfirming] = useState(false);
  const { ask: askScene, dialog: sceneDialog } = useSceneConfirm();

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
  const offMap = !roleCan(role, "listUnmappedDevices")
    ? []
    : all.filter((e) => inHa(e) && !mappedEntityIds.has(e.entity_id));
  const rows = [...onMap, ...offMap, ...notInHa];
  // Deliberately NOT `rows`: a bulk turn-on must never address an entity Home
  // Assistant does not have. The service call would be rejected for that id
  // and the row could never reflect it either way.
  const toggleables = [...onMap, ...offMap]
    .filter((e) => TOGGLEABLE_DOMAINS.has(domainOf(e.entity_id)));
  // "On" is POWER (a group's onCount — devices switched on), and the bulk
  // switch is config/activeDevices': one call PER DOMAIN (the first row's
  // domain used to be sent for every row — a light command to a switch).
  const anyOn = groupLook(toggleables.map((e) => deviceLook(e.entity_id, looks)), { showingDevices: true }).onCount > 0;

  const Icon = group.icon;

  const doToggleAll = () => {
    for (const call of bulkSwitchPlan(toggleables.map((e) => e.entity_id), !anyOn, TOGGLEABLE_DOMAINS)) {
      void callService(call.domain, call.service, {}, { entity_id: call.entityIds });
    }
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
          <InlineConfirm confirmLabel={anyOn ? "Turn off?" : "Turn on?"}
            onConfirm={doToggleAll} onCancel={() => setConfirming(false)} />
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
      {onMap.length > 0 && renderRooms(onMap)}
      {offMap.length > 0 && (
        <>
          <div className="summary-offmap-heading" title="These devices exist in Home Assistant but have no 3D geometry in this villa model">
            Not on the map
          </div>
          {renderRooms(offMap)}
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
          {renderRooms(notInHa)}
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
                // ⚠️ THE SAME HOOK THE SUMMARY BAR USES. A scene run from a
                // room panel and one run from the bar are the same act with
                // the same consequence, so they ask the same question. This
                // surface also had no haptic; the hook carries one.
                onClick={() => askScene(s)}
              >
                <Sparkles size={16} /> {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {sceneDialog}
    </BasePanel>
  );

  /** One list, ROOM-grouped — the renderer the on-map, off-map and not-in-HA
   *  sections share (each had the same block written out until 2.496.263). */
  function renderRooms(list: typeof rows) {
    return groupByRoom(list, roomOf).map(([room, members]) => (
      <div key={room}>
        <div className="summary-room-heading">{room}</div>
        <div className="summary-entity-grid">{members.map(renderRow)}</div>
      </div>
    ));
  }

  function renderRow(e: NonNullable<(typeof all)[number]>) {
    const id = e.entity_id;
    const domain = domainOf(id);
    const look = deviceLook(id, looks);
    const type = look.type;
    const cat: Category = effectiveCategory(subjectOf(id, config.entityMap[id], e, type));
    const label = entityLabel(id);
    // ⚠️ ONE OWNER, AND THIS ROW USED NOT TO USE IT. This was written out here
    // as `pretty(state) + " " + unit` — no scaling — so the row printed
    // "6570.989 W" beside a badge that said "6.6 kW". The climate arrow and the
    // room-vs-setpoint reasoning moved with it; see deviceRowText.
    const stateText = deviceRowText(e, domain);

    const isLock = domain === "lock";
    // `rowInHa` gates every CONTROL on the row. A phantom is rendered so the
    // device is reported, not so it can be operated: Home Assistant would
    // reject the service call, and nothing would ever come back to change the
    // row's state, so the control could only ever look broken.
    const rowInHa = !!entities[id];
    // ⚠️ THREE ANSWERS, AND THE THIRD WITHHOLDS THE CONTROL. This was
    // `isLock ? e.state !== "locked" : !OFF.has(e.state)` — and `!== "locked"`
    // is also true for `unavailable`, `unknown` and `jammed`, so a lock Home
    // Assistant had lost contact with rendered its switch in the UNLOCKED
    // position, announced as "on", while this same row's text said
    // "Unavailable" and its badge was amber. A switch has two positions and
    // the villa did not know which one was true, so it now offers none —
    // the same reasoning `rowInHa` already applies one line up. See
    // entityState.switchPosition, through devicePower.deviceSwitch — the one
    // answer for which way it sits, what throws it, and whether to ask first
    // (2.496.259: this row's switch unlocked a door in one tap, and ignored
    // the owner's "ask before switching").
    const sw = deviceSwitch(e, id, { label, requireConfirm: config.entityMap[id]?.requireConfirm });
    const position = sw.position;
    const canToggle = canControl && rowInHa && position !== "unknown"
      && (TOGGLEABLE_DOMAINS.has(domain) || isLock);
    // EXACTLY what the map paints: `look` above is deviceLook, the map's own
    // rule with the map's own inputs. This used to re-derive the surface from
    // classifyDeviceActivity plus its own unavailable check, which matched the
    // map for most devices and silently disagreed for any entity with a
    // `linkedEntityId`: a pump's power sensor is ringed on the map while its
    // pump runs, and every one of them listed here as plain grey. And until
    // 2.496.245 it resolved the LINKED entity as a raw `state === "on"`, where
    // the map asks devicePower — so a device linked to a lock that was
    // UNLOCKED, or a cover that was OPEN, was ringed on the map and plain here.
    const badge = look;
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
    // The flip is deviceSwitch's (lock/unlock, open/close, a domain's toggle).
    const doToggle = () => {
      const f = sw.flip;
      return f ? callService(f.domain, f.service, {}, { entity_id: id }) : Promise.resolve(NOT_SENT);
    };

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
            src={badgeImage({ category: cat, iconKey: iconKeyFor(type, e), state: badge.face, color: config.entityMap[id]?.badgeColor, ringState: badge.ring })}
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
            actualOn={position === "on"}
            ask={sw.ask}
            label={label}
            onToggle={doToggle}
          />
        )}
      </div>
    );
  }
}
