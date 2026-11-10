// src/components/fm/ScheduleEditor.tsx
// Add, edit and remove maintenance tasks. The schedule starts empty — every
// task is entered by the operator. Presets exist because "every 3 months" is
// how an obligation is actually written, and making someone convert that to
// 90 by hand is a step where mistakes get made.
//
// A task can bind to a room, which is what lets the villa map highlight where
// overdue work actually is.

import InfoTip from "@/components/common/InfoTip";
import { useState } from "react";
import Dropdown from "@/components/common/Dropdown";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import { Plus, Pencil } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useFmData } from "@/fm/FmDataContext";
import { useCardRoom } from "@/config/VillaModel";
import { scheduleStatus } from "@/fm/fmEngine";
import type { FmSchedule } from "@/fm/fmTypes";
import { EMPTY_SCHEDULE_DRAFT as EMPTY, scheduleToDraft as toDraft, draftDays, scheduleWrite, SCHEDULE_PRESETS, type ScheduleDraft as Draft } from "@/fm/scheduleDraft";
import FormActions from "./FormActions";
import TaskCard from "./TaskCard";
import FmForm from "./FmForm";
import { useListEditor } from "./ListEditor";

export default function ScheduleEditor() {
  const { data, addSchedule, updateSchedule, removeSchedule } = useFmData();
  const roomOf = useCardRoom();
  const { config } = useConfig();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** Why the last save was refused — the draft is kept (2.496.252). */
  const [formError, setFormError] = useState<string | null>(null);
  // the task open as its form (ListEditor): erased on another tablet, its form closes and Add a task is back
  const editor = useListEditor(data.schedules.map((s) => s.id), () => { setFormError(null); setDraft(EMPTY); });
  const editingId = editor.editing;

  const rooms = [...new Set(
    config.teleportPoints.map((p) => p.name).filter(Boolean),
  )].sort();

  // The form's rules are scheduleDraft's (2.496.259): an edit never resumes
  // a paused task, "1.5" is not 15, and a mistyped interval is not "every day".
  const days = draftDays(draft.everyDays);
  const write = scheduleWrite(draft, editingId);
  const valid = write.ok;

  const startAdd = () => { setDraft(EMPTY); editor.add(); };
  const startEdit = (s: FmSchedule) => { setDraft(toDraft(s)); editor.edit(s.id); };

  const save = async () => {
    if (!write.ok) { setFormError(write.problem); return; }
    const { done, note: why } = write.kind === "edit" ? await updateSchedule(write.id, write.patch) : await addSchedule(write.fields);
    // Close only when saved or queued; a refused save keeps the draft (2.496.252).
    if (done) editor.close(); else setFormError(why);
  };

  const form = (
    <FmForm>
      <h3>{editingId ? "Edit task" : "New maintenance task"}</h3>

      <label className="fm-field">
        <span>Task</span>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="e.g. Generator service" />
      </label>

      <div className="fm-field">
        <span>How often</span>
        <SegmentedGroup ariaLabel="How often" active={SCHEDULE_PRESETS.some((p) => p.days === days) ? String(days) : null}
          onChange={(everyDays) => setDraft({ ...draft, everyDays })}
          options={SCHEDULE_PRESETS.map((p) => ({ key: String(p.days), label: p.label }))} />
      </div>

      <label className="fm-field" style={{ maxWidth: 200 }}>
        <span>Interval in days</span>
        <input value={draft.everyDays} inputMode="numeric"
          onChange={(e) => setDraft({ ...draft, everyDays: e.target.value })} />
      </label>

      <label className="fm-field" style={{ maxWidth: 260 }}>
        <span>Room (optional)</span>
        <Dropdown value={draft.room} ariaLabel="Room" onChange={(room) => setDraft({ ...draft, room })}
          options={[{ value: "", label: "Whole villa" }, ...rooms.map((r) => ({ value: r, label: r }))]} />
      </label>

      <label className="fm-field" style={{ maxWidth: 260 }}>
        <span>Contract reference (optional)</span>
        <input value={draft.clause} onChange={(e) => setDraft({ ...draft, clause: e.target.value })}
          placeholder="e.g. 3.7(i)" />
      </label>

      {!write.ok && draft.everyDays.trim() !== "" && days === null && (
        <div className="fm-inline-error" role="alert">{write.problem}</div>
      )}
      <FormActions error={formError} onCancel={editor.close} onSave={save} disabled={!valid}
        saveLabel={editingId ? "Save changes" : "Add task"} />
    </FmForm>
  );

  return (
    <div className="fm-stack">
      {/* the description and "Add a task" on one line (owner, 2026-10-14) */}
      <div className="fm-desc-row">
        {editor.addButton && (
          <button className="btn ghost" onClick={startAdd}><Plus size={16} /> Add a task</button>
        )}
        <InfoTip label="About the tasks">
          Each task repeats at the interval you set. It becomes overdue when its interval has passed since it was last
          done, and the board above shows what is due.
        </InfoTip>
      </div>

      {/* a new task's form here; an edit's in its task's place, below (FmForm) */}
      {editor.adding && form}

      <div className="fm-list">
        {data.schedules.length === 0 && (
          <p className="muted body-text">No tasks yet.</p>
        )}
        {data.schedules.map((s) => {
          // Target date this task implies — from its last completion, or (if
          // never done) from when it was created. See fmEngine.scheduleStatus.
          const due = scheduleStatus(s, data.completions);
          return editor.inPlace(s.id, (
            // THE task's card, the Today tab's too (TaskCard): its state, due day and who last did it on both
            <TaskCard key={s.id} status={due} room={roomOf(s)} onRemove={() => removeSchedule(s.id)}
              actions={<>
                <button className="btn ghost" onClick={() => void updateSchedule(s.id, { enabled: !s.enabled })}>
                  {s.enabled ? "Pause" : "Resume"}
                </button>
                <button className="icon-btn" onClick={() => startEdit(s)} aria-label={`Edit ${s.title}`}>
                  <Pencil size={16} />
                </button>
              </>} />
          ), () => form);
        })}
      </div>
    </div>
  );
}
