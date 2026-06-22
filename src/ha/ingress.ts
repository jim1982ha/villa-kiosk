// src/ha/ingress.ts
// Helpers for when the kiosk is served through a Home Assistant add-on (Ingress).
//
// As an add-on we never ask for a Home Assistant URL or a long-lived token: the
// app is same-origin as HA, and it reaches Core through the add-on's built-in
// Supervisor proxy (see rootfs/usr/bin/supervisor-proxy.py). That proxy injects
// the add-on's SUPERVISOR_TOKEN server-side, so the browser stays token-less:
//   WS   -> <ingress base>/core/websocket
//   REST -> <ingress base>/core/api/...

/** True when served behind HA Ingress (i.e. installed and opened as an add-on). */
export function isIngress(): boolean {
  return window.location.pathname.includes("/api/hassio_ingress/");
}

/** The Ingress base path, e.g. "/api/hassio_ingress/<token>/" (trailing slash). */
export function ingressBasePath(): string {
  const m = window.location.pathname.match(/^(.*\/api\/hassio_ingress\/[^/]+\/)/);
  return m ? m[1] : "/";
}

/**
 * Under Ingress the app is SAME ORIGIN as the Home Assistant instance, so the HA
 * URL is simply our own origin — no need to ask the user to type it.
 */
export function ingressHaUrl(): string {
  return window.location.origin;
}

/** WebSocket endpoint of the add-on's Supervisor proxy (token injected server-side). */
export function ingressWsUrl(): string {
  return `${window.location.origin.replace(/^http/i, "ws")}${ingressBasePath()}core/websocket`;
}

/** REST base of the add-on's Supervisor proxy (token injected server-side). */
export function ingressApiBase(): string {
  return `${window.location.origin}${ingressBasePath()}core/api`;
}
