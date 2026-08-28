// src/components/agent/AgentTodo.tsx
//
// The work the villa has asked somebody to do.
//
// ⚠️ THESE JOBS HAD NO SURFACE IN THIS APP AT ALL. A delivered concern raises a
// to-do item (`agent/task.py`), and the ONLY place it appeared was Home
// Assistant's own To-do panel — outside the kiosk entirely. The Facility
// manager, whose work these items are, could not see one; and once an owner
// acknowledged the concern the card left the wall, so the row it had created
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
// Reason tab leaves the row open, because seeing an alert is not doing it.

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";

import { actOnAlert, loadAgentConfig, loadConcerns } from "@/vesta/supervise/agentApi";
import type { Concern } from "@/vesta/shared/agentTypes";
import InfoHint from "@/components/common/InfoHint";
import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";
import { useHA } from "@/ha/HAStateStore";
import Loading from "@/components/common/Loading";
import { completeTodoItem, fetchTodoItems, referenceOf,
         type TodoItem } from "@/ha/HATodoAPI";

/** A row, and the concern it came from when one can be found. */
interface TodoRow {
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

export default function AgentTodo() {
  const { ws } = useHA();
  const { role } = useProfile();
  // ⚠️ THE SAME CAPABILITY THE CONCERN CARD'S BUTTONS USE. Ticking a row is a
  // content judgement the Facility manager is meant to make, not a spend or a
  // configuration change — `manageFacility`, which both they and the owner
  // hold. The server refuses anybody else regardless; this only avoids showing
  // a control that could only ever be refused.
  const canAct = role != null && hasCapability(role, "manageFacility");

  const [list, setList] = useState<string | null>(null);
  const [items, setItems] = useState<TodoRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const cfg = await loadAgentConfig().catch(() => null);
    const entity = String(cfg?.config?.taskList ?? "").trim();
    setList(entity);
    if (!entity) { setItems([]); return; }
    const [items, concerns] = await Promise.all([
      fetchTodoItems(ws, entity), loadConcerns().catch(() => [] as Concern[]),
    ]);
    const byId = new Map(concerns.map((c) => [String(c.id), c]));
    setItems(items
      // ⚠️ OUTSTANDING ONLY. A completed row is a record, and Home Assistant's
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

  // ⚠️ ONE SERVER-SIDE ACT, NOT TWO BROWSER CALLS (2026-08-28). This used to
  // complete the item over Home Assistant's websocket and then acknowledge the
  // alert through the add-on, with nothing joining them: the tick landing and
  // the acknowledgement failing leaves a ticked job beside an alert still being
  // chased. `agent/actions.py` does both or reports why not — and it is the
  // same function the phone's Done button reaches, which is what makes the two
  // surfaces incapable of disagreeing rather than merely expected to agree.
  //
  // ⚠️ A ROW WITH NO ALERT BEHIND IT STILL TICKS. Somebody may have written the
  // item by hand on the list this villa shares; refusing it would make the
  // button dead on rows a person can plainly see.
  const finish = useCallback(async (row: TodoRow) => {
    setBusy(row.item.uid);
    setNote("");
    const id = row.concern ? String(row.concern.id) : "";
    const result = id
      ? await actOnAlert(id, "done")
      : { ok: await completeTodoItem(ws, list ?? "", row.item.summary),
          note: "" };
    setBusy(null);
    setNote(result.ok
      ? (result.note || "Done") + ". It will not be chased again."
      : result.note || "That did not work — try again in a moment.");
    await load();
  }, [ws, list, load]);

  if (items === null) {
    return (
      <Loading />
    );
  }

  return (
    <>
      {/* ⚠️ THE SUBTITLE BECAME THE (i) (2026-08-28, owner's instruction). "—
          what somebody is asked to do" was a gloss on a title that does not
          need one, and the paragraph under it repeated the same fact a third
          time; this app's rule is at most two lines beside a control with
          everything else in here. */}
      <div className="settings-section-title">
        To-Do List
        <InfoHint label="To-Do List">
          <p>
            A row appears here when the villa tells somebody about something,
            and leaves when it is ticked off — here, or on the list itself.
          </p>
          <p>
            {/* ⚠️ NAMED BECAUSE IT IS NOT A LIST THIS APP OWNS. The items are
                ordinary Home Assistant to-do items on the list configured
                under Settings &amp; others, so they can be read and ticked in
                Home Assistant, in its app, or by voice — and ticking one there
                is the same act as ticking it here. A reader who does not know
                that assumes this tab is the only place the work exists. */}
            The list is a Home Assistant to-do list, so the same items appear in
            Home Assistant itself and can be ticked off there. Either way counts:
            the alert behind the row is closed and stops being chased.
          </p>
        </InfoHint>
      </div>
      {/* ⚠️ THE UNCONFIGURED CASE IS NOT AN EMPTY LIST. "No items" on a villa
          that cannot raise one is the silence this project keeps being caught
          by; naming the missing setting is the difference between a quiet villa
          and a broken one. */}
      {!list ? (
        <p className="muted body-text">
          No to-do list is named yet, so findings are never turned into items.
          Name one under Settings &amp; others to switch this on.
        </p>
      ) : items.length === 0 ? (
        <p className="muted body-text">
          Nothing outstanding. A row appears here when the villa tells somebody
          about something, and leaves when it is ticked off — here, or on the
          to-do list itself.
        </p>
      ) : (
        <p className="muted body-text">
          Raised by the villa when it told somebody about a finding. Ticking one
          here also records that the alert has been seen, so it stops being
          escalated.
        </p>
      )}
      {note && <p className="muted body-text" role="status">{note}</p>}

      <div className="fm-list">
        {items.map((row) => {
          const c = row.concern;
          const escalated = String(c?.escalated_step ?? "").trim();
          const seen = String(c?.acknowledged_at ?? "").trim();
          return (
            <div key={row.item.uid} className="fm-row">
              <div className="fm-row-main">
                <div className="fm-row-title">
                  <strong>{row.text}</strong>
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
                      whether somebody has said they have seen it. A row card
                      that showed only its title would leave a reader unable to
                      tell an urgent unanswered one from a handled one. */}
                  {c?.delivered_at
                    ? `Told ${whenOf(c.delivered_at)}`
                    : "Raised by the villa"}
                  {escalated && ` · escalated${c?.escalated_at
                    ? ` ${whenOf(c.escalated_at)}` : ""} — ${escalated}`}
                  {seen && ` · seen by ${c?.acknowledged_by || "somebody"}`}
                  {/* ⚠️ A JOB WHOSE CONCERN CANNOT BE FOUND IS STILL SHOWN. It
                      is real work somebody was asked to do; the concern may
                      have been settled and pruned, or the item written by an
                      older release. Saying less about it beats hiding it. */}
                  {!c && " · no matching alert on record"}
                </div>
              </div>
              {canAct && (
                <button className="btn ghost" disabled={busy === row.item.uid}
                        onClick={() => void finish(row)}
                        title="Tick this off. It also records that the alert has been seen, so it is not escalated again.">
                  {busy === row.item.uid
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
