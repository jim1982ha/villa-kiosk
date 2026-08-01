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

import { useState } from "react";
import { Plus, Wrench } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { displayLabelFor } from "@/config/EntityMap";
import { isUnavailable } from "@/utils/stateColors";
import { useFmData } from "@/fm/FmDataContext";
import { localStamp, ticketStats } from "@/fm/fmEngine";
import type { FmTicketStatus } from "@/fm/fmTypes";
import EvidenceRow from "./EvidenceRow";
import DeviceSearchPicker, { buildDeviceOptions } from "./DeviceSearchPicker";

const NEXT: Record<FmTicketStatus, FmTicketStatus | null> = {
  open: "in_progress", in_progress: "resolved", resolved: null,
};
const LABEL: Record<FmTicketStatus, string> = {
  open: "Open", in_progress: "In progress", resolved: "Resolved",
};

export default function FaultsTab({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const { data, addTicket, updateTicket } = useFmData();
  const { entities } = useHA();
  const { config } = useConfig();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [deviceText, setDeviceText] = useState("");
  const [entityId, setEntityId] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);

  const resetForm = () => {
    setAdding(false); setTitle(""); setDeviceText(""); setEntityId(""); setPhotoIds([]);
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
  const broken = Object.keys(config.entityMap)
    .filter((id) => !config.entityMap[id]?.disabled && isUnavailable(entities[id]) && !ticketed.has(id));

  const label = (id: string) =>
    displayLabelFor(id, config.entityMap[id]?.label, entities[id]?.attributes.friendly_name);

  const deviceOptions = buildDeviceOptions(config.entityMap, entities);

  // One selection, two entry points (the offline shortlist and the search
  // box) — both write here, so picking one never leaves the other showing a
  // stale answer.
  const selectDevice = (id: string, name: string) => {
    setEntityId(id); setDeviceText(name);
    if (!title) setTitle(`${name} offline`);
  };
  const clearDevice = () => { setEntityId(""); setDeviceText(""); };

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
          <h3>Raise a fault</h3>
          {broken.length > 0 && (
            <div className="fm-field">
              <span>Devices Home Assistant reports as offline</span>
              <div className="fm-chiprow">
                {broken.slice(0, 10).map((id) => (
                  <button
                    key={id}
                    className={`fm-entity-chip${entityId === id ? " on" : ""}`}
                    // Second click on the SAME chip un-selects it — the
                    // original bug was that this only ever selected, so once
                    // clicked a chip could never be released again.
                    onClick={() => (entityId === id ? clearDevice() : selectDevice(id, label(id)))}
                  >{label(id)}</button>
                ))}
              </div>
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
                await addTicket({
                  title: title.trim(),
                  entityId: entityId || undefined,
                  deviceLabel: deviceText.trim() || undefined,
                  room: entityId ? config.entityMap[entityId]?.room : undefined,
                  photoIds,
                });
                resetForm();
              }}
            >Raise fault</button>
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
          <div key={t.id} className={`fm-row state-${t.status === "resolved" ? "ok" : t.status === "open" ? "overdue" : "due-soon"}`}>
            <div className="fm-row-main">
              <div className="fm-row-title">
                <strong>{t.title}</strong>
                {t.room && <span className="fm-clause">{t.room}</span>}
              </div>
              <div className="fm-row-sub muted">
                Opened {localStamp(t.openedAt)}
                {t.resolvedAt && ` · resolved ${localStamp(t.resolvedAt)}`}
                {t.photoIds.length > 0 && ` · ${t.photoIds.length} photo(s)`}
              </div>
              {(t.entityId || t.deviceLabel) && (
                <div className="fm-chiprow">
                  {t.entityId ? (
                    <button className="fm-entity-chip" onClick={() => onOpenEntity(t.entityId!)}>
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
              <button className="btn ghost" onClick={() => void updateTicket(t.id, { status: NEXT[t.status]! })}>
                Mark {LABEL[NEXT[t.status]!].toLowerCase()}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
