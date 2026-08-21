// src/components/reports/HistoryTab.tsx
// What was produced, and whether it actually arrived.
//
// ⚠️ DELIVERY IS PER TARGET, AND THIS SHOWS IT THAT WAY. A report that reached
// the owner's phone and failed to reach the facility manager's email is not
// "failed", and collapsing that to one status is how you get a resend that
// spams the person who already read it — see `DELIVERY_STATUS`'s own comment.

import type { ReportHistoryEntry } from "@/reports/reportsTypes";

function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleString(undefined, {
        weekday: "short", day: "numeric", month: "short",
        hour: "2-digit", minute: "2-digit",
      });
}

export default function HistoryTab({
  entries,
}: { entries: ReportHistoryEntry[] | null }) {
  if (entries === null) {
    return <p className="muted body-text">Reading the delivery record…</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="muted body-text">
        No briefings have been sent yet. A preview is not recorded here — only
        something that was actually delivered.
      </p>
    );
  }

  return (
    <ul className="reports-list">
      {entries.map((e) => (
        <li key={e.id} className={`reports-entry sev-${e.severity}`}>
          <div className="reports-entry-head">
            <strong>{when(e.at)}</strong>
            <span className="muted">
              {e.cadence} · {e.audience} · {e.findingCount} finding
              {e.findingCount === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="reports-deliveries">
            {e.deliveries.map((d, i) => (
              <li key={i} className={`reports-delivery status-${d.status}`}>
                <span>{d.target}</span>
                <span>{d.status}</span>
                {d.detail && <span className="muted">{d.detail}</span>}
              </li>
            ))}
            {e.deliveries.length === 0 && (
              <li className="reports-delivery muted">No targets configured.</li>
            )}
          </ul>
        </li>
      ))}
    </ul>
  );
}
