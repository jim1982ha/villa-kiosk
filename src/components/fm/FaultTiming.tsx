// src/components/fm/FaultTiming.tsx
// The (i) beside the Overview's "Open a ticket" (owner, 2026-10-14): what each card's source icon means (sourceIcons),
// then when faults open and close (fm/faultTiming.ts) — the VESTA Agent's rows only when an Agent is connected.

import { Fragment } from "react";
import InfoTip from "@/components/common/InfoTip";
import { SOURCE_ICON, SOURCE_WORDS } from "@/components/fm/sourceIcons";
import { AGENT_SOURCES, ISSUE_SOURCES } from "@/fm/issueSource";
import { faultTiming } from "@/fm/faultTiming";
import { useAgent } from "@/agent/AgentContext";
import { agentVisible } from "@/agent/agentView";

export default function FaultTiming() {
  const { status } = useAgent();
  const agent = agentVisible(status);
  const { rows, note } = faultTiming(agent);
  // the icon each card shows for where its problem comes from (owner, 2026-10-14) — the Agent's only with an Agent
  const sources = ISSUE_SOURCES.filter((s) => agent || !AGENT_SOURCES.has(s));
  return (
    <InfoTip label="What the icons mean, and when faults open and close">
      <strong className="info-pop-title">What the icons mean</strong>
      <div className="info-pop-legend">
        {sources.map((s) => {
          const Icon = SOURCE_ICON[s];
          return (
            <Fragment key={s}>
              <Icon size={15} aria-hidden />
              <b>{SOURCE_WORDS[s][0]}</b>
              <span>{SOURCE_WORDS[s][1]}</span>
            </Fragment>
          );
        })}
      </div>
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
