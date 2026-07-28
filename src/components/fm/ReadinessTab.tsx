// src/components/fm/ReadinessTab.tsx
// "Is the villa fit for the next guest?" — Clause 1.1(iii)(a).
//
// Every check is derived, never hand-ticked: the point is that it reflects the
// villa's ACTUAL live state, which is the one thing a paper checklist can't do.
// A failing check names the devices behind it and opens them directly.

import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { displayLabelFor } from "@/config/EntityMap";
import type { CheckState, ReadinessReport } from "@/fm/readiness";

const ICON: Record<CheckState, typeof CheckCircle2> = {
  pass: CheckCircle2, warn: AlertTriangle, fail: XCircle,
};

export default function ReadinessTab({
  report, onOpenEntity,
}: { report: ReadinessReport; onOpenEntity: (id: string) => void }) {
  const { config } = useConfig();
  const { entities } = useHA();

  const headline = report.overall === "pass"
    ? "Ready for the next guest"
    : report.overall === "warn"
      ? "Ready, with things worth fixing"
      : "Not ready";

  return (
    <div className="fm-stack">
      <div className={`fm-headline ${report.overall}`}>
        <strong>{headline}</strong>
        <span className="muted">{report.passed} of {report.total} checks passing</span>
      </div>

      <div className="fm-list">
        {report.checks.map((c) => {
          const Icon = ICON[c.state];
          return (
            <div key={c.id} className={`fm-row state-${c.state === "pass" ? "ok" : c.state === "warn" ? "due-soon" : "overdue"}`}>
              <span className={`fm-check-icon ${c.state}`}><Icon size={18} /></span>
              <div className="fm-row-main">
                <div className="fm-row-title"><strong>{c.label}</strong></div>
                <div className="fm-row-sub muted">{c.detail}</div>
                {!!c.entityIds?.length && (
                  <div className="fm-chiprow">
                    {c.entityIds.slice(0, 8).map((id) => (
                      <button key={id} className="fm-entity-chip" onClick={() => onOpenEntity(id)}>
                        {displayLabelFor(id, config.entityMap[id]?.label,
                          entities[id]?.attributes.friendly_name)}
                      </button>
                    ))}
                    {c.entityIds.length > 8 && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        +{c.entityIds.length - 8} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
