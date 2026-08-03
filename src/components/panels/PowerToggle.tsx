// src/components/panels/PowerToggle.tsx
// The big on/off button shared by the light, fan, switch and media panels.
// One component so the markup, the "on" styling and the Power icon live in a
// single place instead of being copy-pasted into every panel.

import { Power } from "lucide-react";
import { usePendingAck } from "@/hooks/usePendingAck";
import { tapFeedback } from "@/utils/haptics";

interface Props {
  on: boolean;
  onClick: () => void;
}

export default function PowerToggle({ on, onClick }: Props) {
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

  return (
    <button
      className={`big-toggle ${on ? "on" : ""}${pending ? " pending" : ""}`}
      onClick={() => { tapFeedback(); markPending(); onClick(); }}
      aria-busy={pending}
    >
      <Power size={24} /> {on ? "On" : "Off"}
    </button>
  );
}
