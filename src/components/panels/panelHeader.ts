// src/components/panels/panelHeader.ts
// WHAT THE OPEN DEVICE PANEL'S HEADER SHOWS — its badge (glyph, colours, the
// device's look and ring), its linked switch and its motion line — derived in
// one place (2.496.305). Pure: tests/oracles/panel_header.mjs drives it by
// value.
//
// This was ~80 lines of derivation written inline in the Dashboard's JSX, two
// IIFEs deep, so the badge, ring and linked-switch rules could only be pinned
// by matching the page's source text. The page keeps what must be React — the
// optimistic switch and its ask-first dialog, which are hooks — and passes
// their results in; the actions (edit, report a fault, Back) are
// pages/screen's.

import type { OpenDevice } from "@/types/panel.types";
import type { HassEntity } from "@/types/ha.types";
import type { Category } from "@/types/scene.types";
import type { DeviceSurfaceState } from "@/config/EntityCategories";
import { effectiveCategory, subjectOf, categoryColor } from "@/config/EntityCategories";
import { labelOf } from "@/config/EntityMap";
import { cameraMotionId } from "@/config/BinarySensorClasses";
import { badgeOwnerOf, deviceLook, storeLookSource, type BadgeMark, type LinkPill } from "@/utils/deviceActivity";
import { iconKeyFor } from "@/babylon/badgeIconKeys";
import { domainOf } from "@/utils/entityDomain";

type LookConfig = Parameters<typeof storeLookSource>[1];

export interface PanelHeader {
  badge: {
    category: Category; iconKey: string; color?: string; categoryColor: string;
    state: DeviceSurfaceState; mark: BadgeMark | null; linkPill: LinkPill;
    /** A critical device that lost contact (deviceLook.critical): the window's lost pill is red (reading.lostPillTone). */
    critical: boolean;
  };
  /** The linked switch (EntityMapping.linkedEntityId), when it has one, it can be switched and
   *  this profile may control it. */
  linked: LinkedState & { label: string } | null;
  /** The linked entity when it is a binary_sensor: a reading, never a switch — drawn as its band (LinkedSensorRow),
   *  whatever the profile (owner, 2026-10-21). */
  linkedSensor: { entityId: string; label: string } | null;
  /** A camera's motion sensor (read-only): its band under the camera's (LinkedSensorRow). */
  motion: { entityId: string; label: string } | null;
  /** The device and its linked entity: whose Cockpit issues the window's warning shows and opens (owner, 2026-10-24).
   *  Whether there are any is the Overview's own list, read live by the window (cockpit/useVillaAttention
   *  useDeviceIssue): every issue it lists, an offline device's included, never only the badge's fault records. */
  issueIds: string[];
}

export interface HeaderInput {
  /** The open device as it is set now (openDevice). */
  panel: OpenDevice;
  entities: Record<string, HassEntity>;
  config: LookConfig;
  canControl: boolean;
  /** The linked switch as the page's optimistic hook holds it: on/off as just
   *  pressed, whether its position is known at all, and where the entity
   *  stands with its device. */
  linkedSwitch: LinkedState | null;
}

/** A linked entity's switch: its position (`isOn`, as just pressed), whether its position is known at all (`known`:
 *  not for a lock in motion, devicePower), and its contact (stateColors.contactOf). */
export interface LinkedState { isOn: boolean; known: boolean; contact: "lost" | "no-value" | "ok" }

/** The word under a linked entity's name: "Unavailable" only when contact is LOST, "Unknown" when the device answers
 *  but this entity has no value (or its position is not known), else On / Off. ⚠️ UNKNOWN IS NOT LOST CONTACT (owner,
 *  2026-10-18): the row read "Unavailable" for both. */
export function linkedStateWords(l: LinkedState): string {
  if (l.contact === "lost") return "Unavailable";
  if (l.contact === "no-value" || !l.known) return "Unknown";
  return l.isOn ? "On" : "Off";
}

export function panelHeader({ panel, entities, config, canControl, linkedSwitch }: HeaderInput): PanelHeader {
  // the device as it is set NOW (openDevice): a just-picked badge colour shows at once
  const { entityId, mapping } = panel;
  const linkedId = mapping.linkedEntityId;
  // A device's LINKED entity wears that device's badge — pictogram, category, colour (deviceActivity.badgeOwnerOf,
  // owner 2026-10-22: badge proposal 2), as on the map; its face stays its own.
  const ownerId = badgeOwnerOf(entityId, config.entityMap);
  const ownerMap = ownerId === entityId ? mapping : config.entityMap[ownerId];
  const ownerType = ownerId === entityId ? mapping.type : ownerMap.type;
  const ownerEnt = entities[ownerId];
  const category = effectiveCategory(subjectOf(ownerId, ownerMap, ownerEnt, ownerType));
  // The ONE shared look (deviceActivity.deviceLook), as the map badge and the
  // device lists — but with the linked switch's OPTIMISTIC state: this header
  // sits right above the switch just pressed, and a ring lagging seconds
  // behind its own switch looks broken. The MAP badge stays on confirmed
  // state only (predicting scene appearance was rightly reverted before).
  const look = deviceLook(entityId, storeLookSource(entities, config, {
    drawnAs: { entityId, type: mapping.type },
    pendingPower: (id) => (linkedId && id === linkedId && linkedSwitch ? linkedSwitch.isOn : undefined),
  }));
  // a camera's motion: its linked entity when that detects presence (BinarySensorClasses.cameraMotionId — owner,
  // 2026-10-22: the "Motion sensor" field merged into "Linked entity"); linked to a switch, it has none
  const motionId = cameraMotionId({ type: mapping.type, linkedEntityId: linkedId },
    (id) => entities[id]?.attributes.device_class as string | undefined);
  // ⚠️ A SENSOR IS NOT A SWITCH (owner, 2026-10-21): a lock's linked door sensor was drawn as a toggle that could not
  // move it — its state is read, as a band (LinkedSensorRow)
  const linkedIsSensor = !!linkedId && domainOf(linkedId) === "binary_sensor";
  return {
    badge: {
      category,
      iconKey: iconKeyFor(ownerType, ownerEnt),
      color: ownerMap.badgeColor ?? mapping.badgeColor,
      categoryColor: categoryColor(category),
      state: look.face,
      mark: look.mark,
      linkPill: look.linkPill,
      critical: look.critical,
    },
    linked: linkedId && !linkedIsSensor && canControl && linkedSwitch
      ? { label: labelOf(linkedId, config.entityMap, entities), ...linkedSwitch }
      : null,
    // a camera's motion sensor is its motion band (below), never a second band beside it
    linkedSensor: linkedId && linkedIsSensor && linkedId !== motionId
      ? { entityId: linkedId, label: labelOf(linkedId, config.entityMap, entities) } : null,
    // Read-only, shown whatever the profile (knowing a camera has motion
    // detection wired up is not a control action). "on" is the sensor's own
    // report of motion — what this line says — not an alert judgement.
    motion: motionId
      ? { entityId: motionId, label: labelOf(motionId, config.entityMap, entities) }
      : null,
    issueIds: [entityId, linkedId].filter((id): id is string => !!id),
  };
}
