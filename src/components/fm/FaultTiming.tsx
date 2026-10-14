// src/components/fm/FaultTiming.tsx
// The (i) beside the Overview's "Open a ticket" (owner, 2026-10-14). Its words are fm/faultTiming.ts's — the VESTA
// Agent's rows only when an Agent is connected (agentView.agentVisible).

import InfoTip from "@/components/common/InfoTip";
import { faultTiming } from "@/fm/faultTiming";
import { useAgent } from "@/agent/AgentContext";
import { agentVisible } from "@/agent/agentView";

export default function FaultTiming() {
  const { status } = useAgent();
  const { rows, note } = faultTiming(agentVisible(status));
  return (
    <InfoTip label="When faults open and close">
      <strong className="info-pop-title">When faults open and close</strong>
      <table className="info-pop-table">
        <thead><tr><th>Source</th><th>Opens</th><th>Closes</th></tr></thead>
        <tbody>{rows.map(([what, opens, closes]) => (
          <tr key={what}><td>{what}</td><td>{opens}</td><td>{closes}</td></tr>
        ))}</tbody>
      </table>
      <p className="info-pop-note">{note}</p>
    </InfoTip>
  );
}
