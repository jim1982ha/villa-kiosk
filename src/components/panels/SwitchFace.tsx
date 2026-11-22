// src/components/panels/SwitchFace.tsx
// ⚠️ A LOCK IS A PADLOCK, NEVER A SWITCH (owner, 2026-11-22: "Does it make sense to see the toggle appear off when the
// door is locked? This feel counter intuitive"). A lock's power is still "unlocked = on" (entityState.switchPosition),
// so a heading's power button can only ever lock a room; what a person SEES is its bolt: a closed padlock filled green
// while locked; an open one filled red, in use as a switch that is on, while unlocked (a critical door's too: its alarm
// is its badge's mark). Colour code rules 1 and 3 (owner, 2026-11-22, option B): a control says its state now, filled
// in its state's colour. A tap does what it shows: "Lock", or "Unlock…" asked first (devicePower.switchAsk). Every place that draws a device's
// switch draws it through here: a device row (EntityRowToggle), a window's linked device (BasePanel) and the camera's
// rail (CameraPanel, its icon), its words from utils/switchWords, so a lock reads the same wherever it is.

import type { ReactNode } from "react";
import { Lock, Power, Unlock } from "lucide-react";
import { isLockSwitch, switchTip, type switchA11y } from "@/utils/switchWords";

/** Its switch's icon where a button draws one (the camera's rail): the padlock of its bolt, else Power. */
export function switchIcon(entityId: string, isOn: boolean, size?: number): ReactNode {
  if (!isLockSwitch(entityId)) return <Power size={size} />;
  return isOn ? <Unlock size={size} /> : <Lock size={size} />;
}

/** Spread on it: what a tap does and what it says to assistive tech (switchWords.switchA11y, or a linked device's
 *  linkedSwitchProps). */
type Props = {
  entityId: string;
  isOn: boolean;
  onClick?: () => unknown;
  disabled?: boolean;
} & ReturnType<typeof switchA11y>;

/** A device's inline switch: the sliding toggle, or a lock's padlock. */
export default function SwitchFace({ entityId, isOn, ...button }: Props) {
  const common = { ...button, "data-tip": switchTip(entityId, isOn) };
  if (isLockSwitch(entityId)) {
    return (
      <button className={`summary-entity-lock${isOn ? " open" : ""}`} {...common}>
        {switchIcon(entityId, isOn, 18)}
      </button>
    );
  }
  return (
    <button className={`summary-entity-toggle${isOn ? " on" : ""}`} {...common}>
      <span className="knob" />
    </button>
  );
}
