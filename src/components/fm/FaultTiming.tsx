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
import { agentSourcesShown } from "@/agent/agentView";
import { agentOwned } from "@/fm/issueSource";

export default function FaultTiming() {
  const { status } = useAgent();
  const { data } = useFmData();
  const agent = agentSourcesShown(status, data.tickets.some((t) => agentOwned(t) && stageOf(t) !== "closed"));
  const { groups, note } = faultTiming(agent, status?.cadence ?? null);
  return (
    // twice an (i)'s card: its four columns take fewer lines on a desktop (owner, 2026-10-14 / 2026-10-19); a phone
    // still gets the screen's width
    <InfoTip label="What the icons mean, and when each problem comes and goes" width={INFO_TIP_WIDTH * 2}>
      <strong className="info-pop-title">What the icons mean, and when each problem comes and goes</strong>
      {/* ⚠️ ONE ROW PER SOURCE, FOUR COLUMNS (owner, 2026-10-19: "too big as tooltip — maybe a table would take less
          space"): what it is, when it appears and when it goes side by side, each a few words, instead of a name with
          its description under it and "Appears / Goes" stacked beside — the card is about half as tall. A phone stacks
          each row (04-modals.css). */}
      <table className="info-pop-table">
        <thead><tr><th>Source</th><th>What it is</th><th>Appears</th><th>Goes</th></tr></thead>
        {/* the Kiosk's sources, then the Agent's, each under its heading (owner, 2026-10-15) — headed only when both show */}
        {groups.map((g) => (
          <tbody key={g.title}>
            {groups.length > 1 && <tr className="info-pop-group"><th colSpan={4}>{g.title}</th></tr>}
            {g.rows.map((r) => {
              const Icon = SOURCE_ICON[r.source];
              return (
                <tr key={r.source}>
                  <td><span className="info-pop-source"><Icon size={15} aria-hidden /> <b>{SOURCE_WORDS[r.source]}</b></span></td>
                  <td className="info-pop-what">{r.what}</td>
                  <td className="info-pop-when" data-label="Appears:">{r.opens}</td>
                  <td className="info-pop-when" data-label="Goes:">{r.goes}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      <p className="info-pop-note">{note}</p>
    </InfoTip>
  );
}
