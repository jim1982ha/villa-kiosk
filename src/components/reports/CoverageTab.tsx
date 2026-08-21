// src/components/reports/CoverageTab.tsx
// What this property can be asked about, and what it cannot.
//
// ⚠️ THE ABSENT VOICE, NEVER `capabilityMeaning`. That table says what a
// capability ENABLES ("a tariff is configured, so consumption can be expressed
// as money") and printing it beside a MISSING capability reads as a statement
// of fact about a property that does not have one. `capabilityAbsent` is the
// same fact in the voice of its absence, and the renderer follows the identical
// rule — see `deterministic._coverage`.

// ⚠️ AND NOTHING ON THIS PAGE IS LIVE. `/reports-diagnostics` probes Home
// Assistant when it is ASKED, and it is asked once, when the dialog opens. So
// "Needs attention" is a snapshot from that instant: an item fixed in HA a
// minute ago is still listed, and one that broke a minute ago is not. The owner
// asked whether this was real time or periodic and the honest answer is
// neither — it is on demand, and a panel that does not say so is read as a
// feed. Stating the time and offering the re-probe is cheaper than either
// polling (continuous load on a Pi for a page read once) or leaving a reader to
// guess (`feedback_instruments-never-skip` — a surface that cannot say when it
// was measured reads as current).

import { Check, RefreshCw, X } from "lucide-react";
import type { ReportsDiagnostics } from "@/reports/reportsApi";

/** The probe time as a wall clock, or "" if the server sent nothing usable.
 *  ⚠️ THE READER'S LOCALE AND THE READER'S ZONE, deliberately — unlike a
 *  SCHEDULE hour, which is the villa's wall clock because it fires there. This
 *  is "how long ago did I press the thing", asked by whoever is holding the
 *  device. */
function probedAt(iso: string): string {
  if (!iso) return "";
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? "" : when.toLocaleTimeString();
}

export default function CoverageTab({
  diagnostics, busy, onRefresh,
}: {
  diagnostics: ReportsDiagnostics | null;
  busy: boolean;
  onRefresh: () => void;
}) {
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

  const at = probedAt(diagnostics.at);

  return (
    <div className="reports-pane">
      <div className="reports-freshness">
        <span className="muted body-text">
          {at
            ? `Checked against Home Assistant at ${at}. This does not update on its own.`
            : "Checked when this dialog opened. This does not update on its own."}
        </span>
        <button className="btn ghost" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{busy ? "Checking…" : "Check again"}</span>
        </button>
      </div>

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
