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
import type { LucideIcon } from "lucide-react";
import { PowerSection } from "./PowerToggle";
import StatusPill from "./StatusPill";
import { usePanelActions } from "./PanelActionsContext";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { actionColor, isOffline } from "@/utils/stateColors";
import { controlPill, criticalPillTone } from "@/config/reading";
import { deviceSwitch } from "@/utils/devicePower";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";

interface Props {
  entity: HassEntity | undefined;
  mapping: EntityMapping;
  /** Draw the power button (devicePower.deviceSwitch: its flip, and its ask). */
  power?: boolean;
  /** Beside the power button, in one row with a compact button (PowerToggle.PowerSection) — a light's colours and
   *  effects. Like the children, only while the device can be commanded. */
  beside?: ReactNode;
  /** The window's state pill when the panel words it itself (a lock's bolt with its padlock, a blind's position as it
   *  is dragged); else controlPill's (On / Off, or the state in its words). Every window draws it here, above its
   *  controls, in one style (owner, 2026-11-13). */
  pill?: { text: string; tone: string; icon?: LucideIcon };
  children?: ReactNode;
}

export default function ControlFrame({ entity, mapping, power, beside, pill, children }: Props) {
  const { ws } = useHA();
  const onCriticalList = usePanelActions().badge?.onCriticalList ?? false;
  // ⚠️ LOST CONTACT, NOT "UNKNOWN" (owner, 2026-10-18; architecture review 2026-10-19): a device whose state is
  // "unknown" is answering — it can be commanded (a toggle needs no value), so its controls stay, without the notice;
  // its power button then sits "off" until the device says (devicePower: no position). Only "unavailable" or a
  // missing entity is lost (stateColors.isOffline): no controls, and the window's frame says so (BasePanel's notice).
  if (isOffline(entity)) return null;
  const sw = power ? deviceSwitch(entity, mapping.entityId, mapping) : null;
  const shown = pill ?? controlPill(mapping.entityId, entity, sw ? sw.position : null);
  return (
    <>
      {/* the state, said once and the same way in every window; a critical device's "needs a look" in red */}
      <StatusPill tone={criticalPillTone(shown.tone, onCriticalList)} icon={pill?.icon}>{shown.text}</StatusPill>
      {sw && (() => {
        return (
          <PowerSection
            on={sw.position === "on"}
            leads={actionColor(mapping.entityId, sw.position === "on" ? "off" : "on")}
            onClick={() => HAServices.power(ws, entity, mapping.entityId)}
            ask={sw.ask}
            beside={beside}
          />
        );
      })()}
      {children}
    </>
  );
}
