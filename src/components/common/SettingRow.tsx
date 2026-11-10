// src/components/common/SettingRow.tsx
// THE line of one setting (owner, 2026-11-03: "show the other menu (toggle, slider, etc) with the same layout, for
// consistency", and Map look given its own name like Summary bar's): its icon and name at the left, with the name's
// one (i) when it has one, and its control at the right, in a column of the same width on every line so the controls
// line up. An On | Off (common/OnOffToggle), a slider (SettingSlider below), a segmented choice: each is this line.
//
// ⚠️ ITS NAME IS ONE LINE, AT EVERY WIDTH (owner, 2026-11-06: "Night dimming · / 0.5×", "Full screen on this / tablet"
// and "Maintenance / mode" on two lines on a phone): the name never shrinks below its words; a control that no longer
// fits beside it goes under it, the whole width. A slider's value is never in its name: it sits at the right end of
// the name's line (`value`), or right of the track where three sliders share a wide screen's line, and a slider always
// lies under its name, the same for every slider on every screen.
import type { ReactNode } from "react";
import InfoTip from "./InfoTip";

export default function SettingRow({ icon, label, value, tip, tipLabel, className = "", children }: {
  icon?: ReactNode;
  /** The setting's name, its words alone (a slider's value goes in `value`). */
  label: ReactNode;
  /** What a slider is set to ("1.0×", "1.70 m"), at the right end of the name's line. */
  value?: ReactNode;
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
        {icon}<span className="setting-row-label">{label}</span>
        {tip && <InfoTip label={tipLabel ?? `About ${typeof label === "string" ? label : "this setting"}`}>{tip}</InfoTip>}
      </span>
      {/* at the right end of the name's line; on a wide screen's shared line, right of the track (04-modals.css) */}
      {value !== undefined && <span className="setting-row-value">{value}</span>}
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

/** A setting set with a slider: its name and value on one line, the track under them, the whole width (SettingRow's
 *  `setting-slider`). `before`: a button that sets it another way, at the track's left (the model's "Set North"). */
export function SettingSlider({ icon, label, value, tip, min, max, step, at, onChange, before }: {
  icon?: ReactNode;
  label: string;
  /** The value as read, its unit joined ("1.0×", "1.70 m", "137°"). */
  value: string;
  tip?: ReactNode;
  min: number;
  max: number;
  step: number;
  at: number;
  onChange: (n: number) => void;
  before?: ReactNode;
}) {
  return (
    <SettingRow className="setting-slider" icon={icon} label={label} value={value} tip={tip}>
      {before}
      <input aria-label={label} type="range" min={min} max={max} step={step} value={at}
        onChange={(e) => onChange(Number(e.target.value))} />
    </SettingRow>
  );
}

/** ONE way to write each kind of setting's value (owner, 2026-11-06: "1.00×" beside "0.5×" and "1.0×"): a multiplier
 *  with two decimals, a length in metres with two and its unit spaced, an angle in whole degrees. */
export const settingValue = {
  times: (n: number) => `${n.toFixed(2)}×`,
  metres: (n: number) => `${n.toFixed(2)} m`,
  degrees: (n: number) => `${Math.round(n)}°`,
};
