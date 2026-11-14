// src/components/panels/DeviceChoice.tsx
// A choice that is a device's own state (an AC's mode and fan speed, a fan's speed and preset): the app's one choice
// control in the device's colour, the pressed choice waiting, as the power button does, until the device says where
// it is (usePendingAck). Nothing is predicted: the selected one stays what the device reports.

import { useState } from "react";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import { usePendingAck } from "@/hooks/usePendingAck";
import { tapFeedback } from "@/utils/haptics";
import { STATUS_COLOR, statusKeyFor } from "@/utils/stateColors";

export default function DeviceChoice<K extends string>({ label, options, active, send, stateOf }: {
  /** What is chosen ("Mode", "Fan speed"), for a screen reader. */
  label: string;
  options: readonly { key: K; label: string }[];
  /** The choice the device reports, or null for none of them. */
  active: K | null;
  /** Send the choice, handing the command's outcome back. */
  send: (key: K) => unknown;
  /** The choices ARE the device's states (an AC's mode: "cool", "off"), this its entity: the chosen one wears its
   *  state's colour, as the window's pill, band and legend paint it (owner, 2026-11-14: one colour per state in a
   *  window). Absent (a speed, a preset: no state of the table): the device's colour. */
  stateOf?: string;
}) {
  const { pending, markPending } = usePendingAck(active);
  const [asked, setAsked] = useState<K | null>(null);
  const c = stateOf && active ? STATUS_COLOR[statusKeyFor(active, stateOf)] : null;
  // no box of its own (display: contents): only the colours its chosen segment reads
  const tint = { display: "contents", ...(c ? { ["--device-fill" as string]: `color-mix(in srgb, ${c} 16%, var(--bg-modal))`,
    ["--device-ink" as string]: c } : {}) };
  return (
    <div style={tint}>
    <SegmentedGroup device ariaLabel={label} options={options} active={active} pending={pending ? asked : null}
      onChange={(key) => { tapFeedback(); setAsked(key); markPending(send(key)); }} />
    </div>
  );
}
