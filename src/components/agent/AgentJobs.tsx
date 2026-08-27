// src/components/agent/AgentJobs.tsx
//
// The work the villa has asked somebody to do.
//
// ⚠️ THESE JOBS HAD NO SURFACE IN THIS APP AT ALL. A delivered concern raises a
// to-do item (`agent/task.py`), and the ONLY place it appeared was Home
// Assistant's own To-do panel — outside the kiosk entirely. The Facility
// manager, whose work these jobs are, could not see one; and once an owner
// acknowledged the concern the card left the wall, so the job it had created
// was the last trace and it was invisible. Reported exactly that way: "where is
// it listed?"
//
// ⚠️ ITS OWN TAB, NOT THE FACILITY WORKSPACE (owner's decision, 2026-08-27).
// Facility is the human maintenance record — faults somebody reported,
// schedules somebody agreed — and this is the output of automated supervision.
// Mixing them would put two kinds of authorship in one list; keeping the
// villa's own conclusions inside the VESTA Agent dialog keeps the two readable
// as what they are.
//
// ⚠️ AND IT IS NOT A TIER, WHICH IS WHY IT CARRIES NO STEP BADGE. The five tabs
// beside it are the HLD's five tiers in the villa's signal path; this is what
// the last of them PRODUCED. A sixth "STEP" would claim a stage the pipeline
// does not have.
//
// ⚠️ TICKING HERE ALSO ACKNOWLEDGES THE CONCERN, and that closes a real gap.
// Pressing Done in Telegram completed the item and left the concern
// unacknowledged, so a critical somebody had already dealt with went on being
// chased — the alert-fatigue failure the ladder exists to prevent, arriving
// through the ladder. Finishing the work implies having seen it, so this route
// records both. The reverse is deliberately NOT true: acknowledging on the
// Reason tab leaves the job open, because seeing an alert is not doing it.

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";

import { acknowledgeConcern, loadAgentConfig, loadConcerns } from "@/agent/agentApi";
import type { Concern } from "@/agent/agentTypes";
import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";
import { useHA } from "@/ha/HAStateStore";
import { completeTodoItem, fetchTodoItems, referenceOf,
         type TodoItem } from "@/ha/HATodoAPI";

/** A job, and the concern it came from when one can be found. */
interface Job {
  item: TodoItem;
  /** Everything after the `[ref]` — what a person actually reads. */
  text: string;
  concern?: Concern;
}

/** `2026-08-27T09:23:55Z` → `27 Aug, 17:23` in the reader's own zone. */
const whenOf = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short",
                                       hour: "2-digit", minute: "2-digit" });
};

export default function AgentJobs() {
  const { ws } = useHA();
  const { role } = useProfile();
  // ⚠️ THE SAME CAPABILITY THE CONCERN CARD'S BUTTONS USE. Ticking a job is a
  // content judgement the Facility manager is meant to make, not a spend or a
  // configuration change — `manageFacility`, which both they and the owner
  // hold. The server refuses anybody else regardless; this only avoids showing
  // a control that could only ever be refused.
  const canAct = role != null && hasCapability(role, "manageFacility");

  const [list, setList] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const cfg = await loadAgentConfig().catch(() => null);
    const entity = String(cfg?.config?.taskList ?? "").trim();
    setList(entity);
    if (!entity) { setJobs([]); return; }
    const [items, concerns] = await Promise.all([
      fetchTodoItems(ws, entity), loadConcerns().catch(() => [] as Concern[]),
    ]);
    const byId = new Map(concerns.map((c) => [String(c.id), c]));
    setJobs(items
      // ⚠️ OUTSTANDING ONLY. A completed job is a record, and Home Assistant's
      // own panel keeps every one ever ticked — this tab answers "what is still
      // being asked of somebody", which is a much shorter list and the only one
      // anybody acts on.
      .filter((i) => i.status !== "completed")
      .map((item) => {
        const ref = referenceOf(item.summary);
        return {
          item,
          // The bracket is plumbing that lets three mechanisms find one row;
          // it is not something a reader needs to see.
          text: item.summary.replace(/^\s*\[[^\]]*\]\s*/, "") || item.summary,
          concern: byId.get(ref),
        };
      }));
  }, [ws]);

  useEffect(() => { void load(); }, [load]);

  const finish = useCallback(async (job: Job) => {
    setBusy(job.item.uid);
    setNote("");
    const ok = await completeTodoItem(ws, list ?? "", job.item.summary);
    // ⚠️ THE CONCERN IS ACKNOWLEDGED ONLY IF THE TICK LANDED. Recording "seen"
    // for work that is still outstanding would stop the chase on a job nobody
    // has done — the one outcome worse than chasing.
    if (ok && job.concern && !job.concern.acknowledged_at) {
      await acknowledgeConcern(String(job.concern.id));
    }
    setBusy(null);
    setNote(ok ? "Done. It will not be chased again."
               : "Home Assistant did not accept that — try again in a moment.");
    await load();
  }, [ws, list, load]);

  if (jobs === null) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" aria-hidden /> Loading…
      </p>
    );
  }

  return (
    <>
      <div className="settings-section-title">Jobs — what somebody is asked to do</div>
      {/* ⚠️ THE UNCONFIGURED CASE IS NOT AN EMPTY LIST. "No jobs" on a villa
          that cannot raise one is the silence this project keeps being caught
          by; naming the missing setting is the difference between a quiet villa
          and a broken one. */}
      {!list ? (
        <p className="muted body-text">
          No to-do list is named yet, so findings are never turned into jobs.
          Name one under Settings &amp; others to switch this on.
        </p>
      ) : jobs.length === 0 ? (
        <p className="muted body-text">
          Nothing outstanding. A job appears here when the villa tells somebody
          about something, and leaves when it is ticked off — here, on the
          to-do list itself, or with the Done button on the message.
        </p>
      ) : (
        <p className="muted body-text">
          Raised by the villa when it told somebody about a finding. Ticking one
          here also records that the concern has been seen, so it stops being
          chased.
        </p>
      )}
      {note && <p className="muted body-text" role="status">{note}</p>}

      <div className="fm-list">
        {jobs.map((job) => {
          const c = job.concern;
          const chased = String(c?.escalated_step ?? "").trim();
          const seen = String(c?.acknowledged_at ?? "").trim();
          return (
            <div key={job.item.uid} className="fm-row">
              <div className="fm-row-main">
                <div className="fm-row-title">
                  <strong>{job.text}</strong>
                  {/* The severity the investigation gave it — the same word
                      the concern card shows, from the same field. */}
                  {c && (
                    <span className={`cockpit-concern-sev cockpit-sev-${c.severity}`}>
                      {String(c.severity)}
                    </span>
                  )}
                </div>
                <div className="fm-row-sub muted">
                  {/* ⚠️ THE WHOLE STORY OF THE JOB, IN ORDER: when it was
                      raised, whether the villa has chased anybody about it, and
                      whether somebody has said they have seen it. A job card
                      that showed only its title would leave a reader unable to
                      tell an urgent unanswered one from a handled one. */}
                  {c?.delivered_at
                    ? `Told ${whenOf(c.delivered_at)}`
                    : "Raised by the villa"}
                  {chased && ` · chased${c?.escalated_at
                    ? ` ${whenOf(c.escalated_at)}` : ""} — ${chased}`}
                  {seen && ` · seen by ${c?.acknowledged_by || "somebody"}`}
                  {/* ⚠️ A JOB WHOSE CONCERN CANNOT BE FOUND IS STILL SHOWN. It
                      is real work somebody was asked to do; the concern may
                      have been settled and pruned, or the item written by an
                      older release. Saying less about it beats hiding it. */}
                  {!c && " · no matching concern on record"}
                </div>
              </div>
              {canAct && (
                <button className="btn ghost" disabled={busy === job.item.uid}
                        onClick={() => void finish(job)}
                        title="Tick this off. It also records that the concern has been seen, so nobody is chased about it again.">
                  {busy === job.item.uid
                    ? <Loader2 size={16} className="spin" aria-hidden />
                    : <ClipboardCheck size={16} aria-hidden />}
                  {" Done"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
