// src/components/panels/DeviceChoice.tsx
// A choice that is a device's own state (an AC's mode and fan speed, a fan's speed and preset): the app's one choice
// control, the chosen one filled in the device's state now (--state, ControlFrame: colour code rule 3, owner
// 2026-11-22; it was the device's family colour, or the mode's own state colour), the pressed choice waiting, as the
// power button does, until the device says where it is (usePendingAck). Nothing is predicted: the selected one stays
// what the device reports.

import { useState } from "react";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import { usePendingAck } from "@/hooks/usePendingAck";
import { tapFeedback } from "@/utils/haptics";

export default function DeviceChoice<K extends string>({ label, options, active, send }: {
  /** What is chosen ("Mode", "Fan speed"), for a screen reader. */
  label: string;
  options: readonly { key: K; label: string }[];
  /** The choice the device reports, or null for none of them. */
  active: K | null;
  /** Send the choice, handing the command's outcome back. */
  send: (key: K) => unknown;
}) {
  const { pending, markPending } = usePendingAck(active);
  const [asked, setAsked] = useState<K | null>(null);
  return (
    <SegmentedGroup device ariaLabel={label} options={options} active={active} pending={pending ? asked : null}
      onChange={(key) => { tapFeedback(); setAsked(key); markPending(send(key)); }} />
  );
}
