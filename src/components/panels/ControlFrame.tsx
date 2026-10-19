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
import { PowerSection } from "./PowerToggle";
import UnavailableNotice from "./UnavailableNotice";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { isOffline } from "@/utils/stateColors";
import { deviceSwitch } from "@/utils/devicePower";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";

interface Props {
  entity: HassEntity | undefined;
  mapping: EntityMapping;
  /** Noun for the notice's description ("light", "fan", "AC"…). */
  device: string;
  /** Draw the power button (devicePower.deviceSwitch: its flip, and its ask). */
  power?: boolean;
  /** Beside the power button, in one row with a compact button (PowerToggle.PowerSection) — a light's colours and
   *  effects. Like the children, only while the device can be commanded. */
  beside?: ReactNode;
  /** Shown whatever the state (a reading that is informative offline too). */
  always?: ReactNode;
  children?: ReactNode;
}

export default function ControlFrame({ entity, mapping, device, power, beside, always, children }: Props) {
  const { ws } = useHA();
  // ⚠️ LOST CONTACT, NOT "UNKNOWN" (owner, 2026-10-18; architecture review 2026-10-19): a device whose state is
  // "unknown" is answering — it can be commanded (a toggle needs no value), so its controls stay, without the notice;
  // its power button then sits "off" until the device says (devicePower: no position). Only "unavailable" or a
  // missing entity is lost (stateColors.isOffline), and then the notice replaces the controls.
  if (isOffline(entity)) {
    return <><UnavailableNotice device={device} entityId={mapping.entityId} />{always}</>;
  }
  return (
    <>
      {power && (() => {
        const sw = deviceSwitch(entity, mapping.entityId, mapping);
        return (
          <PowerSection
            on={sw.position === "on"}
            onClick={() => HAServices.power(ws, entity, mapping.entityId)}
            ask={sw.ask}
            beside={beside}
          />
        );
      })()}
      {always}
      {children}
    </>
  );
}
