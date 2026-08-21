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
// difference). WHERE it goes is `notify_targets`, which is one shared list for
// every schedule. So picking "facility" does NOT route anything to a facility
// manager; it changes the prose, and the same notification targets receive it.
// The owner asked this outright — "how would the system know where to send the
// report based on the owner/facility selection?" — which is the question a
// two-column row of unlabelled selects invites, and the honest answer is that
// it does not. Both facts are now stated in the UI beside the controls.
//
// ⚠️ AND THE TARGET LIST HAD NO WAY TO ADD ONE. It rendered `notifyTargets`
// with a delete button per row and no picker, so "Nothing configured — a
// scheduled brief would be composed and have nowhere to go" was a permanent
// state reachable only by editing the store by hand.
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

import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { ReportsDiagnostics } from "@/reports/reportsApi";
import NarrationSection from "./NarrationSection";
import DestinationList from "./DestinationList";
import {
  AUDIENCE, CADENCE, type Cadence, type ReportSchedule, type ReportsConfig,
} from "@/reports/reportsTypes";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** ⚠️ Display defaults only, applied at RENDER and never written back. */
const DEFAULT_HOUR = 7;

function newSchedule(): ReportSchedule {
  return {
    id: `s${Date.now().toString(36)}`,
    cadence: "weekly",
    hour: DEFAULT_HOUR,
    audience: "owner",
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
  config, diagnostics, busy, onSave, secretsConfigured, onSaveSecret,
}: {
  config: ReportsConfig | null;
  diagnostics: ReportsDiagnostics | null;
  busy: boolean;
  onSave: (next: ReportsConfig) => void;
  secretsConfigured: Record<string, boolean>;
  onSaveSecret: (provider: string, value: string) => void;
}) {
  const [draft, setDraft] = useState<ReportsConfig>({});

  // Re-seed only when the server's copy changes, so typing is never clobbered
  // by a background reload — the same ordering rule `DeviceConfigSync` follows.
  useEffect(() => { if (config) setDraft(adoptSharedTargets(config)); }, [config]);

  if (!config) {
    return <p className="muted body-text">Reading the schedule…</p>;
  }

  const schedules = draft.schedules ?? [];
  const available = diagnostics?.notifyTargets ?? [];
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
      <p className="muted body-text">
        Each schedule is one briefing: how often, at what hour in the
        villa&rsquo;s own time, who it is written for, and who receives it.
        <strong> Written for</strong> chooses the CONTENT — an owner brief
        includes running costs, a facility brief is the work list — and{" "}
        <strong>Sends to</strong> chooses the recipients. They are independent:
        a facility brief can go to the owner&rsquo;s phone.
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
            <div className="reports-schedule">
              <select
                aria-label="How often"
                value={s.cadence}
                onChange={(e) => setAt(i, { cadence: e.target.value as Cadence })}
              >
                {CADENCE.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                aria-label="At"
                value={s.hour}
                onChange={(e) => setAt(i, { hour: Number(e.target.value) })}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                ))}
              </select>
              <select
                aria-label="Written for"
                value={s.audience}
                onChange={(e) =>
                  setAt(i, { audience: e.target.value as ReportSchedule["audience"] })}
              >
                {AUDIENCE.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <button
                className="btn danger icon-only"
                aria-label="Remove this schedule"
                onClick={() => set({ schedules: schedules.filter((_, n) => n !== i) })}
              >
                <Trash2 size={16} />
              </button>
            </div>

            {/* ⚠️ INSIDE THE CARD, NOT BESIDE IT. "Who gets this one" is a
                property of the schedule, and the previous design made an
                operator cross-reference a list further down the page to answer
                it. Any Home Assistant action that accepts a title and a message
                qualifies — see `discovery._speaks_message` — which is why this
                is not called "notification services". */}
            <div className="reports-subrow">
              <span className="muted body-text">Sends to</span>
            </div>
            <DestinationList
              targets={own}
              available={available}
              onChange={(next) => setAt(i, { targets: next })}
              emptyText="Nobody — this briefing would be composed and not sent."
            />
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
        keyStored={secretsConfigured.anthropic === true}
        busy={busy}
        onSaveSecret={onSaveSecret}
      />

      <button className="btn primary" disabled={busy} onClick={() => onSave(draft)}>
        <Save size={16} /><span>{busy ? "Saving…" : "Save"}</span>
      </button>
    </div>
  );
}
