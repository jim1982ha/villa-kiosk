// src/ha/ingress.ts
// URL helpers for reaching the add-on's own backend (nginx + supervisor-proxy).
//
// The kiosk is ALWAYS served by the add-on, reached two ways:
//   * HA sidebar (Ingress): the page lives under "/api/hassio_ingress/<token>/",
//     and every backend path must be resolved relative to that base.
//   * Its own hostname (direct/Cloudflare): the page lives at "/", so the same
//     paths resolve against root.
// Either way we never ask for a Home Assistant URL or a long-lived token: the
// app is same-origin as its backend and reaches Core through the add-on's
// Supervisor proxy (see rootfs/usr/bin/supervisor-proxy.py), which injects the
// add-on's SUPERVISOR_TOKEN server-side so the browser stays token-less:
//   WS   -> <base>/core/websocket
//   REST -> <base>/core/api/...
// ingressBasePath() collapses to "/" off Ingress, so a single set of helpers
// serves both modes.

/** The base path to resolve backend routes against: the Ingress prefix
 *  ("/api/hassio_ingress/<token>/") in the sidebar, or "/" on the direct
 *  hostname. */
export function ingressBasePath(): string {
  const m = window.location.pathname.match(/^(.*\/api\/hassio_ingress\/[^/]+\/)/);
  return m ? m[1] : "/";
}

/** WebSocket endpoint of the add-on's Supervisor proxy (token injected server-side). */
export function ingressWsUrl(): string {
  return `${window.location.origin.replace(/^http/i, "ws")}${ingressBasePath()}core/websocket`;
}

/** REST base of the add-on's Supervisor proxy (token injected server-side). */
export function ingressApiBase(): string {
  return `${window.location.origin}${ingressBasePath()}core/api`;
}

/**
 * Resolve a path served by THIS add-on's nginx (e.g. "addon-config",
 * "model/foo.glb") against the base above. A leading-slash absolute path would
 * hit the origin root instead — which, behind the Ingress prefix, never reaches
 * the add-on and 404s. On the direct hostname (`ingressBasePath()` === "/")
 * this is just "/<rel>".
 */
export function ingressPath(rel: string): string {
  return `${ingressBasePath()}${rel.replace(/^\/+/, "")}`;
}

/** True when running as HA's Ingress iframe (the sidebar panel), not the
 *  direct hostname / installed PWA. */
export function isIngress(): boolean {
  return ingressBasePath() !== "/";
}

/**
 * Escape the Ingress iframe back to Home Assistant's own UI. HA renders an
 * Ingress panel as a same-origin iframe inside its own frontend, so
 * `window.top` is reachable; navigating it takes the whole app back to HA
 * instead of just this iframe's content.
 *
 * Exists because the kiosk's 3D view needs `touch-action: none` edge-to-edge
 * for its own pan/orbit/pinch gestures (see styles.css), which on iOS
 * Safari/WKWebView can also swallow the system edge-swipe-back gesture some
 * environments would otherwise offer to leave the panel — a reported
 * "can't get back to Home Assistant" dead end on iPhone. This button is a
 * guaranteed way out that doesn't depend on any native gesture working.
 *
 * No-op off Ingress (there's no HA UI to return to on the direct hostname /
 * installed PWA — callers should hide the control entirely there, see
 * isIngress()).
 */
export function exitToHomeAssistant(): void {
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = "/";
    }
  } catch {
    // Cross-origin or otherwise inaccessible — nothing we can do from here.
  }
}
