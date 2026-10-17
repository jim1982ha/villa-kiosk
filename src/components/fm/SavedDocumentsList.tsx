// src/components/fm/SavedDocumentsList.tsx
// The saved documents of one kind — recaps, spend statements, readiness
// snapshots — under their tab: one renderer so "save, reopen, delete a
// generated document" reads and behaves identically on all three, each called
// by its own name (monthlyDocument.DOCUMENT_KINDS: snapshots were listed as
// "statements" until 2.496.403).

import { Eye, Trash2 } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { localStamp } from "@/fm/fmEngine";

import { monthLabel } from "@/fm/fmEngine";
import { DOCUMENT_KINDS } from "@/fm/monthlyDocument";
import type { FmSavedDocument } from "@/fm/fmTypes";
import AgentMark from "./AgentMark";
import RecordMeta from "./RecordMeta";

export default function SavedDocumentsList({
  kind, onOpen,
}: {
  kind: FmSavedDocument["kind"];
  /** Load a saved document back into the tab's own preview/markdown state. */
  onOpen: (doc: FmSavedDocument) => void;
}) {
  const { data, removeDocument } = useFmData();
  return <SavedDocumentRows kind={kind} docs={data.savedDocuments} onOpen={onOpen} onRemove={(id) => void removeDocument(id)} />;
}

/** The list itself, from the saved documents given (every kind; this one's are shown, newest first). Drawn by
 *  tests/oracles/monthly_documents.mjs. */
export function SavedDocumentRows({ kind, docs: all, onOpen, onRemove }: {
  kind: FmSavedDocument["kind"];
  docs: FmSavedDocument[];
  onOpen: (doc: FmSavedDocument) => void;
  onRemove: (id: string) => void;
}) {
  const docs = all
    .filter((d) => d.kind === kind)
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));

  if (docs.length === 0) return null;

  const { noun, plural } = DOCUMENT_KINDS[kind];

  return (
    <div className="fm-stack">
      <div className="fm-row-sub muted" style={{ marginTop: 4 }}>
        Saved {plural} ({docs.length})
      </div>
      <div className="fm-list">
        {docs.map((doc) => (
          <div key={doc.id} className="fm-row">
            <div className="fm-row-main">
              <div className="fm-row-title">
                <strong>{monthLabel(doc.month)}</strong>
              </div>
              <RecordMeta when={`Saved ${localStamp(doc.generatedAt)}`}>
                <AgentMark record={doc} />
              </RecordMeta>
            </div>
            <button className="btn ghost" onClick={() => onOpen(doc)}>
              <Eye size={16} /> Reopen
            </button>
            <button
              className="icon-btn"
              onClick={() => onRemove(doc.id)}
              aria-label={`Delete saved ${noun} for ${monthLabel(doc.month)}`}
              title={`Delete this saved ${noun}`}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
