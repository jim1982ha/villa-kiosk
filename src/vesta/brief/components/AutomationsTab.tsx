// src/vesta/brief/components/AutomationsTab.tsx
// The villa's OWN automations: what they are for, and which of them is doing a
// job right now.
//
// ⚠️ THIS IS A TAB BECAUSE A BRIEFING IS NOT AN ALERT (2026-08-29, the owner's
// reason, and it is better than the one I proposed). These rows used to sit
// under "What is watched", beside the checks a briefing is built from. I argued
// for removing them because their counters were frozen; that is a symptom. The
// rule is structural: an automation is an INSTANT reaction — it has already
// closed the valve before anyone reads anything — while a briefing is a
// PERIODIC summary. Two different jobs, so automation activity has no place on
// a tab about what goes into a briefing, whether or not the counters ever move
// again.
//
// ⚠️ THE ACCEPTED CONSEQUENCE, STATED SO IT IS NOT REDISCOVERED AS A BUG. The
// report composer still has a path for automation-derived incidents, carrying
// cost, duration and room. Nothing reaches it — the collector subscribes to
// chat events only — so this decision makes that path permanently dead rather
// than temporarily idle. Deleting it is a separate job with its own release.
//
// ⚠️ AND THE COUNTS ARE GONE, DELIBERATELY. `blueprintCategories` is a
// persisted, cumulative record, so `115 received` was true when it was written
// and can never rise again; printing it beside a live-looking role read as
// current status. What the list is still good for is WHICH families this villa
// has, which is exactly what it is used for here.

import { Zap } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import { FAMILIES } from "@/vesta/shared/tiers";
import type { ReportsDiagnostics } from "@/vesta/brief/reportsApi";

/** Families that keep a job of their own while VESTA is doing the detecting.
 *
 *  ⚠️ DERIVED FROM THE FAMILY TABLE, NEVER LISTED HERE. A family is superseded
 *  exactly when its role says so — that string is `tiers.tsx`'s to own, and a
 *  second list in this file is the duplication that goes stale the day a family
 *  is added. `reflex` families ACT (a leak closes a valve with no add-on and no
 *  model in the path) and `audit` proves the alert channel still works; neither
 *  is anything a statistical check can replace. */
function stillWorking(name: string): boolean {
  const family = FAMILIES[name];
  if (!family) return true;      // undescribed: shown rather than judged
  return !family.role.startsWith("superseded");
}

export default function AutomationsTab(
  { diagnostics }: { diagnostics: ReportsDiagnostics | null },
) {
  if (!diagnostics) {
    return <p className="muted body-text">Reading this property…</p>;
  }

  const on = diagnostics.supervisionEnabled;
  const known = (diagnostics.collector?.blueprintCategories ?? [])
    .filter((cat) => FAMILIES[cat]);
  // ⚠️ ON → ONLY WHAT STILL HAS A JOB. OFF → EVERY FAMILY, because with
  // supervision off these are the villa's whole detection layer and a list that
  // hid half of it would be describing a smaller property than the one running.
  const shown = on ? known.filter(stillWorking) : known;
  const superseded = on ? known.filter((cat) => !stillWorking(cat)) : [];

  return (
    <div className="reports-pane">
      <p className="muted body-text">
        Automations you built in Home Assistant. They react the moment something
        happens — no add-on, no AI, no internet — which is what makes them a
        different thing from a briefing rather than a smaller one.
        <InfoHint label="Your automations">
          <p>
            An automation acts, in under a second, and it has already done what
            it does by the time anyone reads anything. A briefing looks back over
            a period and summarises. That is why the two are on separate tabs.
          </p>
          <p>
            Nothing here is added or removed from this screen — these are your
            own Home Assistant automations, and Home Assistant is where you edit
            them.
          </p>
        </InfoHint>
      </p>

      <div className={`fm-banner ${on ? "" : "warn"}`}>
        <Zap size={16} aria-hidden="true" />
        <span>
          {on
            ? "VESTA is doing the detecting. The automations below still do "
              + "their own job — reacting instantly, which no check can."
            : "Your automations are doing the detecting. Every family you have "
              + "is listed below."}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="muted body-text">
          {/* ⚠️ "NONE INSTALLED" IS NOT "NONE FOUND". This list is what the
              add-on has heard from, so on a villa that has never fired one it
              is legitimately empty — saying so beats an empty box. */}
          No automations of this kind have been seen on this property. That is
          not a fault: a villa can be watched entirely by VESTA’s own checks.
        </p>
      ) : (
        <dl className="reflex-table">
          {shown.map((cat) => (
            <div key={cat} className="reflex-row">
              <dt>{cat}</dt>
              <dd className="reflex-role">{FAMILIES[cat]?.role ?? ""}</dd>
            </div>
          ))}
        </dl>
      )}

      {superseded.length > 0 && (
        <>
          <h3 className="settings-section-title">Standing by</h3>
          <p className="muted body-text">
            VESTA’s own checks cover these while supervision is on, so they are
            not the ones finding problems. Switch supervision off and they take
            the job back.
          </p>
          <dl className="reflex-table reports-standing-down">
            {superseded.map((cat) => (
              <div key={cat} className="reflex-row">
                <dt>{cat}</dt>
                <dd className="reflex-role">{FAMILIES[cat]?.role ?? ""}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
