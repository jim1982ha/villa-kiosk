// src/components/reports/CoverageTab.tsx
// What this property can be asked about, and what it cannot.
//
// ⚠️ THE ABSENT VOICE, NEVER `capabilityMeaning`. That table says what a
// capability ENABLES ("a tariff is configured, so consumption can be expressed
// as money") and printing it beside a MISSING capability reads as a statement
// of fact about a property that does not have one. `capabilityAbsent` is the
// same fact in the voice of its absence, and the renderer follows the identical
// rule — see `deterministic._coverage`.

import { Check, X } from "lucide-react";
import type { ReportsDiagnostics } from "@/reports/reportsApi";

export default function CoverageTab({
  diagnostics,
}: { diagnostics: ReportsDiagnostics | null }) {
  if (!diagnostics) {
    return <p className="muted body-text">Reading what this property can measure…</p>;
  }
  if (!diagnostics.reachable) {
    return (
      <div className="fm-banner warn">
        Home Assistant could not be reached, so nothing could be measured.
        {diagnostics.error && <> Reason: {diagnostics.error}</>}
      </div>
    );
  }

  return (
    <div className="reports-pane">
      {diagnostics.preflight.length > 0 && (
        <>
          <h3 className="reports-h3">Needs attention</h3>
          <ul className="reports-list">
            {diagnostics.preflight.map((p, i) => (
              <li key={i} className={`reports-item sev-${p.severity}`}>{p.detail}</li>
            ))}
          </ul>
        </>
      )}

      <h3 className="reports-h3">Available</h3>
      <ul className="reports-list">
        {diagnostics.capabilities.map((c) => (
          <li key={c} className="reports-item">
            <Check size={14} aria-hidden="true" />
            <span>{diagnostics.capabilityMeaning[c] || c}</span>
          </li>
        ))}
        {diagnostics.capabilities.length === 0 && (
          <li className="reports-item muted">Nothing yet.</li>
        )}
      </ul>

      <h3 className="reports-h3">Not covered</h3>
      <ul className="reports-list">
        {diagnostics.capabilitiesMissing.map((c) => (
          <li key={c} className="reports-item muted">
            <X size={14} aria-hidden="true" />
            <span>{diagnostics.capabilityAbsent[c] || c}</span>
          </li>
        ))}
        {diagnostics.capabilitiesMissing.length === 0 && (
          <li className="reports-item muted">
            Everything this report can use is configured.
          </li>
        )}
      </ul>
    </div>
  );
}
