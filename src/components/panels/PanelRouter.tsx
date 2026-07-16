// src/components/panels/PanelRouter.tsx
// Picks the correct control panel for the active entity, based on mapping.type.

import type { ActivePanel } from "@/types/panel.types";
import { useHAEntity } from "@/hooks/useHAEntity";
import { useConfig } from "@/config/ConfigContext";
import { groupForPrimary } from "@/config/deviceGroups";
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
}

export default function PanelRouter({ active, onClose, pinContinuous }: Props) {
  const entity = useHAEntity(active.entityId);
  const { config } = useConfig();
  const props = { entity, mapping: active.mapping, onClose };

  // An entity that's the PRIMARY of a device group opens the combined view
  // (current values + history for every grouped entity) instead of its own
  // type-based panel — see config/deviceGroups.ts.
  const group = groupForPrimary(config.deviceGroups, active.entityId);
  if (group) {
    return <DeviceGroupPanel group={group} primaryMapping={active.mapping} onClose={onClose} />;
  }

  switch (active.mapping.type) {
    case "light":
      return <LightPanel {...props} />;
    case "climate":
      return <ACPanel {...props} />;
    case "lock":
      return <LockPanel {...props} />;
    case "camera":
      return <CameraPanel {...props} pinContinuous={pinContinuous} />;
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
