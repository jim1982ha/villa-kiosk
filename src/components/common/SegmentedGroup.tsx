// src/components/common/SegmentedGroup.tsx
// THE "choose one of several" control: one track, one markup, one selected look, one accessibility contract
// (role="group", aria-pressed on each option). A single toggle is a one-option group whose `active` is null while off.
//
// ⚠️ EVERY CHOICE IN THE APP IS THIS (owner, 2026-11-10: the Cockpit's tabs, its Issues | Notifications | Reports line
// and Settings' On | Off were three looks, "the same style consistently, uniquely and centrally applied"): a window's
// tabs (common/ModalTabs), the Inbox's filters, a task's "How often", a device's mode, speed and preset, the charts'
// ranges, every setting's choice. Its look is `.segmented` (04-modals.css) and nothing else: a caller's `className`
// places the group in its line, it never restyles a segment.

import type { ReactNode } from "react";

interface SegmentedOption<K extends string> {
  key: K;
  /** What the button shows — text, an icon, or both. */
  label: ReactNode;
  /** Tooltip, and the accessible name when the label is an icon alone. */
  title?: string;
  /** Shown, greyed and not pressable: a choice this view has nothing to draw for (owner, 2026-10-20: "the toggle
   *  UI consistent everywhere, but grey the buttons that are not applicable"). */
  disabled?: boolean;
}

/** How the group takes its line: `fill` shares it in equal segments (a grid of equal cells past four choices);
 *  `natural` gives each segment its words' width and scrolls sideways when the line is too short (tabs, filters, a
 *  header's control); `compact` is the small one beside a heading (the charts' ranges, a section's counts). */
export type SegmentedLayout = "fill" | "natural" | "compact";

export default function SegmentedGroup<K extends string>({
  options, active, onChange, ariaLabel, layout = "fill", tabs = false, device = false, pending = null, className = "",
}: {
  options: readonly SegmentedOption<K>[];
  /** The pressed option, or null for none (a toggle that is off). */
  active: K | null;
  onChange: (key: K) => void;
  ariaLabel: string;
  layout?: SegmentedLayout;
  /** A window's tabs: said as a tab list to a screen reader (common/ModalTabs). */
  tabs?: boolean;
  /** The choice is a device's own state (its mode, its speed): selected in the device's colour, as its On button. */
  device?: boolean;
  /** The option pressed and not yet answered by the device: it shows the app's waiting sign (panels/DeviceChoice). */
  pending?: K | null;
  /** Where the group sits in its line (a margin, a width). Never a segment's look. */
  className?: string;
}) {
  // more than four choices wrap on a phone: a grid of equal cells, not a pill over several lines (owner, 2026-11-03)
  const shape = layout === "fill" ? (options.length > 4 ? " segmented-grid" : "") : ` segmented-${layout}`;
  return (
    <div className={`segmented${shape}${device ? " segmented-device" : ""}${className ? ` ${className}` : ""}`}
      role={tabs ? "tablist" : "group"} aria-label={ariaLabel}>
      {options.map((o) => {
        const on = o.key === active;
        return (
          <button key={o.key} type="button" className={on ? "active" : ""} disabled={o.disabled}
            aria-disabled={o.disabled || undefined} role={tabs ? "tab" : undefined}
            {...(tabs ? { "aria-selected": on } : { "aria-pressed": on })} aria-busy={o.key === pending || undefined}
            onClick={() => { if (!o.disabled) onChange(o.key); }} data-tip={o.title} aria-label={o.title}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
