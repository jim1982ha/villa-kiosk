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

import { useMemo } from "react";
import { CalendarCheck, Wrench } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { localStamp, formatIdr } from "@/fm/fmEngine";
import EvidenceRow from "./EvidenceRow";
import ErasableRow from "./ErasableRow";

export default function RecentWorkList({ limit = 12 }: { limit?: number }) {
  const { data, removeCompletion } = useFmData();

  const rows = useMemo(() => {
    const scheduleTitle = new Map(data.schedules.map((s) => [s.id, s.title]));
    const ticketTitle = new Map(data.tickets.map((t) => [t.id, t.title]));
    const costById = new Map(data.costs.map((c) => [c.id, c]));
    return [...data.completions]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, limit)
      .map((c) => ({
        completion: c,
        // A completion can outlive the thing it answered (a schedule deleted,
        // a fault erased). Say so plainly rather than rendering a blank title
        // — the work still happened, which is the whole point of keeping it.
        source: c.ticketId
          ? { kind: "fault" as const, title: ticketTitle.get(c.ticketId) ?? "a fault since erased" }
          : { kind: "schedule" as const, title: scheduleTitle.get(c.scheduleId) ?? "a task since removed" },
        cost: c.costId ? costById.get(c.costId) : undefined,
      }));
  }, [data.completions, data.schedules, data.tickets, data.costs, limit]);

  if (rows.length === 0) return null;

  return (
    <div className="fm-stack">
      <div className="fm-row-sub muted" style={{ marginTop: 4 }}>
        Recent work ({data.completions.length} logged)
      </div>
      <div className="fm-list">
        {rows.map(({ completion: c, source, cost }) => (
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
                  ? <Wrench size={14} className="muted" />
                  : <CalendarCheck size={14} className="muted" />}
                <strong>{source.title}</strong>
                {source.kind === "fault" && <span className="fm-clause">fault</span>}
              </div>
              <div className="fm-row-sub muted">
                {localStamp(c.at)}{c.by && c.by !== "—" ? ` · ${c.by}` : ""}
              </div>
              {c.note && <div className="fm-timeline-note">{c.note}</div>}
              {c.photoIds.length > 0 && (
                <EvidenceRow photoIds={c.photoIds} disabled />
              )}
            </div>
            {cost && <span className="fm-amount">{formatIdr(cost.amountIdr)}</span>}
          </ErasableRow>
        ))}
      </div>
    </div>
  );
}
