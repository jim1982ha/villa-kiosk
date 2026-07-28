// src/components/settings/TelemetryPanel.tsx
// Owner-only view of the events every client has reported to the add-on
// (GET /telemetry — see supervisor-proxy.py's ring buffer).
//
// The point of this screen is answering "why is it slow / broken on SOMEONE
// ELSE'S phone", which is otherwise unanswerable: you can't open devtools on a
// guest's iPhone in another country. Load timings land here per device, as do
// JS errors, WebGL context losses and the page-lifecycle transitions that
// explain an iOS white-screen-after-app-switch.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { ingressPath } from "@/ha/ingress";

interface TelemetryEvent {
  kind: string;
  at?: string;
  ua?: string;
  role?: string;
  [k: string]: unknown;
}

/** Condense a User-Agent to something readable in a narrow column. The full
 *  string stays in the row's title attribute for when it matters. */
function shortUA(ua = ""): string {
  if (/iPhone|iPad|iPod/.test(ua)) {
    const v = /OS (\d+)[._](\d+)/.exec(ua);
    return `iOS${v ? ` ${v[1]}.${v[2]}` : ""}${/CriOS/.test(ua) ? " Chrome" : " Safari"}`;
  }
  if (/Android/.test(ua)) {
    const v = /Android (\d+)/.exec(ua);
    return `Android${v ? ` ${v[1]}` : ""}`;
  }
  if (/Macintosh/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return ua.slice(0, 24) || "—";
}

/** The one-line summary per event kind — the fields that actually matter for
 *  that kind, rather than a raw JSON dump nobody reads. */
function summarise(e: TelemetryEvent): string {
  switch (e.kind) {
    case "load":
      return `${e.parseMs}ms parse (import ${e.importMs} · post ${e.postMs}), `
        + `fetch ${e.fetchMs}ms, ${e.meshes} meshes`;
    case "error":
      return `${e.code}: ${String(e.message ?? "").slice(0, 120)}`;
    case "lifecycle":
      return `${e.event}${e.persisted !== undefined ? ` persisted=${e.persisted}` : ""}`
        + `${e.state ? ` (${e.state})` : ""}`;
    case "recovered":
      return String(e.reason ?? "auto-reloaded");
    default:
      return "";
  }
}

const TONE: Record<string, string> = {
  error: "var(--status-danger)",
  "context-lost": "var(--status-danger)",
  recovered: "var(--status-warning)",
};

export default function TelemetryPanel() {
  const [events, setEvents] = useState<TelemetryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (clear = false) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(ingressPath(`telemetry${clear ? "?clear=1" : ""}`),
        { credentials: "same-origin" });
      if (r.status === 404) { setError("This add-on build has no telemetry endpoint yet."); setEvents([]); return; }
      if (r.status === 403) { setError("Owner profile required to read telemetry."); setEvents([]); return; }
      if (!r.ok) { setError(`Couldn't load telemetry (HTTP ${r.status}).`); setEvents([]); return; }
      const d = (await r.json()) as { events?: TelemetryEvent[] };
      setEvents(Array.isArray(d.events) ? [...d.events].reverse() : []); // newest first
    } catch {
      setError("Couldn't reach the add-on.");
      setEvents([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <p className="muted body-text" style={{ marginBottom: 12 }}>
        What every device that opens this kiosk has reported — load timings, JS
        errors, WebGL context losses and page-lifecycle transitions. This is how
        a problem on someone else&rsquo;s phone becomes diagnosable. Newest first;
        the add-on keeps the last 500 events.
      </p>

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className="btn ghost" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={16} /> Refresh
        </button>
        <button className="btn ghost" onClick={() => void load(true)} disabled={busy}>
          <Trash2 size={16} /> Clear after reading
        </button>
      </div>

      {error && <div className="muted body-text">{error}</div>}
      {!error && events?.length === 0 && (
        <div className="muted body-text">
          Nothing reported yet. Events appear as devices load the villa (or hit an error).
        </div>
      )}

      {!!events?.length && (
        <div className="config-table">
          {events.map((e, i) => (
            <div
              key={i}
              style={{
                display: "flex", gap: 10, alignItems: "baseline",
                padding: "8px 0", borderTop: i ? "1px solid var(--hairline)" : "none",
                fontSize: 13,
              }}
              title={e.ua}
            >
              <span style={{ flex: "0 0 auto", fontWeight: 600, color: TONE[e.kind] ?? "var(--text-primary)" }}>
                {e.kind}
              </span>
              <span className="muted" style={{ flex: "0 0 auto", fontSize: 11 }}>
                {shortUA(e.ua)}{e.role ? ` · ${e.role}` : ""}
              </span>
              <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{summarise(e)}</span>
              <span className="muted" style={{ flex: "0 0 auto", fontSize: 11 }}>
                {e.at?.replace("T", " ").replace("+00:00", "Z") ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
