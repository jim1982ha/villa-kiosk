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
//
// A PROFILE THAT SWITCHES NOTHING (no controlEntities, PanelActions may.control: the read-only Display, a TV in the
// villa; owner, 2026-11-24) sees every control as it is, the power button, the choices and the sliders at the device's
// own values, all disabled by one disabled fieldset around them: nothing to press, nothing to drag, in every window
// alike. The proxy refuses its service calls too (_service_call_allowed); this is what the screen shows.

import type { CSSProperties } from "react";
import { leadsTo, pillKey, stateFill } from "@/utils/stateColors";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PowerSection } from "./PowerToggle";
import StatusPill from "./StatusPill";
import { usePanelActions, useStatusRule } from "./PanelActionsContext";
import { useHAActions } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { isOffline } from "@/utils/deviceHealth";
import { controlPill } from "@/config/reading";
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
  const { ws } = useHAActions();
  const rule = useStatusRule();
  const { may } = usePanelActions();
  // ⚠️ LOST CONTACT, NOT "UNKNOWN" (owner, 2026-10-18; architecture review 2026-10-19): a device whose state is
  // "unknown" is answering — it can be commanded (a toggle needs no value), so its controls stay, without the notice;
  // its power button then sits "off" until the device says (devicePower: no position). Only "unavailable" or a
  // missing entity is lost (deviceHealth.isOffline): no controls, and the window's frame says so (BasePanel's notice).
  if (isOffline(entity)) return null;
  const sw = power ? deviceSwitch(entity, mapping.entityId, mapping) : null;
  // a panel's own pill is read with the same rule (its device's, DeviceLook.statusRule): only painted here
  const shown = pill ?? controlPill(mapping.entityId, entity, sw ? sw.position : null, rule);
  // what is chosen now (a mode, a speed, a light's colour) is filled in its pill's colour from here (`--state`,
  // stateColors.stateFill), so it cannot say another state than the pill above it; a button that acts wears where
  // it leads (leadsTo)
  const state = { display: "contents", ...stateFill(pillKey(shown.tone)) } as CSSProperties;
  return (
    <div className="device-controls" style={state}>
      {/* the state, said once and the same way in every window; a critical device's "needs a look" in red */}
      <StatusPill tone={shown.tone} icon={pill?.icon}>{shown.text}</StatusPill>
      {(() => {
        const controls = (
          <>
            {sw && (
              <PowerSection
                on={sw.position === "on"}
                leads={leadsTo(mapping.entityId, sw.position === "on" ? "off" : "on", rule)}
                onClick={() => (may.control ? HAServices.power(ws, entity, mapping.entityId) : undefined)}
                ask={sw.ask}
                beside={beside}
              />
            )}
            {children}
          </>
        );
        // only a read-only profile's are wrapped: every other profile's window keeps its layout as it was
        return may.control ? controls
          : <fieldset className="device-controls-readonly" disabled aria-label="Read only">{controls}</fieldset>;
      })()}
    </div>
  );
}
