// src/components/fm/ReadinessTab.tsx
// "Is the villa fit for the next guest?"
//
// Every check is derived, never hand-ticked: the point is that it reflects the
// villa's ACTUAL live state, which is the one thing a paper checklist can't do.
// A failing check names the devices behind it and opens them directly.

import { CheckCircle2, AlertTriangle, XCircle, ChevronRight } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { displayLabelFor } from "@/config/EntityMap";
import type { CheckState, ReadinessCheck, ReadinessReport } from "@/fm/readiness";

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

/** Checks that ALSO get a one-tap "View …" shortcut (same idea as the
 *  devices-online one above, opening a group panel via onOpenCheckDevices)
 *  IN ADDITION to their inline chip row — unlike devices-online, these
 *  usually name few enough devices that the chips stay useful on their own,
 *  but the shortcut is still worth having for the same reason the map badge
 *  and the SummaryBar tile have one: jumping straight to "every lock" /
 *  "every light" beats hunting for the entity in a chip row one at a time.
 *  Keyed by check id (see readiness.ts) -> the shortcut's button label. */
const SHORTCUT_LABEL: Partial<Record<string, string>> = {
  locks: "View doors",
  lights: "View lights",
};

export default function ReadinessTab({
  report, onOpenEntity, onOpenUnavailableDevices, onOpenCheckDevices,
}: {
  report: ReadinessReport;
  onOpenEntity: (id: string) => void;
  /** Opens the shared Unavailable-devices panel — same list, same count as
   *  the HUD badge (see config/deviceGroups.unavailableDeviceIds). */
  onOpenUnavailableDevices: () => void;
  /** Same idea, generalised to any other check in SHORTCUT_LABEL — opens a
   *  group panel scoped to exactly that check's own entityIds. */
  onOpenCheckDevices: (check: ReadinessCheck) => void;
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
          const shortcutLabel = SHORTCUT_LABEL[c.id];
          return (
            <div key={c.id} className={`fm-row state-${c.state === "pass" ? "ok" : c.state === "warn" ? "due-soon" : "overdue"}`}>
              <span className={`fm-check-icon ${c.state}`}><Icon size={18} /></span>
              <div className="fm-row-main">
                <div className="fm-row-title">
                  <strong>{c.label}</strong>
                  {/* Same line as the title, not stacked below the detail —
                      stacking it made ONE row taller than every other
                      readiness row next to it (they're read as a grid of
                      cards, and an outlier height there reads as a bug). */}
                  {isDeviceList && !!c.entityIds?.length && (
                    <button className="btn ghost fm-row-title-action" onClick={onOpenUnavailableDevices}>
                      View unavailable devices <ChevronRight size={15} />
                    </button>
                  )}
                  {!isDeviceList && shortcutLabel && !!c.entityIds?.length && (
                    <button className="btn ghost fm-row-title-action" onClick={() => onOpenCheckDevices(c)}>
                      {shortcutLabel} <ChevronRight size={15} />
                    </button>
                  )}
                </div>
                <div className="fm-row-sub muted">{c.detail}</div>
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
