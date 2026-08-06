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
function ingressBasePath(): string {
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
