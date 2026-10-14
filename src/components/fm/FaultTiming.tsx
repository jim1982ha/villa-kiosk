// src/components/fm/FaultTiming.tsx
// The (i) beside "Raise a fault" (owner, 2026-10-14: "how frequent is the list refreshed … what happens if an issue
// occurs or clears during the day?"). Its words are fm/faultTiming.ts's.

import InfoTip from "@/components/common/InfoTip";
import { FAULT_TIMING, FAULT_TIMING_NOTE } from "@/fm/faultTiming";

export default function FaultTiming() {
  return (
    <InfoTip label="When faults open and close">
      <strong className="info-pop-title">When faults open and close</strong>
      <table className="info-pop-table">
        <thead><tr><th>Source</th><th>Opens</th><th>Closes</th></tr></thead>
        <tbody>{FAULT_TIMING.map(([what, opens, closes]) => (
          <tr key={what}><td>{what}</td><td>{opens}</td><td>{closes}</td></tr>
        ))}</tbody>
      </table>
      <p className="info-pop-note">{FAULT_TIMING_NOTE}</p>
    </InfoTip>
  );
}
