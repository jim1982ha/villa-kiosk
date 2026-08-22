// src/components/reports/ScheduleTab.tsx
// When a report arrives, for whom, and where it goes.
//
// ⚠️ THE HOUR IS WALL-CLOCK, IN THE VILLA'S OWN TIMEZONE — never UTC. An owner
// asking for a report "at 7am" means 7am on the wall, and it has to stay 7am
// across a DST change. The scheduler resolves the zone itself (explicit →
// cached → ask Home Assistant → UTC with a warning); this dialog never sends
// one, because a browser's zone is the READER's, not the villa's, and a phone
// in another country would silently re-time every report.
//
// ⚠️ AND THE STORED DOCUMENT IS A SPARSE OVERLAY. Only what the operator has
// actually set is written back. Filling in defaults would make a DELETED
// schedule indistinguishable from an absent one, which is the config
// resurrection bug CLAUDE.md's hard rule describes.
//
// ⚠️ "WRITTEN FOR" IS NOT "SENT TO", AND THE FIRST VERSION OF THIS TAB LET A
// READER BELIEVE IT WAS. `audience` selects WHAT IS IN the brief — the owner's
// brief carries a money section the facility one omits, the facility brief is
// the work list (`SECTIONS_FOR` in `narrate/deterministic.py` is the whole
// difference). WHERE it goes is the schedule's own `targets`. So picking
// "facility" does NOT route anything to a facility manager; it changes the
// prose. The owner asked this outright — "how would the system know where to
// send the report based on the owner/facility selection?" — which is the
// question a row of unlabelled selects invites, and the honest answer is that
// it does not. Both facts are stated in the UI beside the controls.
//
// ⚠️ A SCHEDULE OWNS ITS RECIPIENTS. THERE IS NO SEPARATE DESTINATION SECTION,
// AND REMOVING IT IS THE POINT. v2.546.0 added per-schedule targets as an
// OPT-IN OVERRIDE beside a global list, on the reasoning that one shared list
// is the common case and two ways to set one thing needs the relationship
// stated at the control. The owner rejected that and was right: "the recipient
// selection must be linked and associated with each schedule profile that the
// user is adding."
//
// The rejected design asked the operator to hold a rule in their head — which
// list is in force for which row — to answer the only question they ever have
// about a schedule, which is "who gets this one". A card per schedule carrying
// when · for whom · to whom answers it by looking. `pipeline.targets_for` has
// preferred a schedule's own targets since Phase 2, so this is the UI catching
// up with the data model rather than a new capability.
//
// ⚠️ `notify_targets` STAYS ON THE BACKEND and is NOT shown. It is the fallback
// for any config written before this, and `targets_for` still reads it when a
// schedule names nothing — deleting it would silently redirect the briefings of
// every install that has not opened this dialog since. `adoptSharedTargets`
// below migrates it into the schedules the first time the tab is opened, so the
// operator ends up with one place without losing what they configured.

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { fetchNextRuns, type ReportsDiagnostics } from "@/reports/reportsApi";
import { useLongPress } from "@/hooks/useLongPress";
import { tapFeedback } from "@/utils/haptics";
import NarrationSection from "./NarrationSection";
import DestinationList, { RecipientButton } from "./DestinationList";
import {
  AUDIENCE, CADENCE, type Cadence, type ReportSchedule, type ReportsConfig,
} from "@/reports/reportsTypes";

/** ⚠️ Display defaults only, applied at RENDER and never written back. */
const DEFAULT_HOUR = 7;

/** `"07:00"` from the stored pair, for `<input type="time">`.
 *
 *  ⚠️ ONE CONTROL INSTEAD OF TWO SELECTS, AND IT IS ALSO THE MORE CAPABLE ONE.
 *  A 24-entry hour dropdown could not express 07:30 at all, and a second
 *  dropdown for minutes would have put five controls on a row the owner had
 *  just called cluttered. `type="time"` is native, is a wheel on iOS — the
 *  device this is operated from — and honours the reader's 12/24-hour locale
 *  without this file knowing anything about it. */
const asTime = (hour: number, minute: number) =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/** Monday-first, matching the scheduler's `weekday` (0 = Monday). ⚠️ NOT
 *  `toLocaleDateString`-derived: the villa's week starts where the scheduler
 *  says it starts, and a reader in a Sunday-first locale must not be offered a
 *  list whose indices mean something else on the server. */
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday",
                  "Friday", "Saturday", "Sunday"];

/** "Monday 24 Aug, 11:59" from the villa-local ISO the backend computed.
 *
 *  ⚠️ RENDERED, NOT RECOMPUTED, AND NOT RE-ZONED. The string already carries
 *  the villa's offset; parsing it and formatting in the reader's zone would
 *  show a phone in another country a different day from the one the report
 *  actually lands on — the exact reason this dialog never sends a timezone. So
 *  the parts are read off the ISO text itself. */
function whenNext(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return "";
  const [, y, mo, d, hh, mm] = m;
  const at = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  const day = at.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" });
  const month = at.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  return `${day} ${Number(d)} ${month}, ${hh}:${mm}`;
}

/** ⚠️ A `time` INPUT CAN BE EMPTY, and clearing it must not schedule 00:00 —
 *  the operator is mid-edit, not asking for midnight. An unparseable value
 *  leaves the schedule alone. */
function parseTime(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function newSchedule(): ReportSchedule {
  return {
    id: `s${Date.now().toString(36)}`,
    cadence: "weekly",
    hour: DEFAULT_HOUR,
    audience: "owner",
    minute: 0,
    // ⚠️ AN EMPTY LIST, NOT AN ABSENT ONE, AND THE DIFFERENCE IS REAL.
    // `targets_for` reads absent as "inherit `notify_targets`" and empty as
    // "nowhere" — so a new schedule with no `targets` key would DISPLAY as
    // "Nobody" here while the backend quietly delivered it to a legacy shared
    // list the operator can no longer see. Stating the empty list makes what is
    // shown and what is stored the same thing.
    targets: [],
  };
}

/** Move a legacy shared destination list onto the schedules that were using it.
 *
 *  ⚠️ INTO THE DRAFT, NEVER STRAIGHT TO DISK. This runs when the tab opens, and
 *  a migration that wrote itself back would be a background write the operator
 *  did not ask for — on a store two devices can hold open at once, with a
 *  revision check that would then fire on the other one. It becomes real when
 *  they press Save, like every other edit here.
 *
 *  ⚠️ AND IT IS A NO-OP UNLESS THERE IS SOMETHING TO MOVE. A schedule that
 *  already names its own targets is untouched, and a config with no shared list
 *  is returned as-is — so opening the tab twice cannot produce two different
 *  drafts, and an operator who deliberately emptied a schedule's destinations
 *  does not get the shared list pushed back into it.
 *
 *  The backend keeps reading `notify_targets` for anyone who never opens this
 *  dialog (`pipeline.targets_for`), which is why clearing it here is safe: the
 *  schedules now carry what it used to supply. */
export function adoptSharedTargets(config: ReportsConfig): ReportsConfig {
  const shared = config.notifyTargets ?? [];
  const schedules = config.schedules ?? [];
  if (shared.length === 0) return config;
  if (schedules.every((s) => s.targets !== undefined)) return config;
  return {
    ...config,
    schedules: schedules.map((s) =>
      s.targets === undefined ? { ...s, targets: [...shared] } : s),
    notifyTargets: [],
  };
}

export default function ScheduleTab({
  config, diagnostics, busy, onDraft, onSendNow, secretsConfigured, onSaveSecret,
}: {
  config: ReportsConfig | null;
  diagnostics: ReportsDiagnostics | null;
  busy: boolean;
  /** ⚠️ THE SAVE BUTTON LIVES IN THE MODAL'S FOOTER, NOT AT THE FOOT OF THIS
   *  TAB, so this tab has to hand its draft up. It was at the bottom of the
   *  content — below the fold on a laptop, under a NarrationSection that
   *  unfolds when ticked — so the one button that commits the work was the one
   *  you could not see, while Close sat pinned in the footer the whole time.
   *  Every other dialog in this family puts its actions in that footer;
   *  `test_modal_shell` exists because this one had already skipped it once.
   *
   *  Published through an effect rather than during render — a parent setState
   *  in a child's render body is a loop — and cleared on unmount, so switching
   *  tabs cannot leave a Save button offering a draft nothing is showing. */
  onDraft: (draft: ReportsConfig | null) => void;
  /** Send ONE schedule's briefing right now, for real.
   *
   *  ⚠️ A HIDDEN GESTURE ON THE DELETE BUTTON, BY REQUEST: tap removes the
   *  schedule, HOLD sends it. Worth stating the hazard once, because the two
   *  outcomes are far apart — a hold that lifts early deletes a schedule, and a
   *  tap that lingers messages the household. `useLongPress` is the app's
   *  shared recogniser and `consumeClick()` is what stops one press doing both,
   *  which is the failure mode CameraPanel already paid for. */
  onSendNow: (schedule: ReportSchedule) => void;
  secretsConfigured: Record<string, boolean>;
  onSaveSecret: (provider: string, value: string) => void;
}) {
  const [draft, setDraft] = useState<ReportsConfig>({});
  /** Which schedule has its recipient list open, if any. ⚠️ ONE AT A TIME, and
   *  by INDEX rather than a flag per row: two open lists on a phone push the
   *  Save button off the screen, and the question "who gets this one" is asked
   *  about one schedule at a time by definition. */
  const [openRecipients, setOpenRecipients] = useState<number | null>(null);
  /** When the schedules ON SCREEN would next fire, answered by the server.
   *
   *  ⚠️ DEBOUNCED, because a `time` input fires on every dial turn and this is
   *  a request per change. 350ms is long enough that scrubbing a time costs one
   *  call and short enough that the line has settled before a finger lifts.
   *
   *  ⚠️ AND IT IS RE-ASKED WHEN THE ROW CHANGES AT ALL, not only its time: a
   *  cadence of "weekly" moves the answer by up to six days and a weekday moves
   *  it by one, so keying this on the time alone would leave the other two
   *  controls silently stale — the same defect one field over. */
  const [draftRuns, setDraftRuns] = useState<Record<string, string>>({});
  /** ⚠️ ONE RECOGNISER, ONE HELD ROW. A hook per row would break the rules-of-
   *  hooks contract the moment a schedule is deleted mid-list; HUD's category
   *  buttons solved the same problem the same way, with a ref naming which one
   *  is under the finger. */
  const held = useRef<ReportSchedule | null>(null);
  const sendHold = useLongPress(() => {
    if (!held.current) return;
    tapFeedback();
    onSendNow(held.current);
  }, { nativeButton: true });
  const schedulesKey = JSON.stringify(draft.schedules ?? []);
  useEffect(() => {
    const rows: ReportSchedule[] = JSON.parse(schedulesKey);
    if (rows.length === 0) { setDraftRuns({}); return; }
    // ⚠️ `cancelled` rather than an AbortController: two answers can be in
    // flight after a fast edit and the LAST REQUEST is not necessarily the last
    // RESPONSE, so a stale one must be dropped on arrival rather than raced.
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchNextRuns(rows).then((runs) => {
        if (!cancelled && Object.keys(runs).length) setDraftRuns(runs);
      });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [schedulesKey]);

  // Re-seed only when the server's copy changes, so typing is never clobbered
  // by a background reload — the same ordering rule `DeviceConfigSync` follows.
  useEffect(() => { if (config) setDraft(adoptSharedTargets(config)); }, [config]);

  // ⚠️ THE DRAFT ITSELF, NOT A DIRTY FLAG. The footer button has to SAVE it, so
  // handing up a boolean would mean keeping a second copy somewhere to save
  // from — and two copies of an edit is how one of them goes stale.
  const settled = config ? JSON.stringify(adoptSharedTargets(config)) : null;
  const current = JSON.stringify(draft);
  useEffect(() => {
    onDraft(settled !== null && current !== settled ? JSON.parse(current) : null);
    return () => onDraft(null);
  }, [current, settled, onDraft]);

  if (!config) {
    return <p className="muted body-text">Reading the schedule…</p>;
  }

  const schedules = draft.schedules ?? [];
  const available = diagnostics?.notifyTargets ?? [];
  /** ⚠️ THE LIVE ANSWER FOR WHAT IS ON SCREEN, not for what is stored. The
   *  stored answer is the fallback, so a row that has never been edited still
   *  reads correctly before the first probe returns. */
  const nextRun = { ...(diagnostics?.nextRuns ?? {}), ...draftRuns };
  /** Does this row differ from what the add-on has stored?
   *
   *  ⚠️ COMPARED BY CONTENT, BY ID. `next_runs` is keyed by schedule id and
   *  computed from the STORED document, so a row the operator has touched but
   *  not saved is described by a date belonging to its previous settings.
   *  Matching by INDEX would report every row as edited the moment one is
   *  deleted, which is the same lie in the other direction. */
  const savedById = new Map((config.schedules ?? []).map((s) => [s.id, JSON.stringify(s)]));
  const edited = (s: ReportSchedule) => savedById.get(s.id) !== JSON.stringify(s);
  // ⚠️ WAS THE SHARED LIST MIGRATED INTO THE ROWS THIS SESSION? `draft` is the
  // migrated copy and `config` is the server's, so a difference here means the
  // operator is looking at destinations that are NOT yet stored — and pressing
  // Close instead of Save would leave the old shape in place, still working.
  // Saying so beats a silent rewrite either way.
  const migrated = (config.notifyTargets ?? []).length > 0
    && (draft.notifyTargets ?? []).length === 0;
  const set = (patch: Partial<ReportsConfig>) => setDraft({ ...draft, ...patch });
  const setAt = (i: number, patch: Partial<ReportSchedule>) =>
    set({ schedules: schedules.map((s, n) => (n === i ? { ...s, ...patch } : s)) });

  return (
    <div className="reports-pane">
      {/* ⚠️ `label.toggle` IS THE APP'S SHARED CHECKBOX ROW. This shipped as
          `.fm-check`, a class that does not exist anywhere — so the label got
          no flex layout and the input fell back to the browser's native
          rendering: a white square floating above its own text, which is what
          the owner screenshotted. `.fm-check-icon` exists and is for readiness
          status glyphs; the similar name is what made the invention feel safe. */}
      <label className="toggle">
        <input
          type="checkbox"
          checked={draft.enabled === true}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        <span>Send briefings on a schedule</span>
      </label>
      <p className="muted body-text">
        Off by default. Read one from the Preview tab first — that is what this
        setting commits you to receiving.
      </p>

      {migrated && (
        <div className="fm-banner">
          Destinations used to be one shared list for every schedule. They have
          been copied onto each schedule below — press Save to keep that.
          Nothing has changed yet, and briefings keep going where they were
          going until you do.
        </div>
      )}

      <h3 className="reports-h3">Schedules</h3>
      {/* ⚠️ ONE SENTENCE. The previous version explained the audience/recipient
          distinction in four lines above a section the owner had just called
          cluttered — and the distinction is now visible in the row itself, an
          audience select beside a recipients button. Prose that repeats what
          the controls already show is what makes a panel feel heavy. The time
          is the one thing the controls cannot say, because a browser shows the
          READER's clock and the schedule fires on the VILLA's. */}
      <p className="muted body-text">
        One briefing each: how often, at what time in the villa&rsquo;s own
        clock, what it contains, and who receives it.
      </p>
      {schedules.length === 0 && (
        <p className="muted body-text">
          None yet. Nothing is sent until you add one.
        </p>
      )}

      {schedules.map((s, i) => {
        const own = s.targets ?? [];
        return (
          <div key={s.id || i} className="reports-schedule-card">
            {/* ⚠️ ONE LINE: when · for whom · to whom · remove. The recipients
                are a BUTTON here rather than a list, because "who gets this
                one" is a one-glance question and the answer is short — the
                list only appears when it is being changed. Two releases put
                the destinations on their own row under the schedule and the
                owner called both cluttered; they were right, and a set of
                three is not worth a permanent row. */}
            <div className="reports-schedule">
              {/* ⚠️ THE FIELDS WRAP; THE DELETE DOES NOT. All five controls used
                  to be siblings in one wrapping row, so on a phone the fourth
                  or fifth dropped to a second line and took the delete button
                  with it — reported from a 390px screen, where it sat alone
                  under the row looking like an action on the whole card rather
                  than on that schedule. Grouping the fields lets them wrap
                  among themselves while the button stays on the first line. */}
              <div className="reports-schedule-fields">
              <select
                aria-label="How often"
                value={s.cadence}
                onChange={(e) => setAt(i, { cadence: e.target.value as Cadence })}
              >
                {CADENCE.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                type="time"
                aria-label="At what time"
                value={asTime(s.hour, s.minute ?? 0)}
                onChange={(e) => {
                  const t = parseTime(e.target.value);
                  if (t) setAt(i, t);
                }}
              />
              {/* ⚠️ THE DAY IS A CONTROL BECAUSE IT WAS A SECRET. "Weekly"
                  meant Monday and "monthly" meant the 1st, hard-coded, with
                  nothing in the dialog saying so — the owner created a weekly
                  schedule on a Friday for two minutes' time, received nothing,
                  and had to ask why. It only appears for the cadence it applies
                  to: a daily schedule has no day to choose and a third
                  permanently-disabled control is the clutter this row has twice
                  been rebuilt to remove. */}
              {s.cadence === "weekly" && (
                <select
                  aria-label="On which day"
                  value={s.weekday ?? 0}
                  onChange={(e) => setAt(i, { weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}
                </select>
              )}
              {s.cadence === "monthly" && (
                <select
                  aria-label="On which date"
                  value={s.day ?? 1}
                  onChange={(e) => setAt(i, { day: Number(e.target.value) })}
                >
                  {Array.from({ length: 31 }, (_, n) => n + 1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              )}
              <select
                aria-label="Written for"
                value={s.audience}
                onChange={(e) =>
                  setAt(i, { audience: e.target.value as ReportSchedule["audience"] })}
              >
                {AUDIENCE.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <RecipientButton
                targets={own}
                available={available}
                open={openRecipients === i}
                onToggle={() => setOpenRecipients(openRecipients === i ? null : i)}
              />
              </div>
              <button
                className="btn danger icon-only"
                aria-label="Remove this schedule. Press and hold to send it now."
                title="Press and hold to send this briefing now"
                onPointerDown={(e) => { held.current = s; sendHold.onPointerDown(e); }}
                onPointerUp={sendHold.onPointerUp}
                onPointerLeave={sendHold.onPointerLeave}
                onPointerCancel={sendHold.onPointerCancel}
                onPointerMove={sendHold.onPointerMove}
                onKeyDown={(e) => { held.current = s; sendHold.onKeyDown(e); }}
                onKeyUp={sendHold.onKeyUp}
                onClick={() => {
                  // ⚠️ THE HOLD ALREADY ACTED. Without this, one press both
                  // sends the briefing AND deletes the schedule — the exact
                  // double-fire `consumeClick` exists for.
                  if (sendHold.consumeClick()) return;
                  setOpenRecipients(null);
                  set({ schedules: schedules.filter((_, n) => n !== i) });
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>

            {/* ⚠️ THE ANSWER TO "WHY HAVE I NOT RECEIVED ANYTHING", STATED
                BEFORE IT IS ASKED. Computed by `schedule.next_fire` on the
                server — the same function the scheduler uses — because a second
                implementation here would be a different answer under the same
                label.

                ⚠️ WHICH MEANS IT DESCRIBES THE STORED SCHEDULE, NOT THE ONE ON
                SCREEN, AND IT MUST SAY SO WHILE THOSE DIFFER. The comment here
                used to claim exactly that — "it lags an unsaved edit; saying
                which is better than a number that silently means the wrong
                one" — and the code never said which: an owner changed a row
                from "weekly on Monday 12:38" to "daily 12:40", and the line
                went on reading "Next: Monday 24 Aug, 12:38". A confident wrong
                date is worse than no date, because nothing about it looks
                stale. */}
            <p className="muted body-text reports-next">
              {draft.enabled !== true
                ? "Nothing is sent — “Send briefings on a schedule” is off."
                : own.length === 0
                  ? "Nobody is selected, so this one would be composed and not sent."
                  : nextRun[s.id]
                    ? `Next: ${whenNext(nextRun[s.id])}, villa time.${
                        edited(s) ? " Not saved yet." : ""}`
                    : "Working out when this goes out…"}
            </p>

            {openRecipients === i && (
              <DestinationList
                targets={own}
                available={available}
                onChange={(next) => setAt(i, { targets: next })}
              />
            )}
          </div>
        );
      })}

      <button
        className="btn"
        onClick={() => set({ schedules: [...schedules, newSchedule()] })}
      >
        <Plus size={16} /><span>Add a schedule</span>
      </button>

      <NarrationSection
        draft={draft}
        set={set}
        secretsConfigured={secretsConfigured}
        busy={busy}
        onSaveSecret={onSaveSecret}
      />

    </div>
  );
}
