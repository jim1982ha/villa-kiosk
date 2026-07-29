// src/components/fm/ReadinessTab.tsx
// "Is the villa fit for the next guest?" — Clause 1.1(iii)(a).
//
// Every check is derived, never hand-ticked: the point is that it reflects the
// villa's ACTUAL live state, which is the one thing a paper checklist can't do.
// A failing check names the devices behind it and opens them directly.

import { CheckCircle2, AlertTriangle, XCircle, ChevronRight } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { displayLabelFor } from "@/config/EntityMap";
import type { CheckState, ReadinessReport } from "@/fm/readiness";

const ICON: Record<CheckState, typeof CheckCircle2> = {
  pass: CheckCircle2, warn: AlertTriangle, fail: XCircle,
};

/** The "All devices reporting" check can legitimately list dozens of ids on a
 *  villa having a bad day — that's the exact check this app once got
 *  flagged for cluttering the tab with a wall of chips. It already has a
 *  dedicated, better UI for that: the same Unavailable-devices panel the HUD
 *  badge opens (see FacilityModal). Every OTHER check keeps its inline chip
 *  list — those are usually one or two devices (a lock, a camera), and jumping
 *  straight to the one at fault is more useful there than a link to a list. */
const DEVICE_LIST_CHECK_ID = "devices-online";

export default function ReadinessTab({
  report, onOpenEntity, onOpenUnavailableDevices,
}: {
  report: ReadinessReport;
  onOpenEntity: (id: string) => void;
  /** Opens the shared Unavailable-devices panel — same list, same count as
   *  the HUD badge (see config/deviceGroups.unavailableDeviceIds). */
  onOpenUnavailableDevices: () => void;
}) {
  const { config } = useConfig();
  const { entities } = useHA();

  const headline = report.overall === "pass"
    ? "Ready for the next guest"
    : report.overall === "warn"
      ? "Ready, with things worth fixing"
      : "Not ready";

  const HeadlineIcon = ICON[report.overall];

  return (
    <div className="fm-stack">
      <div className={`fm-headline ${report.overall}`}>
        <span className="fm-headline-icon"><HeadlineIcon size={22} /></span>
        <div className="fm-headline-text">
          <strong>{headline}</strong>
          <span className="muted">{report.passed} of {report.total} checks passing</span>
        </div>
      </div>

      <div className="fm-list">
        {report.checks.map((c) => {
          const Icon = ICON[c.state];
          const isDeviceList = c.id === DEVICE_LIST_CHECK_ID;
          return (
            <div key={c.id} className={`fm-row state-${c.state === "pass" ? "ok" : c.state === "warn" ? "due-soon" : "overdue"}`}>
              <span className={`fm-check-icon ${c.state}`}><Icon size={18} /></span>
              <div className="fm-row-main">
                <div className="fm-row-title"><strong>{c.label}</strong></div>
                <div className="fm-row-sub muted">{c.detail}</div>
                {isDeviceList && !!c.entityIds?.length && (
                  <button className="btn ghost" style={{ marginTop: 6, alignSelf: "flex-start" }}
                    onClick={onOpenUnavailableDevices}>
                    View unavailable devices <ChevronRight size={15} />
                  </button>
                )}
                {!isDeviceList && !!c.entityIds?.length && (
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
