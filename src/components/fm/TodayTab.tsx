// src/components/fm/TodayTab.tsx
// The maintenance board, worst first, with the log-completion flow.
//
// This is the screen the facility manager opens on: it answers "what do I have
// to do" before it answers anything else, which is why it leads rather than the
// 3D map. Overdue work is exactly the kind of gap a management contract's
// maintenance-standard clause exists to prevent, whatever that clause is.

import InfoTip from "@/components/common/InfoTip";
import { useState } from "react";
import { Check, CalendarClock, Trash2 } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { useDeviceIdentity } from "@/config/VillaModel";
import { openCounts } from "@/fm/deviceWork";
import { pillClass, toneClass } from "@/fm/tone";
import { budgetStatus, dueLine, DUE_WORDS, localStamp, scheduleBoard, shortDate, type ScheduleStatus, parseAmount, fmAttention, workedBy } from "@/fm/fmEngine";
import { COST_CATEGORY_NAMES } from "@/fm/fmTypes";
import { useFmTerms } from "@/fm/useFmTerms";
import EvidenceRow from "./EvidenceRow";
import RecentWorkList from "./RecentWorkList";
import NotesField from "./NotesField";
import InlineConfirm from "@/components/common/InlineConfirm";
import AgentMark from "./AgentMark";
import RecordCard from "./RecordCard";
import { formatMoney } from "@/utils/money";
import CostFields from "./CostFields";
import FormActions from "./FormActions";
import Tip from "@/components/common/Tip";

/** The engine's sentence (fmEngine.dueLine — the recap's too) with the date in the reader's locale. Same wording
 *  either side of "never": a target date is shown regardless — see fmEngine.scheduleStatus for why "never" now
 *  always carries a dueAt — so the operator sees WHEN a task is due even before it's ever been logged once. */
function dueText(s: ScheduleStatus): string {
  return `${dueLine(s)}${s.dueAt ? ` (by ${shortDate(s.dueAt)})` : ""}`;
}

export default function TodayTab({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const { data, logCompletion, removeSchedule, removeAllSchedules } = useFmData();
  const { deviceOfRecord } = useDeviceIdentity();
  const terms = useFmTerms();
  const board = scheduleBoard(data);
  const [openId, setOpenId] = useState<string | null>(null);
  // Bulk delete is destructive across every task at once — require an
  // explicit second tap before it fires, same pattern as the "Turn all
  // on/off" confirm elsewhere (SummaryGroupPanel) and the Facility
  // unavailable-devices bulk toggle.
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);

  if (data.schedules.length === 0) {
    // work already logged (a task done, since removed) is part of the record: listed UNDER the empty-state message,
    // never inside it (it took the message's grey, centred text)
    return (
      <div className="fm-stack">
      {/* THE Cockpit card, as every other (owner, 2026-10-22: "make it consistent with the rest of the UI") — it was
          a centred block of its own, in larger grey type */}
      <RecordCard lead={<CalendarClock size={16} className="muted" aria-hidden="true" />} title={<span className="with-tip">
        No maintenance schedule yet
        <InfoTip label="About the maintenance schedule">
          Add your property's own recurring maintenance tasks with Add a task below: air conditioning service, pest
          control, pool and landscaping, whatever your own schedule or agreement calls for. Each task then tracks its
          own interval, due date and the work done.
        </InfoTip></span>} />
      <RecentWorkList />
      </div>
    );
  }

  // The ONE attention rule (fmEngine.fmAttention): late tasks, not due-soon.
  const attention = fmAttention(data).lateTasks;
  // a fault waits on the Overview until someone takes it on; then it is a ticket (owner, 2026-10-14)
  // counted per device, as the Overview and Tickets draw them (openCounts)
  const open = openCounts(data.tickets, deviceOfRecord);

  return (
    <div className="fm-stack">
      <div className="fm-summary">
        <div className={`fm-stat ${attention.length ? "bad" : "good"}`}>
          <span className="n">{attention.length}</span>
          <span className="l">tasks need attention</span>
        </div>
        <div className={`fm-stat ${open.faults ? "warn" : "good"}`}>
          <span className="n">{open.faults}</span>
          <span className="l">open faults</span>
        </div>
        <div className="fm-stat">
          <span className="n">{open.tickets}</span>
          <span className="l">tickets in progress</span>
        </div>
        <div className="fm-stat">
          {/* The month's money as the Spend tab and the statement say it: the capped category's spend, in the
              villa's currency (useFmTerms), under the category's name. ⚠️ It read "spent this month" over a bare
              Minor figure with no currency (architecture review, 2026-10-19) — the Spend tab's three totals, a step
              away, said more and said it differently. */}
          <span className="n">{formatMoney(budgetStatus(data.costs, undefined, terms).minorSpend, terms.currency)}</span>
          <span className="l">{COST_CATEGORY_NAMES.minor} spend this month</span>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        {confirmingDeleteAll ? (
          // data.schedules.length, not board.length: the board only shows
          // ENABLED tasks (scheduleBoard filters paused ones out), but
          // removeAllSchedules clears every schedule regardless — the
          // confirm count must match what actually gets deleted.
          <InlineConfirm confirmLabel={<>Delete all {data.schedules.length} tasks?</>}
            onConfirm={async () => { await removeAllSchedules(); setConfirmingDeleteAll(false); }}
            onCancel={() => setConfirmingDeleteAll(false)} />
        ) : (
          <button className="btn ghost" onClick={() => setConfirmingDeleteAll(true)}>
            <Trash2 size={16} /> Delete all
          </button>
        )}
      </div>

      <div className="fm-list">
        {board.map((s) => (
          // THE Cockpit card (RecordCard): its state pill on the title line, Log and the bin inside, on the right of
          // its text (architecture review, 2026-10-15 — the layout the owner set for tickets); its tint says how late
          // its state's ONE word and tone (fmEngine.DUE_WORDS — the recap's and the Overview's too)
          <RecordCard key={s.schedule.id} tone={toneClass(DUE_WORDS[s.state].tone)} title={s.schedule.title}
            status={{ text: DUE_WORDS[s.state].word, tone: pillClass(DUE_WORDS[s.state].tone) }}
            when={`${dueText(s)} · every ${s.schedule.everyDays} days`
              + (s.last ? ` · last ${localStamp(s.last.at)} by ${workedBy(s.last)}` : "")}
            pills={<>
              {s.schedule.clause && <span className="fm-clause">Cl. {s.schedule.clause}</span>}
              {s.schedule.room && <span className="fm-clause">{s.schedule.room}</span>}
              <AgentMark record={s.schedule} />
            </>}
            actions={<>
              <button className="btn ghost" onClick={() => setOpenId(openId === s.schedule.id ? null : s.schedule.id)}>
                <Check size={16} /> Log
              </button>
              <Tip text="Remove this task. Completions already logged against it are kept.">
                <button className="icon-btn" onClick={() => void removeSchedule(s.schedule.id)}
                  aria-label={`Remove ${s.schedule.title}`}>
                  <Trash2 size={16} />
                </button>
              </Tip>
            </>} />
        ))}
      </div>

      {/* What has actually been done, under what is still due. Completions
          were previously logged and then never shown anywhere. */}
      <RecentWorkList />

      {openId && (
        <LogCompletion
          scheduleId={openId}
          onCancel={() => setOpenId(null)}
          onSave={async (payload, cost) => {
            // Close only when saved or queued; a refused save keeps the form (2.496.252).
            const { done, note: why } = await logCompletion(payload, cost);
            if (done) setOpenId(null);
            return done ? null : why;
          }}
          onOpenEntity={onOpenEntity}
        />
      )}
    </div>
  );
}

/** The completion form. Cost is optional and defaults to Minor — but the moment
 *  it would take the month past the owner's monthly cap (see
 *  fmEngine's budgetStatus().cap), the operator is told BEFORE
 *  saving, because that is when the minor-vs-major decision is still theirs
 *  to make. No-op with no cap configured — projectedSpend is never over then. */
function LogCompletion({
  scheduleId, onCancel, onSave,
}: {
  scheduleId: string;
  onCancel: () => void;
  onSave: (
    c: { scheduleId: string; at: string; by: string; note?: string; photoIds: string[] },
    cost?: { amountIdr: number; label: string; category: "minor" | "major" },
  ) => Promise<string | null>;   // null = saved/queued; else why it was refused
  onOpenEntity: (id: string) => void;
}) {
  const { data } = useFmData();
  const schedule = data.schedules.find((s) => s.id === scheduleId);
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  /** Why the save was refused — the form keeps what was typed (2.496.252). */
  const [saveError, setSaveError] = useState<string | null>(null);

  const amountIdr = parseAmount(amount);

  return (
    <div className="fm-form">
      <h3>Log: {schedule?.title}</h3>

      <label className="fm-field">
        <span>Done by</span>
        <input value={by} onChange={(e) => setBy(e.target.value)}
          placeholder="Name or company" />
      </label>

      <NotesField
        label="Note (optional)"
        value={note}
        onChange={setNote}
        placeholder="What was done, anything found or worth flagging for next time"
      />

      {/* A completion's cost is always the capped kind (CostFields). */}
      <CostFields amount={amount} onAmount={setAmount} optional />

      <div className="fm-field">
        <span>Photo evidence</span>
        <EvidenceRow photoIds={photoIds} onChange={setPhotoIds} />
      </div>

      <FormActions
        error={saveError} onCancel={onCancel} disabled={saving}
        saveLabel={saving ? "Saving…" : "Save completion"}
        onSave={async () => {
            setSaving(true);
            setSaveError(null);
            const refused = await onSave(
              { scheduleId, at: new Date().toISOString(), by: by.trim(), note: note.trim() || undefined, photoIds },
              amountIdr > 0
                ? { amountIdr, label: schedule?.title ?? "Maintenance", category: "minor" }
                : undefined,
            );
            setSaving(false);
            if (refused) setSaveError(refused);
          }}
      />
    </div>
  );
}
