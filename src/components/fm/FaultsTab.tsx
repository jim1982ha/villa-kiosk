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
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { displayLabelFor } from "@/config/EntityMap";
import { useFmData } from "@/fm/FmDataContext";
import { localStamp, ticketStats } from "@/fm/fmEngine";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";
import EvidenceRow from "./EvidenceRow";
import ErasableRow from "./ErasableRow";
import FaultStageModal from "./FaultStageModal";
import DeviceSearchPicker, { type DeviceOption } from "./DeviceSearchPicker";

const NEXT: Record<FmTicketStatus, FmTicketStatus | null> = {
  open: "in_progress", in_progress: "resolved", resolved: null,
};
/** Read-only evidence strips never call back — a stable identity keeps the
 *  memoised row from re-rendering on every parent update. */
const NO_PHOTO_EDIT = () => {};

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
  const { data, addTicket, updateTicket, removeTicket } = useFmData();
  const { entities } = useHA();
  const { config } = useConfig();
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
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  /** The fault whose stage change is being recorded, and where it's going. */
  const [staging, setStaging] = useState<{ ticket: FmTicket; to: FmTicketStatus } | null>(null);
  const [showBroken, setShowBroken] = useState(false);

  const resetForm = () => {
    setAdding(false); setEditingId(null);
    setTitle(""); setDeviceText(""); setEntityId(""); setPhotoIds([]);
  };

  const openEditor = (t: FmTicket) => {
    setEditingId(t.id);
    setAdding(true);
    setTitle(t.title);
    setEntityId(t.entityId ?? "");
    setDeviceText(t.deviceLabel ?? (t.entityId ? label(t.entityId) : ""));
    setPhotoIds(t.photoIds);
  };

  const stats = ticketStats(data.tickets);
  const openFirst = [...data.tickets].sort((a, b) => {
    const rank = (s: FmTicketStatus) => (s === "open" ? 0 : s === "in_progress" ? 1 : 2);
    return rank(a.status) - rank(b.status) || Date.parse(b.openedAt) - Date.parse(a.openedAt);
  });

  // Devices HA currently reports as unavailable that don't already have an open
  // ticket — the "raise this" shortlist.
  const ticketed = new Set(data.tickets.filter((t) => t.status !== "resolved")
    .map((t) => t.entityId).filter(Boolean));
  const broken = unavailableIds.filter((id) => !ticketed.has(id));

  const label = (id: string) =>
    displayLabelFor(id, config.entityMap[id]?.label, entities[id]?.attributes.friendly_name);


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
                {showBroken ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
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
            <span>Describe the problem</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Pool pump not starting" />
          </label>
          <div className="fm-field">
            <span>Photo evidence</span>
            <EvidenceRow photoIds={photoIds} onChange={setPhotoIds} />
          </div>
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
                  room: entityId ? config.entityMap[entityId]?.room : undefined,
                  photoIds,
                };
                // Same fields either way — updateTicket leaves status,
                // openedAt and resolvedAt alone, so correcting a description
                // never rewrites the fault's history.
                if (editingId) await updateTicket(editingId, fields);
                else await addTicket(fields);
                resetForm();
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
            className={`state-${t.status === "resolved" ? "ok" : t.status === "open" ? "overdue" : "due-soon"}`}
            intent={{ title: "Erase this fault", detail: t.title }}
            erase={(token) => removeTicket(t.id, token)}
            onOpen={() => openEditor(t)}
          >
            <div className="fm-row-main">
              <div className="fm-row-title">
                <strong>{t.title}</strong>
                {t.room && <span className="fm-clause">{t.room}</span>}
                {/* Read this row differently: a guest reports a symptom from
                    inside the villa, not a diagnosis. */}
                {t.reportedBy === "guest" && <span className="fm-clause guest">guest report</span>}
              </div>
              <div className="fm-row-sub muted">
                Opened {localStamp(t.openedAt)}
                {t.resolvedAt && ` · resolved ${localStamp(t.resolvedAt)}`}
              </div>
              {/* The photos themselves, not a count of them. "3 photo(s)"
                  is a claim; a thumbnail you can open is the evidence. */}
              {t.photoIds.length > 0 && (
                <EvidenceRow photoIds={t.photoIds} onChange={NO_PHOTO_EDIT} disabled />
              )}
              {/* The fault's own history. Rendered on the card rather than
                  behind another tap: "what has actually been done about this"
                  is the question anyone opening the Faults tab is asking. */}
              {(t.updates?.length ?? 0) > 0 && (
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
            <span className={`fm-badge ${t.status === "resolved" ? "ok" : t.status === "open" ? "overdue" : "due-soon"}`}>
              {LABEL[t.status]}
            </span>
            {NEXT[t.status] && (
              <button className="btn ghost"
                // Never a bare status flip any more: every transition goes
                // through the same dialog, so the record always carries who
                // and what behind the change.
                onClick={(e) => { e.stopPropagation(); setStaging({ ticket: t, to: NEXT[t.status]! }); }}>
                Mark {LABEL[NEXT[t.status]!].toLowerCase()}
              </button>
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
