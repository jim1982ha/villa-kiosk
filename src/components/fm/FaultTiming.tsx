// src/components/fm/FaultTiming.tsx
// The (i) beside the Overview's "Open a ticket" (owner, 2026-10-14): ONE table — each source's icon (sourceIcons), what
// it is, when it appears and when it goes (fm/faultTiming.ts) — then how a fault becomes a ticket and how often the list
// is read again.
//
// ⚠️ THE AGENT'S ROWS WHENEVER ITS FAULTS ARE ON THE LIST (owner, 2026-10-14: its rows were gone from the card). They
// showed only once the Agent's status had been read — a moment after every start, longer if that read failed — while
// the cards above already wore its icons. An icon on the list is always explained.

import InfoTip from "@/components/common/InfoTip";
import { INFO_TIP_WIDTH } from "@/components/common/infoTipPlacement";
import { SOURCE_ICON, SOURCE_WORDS } from "@/components/fm/sourceIcons";
import { faultTiming } from "@/fm/faultTiming";
import { stageOf } from "@/fm/fmEngine";
import { useFmData } from "@/fm/FmDataContext";
import { useAgent } from "@/agent/AgentContext";
import { agentVisible } from "@/agent/agentView";

export default function FaultTiming() {
  const { status } = useAgent();
  const { data } = useFmData();
  const agent = agentVisible(status) || data.tickets.some((t) => t.source === "vesta_agent" && stageOf(t) !== "closed");
  const { rows, note } = faultTiming(agent);
  return (
    // two-thirds wider than an (i)'s card: its three columns take fewer lines on a desktop (owner, 2026-10-14); a phone
    // still gets the screen's width
    <InfoTip label="What the icons mean, and when each problem comes and goes" width={Math.round(INFO_TIP_WIDTH * 1.66)}>
      <strong className="info-pop-title">What the icons mean, and when each problem comes and goes</strong>
      <table className="info-pop-table">
        {/* "Appears" and "Goes" in ONE column, the same width: the card is less tall (owner, 2026-10-15) */}
        <thead><tr><th>Source</th><th>When</th></tr></thead>
        <tbody>{rows.map((r) => {
          const Icon = SOURCE_ICON[r.source];
          return (
            <tr key={r.source}>
              <td>
                <span className="info-pop-source"><Icon size={15} aria-hidden /> <b>{SOURCE_WORDS[r.source]}</b></span>
                <span className="info-pop-what">{r.what}</span>
              </td>
              <td>
                <span className="info-pop-when"><b>Appears:</b> {r.opens}</span>
                <span className="info-pop-when"><b>Goes:</b> {r.goes}</span>
              </td>
            </tr>
          );
        })}</tbody>
      </table>
      <p className="info-pop-note">{note}</p>
    </InfoTip>
  );
}
