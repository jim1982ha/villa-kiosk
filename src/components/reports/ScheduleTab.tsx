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
  const set = (patch: Partial<ReportsConfig>) => setDraft({ ...draft, ...patch });
  const setAt = (i: number, patch: Partial<ReportSchedule>) =>
    set({ schedules: schedules.map((s, n) => (n === i ? { ...s, ...patch } : s)) });

  return (
    <div className="reports-pane">
      <label className="fm-check">
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
      {/* ⚠️ `notify.notify` FANS OUT TO EVERY DEVICE IN THE HOUSE. It is a
          perfectly good service and a terrible default — a villa that switches
          reports on and gets the weekly summary on the TV, three phones and a
          tablet switches them off again. Discovery flags it; this warns. */}
      <ul className="reports-list">
        {(diagnostics?.capabilities.includes("notify") ? targets : []).map((t) => (
          <li key={t} className="reports-item">
            <span>{t}</span>
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
        {targets.some((t) => t.endsWith(".notify")) && (
          <li className="reports-item sev-warning">
            One of these sends to every device in the house at once.
          </li>
        )}
      </ul>

      <button className="btn primary" disabled={busy} onClick={() => onSave(draft)}>
        <Save size={16} /><span>{busy ? "Saving…" : "Save"}</span>
      </button>
    </div>
  );
}
