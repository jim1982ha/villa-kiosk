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
import { useState, type CSSProperties } from "react";
import { Sparkles, Power, PowerOff, MapPin, Building2, Lock, Unlock } from "lucide-react";
import BasePanel from "./BasePanel";
import { useHA, useHAActions } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useSceneConfirm } from "@/hooks/useSceneConfirm";
import { useProfile } from "@/auth/ProfileContext";
import type { HaSceneInfo } from "@/config/haScenes";
import { deviceLook, groupLook, type LookSource } from "@/utils/deviceActivity";
import { bulkSwitchPlan, bulkWords } from "@/config/activeDevices";
import { ROW_SWITCH_DOMAINS } from "@/utils/quickAction";
import { isLockSwitch } from "@/utils/switchWords";
import { leadsTo } from "@/utils/stateColors";
import type { HassEntity } from "@/types/ha.types";
import { listSections, offersGrouping, summaryRows, type Grouping } from "@/config/summaryRows";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import { TipTitle } from "@/components/common/InfoTip";
import { useRoomFloors } from "@/config/useRoomFloors";
import { deviceRoom, floorOfRoom } from "@/config/devicePlace";

// The group's shape is config/summaryGroups' (this screen only draws one).
import type { SummaryGroup } from "@/config/summaryGroups";
import { useVillaModel } from "@/config/VillaModel";
import InlineConfirm from "@/components/common/InlineConfirm";
import { allSent } from "@/ha/serviceOutcome";
import { usePendingAck } from "@/hooks/usePendingAck";
import { NOT_IN_HA } from "@/utils/deviceHealth";
import EmptyLine from "@/components/common/EmptyLine";
import { useDeviceRows } from "./useDeviceRows";
import Button from "@/components/common/Button";

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

/**
 * "Turn all on/off" for a set of devices, behind the same second tap — the
 * header's (the whole group) and each room's or floor's heading (listSections) are this one control.
 * Bulk-toggling many devices from one tap is easy to trigger by accident, so it
 * asks first, the LockPanel unlock pattern. Icon-only: the text cost too much
 * width, on a phone above all; the icon carries the direction (Power = will
 * turn on, PowerOff = will turn off; over locks alone the padlock it will throw) and the tooltip says what it will switch (bulkWords: "Turn off 1 fan"). "On" is
 * POWER (groupLook's onCount), and the switch is config/activeDevices' — one
 * call PER DOMAIN (a lock: lock / unlock). Shown over any heading with a device a row switches (owner, 2026-10-20:
 * one switch, four locks — every heading that has one). Once sent it waits as every command button does
 * (usePendingAck), until one of the devices it switches says so.
 */
function BulkToggle({ devices, looks }: { devices: HassEntity[]; looks: LookSource }) {
  const { callService } = useHAActions();
  const [confirming, setConfirming] = useState(false);
  const anyOn = groupLook(devices.map((e) => deviceLook(e.entity_id, looks)), { showingDevices: true }).onCount > 0;
  // what it will change, said (owner, 2026-10-20): the devices now on when it turns off, else those now off
  const changing = devices.map((e) => e.entity_id).filter((id) => (deviceLook(id, looks).power === "on") === anyOn);
  const { pending, markPending } = usePendingAck(changing.join());
  if (devices.length === 0) return null;
  const words = bulkWords(changing, !anyOn);
  // ⚠️ LOCKS ONLY, A PADLOCK (owner, 2026-11-22: a lock is a padlock, never an on/off switch — SwitchFace): a heading
  // over locks alone shows the bolt it will throw, Lock with any unlocked, Unlock… with all locked, and says it so.
  const locks = devices.every((e) => isLockSwitch(e.entity_id));
  const icon = locks ? (anyOn ? <Lock size={18} /> : <Unlock size={18} />) : (anyOn ? <PowerOff size={18} /> : <Power size={18} />);
  const confirmLabel = locks ? (anyOn ? "Lock" : "Unlock") : (anyOn ? "Turn off" : "Turn on");
  // the colour of where it leads, as a window's button (stateColors.leadsTo; owner, 2026-11-22): "Lock" or "Turn off"
  // the resting green, "Unlock…" or "Turn on" the in-use red
  const leads = leadsTo(devices[0].entity_id, locks ? (anyOn ? "locked" : "unlocked") : (anyOn ? "off" : "on")) as CSSProperties;
  const run = () => {
    markPending(allSent(bulkSwitchPlan(devices.map((e) => e.entity_id), !anyOn, ROW_SWITCH_DOMAINS)
      .map((call) => callService(call.domain, call.service, {}, { entity_id: call.entityIds }))));
    setConfirming(false);
  };
  return confirming ? (
    <InlineConfirm question={`${words}?`} confirmLabel={confirmLabel} onConfirm={run}
      onCancel={() => setConfirming(false)} />
  ) : (
    <Button look="action" style={leads} icon={icon} label={words} busy={pending}
      onClick={() => setConfirming(true)} />
  );
}

// ⚠️ THE SECOND PRETTIFIER AND THE SECOND OFF-SET ARE BOTH GONE. The prettifier
// capitalised first and replaced underscores after, where `entityValue`'s does
// it the other way round — they disagreed on a state beginning with an
// underscore. The off-set was a byte-identical copy of `entityState.OFF_STATES`
// in a file that already imported from that very module; `isOn` is the same
// question asked of the owner. Both are the defect this repo has now produced
// three times: a rule copied beside the module that owns it, where nothing can
// see the two drift apart.

export default function SummaryGroupPanel({
  group, canControl, onClose, onOpenEntity, hideBulkToggle,
  filterSuppressed = true, roomScenes,
}: Props) {
  // Entities on the 3D map; anything else exists only in Home Assistant and
  // is listed last and tinted (config/VillaModel).
  const { mappedEntityIds } = useVillaModel();
  const { entities, suppressedEntityIds } = useHA();
  const roomFloors = useRoomFloors();
  const { resolvedRooms } = useConfig();
  // every row, and how each device looks (the group's "Turn all on/off" reads it): useDeviceRows, shared with Search
  const { looks, renderRow } = useDeviceRows();
  const { role } = useProfile();
  const { ask: askScene, dialog: sceneDialog } = useSceneConfirm();

  const roomOf = (id: string) => deviceRoom(resolvedRooms, id);

  // Which rows, in which buckets — config/summaryRows (the phantom stand-ins,
  // the three buckets, the guest's off-map rule; tested by value). A guest
  // never lists a device that has no presence on the map.
  const { onMap, offMap, notInHa, rows, toggleables } = summaryRows(group.entityIds, {
    entities, mapped: mappedEntityIds, suppressed: suppressedEntityIds, filterSuppressed,
    mayListUnmapped: roleCan(role, "listUnmappedDevices"),
  });
  const Icon = group.icon;
  // Who may switch a whole set at once — the header's and every heading's BulkToggle.
  const bulk = !hideBulkToggle && canControl;
  // ⚠️ PER ROOM OR PER FLOOR, IN THE LIST ITSELF (owner, 2026-10-20): the Cockpit's Room / Floor / Category tiles were
  // a second way to the same lists, removed; every list spanning rooms offers the split, Per Room when it opens —
  // the same from every opener (a top-bar category, the bottom bar, the map).
  const [grouping, setGrouping] = useState<Grouping>("room");
  const splits = offersGrouping(rows, (e) => e.entity_id, roomOf);

  return (
    <BasePanel
      title={group.title}
      icon={<Icon size={22} />}
      className="summary-group-modal"
      onClose={onClose}
      // Same idea as Settings' theme buttons living in ITS header: the one
      // action that applies to the WHOLE group belongs where it's always
      // visible, not scrolled past a long, room-grouped device list.
      headerActions={bulk && <BulkToggle devices={toggleables} looks={looks} />}
    >
      {rows.length === 0 && <EmptyLine>No devices in this group.</EmptyLine>}
      {splits && (
        <SegmentedGroup ariaLabel="Group by" className="summary-grouping" active={grouping} onChange={setGrouping} options={[
          { key: "room", label: <><MapPin size={16} /> Per Room</> },
          { key: "floor", label: <><Building2 size={16} /> Per Floor</> },
        ]} />
      )}

      {/* On-map devices first, under their headings, then (if any, and not Guest) the
          HA-only ones under their own heading, split the same way — one
          renderer for both, so the two lists can't drift. */}
      {onMap.length > 0 && renderRooms(onMap)}
      {offMap.length > 0 && (
        <>
          {/* what each heading means is behind its (i), which a tap opens: it was a hover text (UI scan, 2026-11-10) */}
          <div className="summary-offmap-heading">
            <TipTitle title="Not on the map" tip="The villa's system has these devices, but the villa's 3D model has no object for them." />
          </div>
          {renderRooms(offMap)}
        </>
      )}
      {notInHa.length > 0 && (
        <>
          <div className="summary-offmap-heading summary-notinha-heading">
            <TipTitle title={NOT_IN_HA} tip="The villa's 3D model has objects named after these devices, but the villa's system has no such device: it was removed there, or renamed. Update the model, or add the device back." />
          </div>
          {renderRooms(notInHa)}
        </>
      )}

      {/* Scenes last — the room's own devices are why this modal was opened,
          scenes are a secondary shortcut for the same room. */}
      {!!roomScenes?.length && (
        <div className="summary-room-scenes">
          <div className="section-title">Scenes for this room</div>
          <div className="summary-room-scenes-row">
            {roomScenes.map((s) => (
              <Button icon={<Sparkles size={16} />} key={s.entityId} disabled={!canControl}
                onClick={() => askScene(s)}> {s.name}</Button>
            ))}
          </div>
        </div>
      )}
      {sceneDialog}
    </BasePanel>
  );

  /** One list under its headings (summaryRows.listSections: each room, or each floor), each heading with its own
   *  "Turn all on/off" — the renderer the on-map, off-map and not-in-HA sections share. */
  function renderRooms(list: typeof rows) {
    return listSections(list, (e) => e.entity_id, roomOf, (room) => floorOfRoom(roomFloors, room), grouping).map((sec) => {
      const inSection = new Set(sec.items.map((e) => e.entity_id));
      return (
        <div key={sec.key} className="summary-section">
          <div className="summary-section-heading">
            <span>{sec.title}</span>
            {bulk && <BulkToggle devices={toggleables.filter((e) => inSection.has(e.entity_id))} looks={looks} />}
          </div>
          <div className="summary-entity-grid">{sec.items.map((e) => renderRow(e, { canControl, onOpen: onOpenEntity }))}</div>
        </div>
      );
    });
  }
}
