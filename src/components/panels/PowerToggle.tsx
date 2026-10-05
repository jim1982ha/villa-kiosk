// src/components/panels/PowerToggle.tsx
// The big on/off button shared by the light, fan, switch and media panels.
// One component so the markup, the "on" styling and the Power icon live in a
// single place instead of being copy-pasted into every panel.

import { Power } from "lucide-react";
import { usePendingAck } from "@/hooks/usePendingAck";
import { useAskFirst } from "@/hooks/useAskFirst";
import type { SwitchAsk } from "@/utils/devicePower";
import { tapFeedback } from "@/utils/haptics";
import InlineConfirm from "@/components/common/InlineConfirm";

interface Props {
  on: boolean;
  onClick: () => unknown;
  /** devicePower.deviceSwitch's `ask` — the device's own answer to "ask
   *  before throwing it": always for an unlock, and whenever the owner set
   *  "ask before switching" (EntityMapping.requireConfirm, an explicit opt-in
   *  for a door release or gate motor modelled as a plain switch). First tap
   *  shows the inline confirm instead of acting. quickAction.isQuickToggle
   *  reads the same answer, so a tap on such a device's map badge opens this
   *  panel rather than acting. */
  ask?: SwitchAsk | null;
}

export default function PowerToggle({ on, onClick, ask = null }: Props) {
  // `on` is derived purely from HA's live entity state, so the button gave no
  // feedback at all for the round-trip between a tap and the real
  // state_changed event landing — on a slow link that read as "did that even
  // register?". An earlier attempt at PREDICTING the outcome (optimistic
  // toggle) was reverted project-wide after it mispredicted rapid ON->OFF
  // taps (see CHANGELOG ~v2.32.7-20). This doesn't predict anything: it just
  // acknowledges the tap with a brief pulse, and clears the moment `on`
  // actually changes to whatever HA reports — so it can never show the wrong
  // state, only "something is happening". The rules for that live in
  // usePendingAck now, shared with the lock panel.
  const { pending, markPending } = usePendingAck(on);

  // The "on" look is the device's OWN category colour, not the app accent —
  // but the colour is not read here. BasePanel puts --device-fill/-ink/-ring
  // on the panel, so this button, the speed/preset chips beside it and the
  // header icon above it are three renderings of one value, and a panel type
  // that grows another stateful control gets it without wiring. See
  // .big-toggle.on in styles.css.

  const { asking, request, confirm, cancel } = useAskFirst(ask, () => {
    tapFeedback();
    markPending(onClick());
  });

  if (asking) {
    return <InlineConfirm question={asking.question} confirmLabel={asking.confirmLabel} onConfirm={confirm} onCancel={cancel} />;
  }

  return (
    <button
      className={`big-toggle ${on ? "on" : ""}${pending ? " pending" : ""}`}
      onClick={request}
      aria-busy={pending}
    >
      <Power size={24} /> {on ? "On" : "Off"}
    </button>
  );
}
