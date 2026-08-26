import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, Loader2 } from "lucide-react";
import SourceChip from "@/components/common/SourceChip";

import { completeTask, fetchTasks, type FacilityTask } from "@/reports/reportsApi";

/**
 * Acknowledging a facility manager task without leaving the kiosk.
 *
 * ⚠️ THE ONLY ACK CHANNEL USED TO BE HOME ASSISTANT. A brief tells the Facility
 * Manager what to do; the only way to record that it was done was to open HA's
 * To-do panel and tick the item. On a wall-mounted tablet showing VESTA that is
 * a context switch to another application, so tasks were acknowledged late or
 * not at all — and the noise counter, the report's "Followed up" section and
 * each blueprint's own re-arm all key on that tick.
 *
 * ⚠️ TICKING IS THE WHOLE INTERACTION, AND THAT IS DELIBERATE. The catalog asks
 * for three outcomes — done / not found / need help — and this offers one,
 * because "done" is the only one the todo list can represent. Two of three
 * silently mapped onto "completed" would record work that did not happen, which
 * is worse than not offering them. The gap is stated in the footer rather than
 * papered over.
 */
export default function TasksTab({ canAck }: { canAck: boolean }) {
  const [tasks, setTasks] = useState<FacilityTask[]>([]);
  const [reachable, setReachable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { tasks: rows, reachable: ok } = await fetchTasks();
    setTasks(rows);
    setReachable(ok);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onComplete = useCallback(async (task: FacilityTask) => {
    setBusy(task.uid);
    setError(null);
    const result = await completeTask(task);
    if (result.ok) {
      // ⚠️ ACKNOWLEDGE, NEVER PREDICT. The row is removed only after the server
      // confirms, because the server may refuse — the task may have been ticked
      // in Home Assistant a moment ago, or it may not be one of ours at all.
      // An optimistic removal would show work as done that was not recorded.
      setTasks((current) => current.filter((t) => t.uid !== task.uid));
    } else {
      setError(result.error ?? "The task could not be completed.");
    }
    setBusy(null);
  }, []);

  if (loading) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" /> Reading the task list…
      </p>
    );
  }

  if (!reachable) {
    return (
      <p className="muted body-text">
        Home Assistant could not be reached, so the task list is unavailable.
        Nothing has been changed.
      </p>
    );
  }

  return (
    <div>
      <p className="muted body-text">
        Work the villa&rsquo;s own automations have asked for. Completing one
        here is the same as ticking it in Home Assistant: it leaves this list,
        appears under <strong>Followed up</strong> in the next briefing, and
        re-arms the rule that raised it.
      </p>

      {error && <div className="fm-banner warn">{error}</div>}

      {tasks.length === 0 ? (
        <p className="muted body-text">
          <ClipboardList size={14} /> Nothing outstanding.
        </p>
      ) : (
        <ul className="reports-tasks">
          {tasks.map((task) => (
            <li key={task.uid} className="reports-task">
              {/* ⚠️ `reflex`, AND THE PROVENANCE HERE SURPRISES PEOPLE — it was
                  the owner's own question. Nothing on this list was written by
                  the agent. An AUTOMATION writes the item into a Home Assistant
                  to-do list; VESTA reads that list back (`ledger.todo_tasks`),
                  keeps only the entries carrying `TASK_PREFIX` because the same
                  list is often the household's real shopping list, and renders
                  what it found. So a task is deterministic blueprint output
                  round-tripped through HA — the opposite end of the spectrum
                  from the Concerns two screens away, and until this chip the
                  two looked equally like "the villa said so".
                  ⚠️ `ruleId` beside the text is the blueprint's OWN id, which
                  is the corroboration: an agent-derived row could not have one. */}
              <SourceChip source="reflex" />
              <span className="reports-task-text">
                {task.text}
                {task.ruleId && (
                  <span className="muted"> &mdash; {task.ruleId}</span>
                )}
              </span>
              {/* ⚠️ ABSENT, NOT DISABLED, FOR A GUEST. A greyed control invites
                  the question "why can I not press this"; a role that may not
                  complete tasks simply reads the list. Server-side the check is
                  `TASK_ACK_ROLES` — this is a rendering convenience only. */}
              {canAck && (
                <button
                  className="btn"
                  disabled={busy === task.uid}
                  onClick={() => void onComplete(task)}
                  aria-label={`Mark done: ${task.text}`}
                >
                  {busy === task.uid
                    ? <Loader2 size={16} className="spin" />
                    : <CheckCircle2 size={16} />}
                  <span>Done</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="muted body-text">
        Only &ldquo;done&rdquo; can be recorded. The catalog also asks for
        &ldquo;not found&rdquo; and &ldquo;need help&rdquo;; a task list has no
        way to express them, and mapping them onto &ldquo;completed&rdquo; would
        record work that did not happen.
      </p>
    </div>
  );
}
