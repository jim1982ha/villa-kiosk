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
import { RefreshCw, Trash2, Copy, Check, Download } from "lucide-react";
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

/** ms → the shortest honest rendering ("840ms", "5.5s"). */
function ms(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "?";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

/** The one-line summary per event kind — the fields that actually matter for
 *  that kind, rather than a raw JSON dump nobody reads. */
function summarise(e: TelemetryEvent): string {
  switch (e.kind) {
    case "load": {
      // Post-phase step timings arrive as loose keys on the event (see
      // BabylonCanvas) — surface the biggest, since that's the actionable one.
      const steps = ["indexMeshes", "applyStructure", "pickIndex", "spawn"]
        .filter((k) => typeof e[k] === "number")
        .map((k) => [k, e[k] as number] as const)
        .sort((a, b) => b[1] - a[1]);
      const worst = steps.length ? ` · slowest step ${steps[0][0]} ${steps[0][1]}ms` : "";
      // A big yield figure means the tab was BACKGROUNDED mid-load, not that
      // anything was slow — call that out so it isn't read as a regression.
      const parked = typeof e.yield === "number" && e.yield > 1000
        ? ` · ${(e.yield / 1000).toFixed(1)}s parked (tab was hidden)` : "";
      // Lead with the end-to-end wall clock, not `parseMs`. This line used to
      // open with parse time, which since 2.95.0 is a minority of the load —
      // reading it as the headline understated every slow load by seconds.
      // `waitMs` (a person at the profile/passcode screen) is called out
      // separately so it is never mistaken for the app being slow.
      const waited = typeof e.waitMs === "number" && e.waitMs > 0
        ? `, ${ms(e.waitMs)} waiting on sign-in` : "";
      const active = typeof e.activeMs === "number" && waited
        ? ` → ${ms(e.activeMs)} active` : "";
      const weight = typeof e.jsKb === "number" ? ` · ${e.jsKb}kB js` : "";
      // Main-thread blocking is what a "freeze" actually is. Called out
      // separately when any of it landed BEFORE the villa started loading:
      // that is the part the user meets with no spinner to explain it.
      const stalled = typeof e.stallMs === "number"
        ? ` · BLOCKED ${ms(e.stallMs)}/${e.stallCount} tasks (worst ${ms(e.stallMaxMs)}`
          + `${e.stallPreMs ? `, ${ms(e.stallPreMs)} pre-villa` : ""})`
        : "";
      // A RELOAD (the villa built again in the same page, after signing out
      // and back in) has no meaningful navigation-relative total — that number
      // would be "time since the page opened". It reports `reloadMs` instead,
      // and the headline has to say which of the two it is showing.
      // `visibleMs` is navigation → the first frame actually DRAWN, which is
      // what a stopwatch measures. Everything else stops at setStatus("ready")
      // — a React state update, before the overlay clears and before Babylon
      // compiles a single shader. Lead with it whenever it exists.
      // Kept: 2.110.0 briefly pre-compiled shaders here and the field data
      // showed it cost more than it saved, so older records carry these.
      const compiled = typeof e.compileMs === "number"
        ? ` · shaders ${ms(e.compileMs)}/${e.compiledMats}` : "";
      const painted = typeof e.paintMs === "number"
        ? ` · paint ${ms(e.paintMs)}${e.paintTimedOut ? " (NEVER PAINTED)" : ""}` : "";
      const head = typeof e.visibleMs === "number"
        ? `${ms(e.visibleMs)} to visible`
        : typeof e.reloadMs === "number"
          ? `${ms(e.reloadMs)} reload #${e.loadSeq ?? "?"}`
          : `${ms(e.totalMs)} total`;
      return `${head}${waited}${active} · bundle ${ms(e.bundleMs)}`
        + ` · mount ${ms(e.mountMs)} · parse ${ms(e.parseMs)} · reveal ${ms(e.revealMs)}`
        + `${compiled}${painted}${weight}${stalled}${worst}${parked}`;
    }
    case "error":
      return `${e.code}: ${String(e.message ?? "").slice(0, 120)}`;
    case "lifecycle":
      return `${e.event}${e.persisted !== undefined ? ` persisted=${e.persisted}` : ""}`
        + `${e.state ? ` (${e.state})` : ""}`;
    case "ha-connect": {
      // The headline is PRE-LOGIN or not: this work runs on the profile /
      // passcode screens, and that is the whole question being asked of it.
      const where = e.preLogin ? "BEFORE login (profile/PIN screen)" : "after login";
      if (e.phase === "registry") {
        return `entity registry: ${e.rows} rows in ${ms(e.ms)} — ${where}`;
      }
      return `hydrate: ${e.states} states, fetch ${ms(e.fetchMs)} + apply `
        + `${ms(e.applyMs)} — ${where}`;
    }
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

/** The table only ever RENDERS this many rows (newest first) — the add-on
 *  already caps the underlying log at 500 events server-side (see
 *  supervisor-proxy.py's TELEMETRY_MAX_EVENTS ring buffer), but 500 rows of
 *  DOM in one long scroll is its own kind of unusable. Copy all/Download
 *  still act on the FULL fetched set, not just what's visibly rendered. */
const VISIBLE_ROWS = 10;

export default function TelemetryPanel() {
  const [events, setEvents] = useState<TelemetryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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

  /** The raw events, pretty-printed — what actually gets copied/downloaded.
   *  Deliberately the FULL objects, not the condensed one-liners the table
   *  shows: the whole point of exporting is to hand over everything, including
   *  fields this UI doesn't happen to render. */
  const asJson = useCallback(() => JSON.stringify(events ?? [], null, 2), [events]);

  const copyAll = useCallback(async () => {
    const text = asJson();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API blocked (insecure context / kiosk lockdown / iOS quirks)
      // — same textarea+execCommand fallback ErrorReport already relies on.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [asJson]);

  /** Save to a file — for a log too big to paste comfortably, and so it can be
   *  attached/forwarded as-is. */
  const downloadAll = useCallback(() => {
    const url = URL.createObjectURL(new Blob([asJson()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `villa-kiosk-telemetry-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [asJson]);

  return (
    <div>
      <p className="muted body-text" style={{ marginBottom: 12 }}>
        What every device that opens this kiosk has reported — load timings, JS
        errors, WebGL context losses and page-lifecycle transitions. This is how
        a problem on someone else&rsquo;s phone becomes diagnosable. Newest first;
        the add-on keeps the last 500 events. Use <strong>Copy all</strong> or
        <strong> Download .json</strong> to share the raw events (every field,
        not just the summary shown here).
      </p>

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className="btn ghost" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={16} /> Refresh
        </button>
        <button className="btn ghost" onClick={() => void copyAll()} disabled={busy || !events?.length}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied!" : "Copy all"}
        </button>
        <button className="btn ghost" onClick={downloadAll} disabled={busy || !events?.length}>
          <Download size={16} /> Download .json
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
          {events.slice(0, VISIBLE_ROWS).map((e, i) => (
            /* Layout lives in styles.css (.telemetry-row), NOT inline: the
               phone tier has to re-flow this row onto two lines, and a media
               query cannot override an inline style prop. */
            <div key={i} className="telemetry-row" title={e.ua}>
              <span className="telemetry-kind" style={{ color: TONE[e.kind] ?? "var(--text-primary)" }}>
                {e.kind}
              </span>
              <span className="muted telemetry-meta">
                {/* The build that produced the event. Without it, an event
                    logged minutes after a release is indistinguishable from
                    one produced BY that release — the add-on's frontend ships
                    inside the GHCR image, so a device can lag a push by a long
                    way. Older events predate the field and just show nothing. */}
                {shortUA(e.ua)}{e.role ? ` · ${e.role}` : ""}{e.v ? ` · v${e.v}` : ""}
              </span>
              <span className="telemetry-summary">{summarise(e)}</span>
              <span className="muted telemetry-time">
                {e.at?.replace("T", " ").replace("+00:00", "Z") ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {!!events?.length && events.length > VISIBLE_ROWS && (
        <p className="muted body-text" style={{ marginTop: 8, fontSize: "var(--text-xs)" }}>
          Showing the newest {VISIBLE_ROWS} of {events.length} — use <strong>Copy all</strong> or
          <strong> Download .json</strong> above for the rest.
        </p>
      )}
    </div>
  );
}
