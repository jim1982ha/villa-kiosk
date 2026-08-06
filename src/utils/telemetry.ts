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
  | "ha-connect";

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

/** Wire the page-lifecycle + WebGL signals that explain an iOS white screen.
 *  Idempotent; safe to call once at startup. */
let installed = false;
export function installLifecycleTelemetry(): void {
  if (installed) return;
  installed = true;
  // `persisted` is the exact field that misleads on iOS (see SceneManager's
  // handlePageHide) — recording it is what lets us confirm the diagnosis from
  // a real device instead of inferring it.
  window.addEventListener("pagehide", (e) => {
    report("lifecycle", { event: "pagehide", persisted: e.persisted });
  });
  window.addEventListener("pageshow", (e) => {
    report("lifecycle", { event: "pageshow", persisted: e.persisted });
  });
  document.addEventListener("visibilitychange", () => {
    report("lifecycle", { event: "visibilitychange", state: document.visibilityState });
  });
}
