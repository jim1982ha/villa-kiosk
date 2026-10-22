// src/components/settings/TelemetryPanel.tsx
// Owner-only view of the events every client has reported to the add-on
// (GET /telemetry — see supervisor-proxy.py's ring buffer).
//
// The point of this screen is answering "why is it slow / broken on SOMEONE
// ELSE'S phone", which is otherwise unanswerable: you can't open devtools on a
// guest's iPhone in another country. Load timings land here per device, as do
// JS errors, WebGL context losses and the page-lifecycle transitions that
// explain an iOS white-screen-after-app-switch.

import { NoticeView } from "@/components/hud/Notice";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePaged, Pager } from "@/components/common/Paged";
import { downloadFile } from "@/utils/download";
import { RefreshCw, Trash2, Copy, Check, Download, Stethoscope, Activity, ChevronDown, Info } from "lucide-react";
import { ingressPath } from "@/ha/ingress";
import { buildReport } from "@/utils/diagnostics";
import { copyText } from "@/utils/clipboard";
import { runRegisteredProbe, probeAvailable, formatProbe } from "@/babylon/perfProbe";
import type { TelemetryKind } from "@/utils/telemetry";
import { backendFetch } from "@/auth/sessionLost";
import { useBackToClose } from "@/hooks/useBackToClose";
import { useOutsideClose } from "@/hooks/useOutsideClose";

interface TelemetryEvent {
  // ⚠️ `string`, not TelemetryKind, and deliberately (2.427.0): these events are
  // parsed from the stored JSON under /data, which is HISTORY — it legitimately
  // contains kinds retired since it was written, so typing this as the union
  // would be a lie about untrusted input. The narrowing happens at the one place
  // it can be honest instead: `summarise`'s switch.
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
  // ── NARROWED, SO A DEAD RENDERER IS A COMPILE ERROR (2.427.0) ─────────────
  // /dry-audit: the channel list in telemetry.ts and the renderers here are two
  // lists that must agree, and nothing made them. `TelemetryEvent.kind` was
  // `string`, so `switch (e.kind)` narrowed nothing and every case label went
  // unchecked — proven the same hour: "roomzoom" was deleted from TelemetryKind
  // and its `case` here still compiled clean.
  //
  // The cast fixes the direction that fails SILENTLY: a channel retired or
  // renamed now breaks the build at its renderer instead of leaving dead code.
  //
  // The other direction — a NEW channel with no renderer — is deliberately not
  // converged. It would need a Record<TelemetryKind, …> to be exhaustive, and
  // that is a second list to maintain for a failure that announces itself the
  // first time anyone opens the panel (the event falls to `default` and prints
  // raw). Noted here rather than left as a silent divergence.
  switch (e.kind as TelemetryKind) {
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
      // Loud on purpose: a previous villa still in memory two loads later is
      // the difference between a kiosk that runs for months and one iOS kills.
      const leaked = [
        typeof e.mgr === "number" ? `${e.mgr} scene manager(s)` : null,
        typeof e.scene === "number" ? `${e.scene} scene(s)` : null,
      ].filter(Boolean).join(" + ");
      const stale = leaked ? ` · ⚠️ ${leaked} NOT freed from earlier loads` : "";
      return `${head}${waited}${active} · bundle ${ms(e.bundleMs)}`
        + ` · mount ${ms(e.mountMs)} · parse ${ms(e.parseMs)} · reveal ${ms(e.revealMs)}`
        + `${compiled}${painted}${weight}${stalled}${worst}${parked}${stale}`;
    }
    case "error":
      return `${e.code}: ${String(e.message ?? "").slice(0, 120)}`;
    case "csp":
      // What the policy WOULD have blocked, were it enforced (it is Report-Only).
      return `${e.directive} would block ${e.blocked}${e.source ? ` · ${e.source}:${e.line ?? "?"}` : ""}`;
    case "session":
      // `lostRole` is the profile that WAS signed in; the row's own role is
      // whoever signed in afterwards, when the report could be sent.
      return `session lost${e.lostRole ? ` (${e.lostRole})` : ""}`
        + `${e.source ? ` · ${e.source}` : ""}${e.agoMs !== undefined ? ` · ${ms(e.agoMs)} before this sign-in` : ""}`;
    case "lifecycle":
      return `${e.event}${e.persisted !== undefined ? ` persisted=${e.persisted}` : ""}`
        + `${e.hiddenMs ? ` after ${ms(e.hiddenMs)} hidden` : ""}`
        + `${e.state ? ` (${e.state})` : ""}`;
    case "ha-connect": {
      // The headline is PRE-LOGIN or not: this work runs on the profile /
      // passcode screens, and that is the whole question being asked of it.
      const where = e.preLogin ? "BEFORE login (profile/PIN screen)" : "after login";
      if (e.phase === "registry") {
        return `entity registry: ${e.rows} rows in ${ms(e.ms)}, ${where}`;
      }
      // A socket that died. `up` is the figure to read first: a consistent age
      // across many rows means something is timing the connection out, a wild
      // spread means a flaky link. `we closed it` distinguishes our own pong
      // watchdog giving up from the peer hanging up.
      if (e.phase === "disconnect") {
        return `socket closed: code ${e.code}${e.reason ? ` "${e.reason}"` : ""}`
          + ` after ${ms(e.upMs)} up${e.byPong ? " · we closed it (no pong)" : ""}`
          + `${e.wasClean ? "" : " · unclean"}`;
      }
      // `pushed` is the share of the payload that reached a subscriber — on a
      // reconnect into an unchanged villa it should be near zero.
      const pushed = typeof e.pushed === "number" ? `, ${e.pushed} changed` : "";
      return `hydrate: ${e.states} states${pushed}, fetch ${ms(e.fetchMs)} + apply `
        + `${ms(e.applyMs)}, ${where}`;
    }
    case "sync": {
      // `sync` rows rendered blank before — the one kind with no summariser, in
      // the screen whose whole job is to make an event readable.
      const which = e.store === "fm" ? "facility" : "config";
      if (e.op === "push") {
        const changed = e.changed && typeof e.changed === "object"
          ? Object.entries(e.changed as Record<string, number>)
              .map(([k, n]) => `${k} ×${n}`).join(", ")
          : "";
        return e.ok
          ? `${which} pushed${changed ? `, ${changed}` : ""}`
            + `${typeof e.attempts === "number" && e.attempts > 1 ? ` (${e.attempts} attempts)` : ""}`
          : `${which} push FAILED: ${e.reason ?? "unknown"}`;
      }
      if (e.aborted) return `${which} pull skipped, ${e.aborted}`;
      const held = typeof e.entities === "number" ? ` · ${e.entities} entities` : "";
      return `${which} pulled${e.changed === false ? " (unchanged)" : ""}${held}`;
    }
    case "recovered":
      return String(e.reason ?? "auto-reloaded");
    case "freeze": {
      // "How long after coming back" is the whole point of the row — a freeze
      // on the return path and one out of nowhere have unrelated causes.
      const back = typeof e.sinceVisibleMs === "number"
        ? ` · ${ms(e.sinceVisibleMs)} after returning from ${ms(e.hiddenForMs)} hidden`
        : " · no recent return (not the wake path)";
      // "watchdog" is the Safari/iOS timer fallback — it measures total
      // event-loop lag rather than one task, so the figure is an upper bound.
      const how = e.src === "watchdog" ? " (timer lag)" : "";
      // WHAT WAS RUNNING (see utils/perfSpans). `cover` is the field to read
      // first and 0 is a real answer: it says none of the block was in code
      // this app instruments, which rules out every app-side theory at once.
      const blame = e.spans
        ? ` · ${e.spans} (${e.cover ?? "?"}% covered)`
        : typeof e.cover === "number"
          ? ` · nothing instrumented was running (${e.cover}% covered)`
          : "";
      return `UI blocked ${ms(e.ms)}${how}${back} · ${ms(e.sinceLoadMs)} into this session${blame}`;
    }
    case "probe": {
      // Each row as "what it cost", which is the NEGATIVE of the delta the
      // probe measured by removing it — the whole point is reading the cost of
      // a thing, not the speed of the scene without it.
      const rows = Array.isArray(e.rows) ? e.rows as Array<{ name: string; renderMs: number; deltaMs: number }> : [];
      if (rows.length === 0) return "frame-cost probe (no rows)";
      const base = rows[0];
      const rest = rows.slice(1)
        .sort((a, b) => a.deltaMs - b.deltaMs)
        .map((r) => `${r.name} ${(-r.deltaMs).toFixed(1)}ms`)
        .join(" · ");
      // The context matters as much as the numbers: a baseline is meaningless
      // without the pixel count, and a comparison between devices is wrong
      // without the render tier. See SceneManager.renderContext.
      const mpx = typeof e.rw === "number" && typeof e.rh === "number"
        ? ` · ${((e.rw * e.rh) / 1e6).toFixed(2)}Mpx@${e.hw ?? "?"}` : "";
      const tier = [e.ibl ? "IBL" : null, e.ssao ? "SSAO" : null].filter(Boolean).join("+") || "no post";
      // The DRIVER's sample count, never a requested value. A build that
      // asked for no multisampling and got 4 anyway once made a null result
      // look like evidence; only the granted number can be trusted.
      const aa = typeof e.aaSamples === "number"
        ? ` · ${e.aaSamples > 1 ? `${e.aaSamples}× MSAA` : "no MSAA"}`
        : "";
      return `frame-cost probe (${e.mode ?? "?"}${mpx}${aa} · ${tier} · ${e.gpu ?? "?"})`
        + `, baseline ${base.renderMs.toFixed(1)}ms · costs: ${rest}`;
    }
    case "frames": {
      // p95 is the number a person actually feels: a median of 16ms with a p95
      // of 90ms reads as "laggy" even though the average looks fine, and that
      // gap is exactly what a single fps figure hides.
      const load = `${e.activeMeshes ?? "?"} meshes · ${e.activeKTris ?? "?"}k tris`
        + ` · ${e.rw ?? "?"}×${e.rh ?? "?"}@${e.hw ?? "?"}`
        + ` · ${e.litOn ?? "?"}/${e.lights ?? "?"} lights on`;
      const passes = [e.ibl ? "IBL" : null, e.ssao ? "SSAO" : null]
        .filter(Boolean).join("+") || "no post";
      // Where the frame went. renderMs close to the median says the cost is
      // inside scene.render(); well under it says the time is elsewhere.
      const cost = e.renderMs === undefined ? ""
        : ` · ${ms(e.renderMs)} in render, ${e.drawCalls ?? "?"} draws,`
          + ` ${ms(e.evalMs)} culling`;
      return `${e.fps ?? "?"} fps while ${e.mode ?? "?"}`
        + ` · frame ${ms(e.p50)} median, ${ms(e.p95)} p95, ${ms(e.worst)} worst`
        + cost
        + ` · ${load} · ${passes}`;
    }
    case "spans": {
      // TEMPORARY — see perfSpans' census notes. The verdict is the RUN COUNT,
      // so it is spelled out rather than left as the raw `name:runs:ms`: a "×2"
      // buried in a comma-separated string is exactly the kind of detail that
      // gets read past, and it is the whole reason the record exists.
      // A load that began under the timer means these counters describe THAT
      // load, not this one — say so rather than presenting them as this load's.
      const stale = e.nowSeq !== undefined && e.nowSeq !== e.seq
        ? ` · ⚠ load ${e.seq} → ${e.nowSeq}, counters belong to the later one` : "";
      if (!e.census || e.census === "(empty)") {
        return `${ms(e.atMs)} into load, counters were EMPTY (reset under us)${stale}`;
      }
      const rows = String(e.census).split(",").filter(Boolean).map((part) => {
        const [name, runs, totalMs] = part.split(":");
        const n = Number(runs);
        return `${name} ${ms(Number(totalMs))}${n > 1 ? ` over ${n} RUNS` : ""}`;
      });
      return `${ms(e.atMs)} into load, ${rows.join(" · ")}${stale}`;
    }
    case "context-lost":
      return `WebGL context lost (${e.total ?? "?"} this session)`;
    case "context-restored":
      // Two rows per restore: the loss window, then the rebuild cost once the
      // first frame is actually back on screen.
      return e.phase === "repainted"
        ? `repainted, rebuild blocked ${ms(e.blockedMs)}`
        : `context restored after ${ms(e.deadMs)} dead`
          + ` · ${e.meshes ?? "?"} meshes, ${e.textures ?? "?"} textures to re-upload`;
    default:
      return "";
  }
}

const TONE: Record<string, string> = {
  error: "var(--status-danger)",
  freeze: "var(--status-danger)",
  "context-lost": "var(--status-danger)",
  "context-restored": "var(--status-warning)",
  recovered: "var(--status-warning)",
  csp: "var(--status-warning)",
};

/** The table only ever RENDERS this many rows (newest first) — the add-on
 *  already caps the underlying log server-side (the telemetry_max_events
 *  option, 500 by default — supervisor-proxy.py's ring), but 500 rows of
 *  DOM in one long scroll is its own kind of unusable. Copy all/Download
 *  still act on the FULL fetched set, not just what's visibly rendered. */
// ⚠️ THE FIXED WINDOW IS GONE. This showed the newest 10 and told you to use
// Copy/Download for the rest — so row 11 of 500 was unreachable on the very
// screen that exists to read them. `usePaged` reaches every row.

export default function TelemetryPanel() {
  const [events, setEvents] = useState<TelemetryEvent[] | null>(null);
  const paged = usePaged(events ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** The on-demand report for THIS device (see the button below). */
  const [selfReport, setSelfReport] = useState<string | null>(null);

  const load = useCallback(async (clear = false) => {
    setBusy(true);
    setError(null);
    try {
      const r = await backendFetch(ingressPath(`telemetry${clear ? "?clear=1" : ""}`),
        { credentials: "same-origin" });
      if (r.status === 404) { setError("This add-on build has no telemetry endpoint yet."); setEvents([]); return; }
      if (r.status === 403) { setError("Owner profile required to read telemetry."); setEvents([]); return; }
      if (!r.ok) { setError(`Couldn't load telemetry (HTTP ${r.status}).`); setEvents([]); return; }
      const d = (await r.json()) as { events?: TelemetryEvent[] };
      // A clearing read RETURNS the events it deleted — that is the endpoint's
      // whole "read and empty in one trip" contract, and it is right for a
      // caller archiving them. It is wrong for this screen: rendering them
      // afterwards makes an emptied store look untouched, so Clear read as
      // broken and had to be pressed twice before anything appeared to happen.
      // The list on screen already IS the copy the user was reading; Copy and
      // Download are next to the button for keeping it.
      setEvents(clear ? [] : Array.isArray(d.events) ? [...d.events].reverse() : []); // newest first
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
    if (!(await copyText(asJson()))) { setNotice("Could not copy, use Download instead."); return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [asJson]);

  /** A short notice that clears itself (owner, 2026-10-14: "a quick notification … that auto-clears"). */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);
  /** Copy a diagnostic's result where it was asked for, and say whether it landed. */
  const copyResult = useCallback(async (text: string, what: string) => {
    setNotice(await copyText(text) ? `${what} copied to the clipboard.`
      : `${what} is ready, the browser refused to copy it automatically, use its Copy button.`);
  }, []);
  /** "Diagnose ▾": ONE button for this device's report and the frame-cost probe (owner, 2026-10-14). */
  const [diagOpen, setDiagOpen] = useState(false);
  // the phone's Back closes it like every menu (the overlay stack); a tap elsewhere or Escape too (the popover hook)
  const diagRef = useRef<HTMLDivElement>(null);
  const closeDiag = useCallback(() => setDiagOpen(false), []);
  useBackToClose(closeDiag, diagOpen);
  useOutsideClose([diagRef], diagOpen, closeDiag);
  const runDevice = useCallback(() => {
    setDiagOpen(false);
    const text = buildReport(null);
    setSelfReport(text);
    void copyResult(text, "Device report");
  }, [copyResult]);

  /** Save to a file — for a log too big to paste comfortably, and so it can be
   *  attached/forwarded as-is. */
  const downloadAll = useCallback(() => {
    downloadFile(
      `villa-kiosk-telemetry-${new Date().toISOString().slice(0, 10)}.json`,
      asJson(), "application/json");
  }, [asJson]);

  // The probe writes its own telemetry record, so the result is recoverable
  // from a dump afterwards; showing it here as well is what makes the run
  // useful ON the device, without a console and without an export round trip.
  const [probing, setProbing] = useState(false);
  const [probeText, setProbeText] = useState<string | null>(null);
  const runProbe = useCallback(async () => {
    setDiagOpen(false);
    setProbing(true);
    setProbeText(null);
    try {
      const rows = await runRegisteredProbe();
      const text = rows ? formatProbe(rows) : "No scene is loaded to measure.";
      setProbeText(text);
      if (rows) void copyResult(text, "Frame-cost probe");
    } catch (err) {
      setProbeText(`Probe failed: ${(err as Error).message}`);
    } finally {
      // In a finally because the probe hands the render loop back in its own
      // finally — a failed run must not leave the button disabled forever on a
      // kiosk whose villa is now rendering perfectly well again.
      setProbing(false);
    }
  }, [copyResult]);

  return (
    <div>
      <p className="muted body-text" style={{ marginBottom: 12 }}>
        What every device that opens this kiosk has reported, load timings, JS
        errors, WebGL context losses and page-lifecycle transitions. This is how
        a problem on someone else&rsquo;s phone becomes diagnosable. Newest first;
        the add-on keeps the last 500 events. <strong>Copy</strong> and
        <strong> Download</strong> give you the raw events (every field, not just
        the summary shown here); <strong>Clear</strong> empties the store.
      </p>

      {/* ⚠️ ICONS ONLY ON A PHONE (owner, 2026-10-14): six labelled buttons overflowed their pills there
          (.telemetry-actions .btn-label); each keeps its name as aria-label and title. */}
      <div className="row telemetry-actions" style={{ gap: 8, marginBottom: 12 }}>
        <button className="btn ghost" onClick={() => void load()} disabled={busy}
          title="Re-read the events from the add-on" aria-label="Refresh">
          <RefreshCw size={16} /> <span className="btn-label">Refresh</span>
        </button>
        <button className="btn ghost" onClick={() => void copyAll()} disabled={busy || !events?.length}
          title="Copy every event, every field, as JSON" aria-label="Copy">
          {copied ? <Check size={16} /> : <Copy size={16} />} <span className="btn-label">{copied ? "Copied" : "Copy"}</span>
        </button>
        <button className="btn ghost" onClick={downloadAll} disabled={busy || !events?.length}
          title="Save every event as a .json file" aria-label="Download">
          <Download size={16} /> <span className="btn-label">Download</span>
        </button>
        <button className="btn ghost" onClick={() => void load(true)} disabled={busy}
          title="Empty the add-on's event store. Copy or Download first if you want to keep them." aria-label="Clear">
          <Trash2 size={16} /> <span className="btn-label">Clear</span>
        </button>
        {/* THIS device, right now, and the frame-cost probe — one "Diagnose" menu (owner, 2026-10-14), each result
            copied where the button was pressed.
            The device report is the one ErrorReport shows after a crash — same builder, so the two cannot describe
            the device differently — asked for while nothing is wrong (a layout that is wrong but working, WebGL
            limits that explain a slow load). The probe has a console form too, and neither an iPad nor an iPhone
            has a console — nor, inside the companion app or an installed PWA, a URL `?debug` can be added to. */}
        <div className="telemetry-diag" ref={diagRef}>
          <button className="btn ghost" aria-haspopup="menu" aria-expanded={diagOpen} disabled={probing}
            onClick={() => setDiagOpen((o) => !o)} title="This device's report, or the frame-cost probe"
            aria-label="Diagnose">
            <Stethoscope size={16} /> <span className="btn-label">{probing ? "Measuring…" : "Diagnose"}</span>
            <ChevronDown size={14} />
          </button>
          {diagOpen && (
            <div className="hud-menu telemetry-diag-menu" role="menu">
              <button role="menuitem" className="hud-menu-item" onClick={runDevice}
                title="This device right now, screen, viewport, WebGL caps, loaded model">
                <Stethoscope size={18} /> <span>This device</span>
              </button>
              <button role="menuitem" className="hud-menu-item" onClick={() => void runProbe()}
                disabled={!probeAvailable()}
                title="Re-times the frame with the badges, lights, image-based lighting and geometry removed one at a time. About 15 seconds, during which the villa will look wrong.">
                <Activity size={18} /> <span>Frame-cost probe</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {probeText && (
        <div className="field">
          <label className="entity-label row spread">
            Frame cost on this device, what each thing was costing
            <button className="btn ghost" onClick={() => void copyResult(probeText, "Frame-cost probe")}><Copy size={14} /> Copy</button>
          </label>
          <pre className="diag-report">{probeText}</pre>
        </div>
      )}

      {selfReport && (
        <div className="field">
          <label className="entity-label row spread">
            This device, screen, viewport, WebGL, model
            <span className="row" style={{ gap: 6 }}>
              <button className="btn ghost" onClick={() => void copyResult(selfReport, "Device report")}><Copy size={14} /> Copy</button>
              <button className="btn ghost" onClick={() => setSelfReport(null)}>Hide</button>
            </span>
          </label>
          <pre className="diag-report">{selfReport}</pre>
        </div>
      )}

      {error && <div className="muted body-text">{error}</div>}
      {!error && events?.length === 0 && (
        <div className="muted body-text">
          Nothing reported yet. Events appear as devices load the villa (or hit an error).
        </div>
      )}

      {!!events?.length && (
        <div className="config-table">
          {paged.page.map((e, i) => (
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
              <span className="telemetry-summary" title={summarise(e)}>{summarise(e)}</span>
              <span className="muted telemetry-time">
                {e.at?.replace("T", " ").replace("+00:00", "Z") ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {!!events?.length && <Pager paged={paged} unit="event" />}
      {/* Over the dialog, not inside its scrolling body, where a fixed toast can be clipped */}
      {notice && createPortal(
        <div className="notice-stack over-dialog"><NoticeView tone="info" icon={<Info size={16} />}>{notice}</NoticeView></div>,
        document.body)}
    </div>
  );
}
