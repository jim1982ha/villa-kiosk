// src/components/panels/PowerToggle.tsx
// The big on/off button shared by the light, fan, switch and media panels.
// One component so the markup, the "on" styling and the Power icon live in a
// single place instead of being copy-pasted into every panel.

import { useState } from "react";
import { Power } from "lucide-react";
import { usePendingAck } from "@/hooks/usePendingAck";
import { tapFeedback } from "@/utils/haptics";

interface Props {
  on: boolean;
  onClick: () => void;
  /** Device label, used in the confirm prompt below — only meaningful
   *  together with requireConfirm. */
  label?: string;
  /** EntityMapping.requireConfirm — an explicit per-device opt-in (set in
   *  Advanced Settings, never inferred from the entity_id) for a device
   *  where an accidental tap has a real physical consequence (a door
   *  release, a gate motor, modelled as a plain switch/light/fan with no
   *  domain-level "this is critical" signal of its own). First tap shows
   *  an inline "Turn on/off?" confirm instead of acting — the exact same
   *  Cancel/Confirm pattern SummaryGroupPanel's "Turn all on/off" already
   *  uses, not a second bespoke one. Combined with quickAction.ts's
   *  isQuickToggle also honouring this flag, a tap on this device's map
   *  badge can't act at all without first landing here. */
  requireConfirm?: boolean;
}

export default function PowerToggle({ on, onClick, label, requireConfirm }: Props) {
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
  const [confirming, setConfirming] = useState(false);

  const act = () => {
    tapFeedback();
    markPending();
    onClick();
    setConfirming(false);
  };

  if (requireConfirm && confirming) {
    return (
      <div className="modal-actions" style={{ margin: 0 }}>
        <span className="body-text" style={{ marginRight: "auto" }}>
          Turn {on ? "off" : "on"}{label ? ` ${label}` : ""}?
        </span>
        <button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
        <button className="btn danger" onClick={act}>Confirm</button>
      </div>
    );
  }

  return (
    <button
      className={`big-toggle ${on ? "on" : ""}${pending ? " pending" : ""}`}
      onClick={() => (requireConfirm ? setConfirming(true) : act())}
      aria-busy={pending}
    >
      <Power size={24} /> {on ? "On" : "Off"}
    </button>
  );
}
