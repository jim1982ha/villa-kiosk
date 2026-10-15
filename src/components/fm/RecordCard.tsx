// src/components/fm/RecordCard.tsx
// THE card of every Cockpit list — an open issue on the Overview, a ticket, a closed ticket, a scheduled task, a spend
// line, a piece of work done (owner, 2026-10-14/15: "the same style as any other card, fully re-using the same code").
// Its title with a status pill (and a line under it: the room), the line of pills and when, its notes, photos and
// reports — or its own lines (`body`: the Overview's problems) — a cost on the right, and its buttons on the right of
// its text, inside the card. Tapping it opens it (`onOpen`); holding it erases it when it can be erased (`erase`:
// ErasableRow, superadmin) — a scheduled task is removed with its own bin instead.
//
// ⚠️ ONE CARD, NOT FOUR (architecture review, 2026-10-15): the Overview, Schedule and Spend each drew their own, so a
// layout request ("buttons inside, on the right", "a note never runs out of the card") was made up to four times.
//
// `framed`: a card of its own (the default) — or a record inside a card holding several (a ticket taken on for several
// faults of one device: TicketsTab draws the frame). `lead`: what stands before the title (the Overview's source
// icons); `trailing`: after the pill (its chevron), `aside` under it; `tone`: the card's own tint (a task overdue).

import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import ErasableRow from "./ErasableRow";
import EvidenceRow from "./EvidenceRow";
import RecordMeta, { RecordNotes } from "./RecordMeta";
import { documentUrl } from "@/fm/fmApi";

export interface RecordCardProps {
  title: ReactNode;
  /** Its status pill: `tone` is the badge's colour class (ok, due-soon, overdue, never…). */
  status?: { text: string; tone: string };
  subtitle?: ReactNode;
  lead?: ReactNode;
  trailing?: ReactNode;
  /** A short line at the right, under `trailing` — on the room's line (the Overview's "Next check", owner 2026-10-15). */
  aside?: ReactNode;
  /** The pills before `when` (room, device chip, "by VESTA Agent"…). */
  pills?: ReactNode;
  when?: ReactNode;
  notes?: (string | undefined | null)[];
  /** Lines of its own, in place of the pills/when/notes block (the Overview's problems). */
  body?: ReactNode;
  photoIds?: string[];
  documentIds?: string[];
  /** A cost, formatted, at the right of the text. */
  amount?: string;
  actions?: ReactNode;
  erase?: { title: string; detail: string; run: (token: string) => Promise<unknown> };
  onOpen?: () => void;
  framed?: boolean;
  /** The frame's tint: "state-overdue", "state-due-soon"… */
  tone?: string;
}

export default function RecordCard({ title, status, subtitle, lead, trailing, aside, pills, when, notes, body, photoIds,
  documentIds, amount, actions, erase, onOpen, framed = true, tone }: RecordCardProps) {
  const inside = (
    <>
      <div className="fm-record-head">
        {lead && <span className="fm-record-lead">{lead}</span>}
        <div className="fm-row-title">
          <strong>{title}</strong>
          {subtitle && <span className="fm-record-subtitle muted">{subtitle}</span>}
        </div>
        {status && <span className={`fm-badge ${status.tone}`}>{status.text}</span>}
        {aside ? (
          <span className="fm-record-side">{trailing}<span className="fm-record-aside muted">{aside}</span></span>
        ) : trailing}
      </div>
      {/* its text on the left, its cost and buttons on the right of it, inside the card (owner, 2026-10-14) */}
      <div className="fm-record-body">
        <div className="fm-row-main">
          {body ?? (
            <>
              <RecordMeta when={when}>{pills}</RecordMeta>
              <RecordNotes notes={notes ?? []} />
            </>
          )}
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
        {actions && (
          <div className="fm-record-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
    </>
  );
  const record = erase ? (
    <ErasableRow className="fm-record" intent={{ title: erase.title, detail: erase.detail }}
      erase={(token) => erase.run(token)} onOpen={onOpen}>
      {inside}
    </ErasableRow>
  ) : (
    // nothing to erase by holding it: the same card, tapped to open (a button for the keyboard and screen readers)
    <div className={`fm-row fm-record${onOpen ? " fm-openable" : ""}`} tabIndex={onOpen ? 0 : undefined}
      role={onOpen ? "button" : undefined}
      onClick={onOpen ? (e) => { if (!(e.target as HTMLElement).closest("button,a,input,select,textarea")) onOpen(); } : undefined}
      onKeyDown={onOpen ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } } : undefined}>
      {inside}
    </div>
  );
  return framed ? <div className={`fm-record-card${tone ? ` ${tone}` : ""}`}>{record}</div> : record;
}
