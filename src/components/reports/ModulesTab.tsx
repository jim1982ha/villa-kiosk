// src/components/reports/ModulesTab.tsx
// The checks this add-on can run, whether each one is switched on, and — for
// every one that will not run — the reason.
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

import { Check, Ban, Info } from "lucide-react";
import type { ReportPreview, ReportsDiagnostics } from "@/reports/reportsApi";
import type { ReportsConfig } from "@/reports/reportsTypes";

export default function ModulesTab({
  diagnostics, config, preview, busy, onSave,
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
}) {
  if (!diagnostics || !config) {
    return <p className="muted body-text">Reading the check list…</p>;
  }

  const slices = config.modules ?? {};
  const isOn = (name: string) => slices[name]?.enabled !== false;
  const ran = new Set(preview?.analysis.ran ?? []);
  const skipReason = new Map(
    (preview?.analysis.skipped ?? []).map((s) => [s.module, s.reason]));

  const toggle = (name: string, on: boolean) =>
    onSave({ ...config, modules: { ...slices, [name]: { ...slices[name], enabled: on } } });

  return (
    <div className="reports-pane">
      <p className="muted body-text">
        Checks the add-on runs against this property&rsquo;s own history. Each
        needs particular data to be possible at all, and one that cannot run
        says so instead of going quiet.
      </p>

      <h3 className="reports-h3">Built-in checks</h3>
      {diagnostics.modules.length === 0 && (
        <p className="reports-item sev-warning">
          None are registered. That is a fault in the add-on, not a setting.
        </p>
      )}

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
                them. */}
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
                  {missing.map((c) => diagnostics.capabilityAbsent[c] || c).join(" ")}
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
      <h3 className="reports-h3">Adding your own checks</h3>
      <p className="muted body-text">
        These three arrive with the add-on — nothing to install, nothing to
        delete. Your own Home Assistant automations are the ones that extend a
        brief: anything they report is grouped, priced and written in
        automatically. Diagnostics lists what has been heard, which is how you
        confirm a new one is arriving.
      </p>
      {diagnostics.capabilities.includes("blueprint_layer") ? (
        <p className="reports-item">
          <Check size={14} aria-hidden="true" />
          <span>
            Your automations are reporting, and they win: a built-in check above
            steps aside where one covers the same ground, because your
            automation knows about occupancy, schedules and tariffs and a
            statistic does not.
          </span>
        </p>
      ) : (
        <p className="reports-item muted">
          Nothing has reported yet, so the checks above are the only analysis
          running.
        </p>
      )}
    </div>
  );
}
