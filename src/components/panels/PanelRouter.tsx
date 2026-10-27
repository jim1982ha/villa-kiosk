// src/components/panels/PanelRouter.tsx
// Picks the correct control panel for the active entity, based on mapping.type.

import type { OpenDevice } from "@/types/panel.types";
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
  /** The open device as it is set NOW (openDevice): a rename or a change made while it was open shows at once. */
  active: OpenDevice;
  onClose: () => void;
  pinContinuous?: () => () => void;
  /** Swap the open panel to another entity — used by the camera panel's
   *  prev/next buttons to cycle cameras without closing. */
  onOpenEntity?: (entityId: string) => void;
}

export default function PanelRouter({ active, onClose, pinContinuous, onOpenEntity }: Props) {
  const entity = useHAEntity(active.entityId);
  const { config } = useConfig();
  // Every panel's title comes from mapping.label: the name every screen gives the device (openDevice, through
  // displayLabelFor), so no panel shows the raw-id label a mesh binding can leave behind.
  const mapping = { ...active.mapping, label: active.label };
  const props = { entity, mapping, onClose };

  // A group led by a READING (a temperature + humidity combo) opens the
  // combined view — every member's value and one shared chart. A group led by
  // something you CONTROL (a lock, a switch, a pump plug) opens that device's
  // own panel, with the members listed under it as "Also on this device"
  // (BasePanel): the combined view has no controls, and grouping a lock's
  // battery with it used to leave the lock impossible to lock from its badge
  // (2.496.260).
  const group = groupForPrimary(config.deviceGroups, active.entityId);
  if (group && (mapping.type === "sensor" || mapping.type === "binary_sensor")) {
    return <DeviceGroupPanel group={group} primaryMapping={mapping} onClose={onClose} />;
  }

  // Explicit request for the compact panel over the type's own experience —
  // set ONLY by a camera long-press (see ActivePanel.detail's docstring for
  // why this is the same quick-action/compact-panel split isQuickToggle makes
  // for light/switch/fan, not an arbitrary type check).
  if (active.detail) {
    return <GenericPanel {...props} />;
  }

  // One panel per entity, chosen purely by type. Types with no controls of
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
