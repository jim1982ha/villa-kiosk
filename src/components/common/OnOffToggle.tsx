// src/components/common/OnOffToggle.tsx
// THE on/off setting (owner, 2026-11-03: "instead of showing a single clickable ON button … show a toggle where user can
// toggle either ON or OFF"; then: "re-use this style", Map look's Icon | Card): the setting's name at the left, and the
// one SegmentedGroup with two options, On and Off, the one in force highlighted, at the right of the one setting line
// (common/SettingRow); owner, 2026-11-03: half as wide as when it filled the rest of the line. A thin wrapper: the two options and their mapping to the boolean, nothing
// drawn of its own. Every on/off setting draws it; a one-option group pressed while on read as a button saying what it
// would do, not what is.

import type { ReactNode } from "react";
import SegmentedGroup from "./SegmentedGroup";
import SettingRow from "./SettingRow";

type OnOff = "on" | "off";

export default function OnOffToggle({ on, onChange, ariaLabel, label, icon, title, tip, compact = false, className = "" }: {
  on: boolean;
  /** Called with the value pressed, only when it changes it. */
  onChange: (on: boolean) => void;
  /** The setting's name for assistive technology (the group's name). */
  ariaLabel: string;
  /** What the line shows at the left (the setting's name, or what it does). */
  label: ReactNode;
  /** Shown before the label. */
  icon?: ReactNode;
  /** Tooltip of each option: what the setting does. */
  title?: string;
  /** The name's (i). */
  tip?: ReactNode;
  /** On a card's own line, at that line's height (a device card's "Confirm"): the control's compact shape. */
  compact?: boolean;
  className?: string;
}) {
  const said = title ?? ariaLabel;
  return (
    <SettingRow className={`on-off${className ? ` ${className}` : ""}`} icon={icon} label={label} tip={tip}
      tipLabel={`About ${ariaLabel}`}>
      <SegmentedGroup<OnOff> ariaLabel={ariaLabel} className="on-off-switch" layout={compact ? "compact" : "fill"} active={on ? "on" : "off"}
        onChange={(k) => { if ((k === "on") !== on) onChange(k === "on"); }}
        options={[{ key: "on", label: "On", title: `${said}: on` }, { key: "off", label: "Off", title: `${said}: off` }]} />
    </SettingRow>
  );
}
