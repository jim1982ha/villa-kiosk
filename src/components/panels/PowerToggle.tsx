// src/components/panels/PowerToggle.tsx
// The big Turn on / Turn off button shared by the light, fan, switch, A/C and media panels.
// One component so the markup, the styling and the Power icon live in a single place.
//
// ⚠️ AN ACTION, AS THE LOCK'S (owner, 2026-11-13: "there is no pill showing the current state for the Fan as it
// appear for other device"): it said the state ("On") in the state's colour while a lock and a blind said theirs in a
// pill and named their action on the button. The window's pill says the state now (ControlFrame, every window), and
// this button says what a tap does, in the colour of where it leads (stateColors.actionColor), as "Unlock door…".

import type { ReactNode } from "react";
import { Power } from "lucide-react";
import { usePendingAck } from "@/hooks/usePendingAck";
import { useAskFirst } from "@/hooks/useAskFirst";
import type { SwitchAsk } from "@/utils/devicePower";
import { tapFeedback } from "@/utils/haptics";
import InlineConfirm from "@/components/common/InlineConfirm";


interface Props {
  on: boolean;
  /** The colour of where a tap leads (stateColors.actionColor: off when on, on when off). */
  leads: string;
  onClick: () => unknown;
  /** devicePower.deviceSwitch's `ask` — the device's own answer to "ask
   *  before throwing it": always for an unlock, and whenever the owner set
   *  "ask before switching" (EntityMapping.requireConfirm, an explicit opt-in
   *  for a door release or gate motor modelled as a plain switch). First tap
   *  shows the inline confirm instead of acting. quickAction.isQuickToggle
   *  reads the same answer, so a tap on such a device's map badge opens this
   *  panel rather than acting. */
  ask?: SwitchAsk | null;
  /** The smaller button that sits in a row beside the device's other choices (PowerSection). */
  compact?: boolean;
}

/**
 * The power button's section of a device window. With nothing `beside` it, the big button alone, as it always was;
 * with something beside it (a light's colours and effects, LightChoices), ONE row: a compact On button and those
 * choices next to it (owner, 2026-10-19: the On button took the window's top, and the strip's colours were nowhere).
 */
export function PowerSection({ beside, ...props }: Omit<Props, "compact"> & { beside?: ReactNode }) {
  if (!beside) return <PowerToggle {...props} />;
  return (
    <div className="power-row">
      <PowerToggle {...props} compact />
      {beside}
    </div>
  );
}

export default function PowerToggle({ on, leads, onClick, ask = null, compact = false }: Props) {
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

    const { asking, request, confirm, cancel } = useAskFirst(ask, () => {
    tapFeedback();
    markPending(onClick());
  });

  if (asking) {
    return <InlineConfirm question={asking.question} confirmLabel={asking.confirmLabel} onConfirm={confirm} onCancel={cancel} />;
  }

  return (
    <button
      className={`big-toggle action${compact ? " compact" : ""}`}
      style={{ ["--state" as string]: leads }}
      onClick={request}
      aria-busy={pending || undefined}
    >
      <Power size={compact ? 20 : 24} /> {on ? "Turn off" : "Turn on"}
    </button>
  );
}
