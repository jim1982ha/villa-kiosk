// src/components/fm/TodayTab.tsx
// The Clause 3.7 maintenance board, worst first, with the log-completion flow.
//
// This is the screen the facility manager opens on: it answers "what do I have
// to do" before it answers anything else, which is why it leads rather than the
// 3D map. Overdue work is what Appendix C §7(b) turns into a termination risk.

import { useState } from "react";
import { Check, CalendarClock, Trash2 } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { scheduleBoard, formatIdr, localStamp, shortDate, type ScheduleStatus } from "@/fm/fmEngine";
import { MINOR_MAINTENANCE_CAP_IDR } from "@/fm/fmTypes";
import { budgetStatus, wouldExceedCap } from "@/fm/fmEngine";
import EvidenceRow from "./EvidenceRow";

const STATE_LABEL: Record<ScheduleStatus["state"], string> = {
  overdue: "Overdue",
  never: "Never recorded",
  "due-soon": "Due soon",
  ok: "On schedule",
};

/** Same wording either side of "never": a target date is shown regardless —
 *  see fmEngine.scheduleStatus for why "never" now always carries a dueAt —
 *  so the operator sees WHEN a task is due even before it's ever been logged
 *  once, not just after. */
function dueText(s: ScheduleStatus): string {
  const by = s.dueAt ? ` (by ${shortDate(s.dueAt)})` : "";
  if (s.state === "never") return `No completion recorded yet${by}`;
  const d = Math.round(s.daysUntilDue ?? 0);
  if (d < 0) return `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} overdue${by}`;
  if (d === 0) return `Due today${by}`;
  return `Due in ${d} day${d === 1 ? "" : "s"}${by}`;
}

export default function TodayTab({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const { data, logCompletion, removeSchedule, removeAllSchedules } = useFmData();
  const board = scheduleBoard(data);
  const [openId, setOpenId] = useState<string | null>(null);
  // Bulk delete is destructive across every task at once — require an
  // explicit second tap before it fires, same pattern as the "Turn all
  // on/off" confirm elsewhere (SummaryGroupPanel) and the Facility
  // unavailable-devices bulk toggle.
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);

  if (data.schedules.length === 0) {
    return (
      <div className="fm-empty">
        <CalendarClock size={28} />
        <h3>No maintenance schedule yet</h3>
        <p className="muted body-text">
          Add your property's own recurring maintenance tasks — air
          conditioning service, pest control, pool and landscaping, whatever
          your own schedule or agreement calls for — in the
          <strong> Schedule</strong> tab. Each task tracks its own interval,
          due date and completion history from there.
        </p>
      </div>
    );
  }

  const attention = board.filter((s) => s.state !== "ok");
  const openTickets = data.tickets.filter((t) => t.status !== "resolved");

  return (
    <div className="fm-stack">
      <div className="fm-summary">
        <div className={`fm-stat ${attention.length ? "bad" : "good"}`}>
          <span className="n">{attention.length}</span>
          <span className="l">need attention</span>
        </div>
        <div className={`fm-stat ${openTickets.length ? "warn" : "good"}`}>
          <span className="n">{openTickets.length}</span>
          <span className="l">open faults</span>
        </div>
        <div className="fm-stat">
          <span className="n">{formatIdr(budgetStatus(data.costs).minorIdr).replace("IDR ", "")}</span>
          <span className="l">spent this month</span>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        {confirmingDeleteAll ? (
          <div className="modal-actions" style={{ margin: 0 }}>
            <button className="btn ghost" onClick={() => setConfirmingDeleteAll(false)}>Cancel</button>
            <button
              className="btn danger"
              onClick={async () => { await removeAllSchedules(); setConfirmingDeleteAll(false); }}
            >
              {/* data.schedules.length, not board.length: the board only shows
                  ENABLED tasks (scheduleBoard filters paused ones out), but
                  removeAllSchedules clears every schedule regardless — the
                  confirm count must match what actually gets deleted. */}
              Delete all {data.schedules.length} tasks?
            </button>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => setConfirmingDeleteAll(true)}>
            <Trash2 size={15} /> Delete all
          </button>
        )}
      </div>

      <div className="fm-list">
        {board.map((s) => (
          <div key={s.schedule.id} className={`fm-row state-${s.state}`}>
            <div className="fm-row-main">
              <div className="fm-row-title">
                <strong>{s.schedule.title}</strong>
                {s.schedule.clause && <span className="fm-clause">Cl. {s.schedule.clause}</span>}
                {s.schedule.room && <span className="fm-clause">{s.schedule.room}</span>}
              </div>
              <div className="fm-row-sub muted">
                {dueText(s)} · every {s.schedule.everyDays} days
                {s.last && ` · last ${localStamp(s.last.at)} by ${s.last.by || "—"}`}
              </div>
            </div>
            <span className={`fm-badge ${s.state}`}>{STATE_LABEL[s.state]}</span>
            <button
              className="btn ghost"
              onClick={() => setOpenId(openId === s.schedule.id ? null : s.schedule.id)}
            >
              <Check size={16} /> Log
            </button>
            <button
              className="icon-btn"
              onClick={() => void removeSchedule(s.schedule.id)}
              aria-label={`Remove ${s.schedule.title}`}
              title="Remove this task. Completions already logged against it are kept."
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      {openId && (
        <LogCompletion
          scheduleId={openId}
          onCancel={() => setOpenId(null)}
          onSave={async (payload, cost) => {
            await logCompletion(payload, cost);
            setOpenId(null);
          }}
          onOpenEntity={onOpenEntity}
        />
      )}
    </div>
  );
}

/** The completion form. Cost is optional and defaults to Minor — but the moment
 *  it would take the month past the configured Minor Maintenance cap (see
 *  fmTypes.ts's MINOR_MAINTENANCE_CAP_IDR), the operator is told BEFORE
 *  saving, because that is when the minor-vs-major decision is still theirs
 *  to make. No-op with no cap configured — wouldExceedCap is never true then. */
function LogCompletion({
  scheduleId, onCancel, onSave,
}: {
  scheduleId: string;
  onCancel: () => void;
  onSave: (
    c: { scheduleId: string; at: string; by: string; note?: string; photoIds: string[] },
    cost?: { amountIdr: number; label: string; category: "minor" | "major" },
  ) => Promise<void>;
  onOpenEntity: (id: string) => void;
}) {
  const { data } = useFmData();
  const schedule = data.schedules.find((s) => s.id === scheduleId);
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const amountIdr = Number(amount.replace(/[^\d]/g, "")) || 0;
  const willExceed = amountIdr > 0 && wouldExceedCap(data.costs, amountIdr);

  return (
    <div className="fm-form">
      <h3>Log: {schedule?.title}</h3>

      <label className="fm-field">
        <span>Done by</span>
        <input value={by} onChange={(e) => setBy(e.target.value)}
          placeholder="Name or company" />
      </label>

      <label className="fm-field">
        <span>Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="What was done, anything found" />
      </label>

      <label className="fm-field">
        <span>Cost (optional, IDR)</span>
        <input value={amount} inputMode="numeric"
          onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 450000" />
      </label>

      {willExceed && (
        <div className="fm-banner warn">
          This takes the month past the {formatIdr(MINOR_MAINTENANCE_CAP_IDR)} Minor
          Maintenance cap. Spend beyond it is Major maintenance — record it as that
          category instead if that's what your own agreement calls for.
        </div>
      )}

      <div className="fm-field">
        <span>Photo evidence</span>
        <EvidenceRow photoIds={photoIds} onChange={setPhotoIds} />
      </div>

      <div className="modal-actions" style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(
              { scheduleId, at: new Date().toISOString(), by: by.trim(), note: note.trim() || undefined, photoIds },
              amountIdr > 0
                ? { amountIdr, label: schedule?.title ?? "Maintenance", category: "minor" }
                : undefined,
            );
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : "Save completion"}
        </button>
      </div>
    </div>
  );
}
