// src/components/reports/PreviewTab.tsx
// Compose a report and read it, before deciding to receive them.
//
// ⚠️ THIS TAB IS WHY THE `preview` FLAG EXISTS. "Enable it and see what
// arrives" means finding out that a module is noisy on somebody's phone, at
// whatever hour the schedule fires. A preview composes everything, sends
// nothing and records nothing.

import { FileText, Loader2 } from "lucide-react";
import type { ReportPreview } from "@/reports/reportsApi";

export default function PreviewTab({
  preview, busy, onCompose,
}: {
  preview: ReportPreview | null;
  busy: boolean;
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
        </>
      )}
    </div>
  );
}
