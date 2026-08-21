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
// state reachable only by editing the store by hand. `pipeline.targets_for`
// also supports per-SCHEDULE targets; that is deliberately not exposed yet —
// one destination list is the common case and two ways to set it is the shape
// of a config nobody can reason about.

import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { ReportsDiagnostics } from "@/reports/reportsApi";
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
  config, diagnostics, busy, onSave,
}: {
  config: ReportsConfig | null;
  diagnostics: ReportsDiagnostics | null;
  busy: boolean;
  onSave: (next: ReportsConfig) => void;
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
  const unused = available.filter((t) => !targets.includes(t.service));
  /** A configured target keeps its friendly name if discovery still knows it,
   *  and prints as its raw service id if it does not — a target that has since
   *  been removed from Home Assistant must stay VISIBLE and removable, not
   *  silently disappear from a list the operator is auditing. */
  const nameFor = (service: string) => {
    const known = available.find((t) => t.service === service);
    return known && known.name !== service ? `${known.name} — ${service}` : service;
  };
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
        the work list — not where it is sent. Every schedule goes to the same
        destinations, set below.
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
        Every schedule above is delivered to all of these. Home Assistant
        notification services only — the brief is plain text, so it arrives the
        same way any other HA notification does.
      </p>
      {/* ⚠️ `notify.notify` FANS OUT TO EVERY DEVICE IN THE HOUSE. It is a
          perfectly good service and a terrible default — a villa that switches
          reports on and gets the weekly summary on the TV, three phones and a
          tablet switches them off again. Discovery flags it; this warns. */}
      <ul className="reports-list">
        {targets.map((t) => (
          <li key={t} className="reports-item">
            <span>{nameFor(t)}</span>
            <button
              className="btn danger icon-only"
              aria-label={`Stop sending to ${t}`}
              onClick={() => set({ notifyTargets: targets.filter((x) => x !== t) })}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
        {targets.length === 0 && (
          <li className="reports-item muted">
            Nothing configured — a scheduled brief would be composed and have
            nowhere to go.
          </li>
        )}
        {targets.some((t) => t === "notify.notify") && (
          <li className="reports-item sev-warning">
            One of these sends to every device in the house at once.
          </li>
        )}
      </ul>

      {/* ⚠️ A PICKER, NOT A TEXT FIELD. The services are already known —
          discovery enumerates them — and a free-text service name that does not
          exist fails silently at delivery time, hours later, on nobody's
          screen. `unused` is empty when everything discovered is already a
          target, which is a different state from "this property has no notify
          services" and reads differently below. */}
      {available.length === 0 ? (
        <p className="muted body-text">
          This property has no Home Assistant notification services, so there is
          nowhere to deliver a brief. Set one up in Home Assistant first.
        </p>
      ) : unused.length > 0 && (
        <div className="reports-schedule">
          <select
            aria-label="Add a destination"
            value=""
            onChange={(e) => {
              const service = e.target.value;
              if (service) set({ notifyTargets: [...targets, service] });
            }}
          >
            <option value="">Add a destination…</option>
            {unused.map((t) => (
              <option key={t.service} value={t.service}>
                {t.name === t.service ? t.service : `${t.name} — ${t.service}`}
                {t.broadcast ? " (every device)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <button className="btn primary" disabled={busy} onClick={() => onSave(draft)}>
        <Save size={16} /><span>{busy ? "Saving…" : "Save"}</span>
      </button>
    </div>
  );
}
