// src/components/fm/SavedDocumentsList.tsx
// The saved documents of one kind — recaps, spend statements, readiness
// snapshots — under their tab: one renderer so "save, reopen, delete a
// generated document" reads and behaves identically on all three, each called
// by its own name (monthlyDocument.DOCUMENT_KINDS: snapshots were listed as
// "statements" until 2.496.403).

import { Eye, Trash2 } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { localStamp } from "@/fm/fmEngine";
import { DOCUMENT_KINDS } from "@/fm/monthlyDocument";
import type { FmSavedDocument } from "@/fm/fmTypes";
import AgentMark from "./AgentMark";
import Tip from "@/components/common/Tip";
import RecordCard from "./RecordCard";

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

  // each titled by what it is about: its month, or the moment it was taken (DOCUMENT_KINDS[kind].title)
  const { noun, plural, title } = DOCUMENT_KINDS[kind];

  return (
    <div className="fm-stack">
      <div className="fm-row-sub muted" style={{ marginTop: 4 }}>
        Saved {plural} ({docs.length})
      </div>
      <div className="fm-list">
        {docs.map((doc) => (
          // THE Cockpit card (RecordCard), as every list (owner, 2026-10-22)
          <RecordCard key={doc.id} title={title(doc)} when={`Saved ${localStamp(doc.generatedAt)}`}
            pills={<AgentMark record={doc} />}
            actions={<>
              <button className="btn ghost" onClick={() => onOpen(doc)}>
                <Eye size={16} /> Reopen
              </button>
              <Tip text={`Delete this saved ${noun}`}>
                <button className="icon-btn" onClick={() => onRemove(doc.id)} aria-label={`Delete saved ${noun} for ${title(doc)}`}>
                  <Trash2 size={16} />
                </button>
              </Tip>
            </>} />
        ))}
      </div>
    </div>
  );
}
