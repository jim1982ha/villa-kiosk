// src/components/fm/SavedDocumentsList.tsx
// The saved-reports / saved-statements list shown under both ReportTab and
// SpendTab — one renderer so "save, reopen, delete a generated document"
// reads and behaves identically in both places instead of two bespoke lists
// that could drift apart.

import { Eye, Trash2 } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { localStamp } from "@/fm/fmEngine";
import { monthLabel } from "@/fm/fmReport";
import type { FmSavedDocument } from "@/fm/fmTypes";

export default function SavedDocumentsList({
  kind, onOpen,
}: {
  kind: FmSavedDocument["kind"];
  /** Load a saved document back into the tab's own preview/markdown state. */
  onOpen: (doc: FmSavedDocument) => void;
}) {
  const { data, removeDocument } = useFmData();
  const docs = data.savedDocuments
    .filter((d) => d.kind === kind)
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));

  if (docs.length === 0) return null;

  const noun = kind === "report" ? "reports" : "statements";

  return (
    <div className="fm-stack">
      <div className="fm-row-sub muted" style={{ marginTop: 4 }}>
        Saved {noun} ({docs.length})
      </div>
      <div className="fm-list">
        {docs.map((doc) => (
          <div key={doc.id} className="fm-row">
            <div className="fm-row-main">
              <div className="fm-row-title"><strong>{monthLabel(doc.month)}</strong></div>
              <div className="fm-row-sub muted">Saved {localStamp(doc.generatedAt)}</div>
            </div>
            <button className="btn ghost" onClick={() => onOpen(doc)}>
              <Eye size={16} /> Reopen
            </button>
            <button
              className="icon-btn"
              onClick={() => void removeDocument(doc.id)}
              aria-label={`Delete saved ${kind === "report" ? "report" : "statement"} for ${monthLabel(doc.month)}`}
              title="Delete this saved document"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
