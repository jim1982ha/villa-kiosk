// src/utils/diagnostics.ts
// Crash/error diagnostics for the kiosk. Two jobs:
//
//   1. Survive-the-crash loop breaking. An iOS Safari / WKWebView out-of-memory
//      kill is NOT catchable in JS — the whole web-content process is torn down
//      before any try/catch or window.onerror runs, and iOS silently reloads
//      the page, which then crashes again → an invisible infinite reload loop
//      (this is what a too-heavy GLB does on iPhone; see SceneManager's iOS
//      notes). The only way to break it is to detect the *pattern*: we record
//      each scene-load attempt in localStorage (which DOES survive the crash,
//      unlike sessionStorage), and after too many rapid attempts that never
//      reached "ready", the canvas bails to a diagnostics screen instead of
//      loading the model again.
//
//   2. Rich, copyable error reports. For every *catchable* failure (WebGL
//      unavailable, model fetch 4xx/5xx, Draco/parse throw, render exception,
//      WebGL context loss) and for the crash-loop bail-out, we assemble one
//      report string — device, display, memory, WebGL caps, model, phase
//      reached, and the error itself — that the user can copy with one tap and
//      paste back for troubleshooting.

import { getLoadedModelInfo } from "./modelInfo";
import { report } from "./telemetry";

const DIAG_KEY = "villa-kiosk:diag";
// Two rapid failed attempts already in the window → the next mount is the 3rd,
// so we bail then. Window is short so an occasional real reload never trips it.
const CRASH_LOOP_THRESHOLD = 2;
const CRASH_LOOP_WINDOW_MS = 90_000;

export type LoadPhase =
  | "engine-init"
  | "fetch-config"
  | "fetch-model"
  | "import-mesh"      // Babylon ImportMeshAsync: Draco decode + texture decode + GPU upload — the usual OOM point
  | "post-process"
  | "ready";

export interface CapturedError {
  code: string;
  message: string;
  stack?: string;
  source?: string;
  at: number;
}

interface DiagState {
  attempts: number[];               // epoch-ms of recent scene-load starts
  phase?: LoadPhase;                // furthest phase reached on the last attempt
  model?: { path?: string; bytes?: number; sha256?: string };
  lastError?: CapturedError | null; // most recent captured JS error (may predate a crash)
  contextLosses?: number;
}

function read(): DiagState {
  try {
    const raw = localStorage.getItem(DIAG_KEY);
    if (!raw) return { attempts: [] };
    const s = JSON.parse(raw) as DiagState;
    return { ...s, attempts: Array.isArray(s.attempts) ? s.attempts : [] };
  } catch {
    return { attempts: [] };
  }
}

function write(patch: Partial<DiagState>): void {
  try {
    localStorage.setItem(DIAG_KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    /* storage full/blocked — diagnostics are best-effort */
  }
}

/** Recent (in-window) load-start timestamps. */
function recentAttempts(now = Date.now()): number[] {
  return read().attempts.filter((t) => now - t < CRASH_LOOP_WINDOW_MS);
}

/** True when the scene has already failed to load repeatedly in quick
 *  succession — call BEFORE building the scene so the caller can bail instead
 *  of triggering another crash. */
export function isCrashLooping(): boolean {
  return recentAttempts().length >= CRASH_LOOP_THRESHOLD;
}

export function crashLoopInfo(): { count: number; sinceMs: number } {
  const a = recentAttempts();
  return { count: a.length, sinceMs: a.length ? Date.now() - Math.min(...a) : 0 };
}

/** Record the start of a scene-load attempt (kept only within the window). */
export function noteLoadStart(): void {
  const now = Date.now();
  write({ attempts: [...recentAttempts(now), now], phase: "engine-init" });
}

export function noteLoadPhase(phase: LoadPhase): void {
  write({ phase });
}

export function noteModel(model: DiagState["model"]): void {
  write({ model: { ...read().model, ...model } });
}

/** The scene reached "ready": clear the attempt counter + last error so a
 *  later legitimate reload isn't mistaken for a crash loop. */
export function noteLoadSuccess(): void {
  write({ attempts: [], phase: "ready", lastError: null });
}

/** Manual "try again": reset the loop counter so the next load runs normally. */
export function clearCrashLoop(): void {
  write({ attempts: [] });
}

export function captureError(code: string, err: unknown, source?: string): CapturedError {
  const e = err instanceof Error ? err : new Error(String(err));
  const captured: CapturedError = {
    code,
    message: e.message,
    stack: e.stack,
    source,
    at: Date.now(),
  };
  write({ lastError: captured });
  // Also ship it to the add-on. Local capture only ever helps someone who can
  // reach THIS device's storage; the errors worth fixing happen on a guest's
  // phone. Stack is truncated — the server caps event size and a full stack
  // is rarely the interesting part next to code+message+source.
  report("error", { code, message: e.message, source, stack: e.stack?.slice(0, 1200) });
  return captured;
}

export function noteContextLoss(): void {
  write({ contextLosses: (read().contextLosses ?? 0) + 1 });
  report("context-lost", { total: read().contextLosses ?? 0 });
}

/** Install global handlers so an error that fires *just before* a reload is
 *  still recorded (and shows up in the next load's report). Call once at boot. */
export function installGlobalErrorCapture(): void {
  window.addEventListener("error", (ev) => {
    // Ignore ResourceLoad errors with no error object (e.g. a 404 <img>).
    if (ev.error || ev.message) {
      captureError("WINDOW_ERROR", ev.error ?? new Error(ev.message), `${ev.filename}:${ev.lineno}:${ev.colno}`);
    }
  });
  window.addEventListener("unhandledrejection", (ev) => {
    captureError("UNHANDLED_REJECTION", ev.reason, "promise");
  });
}

function webglInfo(): Record<string, unknown> {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return { available: false };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      available: true,
      version: gl.getParameter(gl.VERSION),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    };
  } catch (err) {
    return { available: "error", detail: String(err) };
  }
}

export function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * The four `env(safe-area-inset-*)` values, in px, MEASURED rather than read.
 *
 * Reading them off a custom property (`--safe-top` and friends) is the obvious
 * approach and is not reliable: whether `getPropertyValue` hands back the
 * substituted pixel length or the literal `env(...)` token is not something to
 * depend on across engines, and this report exists precisely to be trusted
 * when a layout is in doubt. A throwaway element whose padding IS the env()
 * is measured by the layout engine itself, so whatever comes back is what the
 * page's own rules are actually seeing.
 */
function probeSafeAreaInsets(): { top: number; right: number; bottom: number; left: number } | null {
  if (typeof document === "undefined") return null;
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);" +
    "padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);";
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const px = (v: string) => Math.round(parseFloat(v) || 0);
  const out = {
    top: px(cs.paddingTop), right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom), left: px(cs.paddingLeft),
  };
  el.remove();
  return out;
}

/** Assemble the full, copyable report. `primary` is the headline error for this
 *  screen (crash-loop bail, model-load failure, render crash, …). */
export function buildReport(primary: CapturedError): string {
  const d = read();
  const loop = crashLoopInfo();
  const model = getLoadedModelInfo();
  const nav = navigator as Navigator & { deviceMemory?: number };
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  };
  const mb = (n?: number) => (typeof n === "number" ? `${(n / 1_000_000).toFixed(1)} MB` : "n/a");
  const L: string[] = [];
  const push = (k: string, v: unknown) => L.push(`${k}: ${v}`);

  L.push("VESTA — error report");
  L.push("==========================");
  push("When", new Date().toISOString());
  push("App version", typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "?");
  L.push("");
  L.push("[Error]");
  push("Code", primary.code);
  push("Message", primary.message);
  if (primary.source) push("Source", primary.source);
  push("Last load phase reached", d.phase ?? "n/a");
  push("Rapid failed loads", `${loop.count} in ${Math.round(loop.sinceMs / 1000)}s`);
  if (d.contextLosses) push("WebGL context losses", d.contextLosses);
  if (primary.stack) { L.push("Stack:"); L.push(primary.stack); }

  L.push("");
  L.push("[Model]");
  push("Path", d.model?.path ?? model?.url ?? "n/a");
  push("Downloaded size", mb(d.model?.bytes ?? model?.bytes));
  if (d.model?.sha256 || model?.sha256) push("SHA-256", d.model?.sha256 ?? model?.sha256);
  if (model) {
    push("Meshes", model.meshCount);
    push("Load timing", `fetch ${model.fetchMs}ms · parse ${model.parseMs}ms (import ${model.importMs}ms)`);
  } else {
    L.push("(never finished loading — no mesh/timing stats)");
  }

  L.push("");
  L.push("[Device]");
  push("User agent", navigator.userAgent);
  push("Platform", navigator.platform);
  push("iOS", isIOS());
  push("PWA standalone", window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  push("CPU cores", navigator.hardwareConcurrency ?? "n/a");
  push("Device memory (GB)", nav.deviceMemory ?? "n/a (not exposed on this browser)");
  push("Screen", `${screen.width}x${screen.height} @ DPR ${window.devicePixelRatio}`);
  push("Window", `${window.innerWidth}x${window.innerHeight}`);
  // Everything needed to answer "why is there dead space at an edge?" in ONE
  // report instead of a round of guesses. That question came in as a white
  // band along the bottom of an iPad PWA, and it has three possible answers
  // that need three different fixes: the page is laying out short (window <
  // shell), the app is reserving an inset it shouldn't (safe-area), or iOS
  // gave the web view less than the screen and nothing in the page can reach
  // it (window < screen). The numbers below separate those; the symptom alone
  // does not, and a screenshot cannot.
  const vv = window.visualViewport;
  if (vv) push("Visual viewport", `${Math.round(vv.width)}x${Math.round(vv.height)} @ scale ${vv.scale}`);
  const inset = probeSafeAreaInsets();
  if (inset) push("Safe-area insets", `top ${inset.top} right ${inset.right} bottom ${inset.bottom} left ${inset.left}`);
  const shell = document.querySelector(".app-root")?.getBoundingClientRect();
  if (shell) push("App shell box", `${Math.round(shell.width)}x${Math.round(shell.height)} at ${Math.round(shell.left)},${Math.round(shell.top)}`);
  // screen.* is the physical display; window.* is what the browser handed the
  // page. A gap here is the "iOS gave the web view less than the screen" case,
  // which no CSS can fix — it is the meta/manifest presentation or the host.
  const shortBy = Math.round(screen.height - window.innerHeight);
  const shortByW = Math.round(screen.width - window.innerWidth);
  push("Screen not used by page", `${shortByW}px wide, ${shortBy}px tall${shortBy > 2 || shortByW > 2 ? "  <-- dead space OUTSIDE the page" : ""}`);
  push("Online", navigator.onLine);

  L.push("");
  L.push("[JS heap] (Chrome/Android only)");
  if (perf.memory) {
    push("Used", mb(perf.memory.usedJSHeapSize));
    push("Total", mb(perf.memory.totalJSHeapSize));
    push("Limit", mb(perf.memory.jsHeapSizeLimit));
  } else {
    L.push("(not exposed on this browser — normal on iOS Safari)");
  }

  L.push("");
  L.push("[WebGL]");
  for (const [k, v] of Object.entries(webglInfo())) push(`  ${k}`, v);

  if (d.lastError && d.lastError.at !== primary.at) {
    L.push("");
    L.push("[Previously captured JS error]");
    push("Code", d.lastError.code);
    push("Message", d.lastError.message);
    if (d.lastError.source) push("Source", d.lastError.source);
    if (d.lastError.stack) { L.push("Stack:"); L.push(d.lastError.stack); }
  }

  return L.join("\n");
}
