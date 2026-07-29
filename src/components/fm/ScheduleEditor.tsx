// src/components/fm/ScheduleEditor.tsx
// Add, edit and remove maintenance tasks.
//
// Every interval is editable, including the seeded ones: the built-in schedule
// is a sensible starting point drawn from a typical management agreement, not
// a fixed truth — a different villa, or a renegotiated contract, changes the
// numbers. Presets exist because "every 3 months" is how the obligation is
// actually written, and making someone convert that to 90 by hand is a step
// where mistakes get made.
//
// A task can bind to a room, which is what lets the villa map highlight where
// overdue work actually is.

import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useFmData } from "@/fm/FmDataContext";
import { scheduleStatus, shortDate } from "@/fm/fmEngine";
import type { FmSchedule } from "@/fm/fmTypes";

/** How the obligation is usually WRITTEN, mapped to days. Anything that isn't a
 *  whole number of days rounds DOWN (twice a week -> 3, not 4) so a genuinely
 *  late task can never read as compliant. */
const PRESETS: { label: string; days: number }[] = [
  { label: "Twice a week", days: 3 },
  { label: "Weekly", days: 7 },
  { label: "Twice a month", days: 15 },
  { label: "Monthly", days: 30 },
  { label: "Every 3 months", days: 90 },
  { label: "Every 6 months", days: 180 },
  { label: "Every 12 months", days: 365 },
];

type Draft = { title: string; clause: string; everyDays: string; room: string };

const EMPTY: Draft = { title: "", clause: "", everyDays: "90", room: "" };

function toDraft(s: FmSchedule): Draft {
  return {
    title: s.title,
    clause: s.clause ?? "",
    everyDays: String(s.everyDays),
    room: s.room ?? "",
  };
}

export default function ScheduleEditor() {
  const { data, addSchedule, updateSchedule, removeSchedule } = useFmData();
  const { config } = useConfig();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const rooms = [...new Set(
    config.teleportPoints.map((p) => p.name).filter(Boolean),
  )].sort();

  const days = Math.max(1, Number(draft.everyDays.replace(/[^\d]/g, "")) || 0);
  const valid = draft.title.trim().length > 0 && days >= 1;

  const startAdd = () => { setDraft(EMPTY); setEditingId(null); setAdding(true); };
  const startEdit = (s: FmSchedule) => { setDraft(toDraft(s)); setAdding(false); setEditingId(s.id); };
  const cancel = () => { setAdding(false); setEditingId(null); setDraft(EMPTY); };

  const save = async () => {
    const payload = {
      title: draft.title.trim(),
      clause: draft.clause.trim() || undefined,
      everyDays: days,
      room: draft.room || undefined,
      enabled: true,
    };
    if (editingId) await updateSchedule(editingId, payload);
    else await addSchedule(payload);
    cancel();
  };

  const form = (
    <div className="fm-form">
      <h3>{editingId ? "Edit task" : "New maintenance task"}</h3>

      <label className="fm-field">
        <span>Task</span>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="e.g. Generator service" />
      </label>

      <div className="fm-field">
        <span>How often</span>
        <div className="fm-chiprow">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              className={`fm-entity-chip${days === p.days ? " on" : ""}`}
              onClick={() => setDraft({ ...draft, everyDays: String(p.days) })}
            >{p.label}</button>
          ))}
        </div>
      </div>

      <label className="fm-field" style={{ maxWidth: 200 }}>
        <span>Interval in days</span>
        <input value={draft.everyDays} inputMode="numeric"
          onChange={(e) => setDraft({ ...draft, everyDays: e.target.value })} />
      </label>

      <label className="fm-field" style={{ maxWidth: 260 }}>
        <span>Room (optional)</span>
        <select value={draft.room} onChange={(e) => setDraft({ ...draft, room: e.target.value })}>
          <option value="">Whole villa</option>
          {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>

      <label className="fm-field" style={{ maxWidth: 260 }}>
        <span>Contract reference (optional)</span>
        <input value={draft.clause} onChange={(e) => setDraft({ ...draft, clause: e.target.value })}
          placeholder="e.g. 3.7(i)" />
      </label>

      <div className="modal-actions" style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={cancel}><X size={16} /> Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={() => void save()}>
          <Check size={16} /> {editingId ? "Save changes" : "Add task"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fm-stack">
      <p className="muted body-text">
        The schedule the Today tab measures against. Intervals are the minimum
        frequency — a task is overdue the day after its interval elapses.
      </p>

      {!adding && !editingId && (
        <button className="btn ghost" onClick={startAdd} style={{ alignSelf: "flex-start" }}>
          <Plus size={16} /> Add a task
        </button>
      )}

      {(adding || editingId) && form}

      <div className="fm-list">
        {data.schedules.length === 0 && (
          <p className="muted body-text">No tasks yet.</p>
        )}
        {data.schedules.map((s) => {
          // Target date this task implies — from its last completion, or (if
          // never done) from when it was created. See fmEngine.scheduleStatus.
          const due = scheduleStatus(s, data.completions);
          return (
            <div key={s.id} className={`fm-row state-${s.enabled ? "ok" : ""}`}>
              <div className="fm-row-main">
                <div className="fm-row-title">
                  <strong>{s.title}</strong>
                  {s.clause && <span className="fm-clause">Cl. {s.clause}</span>}
                  {s.room && <span className="fm-clause">{s.room}</span>}
                  {!s.enabled && <span className="fm-clause">Paused</span>}
                </div>
                <div className="fm-row-sub muted">
                  Every {s.everyDays} days · due by {due.dueAt ? shortDate(due.dueAt) : "—"}
                </div>
              </div>
              <button
                className="btn ghost"
                onClick={() => void updateSchedule(s.id, { enabled: !s.enabled })}
              >{s.enabled ? "Pause" : "Resume"}</button>
              <button className="icon-btn" onClick={() => startEdit(s)} aria-label={`Edit ${s.title}`}>
                <Pencil size={15} />
              </button>
              <button
                className="icon-btn"
                onClick={() => void removeSchedule(s.id)}
                aria-label={`Remove ${s.title}`}
                title="Remove this task. Completions already logged against it are kept."
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
