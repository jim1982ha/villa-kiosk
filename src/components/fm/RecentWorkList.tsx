// src/components/fm/RecentWorkList.tsx
// The SCHEDULED work done, most recent first — the Schedule tab's "Recent work".
//
// Completions were write-only: logging one recorded who, when, a note, a cost
// and photo evidence — and then no screen in the app ever showed it again. The
// photos sat in /data and surfaced only inside a generated monthly report, so
// the maintenance record could be built but never reviewed. "Did anyone
// actually service the pool last month?" had no answer short of generating a
// report for it. Erasing a completion destroys evidence, so it takes the same
// press-and-hold superadmin path every other evidence record uses.
//
// ⚠️ A TICKET'S REPAIR IS NOT SCHEDULED WORK (owner, 2026-10-14: "why does this ticket appear here?"): the work that
// resolved a ticket is told on its own card in Tickets → Closed (who, the note, its photos and cost) and in Spend.
// ⚠️ THE SAME CARD AS EVERY FACILITY RECORD (RecordCard), folded and paged as Tickets' Closed (FoldedList).

import { useMemo } from "react";
import { useFmData } from "@/fm/FmDataContext";
import { localStamp, completionSource, workedBy, recordsKeptNote } from "@/fm/fmEngine";
import { useFmTerms } from "@/fm/useFmTerms";
import AgentMark from "./AgentMark";
import RecordCard from "./RecordCard";
import { formatMoney } from "@/utils/money";
import FoldedList from "@/components/common/FoldedList";

export default function RecentWorkList() {
  const { data, removeCompletion, retention } = useFmData();
  const terms = useFmTerms();

  const rows = useMemo(() => {
    const costById = new Map(data.costs.map((c) => [c.id, c]));
    return data.completions
      .filter((c) => completionSource(data, c).kind === "schedule")
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .map((c) => ({
        completion: c,
        // A completion can outlive the task it answered (a schedule deleted): said plainly, never a blank title —
        // the work still happened, which is the whole point of keeping it.
        title: completionSource(data, c).title ?? "a task since removed",
        cost: c.costId ? costById.get(c.costId) : undefined,
      }));
  }, [data.completions, data.schedules, data.tickets, data.costs]);

  // how long work done is kept (owner, 2026-10-20: the record's retention, said beside the list it shortens)
  const kept = recordsKeptNote(retention, "Work");
  return (
    <>
    <FoldedList title="Recent work" rows={rows} unit="completion"
      tip={kept ? `${kept} A task's latest completion is always kept.` : undefined}>
      {({ completion: c, title, cost }) => (
        <RecordCard key={c.id} title={title}
          when={`${localStamp(c.at)}${workedBy(c) !== "—" ? ` · ${workedBy(c)}` : ""}`}
          pills={<AgentMark record={c} />} notes={[c.note]} photoIds={c.photoIds}
          amount={cost ? formatMoney(cost.amountIdr, terms.currency) : undefined}
          erase={{ title: "Erase this completion", detail: `${title}, ${localStamp(c.at)}`,
            run: (token) => removeCompletion(c.id, token) }} />
      )}
    </FoldedList>
    </>
  );
}
