// src/components/reports/ModulesTab.tsx
// The whole detection picture on one tab: whether anything is listening, what
// this property's own automations have reported, which built-in checks are
// switched on, and — for every one that will not run — the reason.
//
// ⚠️ THIS WAS TWO TABS, "Checks" AND "Diagnostics", AND THEY ANSWERED ONE
// QUESTION BETWEEN THEM (2026-08-22, owner request). The split forced the
// reader to hold half an answer while they went to find the other half:
// Diagnostics listed the built-in checks as `name · needs N days`, which is a
// strictly thinner copy of the rows below, and this tab's own closing sentence
// ended "Diagnostics lists what has been heard, which is how you confirm a new
// one is arriving" — a cross-reference to a tab that no longer exists, which is
// the tell that the two belonged together. A duplicated list is also a list
// that can disagree with itself, and the thin copy had no toggle, so a check
// switched OFF still appeared there as if it were running.
//
// The order is the order the answer is actually built, top down, and each
// section is a precondition for the one under it:
//
//   1  Is anything listening?      nothing below means anything if it is not
//   2  Your automations            the primary detection layer, which WINS
//   3  Built-in checks             the fallback, on/off, and why each ran
//   4  Adding your own             how to extend it — blueprints, not code
//
// ⚠️ THE PLAN NAMED THIS TAB AND PHASE 5 SHIPPED WITHOUT IT. The interface
// phase specified "Overview · Modules · History · Schedule · Diagnostics" and
// what shipped was Preview · Coverage · Schedule · History · Diagnostics, so
// `config.modules` — the operator's per-check on/off switch, which the backend
// gate has honoured since Phase 3 — had no surface at all. The owner found it
// by reading the spec back: "where does the user select which module the
// briefing report shall be based on?" Nowhere, until now.
//
// ⚠️ A MODULE IS SHIPPED CODE, NOT USER CONTENT, AND THIS TAB DOES NOT PRETEND
// OTHERWISE. There is no Add and no Delete, because a module is a Python file
// inside the add-on that registers itself at import time — adding one is an
// add-on release. What an operator can do is switch one OFF, and what they can
// ADD to this property is BLUEPRINTS, which are a different and much larger
// surface: the villa's own automations fire `vesta_*` events that the composer
// picks up with no code change at all. The copy says so, because a tab listing
// three items with a toggle each invites "where is the + button".
//
// ⚠️ EVERY ROW STATES WHY, INCLUDING THE ONES THAT RAN. `describe_skips` has
// carried a reason since Phase 3 and it reached only the report body. A module
// silently absent from a list reads as "not applicable", which is a claim
// nobody made — the same rule `ran` vs `skipped` exists for one layer down.
//
// ⚠️ `connected` IS THE LIVE SOCKET, NOT A STORED FLAG, and every count in
// section 2 is read through it. `silentTypes` means "these categories are
// quiet" only if something is actually listening; if nothing is, they mean
// nothing at all. The field this replaced was derived from a persisted
// timestamp written once and never cleared, so it read `true` forever after the
// first subscribe — through every drop and restart. See `collect._LIVE`.

import { Ban, Check, Info, PlugZap, Radio, RefreshCw } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import type { ReportPreview, ReportsDiagnostics } from "@/reports/reportsApi";
import type { ReportsConfig } from "@/reports/reportsTypes";

function when(iso: string): string {
  if (!iso) return "never";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

/** What each shipped blueprint family is FOR, and whether it survives.
 *
 *  ⚠️ DERIVED FROM THE CUTOVER ORDER IN `docs/PROGRESS.md`, NOT FROM TASTE.
 *  `maintenance_*` retires first (two of its rules suppress the very checks
 *  that replace them), then `roi_*` starting with `roi_baseline_deviation`
 *  (zero instances, suppressing `level_anomaly` for nothing), then `audit_*`
 *  EXCEPT `audit_notification_path`, which has no successor of any kind and is
 *  the weekly proof the alert channel still works. `critical_*` was never on
 *  that list: ADR-019 keeps ~6 as reflexes, because "a leak must close a valve
 *  in under a second with no WAN and no model in the path. That is physics,
 *  not conservatism."
 *
 *  ⚠️ SO THIS TABLE IS ALREADY CORRECT ON THE DAY THE CUTOVER FINISHES. The
 *  rows for retiring families simply stop appearing — nothing here has to be
 *  edited, which is the property the whole redesign was asked to have.
 *
 *  ⚠️ AND AN UNKNOWN CATEGORY RENDERS PLAINLY RATHER THAN AS AN ERROR. Anyone
 *  can fire a `vesta_<something>_event` from their own automation — that is the
 *  documented extension point, stated at the bottom of this very tab — so a
 *  category we have no opinion about is the SUPPORTED case, not a fault. */
const FAMILIES: Record<string, { role: string; reflex?: true }> = {
  critical: {
    role: "acts in under a second, on this property, with no AI involved",
    reflex: true,
  },
  maintenance: { role: "being replaced by the built-in checks below" },
  roi: { role: "being replaced by the built-in checks below" },
  audit: { role: "proves the alert channel still works" },
};

export default function ModulesTab({
  diagnostics, config, preview, busy, onSave, onRefresh,
}: {
  diagnostics: ReportsDiagnostics | null;
  config: ReportsConfig | null;
  /** The last composed preview, if the operator has run one. ⚠️ THE ONLY PLACE
   *  A LIVE SKIP REASON EXISTS — the gate runs during a pass, so "why did this
   *  not run" is an answer about a PASS, not about configuration. Absent until
   *  one has been composed, and the copy says so rather than implying the
   *  module is fine. */
  preview: ReportPreview | null;
  busy: boolean;
  onSave: (next: ReportsConfig) => void;
  /** ⚠️ RE-PROBES LIVE. `/reports-diagnostics` opens a websocket and walks the
   *  recorder on every request, so this is the real thing rather than a cache
   *  bust — and it is why nothing here polls. The collector banner is the one
   *  reading on this tab that can change while the dialog sits open, which is
   *  why the button came with it from the old Diagnostics tab. */
  onRefresh: () => void;
}) {
  if (!diagnostics || !config) {
    return <p className="muted body-text">Reading the check list…</p>;
  }

  const c = diagnostics.collector;
  const slices = config.modules ?? {};
  const isOn = (name: string) => slices[name]?.enabled !== false;
  const ran = new Set(preview?.analysis.ran ?? []);
  const skipReason = new Map(
    (preview?.analysis.skipped ?? []).map((s) => [s.module, s.reason]));

  const toggle = (name: string, on: boolean) =>
    onSave({ ...config, modules: { ...slices, [name]: { ...slices[name], enabled: on } } });

  return (
    <div className="reports-pane">
      {/* ⚠️ ONE SENTENCE, NOT TWO BEHIND A FLAG (2.755.0). This paragraph
          used to switch on `agent_owns_analysis` and describe two different
          precedence rules, because there genuinely were two. There is one now:
          supervision on, the checks run; supervision off, your automations do
          the job. */}
      <p className="muted body-text">
        What this property is watched by, and what a brief can be built from.
        While supervision is on these checks all run; switch it off and the
        automations you built take the job back.
      </p>

      {/* ── 1. Is anything listening? ───────────────────────────────────── */}
      <div className={`fm-banner ${c.connected ? "" : "warn"}`}>
        {c.connected ? <Radio size={16} /> : <PlugZap size={16} />}
        <span>
          {c.connected
            ? `Listening since ${when(c.connectedSince)}.`
            : "Not listening. Findings fired now would not reach a report."}
          {c.drops > 0 && ` Reconnected ${c.drops} time${c.drops === 1 ? "" : "s"} since this add-on started.`}
        </span>
      </div>

      <dl className="reports-facts">
        <div><dt>Alerts held</dt><dd>{c.buffered}</dd></div>
        <div><dt>Last alert</dt><dd>{when(c.lastEventAt)}</dd></div>
        <div><dt>Listening since first ever</dt><dd>{when(c.onlineSince)}</dd></div>
      </dl>

      <div>
        <button className="btn ghost" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{busy ? "Checking…" : "Check again"}</span>
        </button>
      </div>

      {/* ── 2. Your automations ─────────────────────────────────────────── */}
      <h3 className="settings-section-title">Your automations</h3>
      {/* ⚠️ THE SAME `.reflex-table` THE AGENT'S REFLEX TAB USES. This was the
          identical list in `.reports-item` flex rows — name, chip, sentence and
          count on one line — and it wrapped just as badly here. One rule for one
          shape, so a fix to the readable version lands on both.
          ⚠️ AND THE PER-ROW CHIP IS GONE for the same reason it went there: it
          repeated what the row's own sentence already says. */}
      <dl className="reflex-table">
        {c.blueprintCategories.map((cat) => {
          const seen = c.seenTypes[`vesta_${cat}_event`] ?? 0;
          const family = FAMILIES[cat];
          return (
            <div key={cat} className={`reflex-row${seen ? "" : " muted"}`}>
              <dt>{cat}</dt>
              <dd className="reflex-role">{family?.role ?? ""}</dd>
              <dd className="reflex-count">
                {seen ? `${seen} received` : "nothing yet"}
              </dd>
            </div>
          );
        })}
        {c.blueprintCategories.length === 0 && (
          <p className="muted body-text">
            No automations of this kind are installed. That changes nothing
            here — while supervision is on, the checks below run either way.
          </p>
        )}
      </dl>
      {diagnostics.capabilities.includes("blueprint_layer") ? (
        <p className="reports-item">
          <Check size={14} aria-hidden="true" />
          <span>
            Your automations are reporting, and they win: a built-in check below
            steps aside where one covers the same ground, because your
            automation knows about occupancy, schedules and tariffs and a
            statistic does not.
          </span>
        </p>
      ) : (
        <p className="reports-item muted">
          Nothing has reported yet, so the checks below are the only analysis
          running.
        </p>
      )}

      {/* ── 3. Built-in checks ──────────────────────────────────────────── */}
      <h3 className="settings-section-title">Built-in checks</h3>
      {diagnostics.modules.length === 0 && (
        <p className="reports-item sev-warning">
          None are registered. That is a fault in the add-on, not a setting.
        </p>
      )}

      {/* ⚠️ THEIR OWN LIST, SO THE GAP BETWEEN CHECKS IS THE GAP BETWEEN TASKS.
          These were direct children of `.reports-pane`, which spaces everything
          it holds — headings, banners, paragraphs — at 12px, so the distance
          between two checks was the distance between two SECTIONS. Tasks sit at
          8px (`.reports-tasks`) and read as one list; a wrapper is what lets
          these say the same thing without changing the pane for every other
          surface that uses it. */}
      <div className="reports-checks">
      {diagnostics.modules.map((m) => {
        const on = isOn(m.name);
        const missing = m.requires.filter((r) => !diagnostics.capabilities.includes(r));
        const reason = skipReason.get(m.name);
        return (
          <div key={m.name} className="reports-entry">
            {/* ⚠️ THE TITLE AND THE SENTENCE COME FROM THE MODULE ITSELF. This
                showed the identifier with its underscores removed — "level
                anomaly" — beside "owner and facility · needs 42 days of
                history", and the owner said it read like internal comments. It
                did: an identifier is not a name, and a capability list is a
                precondition rather than a purpose. Somebody deciding whether to
                switch a check OFF needs to know what it would stop telling
                them.
                ⚠️ `minDays` IS THE ONE FACT THE DELETED Diagnostics TAB HELD
                THAT THIS ROW DID NOT, so it comes across rather than being
                dropped with the tab. It rides the head's existing
                `space-between`, opposite the toggle. */}
            <div className="reports-entry-head">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={(e) => toggle(m.name, e.target.checked)}
                />
                <span>{m.title}</span>
              </label>
              {/* ⚠️ THE CHIP ANSWERS THE QUESTION THE TAB'S OWN COPY RAISES.
                  This list sits two tabs from a briefing an AI may have
                  written, and a reader has no way to know these are fixed
                  arithmetic over their own history rather than more of the
                  same. They are the SUCCESSOR to the maintenance/ROI rules
                  being retired, so "always works the same way, and you can
                  switch it off" is the property that makes that swap
                  acceptable — and it is worth saying on the row. */}
              {/* ⚠️ NO `SourceChip` HERE. Every row in this list sits under a
                  heading reading "Built-in checks", so a "Built-in check" chip
                  on each one repeats the section title once per row — the same
                  redundancy the reflex table had, reported in the same breath.
                  The chip earns its place where a list MIXES sources; this list
                  has exactly one. */}
              <span className="reports-entry-meta">
                <span className="muted">needs {m.minDays} days</span>
              </span>
            </div>
            {m.description && (
              <p className="muted body-text">{m.description}</p>
            )}

            {/* ⚠️ ONE LINE, AND ONLY WHEN IT SAYS SOMETHING. The old version
                printed a green "This property has the data it needs" on every
                row — a status that is true of every healthy check and therefore
                carries no information, three times over. Silence is the good
                case; a row speaks when something is stopping it. */}
            {missing.length > 0 && (
              <p className="reports-item sev-warning">
                <Ban size={14} aria-hidden="true" />
                <span>
                  Not possible here.{" "}
                  {missing.map((cap) => diagnostics.capabilityAbsent[cap] || cap).join(" ")}
                </span>
              </p>
            )}
            {!on && missing.length === 0 && (
              <p className="reports-item muted">
                <span>Switched off. The brief will say so rather than omit it.</span>
              </p>
            )}
            {reason && (
              <p className="reports-item muted">
                <Info size={14} aria-hidden="true" />
                <span>Last preview: {reason}</span>
              </p>
            )}
            {ran.has(m.name) && (
              <p className="reports-item">
                <Check size={14} aria-hidden="true" />
                <span>Ran in the last preview.</span>
              </p>
            )}
          </div>
        );
      })}
      </div>

      {!preview && (
        <p className="muted body-text">
          Compose a brief from the Preview tab to see which of these actually
          ran and why the others did not — that is decided during a pass, not
          by these settings alone.
        </p>
      )}

      {/* ⚠️ THE ANSWER TO "HOW DO I ADD ONE". Without this the tab reads as an
          incomplete CRUD screen. The extensible layer really is the blueprint
          one, and it needs no add-on change whatsoever — that is the pivot this
          whole subsystem was rebuilt around. */}
      {/* ⚠️ REWRITTEN OUT OF DEVELOPER LANGUAGE. It said "any Home Assistant
          automation that fires a `vesta_*` event is picked up, deduplicated,
          costed and written into the brief" — four verbs of pipeline internals
          and a wildcard nobody outside this repo can act on. What the reader
          needs is: these are not yours to manage, your automations are, and
          here is how to tell they arrived. The event-name detail belongs in the
          README with the rest of the integration contract, not on a settings
          screen. */}
      <h3 className="settings-section-title">Adding your own checks</h3>
      <p className="muted body-text">
          These arrive with the add-on — nothing to install, nothing to delete.
          <InfoHint label="Built-in checks">
            Your own Home Assistant automations are what extend a brief: anything they
            report is grouped, priced and written in automatically. “Your automations”
            above lists what has been heard, which is how you confirm a rule is
            actually firing.
          </InfoHint>
        </p>
    </div>
  );
}
