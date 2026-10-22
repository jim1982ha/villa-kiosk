// src/components/panels/SummaryEntityRow.tsx
// One device tile of a device list (SummaryGroupPanel: a room's window, the Cockpit's lists, Lights, Facility…):
// the badge, the name, the reading, the chevron, and the row's switch beside it.
//
// ⚠️ THE WHOLE TILE SAYS "CONTACT LOST", NOT ONLY ITS ICON (owner, 2026-10-19: in a room's window only the icon square
// of "… Temperature — Unavailable" was dashed amber). The tile says "no contact" — a dashed grey edge, a grey tint, its
// reading in grey (the badge's grey "?", owner 2026-10-22: badge proposal 2) — and a CRITICAL device that lost contact
// is red, as its badge's red "?" (deviceLook.critical). Both read the device's look (utils/deviceActivity.deviceLook), the map badge's own
// rule: a device with no value to give ("unknown") is not out of contact, and stays a plain tile.

import type { ReactNode } from "react";
import { ChevronRight, EyeOff } from "lucide-react";
import type { DeviceLook } from "@/utils/deviceActivity";

/** The tile's contact classes, from the device's look: "is-lost" when contact is lost, plus "is-critical" for a
 *  critical device that lost it; "" otherwise. */
export function rowLookClass(look: Pick<DeviceLook, "unavailable" | "critical">): string {
  if (!look.unavailable) return "";
  return look.critical ? " is-lost is-critical" : " is-lost";
}

interface Props {
  label: string;
  /** The reading under the name (config/reading's rowText). */
  stateText: string;
  look: Pick<DeviceLook, "unavailable" | "critical">;
  /** The badge picture (badgeImage) — baked by the caller, which holds the theme. */
  badgeSrc: string;
  badgeKey?: string;
  /** No entity with this id exists. */
  notInHa: boolean;
  /** Exists, but not on the 3D map. */
  offMap: boolean;
  /** Hidden by the owner in the villa's system. */
  hidden: boolean;
  onOpen: () => void;
  /** The row's switch, when it has one. */
  toggle?: ReactNode;
}

export default function SummaryEntityRow({
  label, stateText, look, badgeSrc, badgeKey, notInHa, offMap, hidden, onOpen, toggle,
}: Props) {
  return (
    <div className={`summary-entity-row${offMap ? " is-offmap" : ""}${notInHa ? " is-notinha" : ""}${rowLookClass(look)}`}>
      <button
        className="summary-entity-main"
        onClick={onOpen}
        title={notInHa
          ? `${label} — no device has this id`
          : offMap ? `${label} — not on the 3D map` : `Open ${label}`}
      >
        <img className="summary-entity-badge" src={badgeSrc} key={badgeKey} alt="" draggable={false} />
        <span className="summary-entity-text">
          <span className="summary-entity-name-row">
            <span className="summary-entity-name" title={label}>{label}</span>
            {hidden && <EyeOff size={16} className="summary-entity-hidden-icon" aria-label="Hidden" />}
          </span>
          <span className="summary-entity-state">{stateText}</span>
        </span>
        <ChevronRight size={18} className="summary-entity-chevron" />
      </button>
      {toggle}
    </div>
  );
}
