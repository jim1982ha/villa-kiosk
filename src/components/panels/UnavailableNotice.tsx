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
import { useHA } from "@/ha/HAStateStore";
import { missingAdvice, missingFromHa, NOT_IN_HA } from "@/utils/stateColors";
import { useVillaModel } from "@/config/VillaModel";
import { lostPillTone } from "@/config/reading";
import { usePanelActions } from "./PanelActionsContext";
import { useLastSeen } from "@/hooks/useLastSeen";

interface Props {
  /** Noun for the device kind, e.g. "light", "fan", "switch" — now used for
   *  the hover/assistive description rather than an on-screen paragraph. */
  device?: string;
  /** The panel's entity: when Home Assistant does not have it at all, the notice says so and what to do. */
  entityId?: string;
}

export default function UnavailableNotice({ device = "device", entityId }: Props) {
  const { entities } = useHA();
  const { mappedEntityIds } = useVillaModel();
  // a critical device that lost contact: red, as the Cockpit paints it (the header's look decides — reading.lostPillTone)
  const tone = lostPillTone("unavailable", usePanelActions().badge?.critical ?? false);
  const missing = !!entityId && missingFromHa(entities, entityId);
  // whether the villa's system had it before: read only for a Missing device, one read per window (useLastSeen)
  const seen = useLastSeen(missing ? entityId! : null);
  // ⚠️ NOT THE SAME AS LOST CONTACT (owner, 2026-10-14): a 3D object named after an entity Home Assistant no longer
  // has showed "UNAVAILABLE" and "Not enough history yet" — as if it might come back. It will not until the model
  // or a re-mapping changes, so it says that, in the words every surface uses (NOT_IN_HA).
  // ⚠️ THE ID IS FOR WHOEVER FIXES IT (owner, 2026-10-31): the sentence speaks of "this device"; the id the villa's
  // system knows it by sits under it, small, said for what it is: what a technician searches for there or in Edit.
  if (missing) {
    return (
      <div className="center" style={{ margin: "8px 0 20px" }}>
        <span className="status-pill unavailable"><AlertTriangle size={16} />{NOT_IN_HA.toUpperCase()}</span>
        {seen !== "loading" && (
          <p className="muted body-text" style={{ marginTop: 10 }}>
            {missingAdvice(mappedEntityIds.has(entityId!), seen)}
          </p>
        )}
        <p className="muted" style={{ marginTop: 6, fontSize: "var(--text-2xs)" }}>
          Its id in the villa's system: <code>{entityId}</code>
        </p>
      </div>
    );
  }
  // The pill alone carries the message. The paragraph that used to sit under
  // it just restated the word above it and tripled the height of an otherwise
  // tiny panel, so it survives only as the title / accessible description.
  const detail =
    `Contact with this ${device} is lost, its real state isn't `
    + "known, so controls are disabled until it reports in again.";
  return (
    <div className="center" style={{ margin: "8px 0 20px" }}>
      <span className={`status-pill ${tone}`} title={detail} aria-label={detail}>
        <AlertTriangle size={16} />
        UNAVAILABLE
      </span>
    </div>
  );
}
