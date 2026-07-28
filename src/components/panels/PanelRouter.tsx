// src/components/panels/PanelRouter.tsx
// Picks the correct control panel for the active entity, based on mapping.type.

import type { ActivePanel } from "@/types/panel.types";
import { useHAEntity } from "@/hooks/useHAEntity";
import { useConfig } from "@/config/ConfigContext";
import { groupForPrimary } from "@/config/deviceGroups";
import { displayLabelFor } from "@/config/EntityMap";
import LightPanel from "./LightPanel";
import ACPanel from "./ACPanel";
import LockPanel from "./LockPanel";
import CameraPanel from "./CameraPanel";
import SensorPanel from "./SensorPanel";
import CoverPanel from "./CoverPanel";
import FanPanel from "./FanPanel";
import SwitchPanel from "./SwitchPanel";
import MediaPanel from "./MediaPanel";
import GenericPanel from "./GenericPanel";
import DeviceGroupPanel from "./DeviceGroupPanel";

interface Props {
  active: ActivePanel;
  onClose: () => void;
  pinContinuous?: () => () => void;
  /** Swap the open panel to another entity — used by the camera panel's
   *  prev/next buttons to cycle cameras without closing. */
  onOpenEntity?: (entityId: string) => void;
}

export default function PanelRouter({ active, onClose, pinContinuous, onOpenEntity }: Props) {
  const entity = useHAEntity(active.entityId);
  const { config } = useConfig();
  // Every panel's title comes from mapping.label — resolved HERE, once, so
  // EVERY panel (not just the bottom-bar group modal) stops showing a device
  // stuck with the ugly all-lowercase raw-id label a mesh binding can leave
  // behind when it auto-created this mapping before the entity's live
  // friendly_name had arrived (see displayLabelFor's docstring). A real
  // stored customisation still always wins.
  const mapping = {
    ...active.mapping,
    label: displayLabelFor(active.entityId, active.mapping.label, entity?.attributes.friendly_name),
  };
  const props = { entity, mapping, onClose };

  // An entity that's the PRIMARY of a device group opens the combined view
  // (current values + history for every grouped entity) instead of its own
  // type-based panel — see config/deviceGroups.ts.
  const group = groupForPrimary(config.deviceGroups, active.entityId);
  if (group) {
    return <DeviceGroupPanel group={group} primaryMapping={mapping} onClose={onClose} />;
  }

  // One panel per entity, chosen purely by type — tap and long-press both land
  // here, so a badge always opens the same thing. Types with no controls of
  // their own fall through to GenericPanel's state + 24h history (see default).
  switch (mapping.type) {
    case "light":
      return <LightPanel {...props} />;
    case "climate":
      return <ACPanel {...props} />;
    case "lock":
      return <LockPanel {...props} />;
    case "camera":
      return <CameraPanel {...props} pinContinuous={pinContinuous} onOpenEntity={onOpenEntity} />;
    case "sensor":
    case "binary_sensor":
      return <SensorPanel {...props} />;
    case "cover":
      return <CoverPanel {...props} />;
    case "fan":
      return <FanPanel {...props} />;
    case "switch":
    case "input_boolean":
      return <SwitchPanel {...props} />;
    case "media_player":
      return <MediaPanel {...props} />;
    default:
      return <GenericPanel {...props} />;
  }
}
