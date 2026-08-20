// src/components/reports/DiagnosticsTab.tsx
// The detection layer's own health.
//
// ⚠️ `connected` IS THE LIVE SOCKET, NOT A STORED FLAG, and every other number
// here is read through it. `silentTypes` means "these categories are quiet"
// only if something is actually listening; if nothing is, they mean nothing at
// all. The field this replaced was derived from a persisted timestamp written
// once and never cleared, so it read `true` forever after the first subscribe —
// through every drop and restart. See `collect._LIVE`.

import { PlugZap, Radio } from "lucide-react";
import type { ReportsDiagnostics } from "@/reports/reportsApi";

function when(iso: string): string {
  if (!iso) return "never";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

export default function DiagnosticsTab({
  diagnostics,
}: { diagnostics: ReportsDiagnostics | null }) {
  if (!diagnostics) {
    return <p className="muted body-text">Reading the collector's state…</p>;
  }
  const c = diagnostics.collector;

  return (
    <div className="reports-pane">
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

      <h3 className="reports-h3">Alert categories</h3>
      <ul className="reports-list">
        {diagnostics.collector.blueprintCategories.map((cat) => {
          const type = `vesta_${cat}_event`;
          const seen = c.seenTypes[type] ?? 0;
          return (
            <li key={cat} className={`reports-item${seen ? "" : " muted"}`}>
              <span>{cat}</span>
              <span>{seen ? `${seen} received` : "nothing yet"}</span>
            </li>
          );
        })}
        {diagnostics.collector.blueprintCategories.length === 0 && (
          <li className="reports-item muted">
            No automations of this kind are installed, so the built-in checks
            run instead.
          </li>
        )}
      </ul>
      {/* ⚠️ A ZERO HERE IS AMBIGUOUS AND MUST SAY SO. Either nothing of that
          kind happened, or those automations do not report at all — and the
          second is what once hid an entire alert tier. Naming them is the whole
          value; pretending the count answers it is not. */}
      {c.silentTypes.length > 0 && c.connected && (
        <p className="muted body-text">
          A category with nothing received is either a quiet period or
          automations that do not report. This cannot tell which.
        </p>
      )}

      <h3 className="reports-h3">Built-in checks</h3>
      <ul className="reports-list">
        {diagnostics.modules.map((m) => (
          <li key={m.name} className="reports-item">
            <span>{m.name}</span>
            <span className="muted">needs {m.minDays} days</span>
          </li>
        ))}
        {diagnostics.modules.length === 0 && (
          <li className="reports-item muted">None registered.</li>
        )}
      </ul>
    </div>
  );
}
