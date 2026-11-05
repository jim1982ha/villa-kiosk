// src/components/fm/FaultTiming.tsx
// The (i) beside Messages' "Open a ticket" (owner, 2026-10-14): ONE table — each source's icon (sourceIcons), what
// it is, when it appears and when it goes (fm/faultTiming.ts) — then how a fault becomes a ticket and how often the list
// is read again.
//
// ⚠️ THE AGENT'S ROWS WHENEVER ITS FAULTS ARE ON THE LIST (owner, 2026-10-14: its rows were gone from the card). They
// showed only once the Agent's status had been read — a moment after every start, longer if that read failed — while
// the cards above already wore its icons. An icon on the list is always explained.

import InfoTip from "@/components/common/InfoTip";
import { INFO_TIP_WIDTH } from "@/components/common/infoTipPlacement";
import { TimingName } from "@/components/fm/sourceIcons";
import { faultTiming, TIMING_HEADS } from "@/fm/faultTiming";
import { stageOf } from "@/fm/fmEngine";
import { useFmData } from "@/fm/FmDataContext";
import { useAgent } from "@/agent/AgentContext";
import { agentSourcesShown } from "@/agent/agentView";
import { agentOwned } from "@/fm/issueSource";

/** Its title, also the (i)'s name for a screen reader. */
const TITLE = "What the icons mean, and when each problem comes and goes";

export default function FaultTiming() {
  const { status } = useAgent();
  const { data } = useFmData();
  const agent = agentSourcesShown(status, data.tickets.some((t) => agentOwned(t) && stageOf(t) !== "closed"));
  return (
    // twice an (i)'s card: its four columns take fewer lines on a desktop (owner, 2026-10-14 / 2026-10-19); a phone
    // still gets the screen's width
    <InfoTip label={TITLE} width={INFO_TIP_WIDTH * 2}>
      <FaultTimingTable timing={faultTiming(agent, status?.cadence ?? null)} />
    </InfoTip>
  );
}

/** The card's table and note, drawn from faultTiming. Pure: tests/oracles/source_tips.mjs draws it beside each icon's
 *  own tip (sourceIcons SourceTipCard), the same rows. */
export function FaultTimingTable({ timing: { groups, note, confirming } }: { timing: ReturnType<typeof faultTiming> }) {
  return (
    <>
      <strong className="info-pop-title">{TITLE}</strong>
      {/* ⚠️ ONE ROW PER SOURCE, FOUR COLUMNS (owner, 2026-10-19: "too big as tooltip — maybe a table would take less
          space"): what it is, when it appears and when it goes side by side, each a few words, instead of a name with
          its description under it and "Appears / Goes" stacked beside — the card is about half as tall. A phone stacks
          each row (04-modals.css). */}
      <table className="info-pop-table">
        <thead><tr><th>Source</th><th>{TIMING_HEADS.what}</th><th>{TIMING_HEADS.opens}</th><th>{TIMING_HEADS.goes}</th></tr></thead>
        {/* the Kiosk's sources, then the Agent's, each under its heading (owner, 2026-10-15) — headed only when both show */}
        {groups.map((g) => (
          <tbody key={g.title}>
            {groups.length > 1 && <tr className="info-pop-group"><th colSpan={4}>{g.title}</th></tr>}
            {g.rows.map((r) => (
              <tr key={r.source} data-source={r.source}>
                <td><TimingName k={r.source} /></td>
                <td className="info-pop-what">{r.what}</td>
                <td className="info-pop-when" data-label={`${TIMING_HEADS.opens}:`}>{r.opens}</td>
                <td className="info-pop-when" data-label={`${TIMING_HEADS.goes}:`}>{r.goes}</td>
              </tr>
            ))}
            {/* the VESTA Agent's group ends with the check a fault being confirmed wears (owner, 2026-10-23) */}
            {confirming && g === groups[groups.length - 1] && (
              <tr key="confirming" data-source="watch">
                <td><TimingName k="watch" /></td>
                <td className="info-pop-what">{confirming.what}</td>
                <td className="info-pop-when" data-label={`${TIMING_HEADS.opens}:`}>{confirming.opens}</td>
                <td className="info-pop-when" data-label={`${TIMING_HEADS.goes}:`}>{confirming.goes}</td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
      <p className="info-pop-note">{note}</p>
    </>
  );
}
