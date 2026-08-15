// src/utils/telemetry.ts
// Fire-and-forget client → add-on event reporting (POST /telemetry, stored as
// a bounded ring in the add-on's /data — see supervisor-proxy.py).
//
// Why: the failures that actually matter here only ever happen on someone
// else's device. "My friend's iPhone 16 goes white after switching to
// WhatsApp" is not reproducible locally, and asking a guest to open devtools
// on a phone is not a diagnostic strategy. This ships the few facts that
// would have identified that bug immediately — load phase timings, JS errors,
// WebGL context loss, and the page lifecycle transitions around them.
//
// Deliberately cheap and unobtrusive:
//   * never awaited and never throws into a caller — a telemetry outage must
//     not affect the app at all;
//   * keepalive/sendBeacon so an event fired while the page is being hidden
//     (exactly when the iOS bug happens) still leaves the device;
//   * no PII beyond the User-Agent the browser already sends on every request,
//     and the server stamps time/UA/role itself so a client can't forge them;
//   * silently disabled off-Ingress/standalone if the endpoint isn't there
//     (one failed POST, then it stops trying for the session).

import { ingressPath } from "@/ha/ingress";

export type TelemetryKind =
  | "load"            // model load finished — phase timings
  | "error"           // uncaught JS error / unhandled rejection
  | "context-lost"    // WebGL context lost (the iOS memory-pressure signal)
  | "context-restored"
  // A main-thread block long enough for the UI to be visibly unresponsive,
  // AFTER the villa is up. The long-task observer always saw these; only the
  // load snapshot ever reported them. See bootTimeline.reportPostLoadFreeze.
  | "freeze"
  // How long INTERACTIVE frames actually take, summarised per burst of
  // interaction (SceneManager.sampleFrame). `freeze` reports a thread BLOCKED;
  // this reports one that is merely slow — every frame costing 40ms instead of
  // 8 — which is a different complaint ("laggy to orbit / to walk") and was
  // previously unmeasurable on any platform. It matters most on Safari, where
  // the long-task observer behind `freeze` does not exist at all.
  | "frames"
  | "lifecycle"       // pagehide / pageshow / visibility transitions
  | "recovered"       // we auto-reloaded after a restore onto a dead scene
  | "sync"            // shared-config pull/push outcome (see DeviceConfigSync)
  // Home Assistant's initial connect + hydrate. This runs while the PROFILE
  // SCREEN is showing — HAStateProvider sits above ProfileGate — so its cost
  // lands on the one screen whose only job is to stay responsive to a tap.
  // Reported separately because a load record is only emitted once the villa
  // finishes, and a session that stalls at the gate produces no `load` at all:
  // every gated load in the field dump that prompted this was simply missing,
  // which is why a reported freeze there had no data behind it.
  | "ha-connect"
  // Result of the on-device frame-cost A/B experiment (babylon/perfProbe.ts),
  // run by hand from `?debug`. Reported as well as logged so a run on the iPad
  // — the device that matters, and the hardest to attach devtools to — is
  // readable afterwards instead of needing a console at the moment it ran.
  | "probe"
  // TEMPORARY (2.345.0): how many times each instrumented block ran during a
  // load, and for how long in total. `freeze`/`stallMax*` say what was running
  // across one block; they cannot say whether that block ran twice, which is
  // the open question about `calibrateRooms`. See perfSpans' census notes —
  // this kind goes away with them.
  | "spans";

let disabled = false;

/** Report one event. Never awaited, never throws. */
export function report(kind: TelemetryKind, data: Record<string, unknown> = {}): void {
  if (disabled) return;
  const body = JSON.stringify({
    kind,
    // WHICH BUILD produced this event. Its absence once cost a whole
    // diagnosis: a load record timestamped two minutes after a release was
    // read as evidence that the release hadn't helped, when the add-on's
    // frontend ships inside the GHCR image and the device was still running
    // the previous build entirely. A log that can't identify its own version
    // invites exactly that mistake, so every event now carries it.
    v: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
    // Client-side context that helps correlate an event with a device without
    // identifying a person: viewport + devicePixelRatio pin down "which
    // phone", memory (Chrome-only) shows pressure, standalone distinguishes
    // the PWA from the HA-sidebar iframe (they behave differently on iOS).
    vw: window.innerWidth,
    vh: window.innerHeight,
    // The SCREEN, alongside the viewport, because the gap between them is a
    // whole class of bug that was previously invisible here. "There's an empty
    // bar at the bottom on iPhone" was chased through the CSS three times over
    // several releases; what settled it was noticing that vh was 812 on a
    // 402x874 device, i.e. iOS had handed the web view 62pt LESS than the
    // screen and no stylesheet could ever have reached the difference. Without
    // these two numbers that subtraction is not performable from the ring at
    // all, and the only way to get it was to ask someone to open Settings →
    // Telemetry on the affected handset and copy a report out by hand.
    // Cheap (two ints), and they make "the page laid out short" and "the host
    // gave the page less than the screen" distinguishable at a glance — they
    // need completely different fixes and look identical in a screenshot.
    scrw: screen.width,
    scrh: screen.height,
    // The THIRD number, and the one that finally makes the bottom-band report
    // decidable from the ring instead of from a screenshot (2.309.0). The two
    // above separate "the host gave the page less than the screen" from "the
    // page laid out short"; neither can tell whether the app SHELL filled the
    // page it was given. Three cases, three different fixes:
    //   shellH < vh  -> the shell is short: a document-side layout bug, ours.
    //   shellH = vh < scrh -> the page never got the strip: presentation meta
    //                         / manifest / host, and no CSS can reach it.
    //   shellH = vh = scrh -> whatever was reported is not this.
    // Rounded, and null before the shell mounts (a pre-React load record).
    shellH: (() => {
      const r = document.querySelector(".app-root")?.getBoundingClientRect();
      return r ? Math.round(r.height) : undefined;
    })(),
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    standalone: window.matchMedia?.("(display-mode: standalone)").matches === true
      || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    mem: (performance as Performance & { memory?: { usedJSHeapSize: number } })
      .memory?.usedJSHeapSize,
    ...data,
  });
  const url = ingressPath("telemetry");
  try {
    // sendBeacon survives the page being torn down — essential for the
    // lifecycle events we most want (they fire AS the page is going away).
    if (navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through to fetch */ }
  // keepalive gives fetch the same survive-teardown property where beacon
  // isn't available or refused the payload.
  fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).then((r) => {
    // 404 = older add-on without the endpoint; stop trying rather than log a
    // failed request on every event for the rest of the session.
    if (r.status === 404) disabled = true;
  }).catch(() => { /* offline / blocked — drop it, this is best-effort */ });
}

/**
 * A return from hidden is only worth an event if the page was away long enough
 * for the thing these records exist to explain — an iOS white screen, a scene
 * whose WebGL context was reclaimed while backgrounded — to have happened.
 *
 * Below this it is a tab switch, and a tab switch is the single noisiest event
 * the app can emit: `visibilitychange` fires on every app switch, every screen
 * lock and every notification pull-down, and the server ring holds only the
 * newest 500 events ACROSS ALL DEVICES. Reporting each one meant a phone in a
 * pocket could evict a whole fleet's load, freeze and frame history — the very
 * records anything is diagnosed from — with a list of times it was picked up.
 * The sync store solved the same problem with a dedupe for the same reason.
 */
const VISIBILITY_REPORT_MIN_HIDDEN_MS = 30_000;

/** Wire the page-lifecycle + WebGL signals that explain an iOS white screen.
 *  Idempotent; safe to call once at startup. */
let installed = false;
export function installLifecycleTelemetry(): void {
  if (installed) return;
  installed = true;
  // `persisted` is the exact field that misleads on iOS (see SceneManager's
  // handlePageHide) — recording it is what lets us confirm the diagnosis from
  // a real device instead of inferring it. Both of these are genuinely rare
  // (a real navigation away or back), so neither is throttled.
  window.addEventListener("pagehide", (e) => {
    report("lifecycle", { event: "pagehide", persisted: e.persisted });
  });
  window.addEventListener("pageshow", (e) => {
    report("lifecycle", { event: "pageshow", persisted: e.persisted });
  });
  // Only the RETURN, and only from a stretch long enough to matter. Going
  // hidden is not reported at all: it carries no information the return does
  // not, and it doubled the event count on the noisiest signal in the app.
  let hiddenSince = document.visibilityState === "hidden" ? Date.now() : 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (!hiddenSince) hiddenSince = Date.now();
      return;
    }
    const away = hiddenSince ? Date.now() - hiddenSince : 0;
    hiddenSince = 0;
    if (away < VISIBILITY_REPORT_MIN_HIDDEN_MS) return;
    report("lifecycle", { event: "visible", hiddenMs: Math.round(away) });
  });
}
