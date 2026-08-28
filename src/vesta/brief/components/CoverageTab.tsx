// src/components/reports/CoverageTab.tsx
// What this property can be asked about, and what it cannot.
//
// ⚠️ THE ABSENT VOICE, NEVER `capabilityMeaning`. That table says what a
// capability ENABLES ("a tariff is configured, so consumption can be expressed
// as money") and printing it beside a MISSING capability reads as a statement
// of fact about a property that does not have one. `capabilityAbsent` is the
// same fact in the voice of its absence, and the renderer follows the identical
// rule — see `deterministic._coverage`.

// ⚠️ AND NOTHING ON THIS PAGE IS LIVE. `/reports-diagnostics` probes Home
// Assistant when it is ASKED, and it is asked once, when the dialog opens. So
// "Needs attention" is a snapshot from that instant: an item fixed in HA a
// minute ago is still listed, and one that broke a minute ago is not. The owner
// asked whether this was real time or periodic and the honest answer is
// neither — it is on demand, and a panel that does not say so is read as a
// feed. Stating the time and offering the re-probe is cheaper than either
// polling (continuous load on a Pi for a page read once) or leaving a reader to
// guess (`feedback_instruments-never-skip` — a surface that cannot say when it
// was measured reads as current).

import { Check, RefreshCw, X } from "lucide-react";
import type { ReportsDiagnostics } from "@/vesta/brief/reportsApi";

/** The probe time as a wall clock, or "" if the server sent nothing usable.
 *  ⚠️ THE READER'S LOCALE AND THE READER'S ZONE, deliberately — unlike a
 *  SCHEDULE hour, which is the villa's wall clock because it fires there. This
 *  is "how long ago did I press the thing", asked by whoever is holding the
 *  device. */
function probedAt(iso: string): string {
  if (!iso) return "";
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? "" : when.toLocaleTimeString();
}

/** The villa's own listening state, as findings rather than as status lines.
 *
 *  ⚠️ THIS USED TO LIVE ON THE COCKPIT AND NOWHERE ELSE, which put "can the
 *  briefing see anything" on a tab about the villa's devices while the tab
 *  actually called Coverage — reading the SAME `/reports-diagnostics` object —
 *  showed only what the property can be MEASURED for. Two halves of one
 *  question, on two screens, neither saying it was a half.
 *
 *  ⚠️ AND `connected`, NEVER `onlineSince`. The latter is persisted, so it
 *  reads true forever after the first connect — the exact lie `connected` was
 *  added to replace. `onlineSince` is only ever printed as "since when",
 *  alongside a `connected` that is true now.
 */
function listeningFindings(
  d: ReportsDiagnostics, lastBriefing: string,
): { tone: "" | "warn"; text: string }[] {
  const out: { tone: "" | "warn"; text: string }[] = [];
  out.push(d.collector.connected
    ? { tone: "",
        text: `Listening for alerts${d.collector.onlineSince
          ? ` since ${new Date(d.collector.onlineSince).toLocaleDateString()}`
          : ""}.` }
    : { tone: "warn",
        text: "Not listening — anything that happens now will be missing from "
              + "the next briefing." });
  out.push(lastBriefing
    ? { tone: "", text: `Last briefing sent ${new Date(lastBriefing).toLocaleString()}.` }
    : { tone: "warn", text: "No briefing has been sent yet." });
  return out;
}

export default function CoverageTab({
  diagnostics, busy, onRefresh, lastBriefing = "",
}: {
  diagnostics: ReportsDiagnostics | null;
  busy: boolean;
  onRefresh: () => void;
  /** When the most recent briefing went out, ISO, or "" if none ever has.
   *  ⚠️ PASSED IN RATHER THAN FETCHED. The dialog already holds the history for
   *  its own tab; a second read here would be a second answer to one question
   *  and they would disagree the moment one of them was stale. */
  lastBriefing?: string;
}) {
  if (!diagnostics) {
    return <p className="muted body-text">Reading what this property can measure…</p>;
  }
  if (!diagnostics.reachable) {
    return (
      <div className="fm-banner warn">
        Home Assistant could not be reached, so nothing could be measured.
        {diagnostics.error && <> Reason: {diagnostics.error}</>}
      </div>
    );
  }

  const at = probedAt(diagnostics.at);

  return (
    <div className="reports-pane">
      <div className="reports-freshness">
        <span className="muted body-text">
          {at
            ? `Checked against Home Assistant at ${at}. This does not update on its own.`
            : "Checked when this dialog opened. This does not update on its own."}
        </span>
        <button className="btn ghost" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{busy ? "Checking…" : "Check again"}</span>
        </button>
      </div>

      {/* ⚠️ A FINDING IS A CARD; AN INVENTORY IS A LINE. That is the one rule
          this tab now follows, at the owner's request to make findings look
          like the Facility Tasks list. "Is anything listening" and "what needs
          attention" are things that may be WRONG and are worth acting on, so
          they get the same bordered row a task does; "available" and "not
          covered" are a list of what exists, where a card per entry would give
          twenty pieces of furniture the weight of a problem. */}
      <h3 className="settings-section-title">Is anything listening?</h3>
      <ul className="reports-tasks">
        {listeningFindings(diagnostics, lastBriefing).map((f, i) => (
          <li key={i} className="reports-task">
            <span className={`reports-task-text${f.tone === "warn" ? " sev-warning" : ""}`}>
              {f.text}
            </span>
          </li>
        ))}
      </ul>

      {diagnostics.preflight.length > 0 && (
        <>
          <h3 className="settings-section-title">Needs attention</h3>
          <ul className="reports-tasks">
            {diagnostics.preflight.map((p, i) => (
              <li key={i} className="reports-task">
                <span className={`reports-task-text sev-${p.severity}`}>{p.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="settings-section-title">Available</h3>
      <ul className="reports-list">
        {diagnostics.capabilities.map((c) => (
          <li key={c} className="reports-item">
            <Check size={14} aria-hidden="true" />
            <span>{diagnostics.capabilityMeaning[c] || c}</span>
          </li>
        ))}
        {diagnostics.capabilities.length === 0 && (
          <li className="reports-item muted">Nothing yet.</li>
        )}
      </ul>

      <h3 className="settings-section-title">Not covered</h3>
      <ul className="reports-list">
        {diagnostics.capabilitiesMissing.map((c) => (
          <li key={c} className="reports-item muted">
            <X size={14} aria-hidden="true" />
            <span>{diagnostics.capabilityAbsent[c] || c}</span>
          </li>
        ))}
        {diagnostics.capabilitiesMissing.length === 0 && (
          <li className="reports-item muted">
            Everything this report can use is configured.
          </li>
        )}
      </ul>
    </div>
  );
}
