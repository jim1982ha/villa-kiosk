// src/components/fm/FaultsTab.tsx
// The fault work queue — evidence of maintenance inspection and supervision.
// Time-to-resolution is what actually evidences supervision, so the app
// stamps the resolution time itself rather than asking for it.
//
// New faults can be raised straight from a device that Home Assistant reports
// as unavailable, which is the common case: the villa already knows what is
// broken, so the operator shouldn't have to retype it. For anything else,
// DeviceSearchPicker reaches every configured device (not just the offline
// shortlist), with free text for a device that isn't in the villa's list at
// all — a spare part, or something not yet wired into Home Assistant.

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Wrench } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useFmData, fmSaveOutcome } from "@/fm/FmDataContext";
import { isTicketOpen, isTicketResolved, localStamp, ticketStats, ticketRank, TICKET_NEXT } from "@/fm/fmEngine";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";
import EvidenceRow from "./EvidenceRow";
import ErasableRow from "./ErasableRow";
import FaultStageModal from "./FaultStageModal";
import NotesField from "./NotesField";
import DeviceSearchPicker, { type DeviceOption } from "./DeviceSearchPicker";
import AgentMark from "./AgentMark";
import InlineConfirm from "@/components/common/InlineConfirm";

/** Read-only evidence strips never call back — a stable identity keeps the
 *  memoised row from re-rendering on every parent update. */
const LABEL: Record<FmTicketStatus, string> = {
  open: "Open", in_progress: "In progress", resolved: "Resolved",
};

export default function FaultsTab(
  { onOpenEntity, unavailableIds, deviceOptions, reportFaultFor, onFaultFormOpened }: {
    onOpenEntity: (id: string) => void;
    /** Computed once by FacilityModal via unavailableDeviceIds and passed in,
     *  rather than recomputed here — this tab used to derive its own
     *  "broken devices" shortlist straight off entityMap, which meant no
     *  device folding, no config-debris filtering and no dismissals: the
     *  same device could be one row on the HUD badge and two here, and an
     *  entity the owner had explicitly removed still showed up. */
    unavailableIds: string[];
    /** The villa's real devices, built once by FacilityModal — same reason as
     *  unavailableIds above. Deriving it here would give this tab its own
     *  answer to "what is a device", which is how the picker came to list
     *  entries no other screen showed. */
    deviceOptions: DeviceOption[];
    /** Open the form pre-pointed at this device (see FacilityModal). */
    reportFaultFor?: string;
    onFaultFormOpened?: () => void;
  },
) {
  const { data, addTicket, updateTicket, removeTicket, closeTicket } = useFmData();
  const { resolvedRooms } = useConfig();
  const [adding, setAdding] = useState(false);
  /** Id of the fault being edited, or null when the form is raising a new one.
   *  ONE form serves both: a fault raised in a hurry from a phone (often just
   *  a device and four words) is exactly the record someone later needs to
   *  correct or add photos to, and a second, subtly different edit form is how
   *  the two drift apart. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [deviceText, setDeviceText] = useState("");
  const [entityId, setEntityId] = useState("");
  const [note, setNote] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  /** The fault whose stage change is being recorded, and where it's going. */
  const [staging, setStaging] = useState<{ ticket: FmTicket; to: FmTicketStatus } | null>(null);
  const [showBroken, setShowBroken] = useState(false);
  /** The fault whose one-step close ("no action needed") is being confirmed,
   *  and the reason the last close did not land. */
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<{ id: string; text: string } | null>(null);
  /** Why the last raise/edit was refused — the form keeps what was typed. */
  const [formError, setFormError] = useState<string | null>(null);

  const closeNoAction = async (id: string) => {
    setCloseError(null);
    const { done, note: why } = fmSaveOutcome(await closeTicket(id));
    setClosingId(null);
    if (!done && why) setCloseError({ id, text: why });
  };

  const resetForm = () => {
    setFormError(null);
    setAdding(false); setEditingId(null);
    setTitle(""); setDeviceText(""); setEntityId(""); setNote(""); setPhotoIds([]);
  };

  const openEditor = (t: FmTicket) => {
    setEditingId(t.id);
    setAdding(true);
    setTitle(t.title);
    setEntityId(t.entityId ?? "");
    setDeviceText(t.deviceLabel ?? (t.entityId ? label(t.entityId) : ""));
    setNote(t.note ?? "");
    setPhotoIds(t.photoIds);
  };

  const stats = ticketStats(data.tickets);
  // Rank and transitions are the engine's (fmEngine.ticketRank / TICKET_NEXT).
  const openFirst = [...data.tickets].sort((a, b) =>
    ticketRank(a) - ticketRank(b) || Date.parse(b.openedAt) - Date.parse(a.openedAt));

  // Devices HA currently reports as unavailable that don't already have an open
  // ticket — the "raise this" shortlist.
  const ticketed = new Set(data.tickets.filter(isTicketOpen)
    .map((t) => t.entityId).filter(Boolean));
  const broken = unavailableIds.filter((id) => !ticketed.has(id));

  const label = useEntityLabel();


  // One selection, two entry points (the offline shortlist and the search
  // box) — both write here, so picking one never leaves the other showing a
  // stale answer.
  const selectDevice = (id: string, name: string) => {
    setEntityId(id); setDeviceText(name);
    if (!title) setTitle(`${name} offline`);
  };
  const clearDevice = () => { setEntityId(""); setDeviceText(""); };

  // Arrived from a device panel's fault shortcut: open the form with that
  // device already chosen. Runs once per request — the parent clears it — so
  // it can never fight the operator's own edits afterwards. The title is left
  // EMPTY on purpose: selectDevice's "<device> offline" guess is right for a
  // device HA reports as down, but someone reporting a fault by hand is
  // usually describing something HA cannot see at all (a dripping tap, a
  // cracked panel), and a pre-written wrong title tends to get saved as-is.
  useEffect(() => {
    if (!reportFaultFor) return;
    setAdding(true);
    setEditingId(null);
    setEntityId(reportFaultFor);
    setDeviceText(label(reportFaultFor));
    setTitle("");
    setNote("");
    setPhotoIds([]);
    onFaultFormOpened?.();
    // label() reads live config/entities; re-running on those would re-open
    // the form mid-edit. The request id is the only trigger that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportFaultFor]);

  return (
    <div className="fm-stack">
      <div className="fm-summary">
        <div className={`fm-stat ${stats.open ? "bad" : "good"}`}>
          <span className="n">{stats.open}</span><span className="l">open</span>
        </div>
        <div className="fm-stat"><span className="n">{stats.inProgress}</span><span className="l">in progress</span></div>
        <div className="fm-stat">
          <span className="n">
            {stats.meanResolutionHours === null ? "—" : `${stats.meanResolutionHours.toFixed(0)}h`}
          </span>
          <span className="l">mean resolution</span>
        </div>
      </div>

      {!adding && (
        <button className="btn ghost" onClick={() => setAdding(true)} style={{ alignSelf: "flex-start" }}>
          <Plus size={16} /> Raise a fault
        </button>
      )}

      {adding && (
        <div className="fm-form">
          <h3>{editingId ? "Edit fault" : "Raise a fault"}</h3>
          {/* Collapsed by default. It is a useful shortcut when the fault
              you're raising IS one of these, and pure noise otherwise — and
              on a phone an expanded list of ten chips pushed the description
              field, the one thing every fault needs, below the fold. */}
          {broken.length > 0 && !editingId && (
            <div className="fm-field">
              <button
                type="button"
                className="fm-disclosure"
                onClick={() => setShowBroken((v) => !v)}
                aria-expanded={showBroken}
              >
                {showBroken ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                Devices Home Assistant reports as offline ({broken.length})
              </button>
              {/* Rendered conditionally rather than hidden: `.fm-chiprow`
                  sets `display: flex`, and an explicit display beats the
                  browser's own `[hidden] { display: none }` — so the chips
                  stayed visible with only the chevron changing. */}
              {showBroken && <div className="fm-chiprow">
                {broken.slice(0, 10).map((id) => (
                  <button
                    key={id}
                    className={`fm-entity-chip${entityId === id ? " on" : ""}`}
                    // The chip shows a friendly name; the entity_id is what
                    // identifies the device. Same reason the search rows
                    // carry it — a label alone can name nothing findable.
                    title={id}
                    // Second click on the SAME chip un-selects it — the
                    // original bug was that this only ever selected, so once
                    // clicked a chip could never be released again.
                    onClick={() => (entityId === id ? clearDevice() : selectDevice(id, label(id)))}
                  >{label(id)}</button>
                ))}
              </div>}
            </div>
          )}
          <div className="fm-field">
            <span>Device (search, or type one not listed)</span>
            <DeviceSearchPicker
              value={deviceText}
              options={deviceOptions}
              matchedEntityId={entityId || undefined}
              onChangeText={(text) => { setDeviceText(text); setEntityId(""); }}
              onSelect={(opt) => selectDevice(opt.entityId, opt.label)}
              onClear={clearDevice}
            />
          </div>
          <label className="fm-field">
            <span>Summary</span>
            {/* Deliberately one line: this is the fault's headline — the card
                title, the report row, the thing someone scans a list for. The
                account of what is actually wrong belongs below. */}
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Pool pump not starting" />
          </label>
          <NotesField
            label="Details (optional)"
            value={note}
            onChange={setNote}
            placeholder="What exactly happens, when it started, anything already tried…"
            rows={3}
          />
          <div className="fm-field">
            <span>Photo evidence</span>
            <EvidenceRow photoIds={photoIds} onChange={setPhotoIds} />
          </div>
          {formError && <div className="fm-inline-error" role="alert">{formError}</div>}
          <div className="modal-actions" style={{ marginTop: 8 }}>
            <button className="btn ghost" onClick={resetForm}>Cancel</button>
            <button
              className="btn primary"
              disabled={!title.trim()}
              onClick={async () => {
                const fields = {
                  title: title.trim(),
                  entityId: entityId || undefined,
                  deviceLabel: deviceText.trim() || undefined,
                  room: entityId ? resolvedRooms[entityId] : undefined,
                  note: note.trim() || undefined,
                  photoIds,
                };
                // Same fields either way — updateTicket leaves status,
                // openedAt and resolvedAt alone, so correcting a description
                // never rewrites the fault's history.
                const { done, note: why } = fmSaveOutcome(
                  editingId ? await updateTicket(editingId, fields) : await addTicket(fields));
                // Empty the form only when saved or queued: a refused save
                // used to throw away what was typed (2.496.252).
                if (done) resetForm(); else setFormError(why);
              }}
            >{editingId ? "Save changes" : "Raise fault"}</button>
          </div>
        </div>
      )}

      {openFirst.length === 0 && !adding && (
        <div className="fm-empty">
          <Wrench size={28} />
          <h3>No faults recorded</h3>
          <p className="muted body-text">
            Raise one here, or from a device the villa already reports as offline.
          </p>
        </div>
      )}

      <div className="fm-list">
        {openFirst.map((t) => (
          <ErasableRow
            key={t.id}
            className={`fm-fault state-${isTicketResolved(t) ? "ok" : t.status === "open" ? "overdue" : "due-soon"}`}
            intent={{ title: "Erase this fault", detail: t.title }}
            erase={(token) => removeTicket(t.id, token)}
            onOpen={() => openEditor(t)}
          >
            {/* ⚠️ ONE CARD, THREE ROWS (owner, 2026-10-01: "the style of the cards
                is very bad"). The status pill and both buttons used to share
                the title's row, which squeezed a long title into a column six
                lines tall. Now: the title across the card with its status at
                the right; the record under it; the actions on a row of their
                own, at the right — or the close question in their place. */}
            <div className="fm-fault-head">
              <div className="fm-row-title">
                <strong>{t.title}</strong>
                {t.room && <span className="fm-clause">{t.room}</span>}
                {/* Read this row differently: a guest reports a symptom from
                    inside the villa, not a diagnosis. */}
                {t.reportedBy === "guest" && <span className="fm-clause guest">guest report</span>}
                <AgentMark record={t} />
              </div>
              <span className={`fm-badge ${isTicketResolved(t) ? "ok" : t.status === "open" ? "overdue" : "due-soon"}`}>
                {LABEL[t.status]}
              </span>
            </div>
            <div className="fm-row-main">
              <div className="fm-row-sub muted">
                Opened {localStamp(t.openedAt)}
                {t.resolvedAt && ` · resolved ${localStamp(t.resolvedAt)}`}
              </div>
              {/* The photos themselves, not a count of them. "3 photo(s)"
                  is a claim; a thumbnail you can open is the evidence. */}
              {t.note && <div className="fm-timeline-note">{t.note}</div>}
              {t.photoIds.length > 0 && (
                <EvidenceRow photoIds={t.photoIds} disabled />
              )}
              {/* The fault's own history. Rendered on the card rather than
                  behind another tap: "what has actually been done about this"
                  is the question anyone opening the Faults tab is asking.
                  A history of ONE plain "Open" entry only repeats "Opened …"
                  above, so it shows once something has happened. */}
              {(t.updates?.length ?? 0) > (t.updates?.[0]?.note || t.updates?.[0]?.photoIds?.length ? 0 : 1) && (
                <ol className="fm-timeline">
                  {t.updates!.map((u, i) => (
                    <li key={i}>
                      <span className={`fm-timeline-dot ${u.status}`} aria-hidden="true" />
                      <div>
                        <span className="fm-timeline-head">
                          {LABEL[u.status]}
                          <span className="muted"> · {localStamp(u.at)}{u.by ? ` · ${u.by}` : ""}</span>
                        </span>
                        {u.note && <div className="fm-timeline-note">{u.note}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {(t.entityId || t.deviceLabel) && (
                <div className="fm-chiprow">
                  {t.entityId ? (
                    <button className="fm-entity-chip" title={t.entityId}
                      onClick={(e) => { e.stopPropagation(); onOpenEntity(t.entityId!); }}>
                      {t.deviceLabel ?? label(t.entityId)}
                    </button>
                  ) : (
                    // Free-text device: nothing to open, so a plain (non-
                    // clickable) chip rather than a button that does nothing.
                    <span className="fm-entity-chip" style={{ cursor: "default" }}>
                      {t.deviceLabel}
                    </span>
                  )}
                </div>
              )}
            </div>
            {closingId !== t.id && (TICKET_NEXT[t.status] || !isTicketResolved(t)) && (
              <div className="fm-fault-actions">
                {TICKET_NEXT[t.status] && (
                  <button className="btn ghost"
                    // Never a bare status flip any more: every transition goes
                    // through the same dialog, so the record always carries who
                    // and what behind the change.
                    onClick={(e) => { e.stopPropagation(); setStaging({ ticket: t, to: TICKET_NEXT[t.status]! }); }}>
                    Mark {LABEL[TICKET_NEXT[t.status]!].toLowerCase()}
                  </button>
                )}
                {/* ⚠️ THE ONE-STEP CLOSE, BESIDE THE TWO-STEP FLOW, NOT INSTEAD
                    OF IT. Many faults are obsolete — raised automatically and
                    since gone away — and walking each through "in progress" and
                    a cost dialog recorded work nobody did. This one leaves
                    "Closed without action" on the history, and no completion or
                    cost (fmEngine.withTicketClosed). */}
                {!isTicketResolved(t) && (
                  <button className="btn ghost"
                    onClick={(e) => { e.stopPropagation(); setCloseError(null); setClosingId(t.id); }}>
                    Close — no action needed
                  </button>
                )}
              </div>
            )}
            {closingId === t.id && (
              <div className="fm-row-confirm">
                <InlineConfirm
                  question="Close this fault? Nothing was done — no cost is recorded."
                  confirmLabel="Close fault"
                  onConfirm={() => closeNoAction(t.id)}
                  onCancel={() => setClosingId(null)}
                />
              </div>
            )}
            {closeError?.id === t.id && (
              <div className="fm-inline-error fm-row-confirm" role="alert">{closeError.text}</div>
            )}
          </ErasableRow>
        ))}
      </div>

      {staging && (
        <FaultStageModal
          ticket={staging.ticket}
          to={staging.to}
          onClose={() => setStaging(null)}
        />
      )}
    </div>
  );
}
