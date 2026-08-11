// src/utils/bootTimeline.ts
// Named milestones along the only path that actually matters to a user: the
// moment they open the kiosk → the villa on screen.
//
// WHY THIS EXISTS
// `bootMs` (navigation start → the scene effect) was one opaque number covering
// wildly different things: the HTML round trip, the JS bundle's download +
// parse + compile, React mounting, the profile gate resolving, AND — the part
// that makes it actively misleading — however long a HUMAN spent choosing a
// profile and typing a passcode. A load where someone fumbled their PIN for six
// seconds and a load where the bundle took six seconds to compile produced the
// same `bootMs`, and only one of them is a bug worth fixing. Every optimisation
// so far has been judged against a number that silently mixes the two.
//
// This module records a handful of first-write-wins marks along that path
// (idempotent, so React StrictMode's double-invoke and any re-render are
// harmless) and derives two things the old telemetry could not express:
//   * WHERE the machine time went — html / bundle / react / gate / scene, each
//     separately attributable rather than summed into one figure;
//   * `waitMs`, the stretch the app spent WAITING ON THE PERSON, so `activeMs`
//     (= totalMs − waitMs) is the number to actually optimise against.
//
// It also captures what the browser already knows and nobody was reading: the
// Navigation Timing breakdown, and — decisively, given how easy it is to
// measure a build that isn't the one you just shipped — the real decoded size
// of the JS the device actually executed.

import { report } from "./telemetry";

/** Milestones, in the order they happen. */
export type BootMark =
  | "js"      // the main bundle's module body ran (bundle is downloaded+compiled)
  | "react"   // React reached <App> for the first time
  | "gate"    // a sign-in screen became visible (profile select)
  | "pin"     // the passcode pad became visible
  | "auth"    // a session was established (login())
  | "scene";  // the Babylon scene effect started

/** Marks that describe THE PAGE and can only happen once per document. */
const PAGE_MARKS: ReadonlySet<BootMark> = new Set<BootMark>(["js", "react"]);

const marks = new Map<BootMark, number>();
let loadSeq = 0;
let loadT0 = 0;

/** Open a new model load. Clears the PER-LOAD marks and returns which load
 *  this is (1 = the first of this page).
 *
 *  Without this, the marks were module-level and first-write-wins for the
 *  whole document — right for one load per page, wrong the moment the villa
 *  is loaded again (signing out and back in remounts the canvas). From the
 *  second load on, `markBoot("scene")` silently did nothing while the caller's
 *  own `performance.now()` kept advancing, so `bootMs` reported TIME SINCE THE
 *  PAGE OPENED and `waitMs` reported the FIRST sign-in — three consecutive
 *  field records showed `waitMs: 4815` to the millisecond, which is what gave
 *  it away. It read as a 10-35s load regression that had not happened: the
 *  same records showed 2.1-4.3s of actual work throughout. */
export function beginLoad(): number {
  loadT0 = performance.now();
  return ++loadSeq;
}

/** Which load the page is on right now, without opening one. For readers that
 *  are not part of the load sequence — see leakWatch's console hook, whose
 *  grace period is counted in exactly this. */
export function currentLoadSeq(): number {
  return loadSeq;
}

// ── Main-thread stalls ─────────────────────────────────────────────────────
// A freeze is main-thread blocking, and the browser will simply TELL you where
// it happened: any task over 50ms is reported as a `longtask` entry. Four
// hypotheses about a reported freeze on the profile/passcode screens (the JS
// bundle, Draco workers, texture decode, then Home Assistant's connect) were
// each argued from plausibility and each disproved by measurement — the HA one
// came back at 1-4ms of apply time and, worse, `preLogin: false`, so it was not
// even on the screen in question. This asks the browser instead of reasoning
// about it. Counters live alongside the per-load marks and reset with them, so
// what is reported spans the whole cycle a user experiences: the previous scene
// tearing down, the gate, the passcode, and the villa rebuilding.
const stalls = { count: 0, totalMs: 0, maxMs: 0, maxAt: 0, preCount: 0, preMs: 0 };

// ── Post-load freeze reporting ─────────────────────────────────────────────
// The long-task observer below has been running continuously since startup,
// but its counters were only ever READ into the load snapshot and then reset
// — so a multi-second block that happens once the villa is up (the "came back
// to the kiosk and it was frozen" report) was measured and thrown away every
// single time. This reports those directly instead.
//
// Only genuinely user-visible blocks: 1s is far past jank and into "the app
// is not responding". Rate-limited because a wedged main thread can emit
// several in a row, and the first is the informative one.
const FREEZE_MIN_MS = 1000;
const FREEZE_COOLDOWN_MS = 30_000;
const FREEZE_MAX_PER_SESSION = 20;
let lastFreezeReportAt = -Infinity;
let freezeReports = 0;
/** When the load record was built, or 0 before that — see stallSummary.
 *
 *  A TIMESTAMP rather than a flag because a PerformanceObserver reports a long
 *  task when it ENDS, not when it starts. The load's own final block (the GLB
 *  parse and first paint) therefore lands in the observer just AFTER the load
 *  record is built, and a boolean gate counted it as a post-load freeze: the
 *  first capture from a real device reported a 5,469ms "freeze" whose duration
 *  matched that load's own `paintMs` of 5,509 almost exactly. Comparing the
 *  task's startTime against this instead attributes it where it belongs. */
let loadReportedAt = 0;
/** Whether the Long Tasks API took the observe() call; false on Safari/iOS,
 *  which is what installFreezeWatchdog exists for. */
let longtaskAvailable = false;

function reportPostLoadFreeze(
  durationMs: number,
  src: "longtask" | "watchdog",
  /** When the block STARTED. A task that began before the load record was
   *  built is load cost, however long after it the observer reports it. */
  startedAt: number,
): void {
  // While the villa is still loading there is a spinner explaining the wait,
  // and those blocks are already covered by the load record's stall stats.
  if (!loadReportedAt || startedAt < loadReportedAt) return;
  if (durationMs < FREEZE_MIN_MS) return;
  const now = performance.now();
  if (now - lastFreezeReportAt < FREEZE_COOLDOWN_MS) return;
  if (freezeReports >= FREEZE_MAX_PER_SESSION) return;
  lastFreezeReportAt = now;
  freezeReports++;
  // Deferred: reporting from inside the observer callback would add this
  // work to the very stall being measured.
  setTimeout(() => {
    report("freeze", {
      ms: Math.round(durationMs),
      // Which detector saw it. `longtask` attributes the block to ONE task and
      // is the better signal; `watchdog` is the Safari/iOS fallback and
      // measures total event-loop lag, so it can span several tasks.
      src,
      // The discriminator. A freeze within a second or two of coming back is
      // a return-path cost; one at 40 minutes with no recent return is
      // something else entirely, and the fixes are unrelated.
      sinceVisibleMs: lastBecameVisibleAt ? Math.round(now - lastBecameVisibleAt) : undefined,
      hiddenForMs: lastHiddenForMs ? Math.round(lastHiddenForMs) : undefined,
      sinceLoadMs: Math.round(now),
      seq: freezeReports,
    });
  }, 0);
}

/** Start watching for main-thread stalls. Idempotent; call once at startup. */
let stallObserverInstalled = false;
export function installStallObserver(): void {
  if (stallObserverInstalled || typeof PerformanceObserver === "undefined") return;
  stallObserverInstalled = true;
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        // "Before the villa started loading" is the distinction that matters:
        // a stall there is one the user meets on a screen whose only job is to
        // answer a tap, with no spinner to explain it.
        const preScene = !marks.has("scene");
        stalls.count++;
        stalls.totalMs += e.duration;
        if (preScene) { stalls.preCount++; stalls.preMs += e.duration; }
        if (e.duration > stalls.maxMs) {
          stalls.maxMs = e.duration;
          stalls.maxAt = Math.round(e.startTime);
        }
        reportPostLoadFreeze(e.duration, "longtask", e.startTime);
      }
    });
    obs.observe({ type: "longtask", buffered: true });
    longtaskAvailable = true;
  } catch {
    // Not supported (Safari/Firefox) — the rest of the timeline still works,
    // and installFreezeWatchdog below covers the freeze reporting instead.
  }
  if (!longtaskAvailable) installFreezeWatchdog();
}

/**
 * Safari/iOS fallback for freeze detection.
 *
 * The Long Tasks API above is Chromium-only, so on an iPad — one of the two
 * devices this app is actually mounted on a wall to run 24/7, and the platform
 * that historically breaks first — the freeze reporting would otherwise be
 * silent on exactly the hardware a fix most needs verifying against.
 *
 * This measures the same thing from the other side: a timer that should fire
 * every TICK_MS can only be late if the main thread was busy, so the lateness
 * IS the block. It cannot attribute the time to a single task the way a long
 * task entry does (hence the `src` field on the event) — for a multi-second
 * freeze that distinction does not matter.
 *
 * Only installed when the real API is missing, so a Chromium device never
 * reports the same freeze twice from two detectors.
 */
const TICK_MS = 500;

function installFreezeWatchdog(): void {
  if (typeof document === "undefined") return;
  let expected = performance.now() + TICK_MS;
  setInterval(() => {
    const now = performance.now();
    const lateBy = now - expected;
    expected = now + TICK_MS;
    // A hidden page has its timers throttled to seconds or minutes, which is
    // not a freeze — it is the browser doing exactly what it should. Ignore
    // any interval that touched a hidden state at either end, including the
    // one spanning the moment of return.
    if (document.visibilityState !== "visible") return;
    if (now - lastBecameVisibleAt < TICK_MS * 2) return;
    if (lateBy >= FREEZE_MIN_MS) reportPostLoadFreeze(lateBy, "watchdog", now - lateBy);
  }, TICK_MS);
}

// ── Hidden-time accounting ─────────────────────────────────────────────────
// A page that is not being drawn cannot paint, and every "how long did the
// villa take to appear" figure silently included that time. That produced
// records like `paintMs: 52542` which were then explained — by me, wrongly,
// more than once — as GPU or model cost, when the honest answer was that
// nobody could tell from the data. A duration is only meaningful next to how
// much of it the page was actually visible for, so that is now measured
// rather than inferred.
//
// Cumulative rather than per-load: callers sample it at two points and
// subtract, which gives "hidden ms between A and B" without this module
// needing to know anything about load phases.
let hiddenSince: number | null = null;
let hiddenAccumMs = 0;
let visibilityInstalled = false;
/** How long the page was hidden on the MOST RECENT return, and when that
 *  return happened — the context that turns a bare "the main thread blocked
 *  for 4s" into "it blocked 200ms after coming back from 6 minutes away". */
let lastHiddenForMs = 0;
let lastBecameVisibleAt = 0;

/** Total ms the document has spent hidden since page load, up to now. */
export function hiddenMsTotal(): number {
  const live = hiddenSince !== null ? performance.now() - hiddenSince : 0;
  return hiddenAccumMs + live;
}

/** Start accounting hidden time. Idempotent; call once at startup, BEFORE the
 *  villa begins loading, so a load that starts on a backgrounded tab is
 *  measured from the beginning rather than from first transition. */
export function installVisibilityTracker(): void {
  if (visibilityInstalled || typeof document === "undefined") return;
  visibilityInstalled = true;
  if (document.visibilityState === "hidden") hiddenSince = performance.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (hiddenSince === null) hiddenSince = performance.now();
    } else if (hiddenSince !== null) {
      lastHiddenForMs = performance.now() - hiddenSince;
      lastBecameVisibleAt = performance.now();
      hiddenAccumMs += lastHiddenForMs;
      hiddenSince = null;
    }
  });
}

function stallSummary(): Record<string, number> {
  // The load record is being built, so from here on a long task is no longer
  // load cost — it is a freeze on a villa that is already up. See
  // reportPostLoadFreeze, which only reports once this flips.
  loadReportedAt = performance.now();
  if (!stalls.count) return {};
  return {
    stallCount: stalls.count,
    stallMs: Math.round(stalls.totalMs),
    stallMaxMs: Math.round(stalls.maxMs),
    stallMaxAt: stalls.maxAt,
    // The subset the user hits with no spinner on screen to explain it.
    stallPreCount: stalls.preCount,
    stallPreMs: Math.round(stalls.preMs),
  };
}

/** Clear the per-load marks. Call when the scene is TORN DOWN, not when one
 *  starts: `gate`/`pin`/`auth` are recorded BEFORE the scene effect runs (the
 *  sign-in is what causes the canvas to mount), so clearing at the start of a
 *  load would wipe the marks that describe that very load and lose `waitMs`
 *  entirely. Clearing on teardown leaves the next cycle a clean slate at the
 *  only moment nothing is mid-flight. */
export function endLoad(): void {
  for (const key of [...marks.keys()]) {
    if (!PAGE_MARKS.has(key)) marks.delete(key);
  }
  stalls.count = 0; stalls.totalMs = 0; stalls.maxMs = 0;
  stalls.maxAt = 0; stalls.preCount = 0; stalls.preMs = 0;
  // The scene is going away, so the next load's own stalls are load cost
  // again, not freezes on a running villa.
  loadReportedAt = 0;
}

/** Record a milestone. First write wins WITHIN the current load — safe to call
 *  from a render body, a re-running effect, or a StrictMode double-mount. */
export function markBoot(name: BootMark): void {
  if (!marks.has(name)) marks.set(name, performance.now());
}

function mark(name: BootMark): number | undefined {
  return marks.get(name);
}

/** Has this milestone been reached in the current load cycle? Lets code that
 *  knows nothing about auth ask "are we still on the pre-login screens?" —
 *  `hasBootMark("scene")` is false until the villa actually starts loading. */
export function hasBootMark(name: BootMark): boolean {
  return marks.has(name);
}

/** The document's own Navigation Timing entry, if the browser exposes one. */
function navEntry(): PerformanceNavigationTiming | undefined {
  try {
    return performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  } catch {
    return undefined;
  }
}

/** Total DECODED bytes of JavaScript this page actually executed, plus how much
 *  of it crossed the network. `jsKb` is the honest "how big is the bundle on
 *  this device" figure — it is reported even for a cache/service-worker hit
 *  (where `transferSize` is 0), which is exactly the case where a stale build
 *  would otherwise be invisible. This is the field that answers "is the device
 *  running the build I just shipped?" without anyone having to guess. */
function scriptWeight(): { jsKb?: number; jsNetKb?: number } {
  try {
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    let decoded = 0, transferred = 0;
    for (const r of res) {
      if (r.initiatorType !== "script" && !r.name.endsWith(".js")) continue;
      decoded += r.decodedBodySize || 0;
      transferred += r.transferSize || 0;
    }
    if (!decoded) return {};
    return { jsKb: Math.round(decoded / 1024), jsNetKb: Math.round(transferred / 1024) };
  } catch {
    return {};
  }
}

/** The whole picture, flattened into telemetry fields.
 *
 *  `total` is the caller's own navigation-start → villa-visible measurement
 *  (BabylonCanvas already owns that clock); everything else is derived here.
 *
 *  On a RELOAD (`loadSeq > 1`) the navigation-relative figures are deliberately
 *  NOT emitted. `bootMs`, `totalMs` and `activeMs` all mean "since the page
 *  opened", which after a sign-out/sign-in cycle is a number that grows forever
 *  and describes nothing — it is exactly what made a healthy 2.5s load look
 *  like a 35s regression. `reloadMs` replaces them: this load's own span, the
 *  only figure that is true for both cases. */
export function bootTimeline(total: number): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  const put = (k: string, v: number | undefined) => {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.round(v);
  };
  const isReload = loadSeq > 1;
  if (isReload) {
    out.loadSeq = loadSeq;
    put("reloadMs", performance.now() - loadT0);
  }

  const nav = navEntry();
  const tJs = mark("js");
  const tReact = mark("react");
  const tGate = mark("gate") ?? mark("pin");
  const tAuth = mark("auth");
  const tScene = mark("scene");

  // ── Navigation: what the browser did before any of our code existed ──────
  if (nav) {
    out.navType = nav.type;
    // A prerendered document starts its clock earlier than it became visible;
    // without this the phases below look impossibly fast. Not in every browser
    // (and not in this TS lib's DOM types), so it is read defensively.
    put("actMs", (nav as PerformanceNavigationTiming & { activationStart?: number }).activationStart);
    // workerStart > 0 means the service worker handled this navigation — on the
    // PWA (which is the villa iPad's actual configuration) that is the normal
    // path, and its cost has never been separated from "the server was slow".
    if (nav.workerStart > 0) put("swMs", nav.responseStart - nav.workerStart);
    put("ttfbMs", nav.responseStart - nav.requestStart);
    put("htmlMs", nav.responseEnd - nav.responseStart);
    // Bundle: HTML delivered → our module body ran. This is download + parse +
    // compile of the JS, the phase the Babylon barrel-import fix targets.
    if (tJs !== undefined) put("bundleMs", tJs - nav.responseEnd);
  }

  // ── Our own code, phase by phase ─────────────────────────────────────────
  if (tJs !== undefined && tReact !== undefined) put("reactMs", tReact - tJs);

  // ── The human ────────────────────────────────────────────────────────────
  // A gate only appears when there is no restored session. When it does, the
  // time from it appearing to a session existing is dominated by a person
  // reading, tapping and typing — NOT by anything worth optimising. Reporting
  // it separately is what makes `activeMs` meaningful.
  const gated = tGate !== undefined;
  out.gated = gated;
  if (gated) out.pinned = mark("pin") !== undefined;
  let wait = 0;
  if (gated && tAuth !== undefined && tGate !== undefined && tAuth > tGate) {
    wait = tAuth - tGate;
    put("waitMs", wait);
  }

  // Passcode accepted → the scene effect actually starting: React committing
  // the whole authenticated tree (the config/FM/HA providers, Dashboard, then
  // BabylonCanvas) before one line of villa-loading code runs. This is the
  // stretch a user experiences as "I typed my PIN and nothing happened yet",
  // and no measurement has ever covered it. On the restored-session path (no
  // gate at all) it is measured from React instead, the only earlier anchor.
  // ANCHOR MATTERS: `tAuth` is a per-load mark, `tReact` is page-level and
  // never cleared. Falling back to `tReact` on a RELOAD measured from the
  // page's React mount, producing figures like mountMs: 21001 on a load whose
  // own span was 2.2s — the same class of lie `bootMs` told before it was
  // fixed. Only emitted when the anchor genuinely belongs to this load.
  const sceneFrom = tAuth ?? (isReload ? undefined : tReact);
  if (tScene !== undefined && sceneFrom !== undefined) put("mountMs", tScene - sceneFrom);

  // Navigation-relative from here down — only true for the page's FIRST load.
  if (isReload) {
    Object.assign(out, scriptWeight(), stallSummary());
    return out;
  }

  // THE number to judge a load by: wall clock minus the part spent waiting on a
  // person. Equals totalMs whenever a session was already restored.
  put("activeMs", total - wait);

  Object.assign(out, scriptWeight(), stallSummary());
  return out;
}
