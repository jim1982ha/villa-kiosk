// src/components/fm/RecordCard.tsx
// THE card of a Facility record — a ticket, a closed ticket, a piece of scheduled work (owner, 2026-10-14: "the same
// style as any other closed card, fully re-using the same code"). Its title with a status pill, the line of pills and
// when, its notes, photos and reports, a cost on the right, and its buttons on the right of its text, inside the card.
// Tapping it opens it (`onOpen`); holding it erases it (ErasableRow, superadmin).
//
// `framed`: a card of its own (the default) — or a record inside a card holding several (a ticket taken on for several
// faults of one device: TicketsTab draws the frame).

import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import ErasableRow from "./ErasableRow";
import EvidenceRow from "./EvidenceRow";
import RecordMeta, { RecordNotes } from "./RecordMeta";
import { documentUrl } from "@/fm/fmApi";

export interface RecordCardProps {
  title: ReactNode;
  status?: { text: string; tone: "ok" | "due-soon" };
  /** The pills before `when` (room, device chip, "by VESTA Agent"…). */
  pills?: ReactNode;
  when?: ReactNode;
  notes?: (string | undefined | null)[];
  photoIds?: string[];
  documentIds?: string[];
  /** A cost, formatted, at the right of the text. */
  amount?: string;
  actions?: ReactNode;
  erase: { title: string; detail: string; run: (token: string) => Promise<unknown> };
  onOpen?: () => void;
  framed?: boolean;
}

export default function RecordCard({ title, status, pills, when, notes, photoIds, documentIds, amount, actions, erase,
  onOpen, framed = true }: RecordCardProps) {
  const record = (
    <ErasableRow className="fm-record" intent={{ title: erase.title, detail: erase.detail }}
      erase={(token) => erase.run(token)} onOpen={onOpen}>
      <div className="fm-record-head">
        <div className="fm-row-title"><strong>{title}</strong></div>
        {status && <span className={`fm-badge ${status.tone}`}>{status.text}</span>}
      </div>
      {/* its text on the left, its cost and buttons on the right of it, inside the card (owner, 2026-10-14) */}
      <div className="fm-record-body">
        <div className="fm-row-main">
          <RecordMeta when={when}>{pills}</RecordMeta>
          <RecordNotes notes={notes ?? []} />
          {(photoIds?.length ?? 0) > 0 && <EvidenceRow photoIds={photoIds!} disabled />}
          {/* a report kept with it (the VESTA Agent's investigation): opens on the iPad, offline */}
          {(documentIds?.length ?? 0) > 0 && (
            <div className="fm-documents">
              {documentIds!.map((id, i) => (
                <a key={id} className="fm-document-link" href={documentUrl(id)} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}>
                  <FileText size={15} aria-hidden="true" />
                  {documentIds!.length > 1 ? `Investigation report ${i + 1}` : "Investigation report"}
                </a>
              ))}
            </div>
          )}
        </div>
        {amount && <span className="fm-amount">{amount}</span>}
        {/* a press on a button is the button's: never the card's hold-to-erase, never its tap-to-open */}
        {actions && <div className="fm-record-actions" onPointerDown={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
    </ErasableRow>
  );
  return framed ? <div className="fm-record-card">{record}</div> : record;
}
