// src/components/fm/SavedDocumentsList.tsx
// The saved documents of one kind — recaps, spend statements, readiness
// snapshots — under their tab: one renderer so "save, reopen, delete a
// generated document" reads and behaves identically on all three, each called
// by its own name (monthlyDocument.DOCUMENT_KINDS: snapshots were listed as
// "statements" until 2.496.403).

import { momentText } from "@/utils/dateText";
import { Eye } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";

import { DOCUMENT_KINDS } from "@/fm/monthlyDocument";
import type { FmSavedDocument } from "@/fm/fmTypes";
import AgentMark from "./AgentMark";
import { Pager, usePaged, PAGE_CARDS } from "@/components/common/Paged";
import RecordCard from "./RecordCard";
import { withCount } from "@/utils/countBadge";

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
  // ten a page, as every long list (the count is the title's)
  const paged = usePaged(docs, PAGE_CARDS);

  if (docs.length === 0) return null;

  // each titled by what it is about: its month, or the moment it was taken (DOCUMENT_KINDS[kind].title)
  const { noun, plural, title, about } = DOCUMENT_KINDS[kind];
  // ⚠️ ITS MOMENT ONCE (owner, 2026-11-05: a snapshot's card said "05/11/2026 14:02" in its band and "Saved 05/11/2026
  // 14:02" beside it): a document titled by the moment it was taken says no "Saved"; one about a month says when saved
  const saved = (doc: FmSavedDocument) => (about === "moment" ? undefined : `Saved ${momentText(doc.generatedAt)}`);

  return (
    <div className="fm-stack">
      <div className="fm-row-sub muted" style={{ marginTop: 4 }}>
        {withCount(`Saved ${plural}`, docs.length)}
      </div>
      <div className="fm-list">
        {paged.page.map((doc) => (
          // THE Cockpit card (RecordCard), as every list (owner, 2026-10-22)
          <RecordCard key={doc.id} title={title(doc)} when={saved(doc)}
            pills={<AgentMark record={doc} />}
            bin={{ label: `Delete saved ${noun} for ${title(doc)}`, question: `Delete this saved ${noun}?`,
              confirmLabel: "Delete", run: () => onRemove(doc.id) }}
            actions={
              <button className="btn ghost" onClick={() => onOpen(doc)}>
                <Eye size={16} /> Reopen
              </button>
            } />
        ))}
      </div>
      <Pager paged={paged} />
    </div>
  );
}
