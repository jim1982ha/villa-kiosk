// src/components/fm/GuestReportModal.tsx
// "Something's broken" — the whole fault pipeline, for a guest.
//
// A guest is the person most likely to NOTICE a fault: they are the one
// standing in the room when the air-conditioner starts rattling. Until this
// existed, the only way that reached the maintenance record was if they
// happened to mention it to someone. The Facility workspace is not the answer
// — six tabs of schedules, spend and status is not a guest's screen, and they
// hold none of the permissions it assumes.
//
// So this is deliberately one screen and three fields: what is broken, which
// device (already filled in when they came from tapping its badge), and an
// optional photo. It files an ordinary fault ticket, flagged `reportedBy:
// "guest"` so whoever triages it knows they are reading a symptom reported
// from inside the villa, not a diagnosis.
//
// The guest cannot touch it afterwards, by design and by server rule (see
// _fm_guest_write_ok): no status, no cost, no editing a filed report. That is
// also why this screen never lists existing tickets — a guest seeing the
// villa's whole fault history, including what it cost to fix things, is not
// something a report button should hand out.

import { useState } from "react";
import { Camera, Check, Wrench, X } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useFmData } from "@/fm/FmDataContext";
import { uploadEvidence } from "@/fm/fmApi";
import NotesField from "./NotesField";

export default function GuestReportModal({
  entityId, onClose,
}: {
  /** Device the report is about, when the guest came from its panel. */
  entityId?: string;
  onClose: () => void;
}) {
  const { addTicket } = useFmData();
  const { resolvedRooms } = useConfig();
  const label = useEntityLabel();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const deviceLabel = entityId ? label(entityId) : undefined;

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setPhotoError(null);
    try {
      const added: string[] = [];
      for (const file of Array.from(files)) added.push(await uploadEvidence(file));
      setPhotoIds((prev) => [...prev, ...added]);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Couldn't attach that photo.");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    await addTicket({
      title: title.trim(),
      entityId,
      deviceLabel,
      room: entityId ? resolvedRooms[entityId] : undefined,
      note: note.trim() || undefined,
      photoIds,
      reportedBy: "guest",
    });
    setBusy(false);
    setSent(true);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal guest-report" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Wrench size={18} /> Report a problem</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {sent ? (
          // A confirmation, not a silent close: the guest has no way to check
          // afterwards (they can't see the fault list), so the only proof they
          // get that it worked is this.
          <div className="guest-report-done">
            <Check size={28} />
            <h3>Thank you — that&apos;s been reported.</h3>
            <p className="muted body-text">
              Whoever looks after this villa can see it now. You don&apos;t need
              to do anything else.
            </p>
            <button className="btn primary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <div className="modal-body fm-stack">
              {deviceLabel && (
                <div className="fm-field">
                  <span>Device</span>
                  <div className="fm-chiprow">
                    <span className="fm-entity-chip" style={{ cursor: "default" }} title={entityId}>
                      {deviceLabel}
                    </span>
                  </div>
                </div>
              )}
              <label className="fm-field">
                <span>What&apos;s wrong?</span>
                {/* One line, same as the operator form's summary: this becomes
                    the fault's headline in the work queue. Anything longer
                    belongs in the details below, where it won't be truncated
                    in a list. */}
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={deviceLabel
                    ? "e.g. Makes a loud rattling noise"
                    : "e.g. The tap in the downstairs bathroom drips"}
                />
              </label>
              <NotesField
                label="Anything else worth knowing? (optional)"
                value={note}
                onChange={setNote}
                placeholder="When it started, how often it happens, anything you've already tried…"
              />
              <div className="fm-field">
                <span>Photo (optional)</span>
                {/* No thumbnail: evidence photos are readable by the owner and
                    facility manager only (a deliberate access decision), so a
                    guest cannot be shown the picture back. A count and a way
                    to undo is what is honestly available here. */}
                <div className="fm-chiprow">
                  <label className="btn ghost" style={{ cursor: "pointer" }}>
                    <Camera size={16} /> {photoIds.length ? "Add another" : "Add a photo"}
                    <input type="file" accept="image/*" capture="environment" multiple hidden
                      onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} />
                  </label>
                  {photoIds.length > 0 && (
                    <button className="btn ghost" onClick={() => setPhotoIds([])}>
                      {photoIds.length} attached — remove
                    </button>
                  )}
                </div>
                {photoError && <div className="fm-inline-error">{photoError}</div>}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={!title.trim() || busy}
                onClick={() => void send()}>
                {busy ? "Sending…" : "Send report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
