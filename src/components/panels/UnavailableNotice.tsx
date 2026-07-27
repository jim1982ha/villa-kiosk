// src/components/panels/UnavailableNotice.tsx
// Shared "HA has lost contact with this device" block for every simple on/off
// panel (Light/Fan/Switch/Media — Lock has its own richer copy given the
// security stakes). Replaces the panel's normal toggle/controls entirely: a
// device HA has no contact with can't be reliably commanded, and showing the
// toggle as a definite (usually "Off") state misrepresents what's actually
// known — see utils/stateColors.isUnavailable's docstring for the LockPanel
// case ("UNLOCKED" shown for a lock HA had actually lost contact with) that
// prompted this pattern.

import { AlertTriangle } from "lucide-react";

interface Props {
  /** Noun for the device kind, e.g. "light", "fan", "switch" — now used for
   *  the hover/assistive description rather than an on-screen paragraph. */
  device?: string;
}

export default function UnavailableNotice({ device = "device" }: Props) {
  // The pill alone carries the message. The paragraph that used to sit under
  // it just restated the word above it and tripled the height of an otherwise
  // tiny panel, so it survives only as the title / accessible description.
  const detail =
    `Home Assistant has lost contact with this ${device} — its real state isn't `
    + "known, so controls are disabled until it reports in again.";
  return (
    <div className="center" style={{ margin: "8px 0 20px" }}>
      <span className="status-pill unavailable" title={detail} aria-label={detail}>
        <AlertTriangle size={16} />
        UNAVAILABLE
      </span>
    </div>
  );
}
