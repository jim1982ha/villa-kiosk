// src/components/common/SettingRow.tsx
// THE line of one setting (owner, 2026-11-03: "show the other menu (toggle, slider, etc) with the same layout, for
// consistency", and Map look given its own name like Summary bar's): its icon and name at the left, with the name's
// one (i) when it has one, and its control at the right, in a column of the same width on every line so the controls
// line up. An On | Off (common/OnOffToggle), a slider, a segmented choice: each is this line. Nothing else is drawn.

import type { ReactNode } from "react";
import InfoTip from "./InfoTip";

export default function SettingRow({ icon, label, tip, tipLabel, className = "", children }: {
  icon?: ReactNode;
  /** The setting's name (with its value, for a slider). */
  label: ReactNode;
  /** The name's (i): what the setting does. */
  tip?: ReactNode;
  /** The (i)'s name for assistive technology; "About" and the name when the name is plain text. */
  tipLabel?: string;
  className?: string;
  /** The control. */
  children: ReactNode;
}) {
  return (
    <div className={`setting-row${className ? ` ${className}` : ""}`}>
      <span className="setting-row-name">
        {icon}<span>{label}</span>
        {tip && <InfoTip label={tipLabel ?? `About ${typeof label === "string" ? label : "this setting"}`}>{tip}</InfoTip>}
      </span>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
