// src/components/common/OnOffToggle.tsx
// THE on/off setting (owner, 2026-11-03: "instead of showing a single clickable ON button … show a toggle where user can
// toggle either ON or OFF"; then: "re-use this style", Map look's Icon | Card): the setting's name at the left, and the
// one SegmentedGroup with two options, On and Off, the one in force highlighted, filling the rest of the line in equal
// halves as Map look's pair fills its own. A thin wrapper: the two options and their mapping to the boolean, nothing
// drawn of its own. Every on/off setting draws it; a one-option group pressed while on read as a button saying what it
// would do, not what is (tests/oracles/ui_dry.mjs).

import type { ReactNode } from "react";
import SegmentedGroup from "./SegmentedGroup";

type OnOff = "on" | "off";

export default function OnOffToggle({ on, onChange, ariaLabel, label, icon, title, className = "" }: {
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
  className?: string;
}) {
  const said = title ?? ariaLabel;
  return (
    <div className={`on-off${className ? ` ${className}` : ""}`}>
      <span className="on-off-name">{icon}{label}</span>
      <SegmentedGroup<OnOff> ariaLabel={ariaLabel} className="on-off-switch" active={on ? "on" : "off"}
        onChange={(k) => { if ((k === "on") !== on) onChange(k === "on"); }}
        options={[{ key: "on", label: "On", title: `${said}: on` }, { key: "off", label: "Off", title: `${said}: off` }]} />
    </div>
  );
}
