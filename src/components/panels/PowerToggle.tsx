// src/components/panels/PowerToggle.tsx
// The big on/off button shared by the light, fan, switch and media panels.
// One component so the markup, the "on" styling and the Power icon live in a
// single place instead of being copy-pasted into every panel.

import { useEffect, useRef, useState } from "react";
import { Power } from "lucide-react";

interface Props {
  on: boolean;
  onClick: () => void;
}

// Safety-net cap on the "pending" visual — cleared as soon as `on` actually
// flips (see below), so this only matters if HA never confirms at all (a
// dropped call, a slow integration). Long enough to survive normal network
// latency, short enough that a genuinely stuck call doesn't look permanently
// "working" forever.
const PENDING_TIMEOUT_MS = 4000;

export default function PowerToggle({ on, onClick }: Props) {
  // `on` is derived purely from HA's live entity state, so the button gave no
  // feedback at all for the round-trip between a tap and the real
  // state_changed event landing — on a slow link that read as "did that even
  // register?". An earlier attempt at PREDICTING the outcome (optimistic
  // toggle) was reverted project-wide after it mispredicted rapid ON->OFF
  // taps (see CHANGELOG ~v2.32.7-20). This doesn't predict anything: it just
  // acknowledges the tap with a brief pulse, and clears the moment `on`
  // actually changes to whatever HA reports — so it can never show the wrong
  // state, only "something is happening".
  const [pending, setPending] = useState(false);
  const prevOn = useRef(on);
  useEffect(() => {
    if (on !== prevOn.current) {
      prevOn.current = on;
      setPending(false);
    }
  }, [on]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(false), PENDING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <button
      className={`big-toggle ${on ? "on" : ""}${pending ? " pending" : ""}`}
      onClick={() => { setPending(true); onClick(); }}
    >
      <Power size={24} /> {on ? "On" : "Off"}
    </button>
  );
}
