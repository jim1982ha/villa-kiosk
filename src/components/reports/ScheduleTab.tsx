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
// ⚠️ ONE QUESTION ABOUT READERS, NOT TWO (v2.653.0). A schedule row used to
// carry an AUDIENCE select ("written for") beside a RECIPIENT picker ("sent
// to"), and the owner reported the pair as redundant: "a schedule for this
// profile". They are right, and the redundancy was worse than untidy — the two
// could DISAGREE, so a brief written in the facility voice could be addressed
// to the owner's phone and nothing anywhere said so.
//
// A schedule now names a PROFILE and that answers both halves. Advanced
// Settings → Supervision holds one row per person — name, chat, devices,
// profile — so where a profile's briefings go is configured once, beside who
// that person is, and `AUDIENCE_OF_ROLE` derives the voice from the same row.
// `pipeline.targets_for` resolves the profile FIRST, which is what makes the
// People panel the thing that decides delivery rather than a screen whose
// settings a stale per-schedule list silently outranks.
//
// ⚠️ AN UNUSABLE PROFILE IS SHOWN, GREYED, AND SUFFIXED WITH THE REASON — and
// the SUFFIX is the load-bearing half. The owner has already reported once that
// a greyed-out control is hard to see on a sunlit wall tablet; colour alone does
// not carry a state. Keeping the option in the list at all (rather than
// filtering it out) is what makes "there is a Guest profile and nobody is set up
// for it" readable — a list that silently omits it says nothing.
//
// ⚠️ AND THERE ARE TWO REASONS, WHICH THE FIRST VERSION COLLAPSED INTO ONE WORD.
// It said `(missing)` on every profile of a villa that HAD a person configured,
// and the owner reported exactly that: "UI believes that no profiles has been
// defined, which is not right". The rule was right — their one person had no
// devices, because the legacy sender migration cannot invent any — and the WORD
// was wrong: "missing" describes the person, and the person was there. The two
// states now say `(nobody configured)` and `(no devices yet)`, because one of
// them means "add a person" and the other means "tick a device on the row you
// already have", and a reader cannot act on a label that conflates them.
//
// ⚠️ AND SUCH A SCHEDULE MUST NOT SAVE, which is the owner's explicit choice
// over the alternatives (save it and deliver nowhere; save it and fall back to
// somebody else). It blocks the whole Save, so the row says which schedule and
// why — a disabled Save with no reason is the failure this dialog has already
// paid for once, with the button below the fold.
//
// ⚠️ NOTHING STORED IS REWRITTEN ON READ. A schedule written before this keeps
// its own `targets` and its own `audience`, and `pipeline.targets_for` still
// honours both BELOW the profile — so an install that never opens this tab goes
// on delivering exactly where it was. Its row shows the profile as "not set"
// and says so. ⚠️ PICKING A PROFILE THEN CLEARS BOTH: after a deliberate edit
// the profile is the only answer, because leaving the old list underneath is
// how a briefing quietly resumes going to a list nobody can see the day the
// person behind that profile is removed.

import ToggleField from "@/components/common/ToggleField";
import InfoHint from "@/components/common/InfoHint";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { fetchNextRuns, type ReportsDiagnostics } from "@/reports/reportsApi";
import { loadAgentConfig, peopleOf, targetsForRole,
         type Person } from "@/agent/agentApi";
import { ROLE_LABELS, ROLE_ORDER, type Role } from "@/auth/roles";
import { useLongPress } from "@/hooks/useLongPress";
import { tapFeedback } from "@/utils/haptics";
import NarrationSection from "./NarrationSection";
import {
  CADENCE, type Cadence, type ReportSchedule, type ReportsConfig,
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

/** A new schedule, for the first profile somebody is actually reachable on.
 *
 *  ⚠️ NOT A SEEDED DEFAULT — it is the answer to "which of these can be saved",
 *  computed from the villa's own people table, and it falls back to leaving the
 *  profile UNSET rather than naming one nobody is configured for. A row that
 *  cannot be saved the moment it is added would be the dialog picking a fight
 *  with the operator over a choice it made itself. */
function newSchedule(reachable: Role[]): ReportSchedule {
  return {
    id: `s${Date.now().toString(36)}`,
    cadence: "weekly",
    hour: DEFAULT_HOUR,
    minute: 0,
    ...(reachable.length > 0 ? { role: reachable[0] } : {}),
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
  /** The villa's people, as Advanced Settings stores them.
   *
   *  ⚠️ READ HERE RATHER THAN THREADED THROUGH THE MODAL, because this is the
   *  only tab that asks. ⚠️ AND `null` IS NOT `[]`: until the answer arrives,
   *  every profile would read as `(missing)` and every schedule as unsavable —
   *  "could not ask yet" rendered as "nobody is configured", which is the exact
   *  lie `collector.connected` was added to replace one subsystem over. */
  const [people, setPeople] = useState<Person[] | null>(null);
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
  useEffect(() => { if (config) setDraft(config); }, [config]);

  useEffect(() => {
    let cancelled = false;
    void loadAgentConfig().then((got) => {
      // ⚠️ AN UNREADABLE STORE LEAVES THIS `null`, NOT EMPTY. A 403 or a
      // restarting core must not be rendered as "nobody is configured for any
      // profile", which would grey every option and block every save with a
      // sentence that is not true.
      if (!cancelled && got) setPeople(peopleOf(got.config));
    });
    return () => { cancelled = true; };
  }, []);

  /** Which profiles a briefing can actually reach. ⚠️ EMPTY WHILE THE TABLE IS
   *  UNREAD, and `known` below is what stops that being read as an answer. */
  const reachable = ROLE_ORDER.filter(
    (r) => targetsForRole(people ?? [], r).length > 0);
  const known = people !== null;
  /** Why a profile cannot be chosen — and there are TWO reasons, which the
   *  first version collapsed into one word.
   *
   *  ⚠️ REPORTED FROM THE SCREEN: every profile read `(missing)` on a villa
   *  that HAD a person configured, and the owner said so — "UI believes that no
   *  profiles has been defined, which is not right". It was not a bug in the
   *  reachability rule: their one person had no devices yet, because the legacy
   *  sender migration cannot invent any. But "missing" describes the person,
   *  and the person was there. The thing that was missing was a DEVICE, which
   *  is a different sentence and a different fix — one of them is "add a
   *  person", the other is "tick a device on the row you already have".
   *
   *  ⚠️ A PERSON WITH A CHAT AND NO DEVICE IS STILL NOT REACHABLE, and that
   *  stays true: a briefing is delivered through a notify target, and a chat is
   *  the inbound half. The wording changed; the rule did not. */
  const profileGap = (r: Role): "" | "nobody" | "no-devices" => {
    if (!known || reachable.includes(r)) return "";
    return (people ?? []).some((entry) => entry.role === r)
      ? "no-devices" : "nobody";
  };
  const GAP_LABEL: Record<string, string> = {
    "no-devices": "no devices yet",
    nobody: "nobody configured",
  };

  // ⚠️ THE DRAFT ITSELF, NOT A DIRTY FLAG. The footer button has to SAVE it, so
  // handing up a boolean would mean keeping a second copy somewhere to save
  // from — and two copies of an edit is how one of them goes stale.
  //
  // ⚠️ AND AN UNSAVABLE DRAFT IS PUBLISHED AS `null`, which is what disables
  // Save. A schedule naming a profile nobody is configured for must not be
  // stored — the owner's explicit choice — and the row itself says which one
  // and why, because a Save button that is simply dead is the defect this tab
  // has already shipped once.
  const blocked = (draft.schedules ?? []).filter(
    (s) => s.role !== undefined && known && !reachable.includes(s.role));
  const settled = config ? JSON.stringify(config) : null;
  const current = JSON.stringify(draft);
  const savable = blocked.length === 0;
  useEffect(() => {
    onDraft(savable && settled !== null && current !== settled
      ? JSON.parse(current) : null);
    return () => onDraft(null);
  }, [current, settled, savable, onDraft]);

  if (!config) {
    return <p className="muted body-text">Reading the schedule…</p>;
  }

  const schedules = draft.schedules ?? [];
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
  const set = (patch: Partial<ReportsConfig>) => setDraft({ ...draft, ...patch });
  const setAt = (i: number, patch: Partial<ReportSchedule>) =>
    set({ schedules: schedules.map((s, n) => (n === i ? { ...s, ...patch } : s)) });
  /** Choosing a profile drops what the profile replaced.
   *
   *  ⚠️ THE TWO LEGACY KEYS GO TOGETHER AND ONLY ON A DELIBERATE EDIT. A stored
   *  `audience` OUTRANKS the derived voice and a stored `targets` list is read
   *  when nobody is configured for the profile — so leaving either behind makes
   *  the control the operator just used a suggestion. Nothing is stripped on
   *  READ: a schedule nobody touches keeps both and keeps working. */
  const setRole = (i: number, role: Role) =>
    set({
      schedules: schedules.map((s, n) => {
        if (n !== i) return s;
        const { audience: _a, targets: _t, ...rest } = s;
        return { ...rest, role };
      }),
    });

  return (
    <div className="reports-pane">
      {/* ⚠️ `label.toggle` IS THE APP'S SHARED CHECKBOX ROW. This shipped as
          `.fm-check`, a class that does not exist anywhere — so the label got
          no flex layout and the input fell back to the browser's native
          rendering: a white square floating above its own text, which is what
          the owner screenshotted. `.fm-check-icon` exists and is for readiness
          status glyphs; the similar name is what made the invention feel safe. */}
      <ToggleField
        checked={draft.enabled === true}
        onChange={(enabled) => set({ enabled })}
        label="Send briefings on a schedule"
        note={<>
Off by default. Read one from the Preview tab first — that is what this
        setting commits you to receiving.
        </>}
      />

      {/* ⚠️ THE BANNER NAMES WHICH OF THE TWO STATES IT IS, for the reason the
          option labels do — "nobody is set up" was shown to an owner who had
          set somebody up, and it reads as the panel being broken rather than as
          a row needing one more tick. */}
      {known && reachable.length === 0 && (
        <div className="fm-banner">
          {(people ?? []).length > 0
            ? "Nobody has a device yet. Advanced Settings → Supervision → "
              + "People lists the people this villa knows; tick a device on the "
              + "row for whoever should receive a briefing, and their profile "
              + "becomes selectable here."
            : "Nobody is set up to receive a briefing. Advanced Settings → "
              + "Supervision → People is where a person's devices and profile "
              + "are configured; until somebody is there, a schedule has "
              + "nowhere to go."}
        </div>
      )}

      <h3 className="settings-section-title">Schedules</h3>
      {/* ⚠️ TWO SENTENCES, AND THE SECOND EARNS ITS PLACE. Prose that repeats
          what the controls show is what makes a panel feel heavy — but the
          profile select is now the only thing on the row that says anything
          about readers, and where it gets its answer from is in another modal.
          The time is the other thing the controls cannot say, because a browser
          shows the READER's clock and the schedule fires on the VILLA's. */}
      <p className="muted body-text">
          One briefing each: how often, at what time, and which profile it is for.
          <InfoHint label="Briefing schedules">
            Times are in the villa’s own clock. Where a profile’s briefings go — and
            whose voice they are written in — comes from that person’s row in
            Advanced Settings → Supervision.
          </InfoHint>
        </p>
      {schedules.length === 0 && (
        <p className="muted body-text">
          None yet. Nothing is sent until you add one.
        </p>
      )}

      {schedules.map((s, i) => {
        /** Where this row's briefing lands, as this dialog can see it. The
         *  legacy answer (`s.targets`, or the shared list under it) is what a
         *  schedule with no profile still uses. */
        const goesTo = s.role !== undefined
          ? targetsForRole(people ?? [], s.role)
          : (s.targets ?? draft.notifyTargets ?? []);
        const missing = s.role !== undefined && known
          && !reachable.includes(s.role);
        return (
          <div key={s.id || i} className="editable-row-card">
            {/* ⚠️ ONE LINE: when · for whom · remove. "To whom" left this row
                in v2.653.0 — it is the person's own row in Advanced Settings
                now, because choosing a profile and choosing a recipient were
                the same choice made twice. */}
            <div className="editable-row">
              {/* ⚠️ THE FIELDS WRAP; THE DELETE DOES NOT. All five controls used
                  to be siblings in one wrapping row, so on a phone the fourth
                  or fifth dropped to a second line and took the delete button
                  with it — reported from a 390px screen, where it sat alone
                  under the row looking like an action on the whole card rather
                  than on that schedule. Grouping the fields lets them wrap
                  among themselves while the button stays on the first line. */}
              <div className="editable-row-fields">
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
              {/* ⚠️ THE PROFILE, AND IT ANSWERS BOTH HALVES — see this file's
                  header. An option nobody is configured for is DISABLED and
                  SUFFIXED, never hidden: the suffix is what carries the state
                  on a sunlit wall tablet, where grey against grey does not.

                  ⚠️ AND A PROFILE THIS SCHEDULE ALREADY NAMES STAYS SELECTABLE
                  even while missing, because a `<select>` cannot show a value
                  that is not among its options — dropping it would silently
                  redraw the row as some other profile's schedule. */}
              <select
                aria-label="For which profile"
                value={s.role ?? ""}
                onChange={(e) => setRole(i, e.target.value as Role)}
              >
                {s.role === undefined && (
                  <option value="" disabled>not set</option>
                )}
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}
                          disabled={!!profileGap(r) && r !== s.role}>
                    {ROLE_LABELS[r]}
                    {profileGap(r) ? ` (${GAP_LABEL[profileGap(r)]})` : ""}
                  </option>
                ))}
              </select>
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
            <p className={`body-text reports-next${
              missing ? " sev-warning" : " muted"}`}>
              {/* ⚠️ THE UNSAVABLE STATE IS SAID FIRST AND IN FULL, because it
                  disables the Save button for the WHOLE dialog — an operator
                  who came to change a time must be able to see why their
                  unrelated edit will not commit. It names the profile, since
                  "a profile" is not something anyone can go and fix. */}
              {missing
                ? profileGap(s.role as Role) === "no-devices"
                  ? `${ROLE_LABELS[s.role as Role]} has nobody with a device, so
                     this schedule cannot be saved. Tick a device on their row
                     under Advanced Settings → Supervision → People.`
                  : `Nobody is set up for the ${ROLE_LABELS[s.role as Role]}
                     profile, so this schedule cannot be saved. Add that person
                     under Advanced Settings → Supervision, or choose another
                     profile.`
                : draft.enabled !== true
                  ? "Nothing is sent — “Send briefings on a schedule” is off."
                  : goesTo.length === 0
                    ? "Nowhere to send this one yet, so it would be composed and not sent."
                    : nextRun[s.id]
                      ? `Next: ${whenNext(nextRun[s.id])}, villa time.${
                          edited(s) ? " Not saved yet." : ""}`
                      : "Working out when this goes out…"}
            </p>

            {/* ⚠️ THE LEGACY SHAPE, NAMED RATHER THAN SILENTLY HONOURED. A
                schedule written before the profile existed still delivers to
                the list it was given, and nothing on screen would otherwise
                say so — the operator would read "not set" and conclude it goes
                nowhere. */}
            {s.role === undefined && (
              <p className="muted body-text reports-next">
                Set up before profiles existed: it goes to
                {" "}{goesTo.length}{" "}
                destination{goesTo.length === 1 ? "" : "s"} chosen at the time.
                Choosing a profile above replaces that.
              </p>
            )}
          </div>
        );
      })}

      <button
        className="btn"
        onClick={() => set({ schedules: [...schedules, newSchedule(reachable)] })}
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
