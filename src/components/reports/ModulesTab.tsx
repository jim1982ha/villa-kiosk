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
        These are the checks built into the add-on. Each one needs particular
        data to be possible at all — a check that cannot run says so rather than
        going quiet, both here and in the brief itself.
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
            <div className="reports-entry-head">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={(e) => toggle(m.name, e.target.checked)}
                />
                <span>{m.name.replace(/_/g, " ")}</span>
              </label>
              <span className="muted">
                {m.audiences.join(" and ")} · needs {m.minDays} days of history
              </span>
            </div>

            {/* ⚠️ THE CAPABILITY CHECK IS SHOWN WHATEVER THE TOGGLE SAYS, and
                it comes FIRST — the backend gate is ordered the same way and
                for the same reason. "This property has no device metering" is
                more useful than "you have not enabled it" about a check that
                could never have worked. */}
            <ul className="reports-deliveries">
              {missing.length > 0 ? (
                <li className="reports-delivery status-skipped">
                  <span>
                    <Ban size={12} aria-hidden="true" /> Not possible here:{" "}
                    {missing.map((c) => diagnostics.capabilityAbsent[c] || c).join(" ")}
                  </span>
                </li>
              ) : (
                <li className="reports-delivery">
                  <span>
                    <Check size={12} aria-hidden="true" /> This property has the
                    data it needs.
                  </span>
                </li>
              )}
              {!on && (
                <li className="reports-delivery status-skipped">
                  <span>Switched off, so it is reported as switched off rather
                    than omitted.</span>
                </li>
              )}
              {ran.has(m.name) && (
                <li className="reports-delivery">
                  <span><Check size={12} aria-hidden="true" /> Ran in the last preview.</span>
                </li>
              )}
              {reason && (
                <li className="reports-delivery status-skipped">
                  <span><Info size={12} aria-hidden="true" /> Last preview: {reason}</span>
                </li>
              )}
            </ul>
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
      <h3 className="reports-h3">Adding your own checks</h3>
      <p className="muted body-text">
        The checks above ship with the add-on and arrive with its updates —
        there is nothing to install and nothing to delete here. What this
        property can add is <strong>automations</strong>: any Home Assistant
        automation that fires a <code>vesta_*</code> event is picked up,
        deduplicated, costed and written into the brief with no change to this
        add-on at all. The Diagnostics tab lists every event type heard so far,
        which is how you confirm a new automation is reaching the brief.
      </p>
      {diagnostics.capabilities.includes("blueprint_layer") ? (
        <p className="reports-item">
          <Check size={14} aria-hidden="true" />
          <span>
            This property has its own automation layer, and it takes precedence:
            the built-in checks above stand down where it covers the same
            ground, because an automation sees occupancy, schedules and tariffs
            that statistics alone cannot.
          </span>
        </p>
      ) : (
        <p className="reports-item muted">
          No automation has reported yet, so the built-in checks above are the
          only analysis running.
        </p>
      )}
    </div>
  );
}
