// src/components/fm/RecentWorkList.tsx
// Work actually done, most recent first.
//
// Completions were write-only: logging one recorded who, when, a note, a cost
// and photo evidence — and then no screen in the app ever showed it again. The
// photos sat in /data and surfaced only inside a generated monthly report, so
// the maintenance record could be built but never reviewed. "Did anyone
// actually service the pool last month?" had no answer short of generating a
// report for it.
//
// Each row says what the work answered — a scheduled task or a fault — because
// those are read differently: one is upkeep going to plan, the other is
// something that broke. Erasing a completion destroys evidence, so it takes
// the same press-and-hold superadmin path every other evidence record uses.
//
// ⚠️ FOLDED AND PAGED, AS THE TICKETS TAB'S CLOSED (owner, 2026-10-14: "a risk of this list to increase
// indefinitely"): the shared FoldedList — every piece of work, a page of cards at a time, under "Recent work (N)".

import { useMemo } from "react";
import { CalendarCheck, Wrench } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { localStamp, completionSource, workedBy } from "@/fm/fmEngine";
import { useFmTerms } from "@/fm/useFmTerms";
import EvidenceRow from "./EvidenceRow";
import ErasableRow from "./ErasableRow";
import AgentMark from "./AgentMark";
import RecordMeta from "./RecordMeta";
import { formatMoney } from "@/utils/money";
import FoldedList from "@/components/common/FoldedList";

export default function RecentWorkList() {
  const { data, removeCompletion } = useFmData();
  const terms = useFmTerms();

  const rows = useMemo(() => {
    const costById = new Map(data.costs.map((c) => [c.id, c]));
    return [...data.completions]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .map((c) => ({
        completion: c,
        // A completion can outlive the thing it answered (a schedule deleted,
        // a fault erased). Say so plainly rather than rendering a blank title
        // — the work still happened, which is the whole point of keeping it.
        source: (() => {
          const src = completionSource(data, c);   // one reading (fmEngine)
          return { kind: src.kind, title: src.title ?? (src.kind === "fault" ? "a fault since erased" : "a task since removed") };
        })(),
        cost: c.costId ? costById.get(c.costId) : undefined,
      }));
  }, [data.completions, data.schedules, data.tickets, data.costs]);

  return (
    <FoldedList title="Recent work" rows={rows} unit="piece of work">
      {({ completion: c, source, cost }) => (
          <ErasableRow
            key={c.id}
            intent={{
              title: "Erase this completion",
              detail: `${source.title} — ${localStamp(c.at)}`,
            }}
            erase={(token) => removeCompletion(c.id, token)}
          >
            <div className="fm-row-main">
              <div className="fm-row-title">
                {source.kind === "fault"
                  ? <Wrench size={16} className="muted" />
                  : <CalendarCheck size={16} className="muted" />}
                <strong>{source.title}</strong>
              </div>
              <RecordMeta when={`${localStamp(c.at)}${workedBy(c) !== "—" ? ` · ${workedBy(c)}` : ""}`}>
                {source.kind === "fault" && <span className="fm-clause">fault</span>}
                <AgentMark record={c} />
              </RecordMeta>
              {c.note && <div className="fm-timeline-note">{c.note}</div>}
              {c.photoIds.length > 0 && (
                <EvidenceRow photoIds={c.photoIds} disabled />
              )}
            </div>
            {cost && <span className="fm-amount">{formatMoney(cost.amountIdr, terms.currency)}</span>}
          </ErasableRow>
      )}
    </FoldedList>
  );
}
