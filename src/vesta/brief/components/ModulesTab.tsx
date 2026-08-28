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
//   2  VESTA's own checks          on/off, and why each ran
//   3  Adding your own             how to extend it — blueprints, not code
//
// ⚠️ "YOUR AUTOMATIONS" WAS STEP 2 HERE AND IS NOW ITS OWN TAB (2026-08-29).
// Its line read "the primary detection layer, which WINS", false since 2.755.0
// — but the deeper problem was that it was on this tab at all: a briefing is a
// periodic summary and an automation is an instant reaction, so what the
// automations did is not part of what a briefing is built from. See
// `AutomationsTab`.
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
// section 2 is read through it: a count means "this family is quiet" only if
// something is actually listening, and means nothing at all if nothing is. The
// field this replaced was derived from a persisted timestamp written once and
// never cleared, so it read `true` forever after the first subscribe — through
// every drop and restart. See `collect._LIVE`.
//
// ⚠️ THIS PARAGRAPH EXPLAINED HOW TO READ `silentTypes`, DELETED IN 2.835.0
// because nothing has subscribed to those events since the cutover — so it
// could only ever report every family as silent. A comment outliving the field
// it explains is the shape /dry-audit Part 3 exists for.

import { Ban, Check, Info, PlugZap, Radio, RefreshCw } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import type { ReportPreview, ReportsDiagnostics } from "@/vesta/brief/reportsApi";
import type { ReportsConfig } from "@/vesta/shared/reportsTypes";

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
/* ⚠️ `FAMILIES` LEFT WITH THE SECTION IT FED. It was a second copy of
   `shared/tiers.tsx`'s table and the two had already disagreed once — this one
   called maintenance "being replaced by the built-in checks below", which named
   the wrong successor. `AutomationsTab` reads the shared table, so a family has
   one description again. */

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
      {/* ⚠️ THE MODE IS GONE FROM THIS SENTENCE (2026-08-29), on the owner's
          own reasoning: the briefing has never read an automation's output, so
          standing a check down for supervision-off traded the briefing's ONLY
          analysis input for a layer that cannot reach it. The checks run in
          both modes now; `registry.gate` records the full argument. */}
      <p className="muted body-text">
        What this property is watched by, and what a brief can be built from.
        VESTA runs the checks below itself, whatever the supervision switch
        says — in every briefing, and again when the agent investigates
        something. The toggles here are the one thing that stops a check.
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

      {/* ⚠️ "Alerts held" AND "Last alert" WERE DELETED HERE (2026-08-28), and
          they are the Observe tab's defect in a second dialog. Both read the
          COLLECTOR — the blueprint/chat event stream — and since the cutover it
          carries chat only, so "Last alert" was the last Telegram message and
          "Alerts held" was a buffer that can no longer grow from anything
          else. The owner caught the same pair on Observe ("last change seen 34h
          ago … I can't be true, right?"); I fixed the element that was reported
          and not its twin, which is this file's own lesson about rolling a fix
          out by call site.
          ⚠️ `onlineSince` STAYS, and is the one of the three that was always
          honest: it answers "how much of the reporting period can this add-on
          speak for", which is a real precondition for reading any brief. */}
      <dl className="reports-facts">
        <div><dt>Listening since first ever</dt><dd>{when(c.onlineSince)}</dd></div>
      </dl>

      <div>
        <button className="btn ghost" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{busy ? "Checking…" : "Check again"}</span>
        </button>
      </div>

      {/* ⚠️ "YOUR AUTOMATIONS" IS ITS OWN TAB NOW (2026-08-29, the owner's
          reason): "this tab is about briefing, and reporting/briefing doesn't
          rely on instant alerts received from automations". An automation is an
          INSTANT reaction and has already acted before anything is composed; a
          briefing is a PERIODIC summary. Two jobs, so the automations do not
          belong on a tab about what a briefing is built from — and that holds
          whatever the supervision switch says, which is what makes it a better
          rule than the one I proposed (their counters are frozen, which is only
          a symptom). See `AutomationsTab`. */}

      {/* ── 2. VESTA's own checks ──────────────────────────────────────────── */}
      <h3 className="settings-section-title">VESTA’s own checks</h3>
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
                  heading reading "VESTA’s own checks", so a "VESTA check" chip
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
                {/* ⚠️ SINCE 2.873.0 THE SWITCH REACHES THE AGENT TOO — one
                    switch, one meaning — so the sentence promising "the agent
                    can still run it" that stood here was false the moment that
                    shipped. Third stale copy from that day's releases. */}
                <span>
                  Switched off — for briefings and for the agent alike. The
                  brief will say so rather than omit it.
                </span>
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
          <InfoHint label="VESTA’s own checks">
            Your own Home Assistant automations are what extend a brief: anything they
            report is grouped, priced and written in automatically. “Your automations”
            above lists what has been heard, which is how you confirm a rule is
            actually firing.
          </InfoHint>
        </p>
    </div>
  );
}
