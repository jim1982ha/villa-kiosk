// src/components/panels/ControlFrame.tsx
// The part every device panel that COMMANDS something shares: whether the
// device can be commanded, how an offline one looks, and the power button.
//
// ⚠️ THE OFFLINE LOOK HAD DRIFTED (fixed 2.496.231). Seven panels each worked
// out "is it unavailable" and "is it on"; four drew the same notice-or-power-
// button line; and an offline device looked three ways — the A/C showed the
// notice AND greyed-out controls, the blind greyed its buttons, the rest hid
// their controls. Now: the notice, and no controls, everywhere. Each panel
// keeps only its own controls (brightness, fan speed, set-point…), passed as
// children; they render only while the device can be commanded.

import type { ReactNode } from "react";
import PowerToggle from "./PowerToggle";
import UnavailableNotice from "./UnavailableNotice";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { isUnavailable } from "@/utils/stateColors";
import { devicePower } from "@/utils/devicePower";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";

interface Props {
  entity: HassEntity | undefined;
  mapping: EntityMapping;
  /** Noun for the notice's description ("light", "fan", "AC"…). */
  device: string;
  /** Draw the power button (devicePower's flip; confirm when the mapping asks). */
  power?: boolean;
  /** Shown whatever the state (a reading that is informative offline too). */
  always?: ReactNode;
  children?: ReactNode;
}

export default function ControlFrame({ entity, mapping, device, power, always, children }: Props) {
  const { ws } = useHA();
  if (isUnavailable(entity)) {
    return <><UnavailableNotice device={device} />{always}</>;
  }
  return (
    <>
      {power && (
        <PowerToggle
          on={devicePower(entity, mapping.entityId).position === "on"}
          onClick={() => HAServices.power(ws, entity, mapping.entityId)}
          label={mapping.label} requireConfirm={mapping.requireConfirm}
        />
      )}
      {always}
      {children}
    </>
  );
}
