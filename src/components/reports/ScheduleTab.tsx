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
// ⚠️ DESTINATIONS ARE PER-SCHEDULE, WITH THE SHARED LIST AS THE DEFAULT — and
// `pipeline.targets_for` has worked that way since Phase 2 (a schedule's own
// `targets` wins; otherwise the shared list). Only this tab never showed it,
// which forced every brief to the same people and made the audience selector
// look like it chose a recipient. It does not: it chooses what is IN the brief.
// The owner asked for exactly this — "it would make more sense to add this menu
// for each schedule, so the user can individually select where to send each
// report and at what time."
//
// The shared list stays, and stays FIRST, because it is the common case: one
// property, one or two destinations, every brief to both. A schedule opts OUT
// of it by naming its own. Two ways to set one thing is a config nobody can
// reason about UNLESS the relationship is stated at the control, so it is —
// each row says whether it is following the shared list or overriding it.

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
  useEffect(() => { if (config) setDraft(config); }, [config]);

  if (!config) {
    return <p className="muted body-text">Reading the schedule…</p>;
  }

  const schedules = draft.schedules ?? [];
  const targets = draft.notifyTargets ?? [];
  const available = diagnostics?.notifyTargets ?? [];
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

      <h3 className="reports-h3">Schedules</h3>
      <p className="muted body-text">
        How often, at what hour in the villa&rsquo;s own time, and who it is
        written for. <strong>Written for</strong> changes what the brief
        contains — an owner brief includes running costs, a facility brief is
        the work list. It does not choose a recipient: each schedule is
        delivered to the shared list below unless you give it its own
        destinations.
      </p>
      {schedules.length === 0 && (
        <p className="muted body-text">None yet.</p>
      )}
      {schedules.map((s, i) => (
        <div key={s.id || i} className="reports-schedule">
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
            onChange={(e) => setAt(i, { audience: e.target.value as ReportSchedule["audience"] })}
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

          {/* ⚠️ THE RELATIONSHIP BETWEEN THE TWO LISTS IS STATED AT THE
              CONTROL. Two ways to set one thing is a config nobody can reason
              about unless each row says which one is in force — so a schedule
              following the shared list SAYS SO, and names how many that is,
              rather than showing an empty list that reads as "nowhere". */}
          <div className="reports-subrow">
            {s.targets === undefined ? (
              <>
                <span className="muted body-text">
                  Sent to the shared list below
                  {targets.length > 0 ? ` (${targets.length})` : " — which is empty"}.
                </span>
                <button
                  className="btn ghost"
                  onClick={() => setAt(i, { targets: [] })}
                >
                  Send this one somewhere else
                </button>
              </>
            ) : (
              <>
                <span className="muted body-text">
                  This schedule only:
                </span>
                <button
                  className="btn ghost"
                  onClick={() => setAt(i, { targets: undefined })}
                >
                  Use the shared list
                </button>
                <div style={{ flexBasis: "100%" }}>
                  <DestinationList
                    targets={s.targets}
                    available={available}
                    onChange={(next) => setAt(i, { targets: next })}
                    emptyText="Nowhere — this schedule would be composed and not sent."
                  />
                </div>
              </>
            )}
          </div>
        </div>
      ))}
      <button
        className="btn"
        onClick={() => set({ schedules: [...schedules, newSchedule()] })}
      >
        <Plus size={16} /><span>Add a schedule</span>
      </button>

      <h3 className="reports-h3">Where briefings go</h3>
      <p className="muted body-text">
        The shared list: every schedule above uses it unless it names its own.
        Any Home Assistant service that accepts a title and a message can be a
        destination — the brief is plain text, so it arrives the same way any
        other notification does.
      </p>
      <DestinationList
        targets={targets}
        available={available}
        onChange={(next) => set({ notifyTargets: next })}
        emptyText="Nothing configured — a scheduled brief would be composed and have nowhere to go."
      />

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
