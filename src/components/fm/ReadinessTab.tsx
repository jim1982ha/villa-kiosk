// src/components/fm/ReadinessTab.tsx
// "Is the villa fit for the next guest?"
//
// Every check is derived, never hand-ticked: the point is that it reflects the
// villa's ACTUAL live state, which is the one thing a paper checklist can't do.
// A failing check names the devices behind it and opens them directly.

import { useState, type ReactNode } from "react";
import SaveButton from "@/components/common/SaveButton";
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight, Camera, Download } from "lucide-react";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { buildReadinessSnapshot } from "@/fm/fmDocuments";
import { useMonthlyDocument } from "@/fm/useMonthlyDocument";
import SavedDocumentsList from "./SavedDocumentsList";
import MarkdownPreview from "./MarkdownPreview";
import { SourceIconRow } from "./sourceIcons";
import type { CheckState, CheckTarget, ReadinessCheck, ReadinessResult } from "@/fm/readiness";
import { TONE_OF, toneClass } from "@/fm/tone";

const ICON: Record<CheckState, typeof CheckCircle2> = {
  pass: CheckCircle2, warn: AlertTriangle, fail: XCircle,
};

export default function ReadinessTab({
  readiness, onOpenEntity, onOpenCheck,
}: {
  readiness: ReadinessResult;
  onOpenEntity: (id: string) => void;
  /** Opens a check's own devices as a list (readiness.CheckTarget) — every
   *  check the same way. */
  onOpenCheck: (target: CheckTarget) => void;
}) {
  const label = useEntityLabel();
  // Freezing the check turns it from a live readout into evidence (see
  // buildReadinessSnapshot): made and saved in one tap, then shown, saved,
  // reopened and downloaded like the recap and the statement.
  const snapshot = useMonthlyDocument("readiness", (_month, villaName) => buildReadinessSnapshot(readiness, villaName));
  return (
    <div className="fm-stack">
      <ReadinessChecks readiness={readiness} label={label} onOpenEntity={onOpenEntity} onOpenCheck={onOpenCheck}
        save={<SaveButton saved={snapshot.saved} label="Save snapshot" icon={<Camera size={16} />} style={{ marginLeft: "auto" }}
          onClick={() => void snapshot.generateAndSave()} />} />

      <SavedDocumentsList kind="readiness" onOpen={snapshot.reopen} />
      {snapshot.markdown && (
        <div className="fm-stack">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn ghost" onClick={snapshot.close}>Close snapshot</button>
            <button className="btn ghost" onClick={snapshot.download}>
              <Download size={16} /> Download .md
            </button>
          </div>
          <MarkdownPreview markdown={snapshot.markdown} />
        </div>
      )}
    </div>
  );
}

/** The verdict and, folded under it, the checks — each with its own devices' button (readiness.CheckTarget) and,
 *  unless its list is the view itself, a chip per device. Drawn by tests/oracles/readiness_checks.mjs. */
export function ReadinessChecks({ readiness, label, onOpenEntity, onOpenCheck, save, startOpen = false }: {
  readiness: ReadinessResult;
  /** A device's name on its chip. */
  label: (id: string) => string;
  onOpenEntity: (id: string) => void;
  onOpenCheck: (target: CheckTarget) => void;
  /** The verdict line's Save snapshot. */
  save?: ReactNode;
  /** Open at first (a test drawing the checks); the tab opens folded. */
  startOpen?: boolean;
}) {
  // ⚠️ THE CHECKS FOLD UNDER THEIR VERDICT (owner, 2026-10-14): "Not ready · 3 of 6" says it; the six cards under it
  // pushed the monthly recap off the screen. A tap on the verdict opens them.
  const [showChecks, setShowChecks] = useState(startOpen);

  const headline = readiness.overall === "pass"
    ? "Ready for the next guest"
    : readiness.overall === "warn"
      ? "Ready, with things worth fixing"
      : "Not ready";

  const HeadlineIcon = ICON[readiness.overall];

  return (
    <>
      {/* Freezing the check turns it from a live readout into evidence — see
          buildReadinessSnapshot. Same generate-and-keep shape as the recap
          and spend statement, and it lands in the same saved-documents store,
          so a handover pack can include the check actually run on the day. */}
      <div className={`fm-headline ${toneClass(TONE_OF.check[readiness.overall])}`}>
        <button type="button" className="fm-headline-toggle" aria-expanded={showChecks}
          onClick={() => setShowChecks((v) => !v)}>
          <span className="fm-headline-icon"><HeadlineIcon size={22} /></span>
          <span className="fm-headline-text">
            <strong>{headline}</strong>
            <span className="muted">{readiness.passed} of {readiness.total} checks passing</span>
          </span>
          {showChecks ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
        </button>
        {save}
      </div>

      {showChecks && <div className="fm-list">
        {readiness.checks.map((c) => {
          const Icon = ICON[c.state];
          const opens = c.entityIds?.length ? c.opens : undefined;
          // Every check names its devices as chips, the devices not reporting too (owner, 2026-10-18: "the same way the
          // unlocked device or on lights are shown as pills"); past 8, "+N more" — the button opens the whole list.
          const chips = !!c.entityIds?.length;
          return (
            <div key={c.id} className={`fm-row ${toneClass(TONE_OF.check[c.state])}`}>
              <span className={`fm-check-icon ${c.state}`}><Icon size={18} /></span>
              <div className="fm-row-main">
                <div className="fm-row-title">
                  <strong>{c.label}</strong>
                  {/* Same line as the title, not stacked below the detail —
                      stacking it made ONE row taller than every other
                      readiness row next to it (they're read as a grid of
                      cards, and an outlier height there reads as a bug). */}
                  {opens && (
                    <button className="btn ghost fm-row-title-action" onClick={() => onOpenCheck(opens)}>
                      {opens.label} <ChevronRight size={16} />
                    </button>
                  )}
                </div>
                <div className="fm-row-sub muted"><CheckDetail check={c} /></div>
                {chips && c.entityIds && (
                  <div className="fm-chiprow">
                    {c.entityIds.slice(0, 8).map((id) => (
                      <button key={id} className="fm-entity-chip" onClick={() => onOpenEntity(id)}>
                        {label(id)}
                      </button>
                    ))}
                    {c.entityIds.length > 8 && (
                      <span className="muted" style={{ fontSize: "var(--text-xs)" }}>
                        +{c.entityIds.length - 8} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>}

    </>
  );
}

/** A check's line — with the open faults' source icons after "Check the", as the Overview shows them (owner,
 *  2026-10-14). */
export function CheckDetail({ check }: { check: ReadinessCheck }) {
  const lead = "Check the faults";
  if (!check.sources?.length || !check.detail.startsWith(lead)) return <>{check.detail}</>;
  return <>Check the <SourceIconRow sources={check.sources} /> faults{check.detail.slice(lead.length)}</>;
}
