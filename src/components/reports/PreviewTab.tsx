// src/components/reports/PreviewTab.tsx
// Compose a report and read it, before deciding to receive them.
//
// ⚠️ THIS TAB IS WHY THE `preview` FLAG EXISTS. "Enable it and see what
// arrives" means finding out that a module is noisy on somebody's phone, at
// whatever hour the schedule fires. A preview composes everything, sends
// nothing and records nothing.

import { FileText, Loader2 } from "lucide-react";
import type { ReportPreview } from "@/reports/reportsApi";
import type { NarrationMode } from "@/reports/reportsTypes";
import PayloadInspector from "./PayloadInspector";

export default function PreviewTab({
  preview, busy, narrationMode, onCompose,
}: {
  preview: ReportPreview | null;
  busy: boolean;
  /** ⚠️ SO THE INSPECTOR CAN LEAD WITH "NOTHING IS BEING TRANSMITTED" on the
   *  default setting. A payload panel with no such statement implies the data
   *  is leaving, which on every install that has not switched narration on is
   *  the opposite of the truth. */
  narrationMode: NarrationMode;
  onCompose: () => void;
}) {
  return (
    <div className="reports-pane">
      <p className="muted body-text">
        Composes the brief that would be sent, and sends nothing. Nothing is
        recorded in the history either — a delivery record for something that
        was not delivered is worse than no record.
      </p>

      <button className="btn primary" onClick={onCompose} disabled={busy}>
        {busy ? <Loader2 size={16} className="spin" /> : <FileText size={16} />}
        <span>{busy ? "Composing…" : "Compose a brief now"}</span>
      </button>

      {preview && (
        <>
          <h3 className="reports-h3">{preview.title}</h3>
          {/* ⚠️ PRE, NOT A PARAGRAPH. The renderer emits plain text with
              meaningful line breaks — `deliver.py` sends the intersection of
              what notify platforms accept — and reflowing it here would show
              the operator something different from what arrives on the phone. */}
          <pre className="reports-body">{preview.body}</pre>

          <dl className="reports-facts">
            <div><dt>Alerts read</dt><dd>{preview.analysis.aggregated.eventsSeen}</dd></div>
            <div><dt>Grouped into</dt><dd>{preview.analysis.aggregated.groups}</dd></div>
            <div><dt>Priced</dt><dd>{preview.analysis.aggregated.groupsPriced}</dd></div>
            <div><dt>Open incidents</dt><dd>{preview.analysis.aggregated.openIncidents}</dd></div>
            {preview.analysis.aggregated.eventsDropped > 0 && (
              <div>
                <dt>Unreadable</dt>
                <dd>{preview.analysis.aggregated.eventsDropped}</dd>
              </div>
            )}
          </dl>

          {/* ⚠️ AFTER THE BRIEF, NOT BEFORE IT. The plan puts this at the END
              of onboarding — read a real report from real data, THEN see
              exactly what would be transmitted, and only then decide. Leading
              with a JSON block would bury the thing the operator came to
              read. */}
          <PayloadInspector preview={preview} mode={narrationMode} />
        </>
      )}
    </div>
  );
}
