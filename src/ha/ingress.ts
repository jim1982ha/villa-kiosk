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

/**
 * A JSON write to one of this add-on's own endpoints. Returns the raw
 * `Response` — parsing is the caller's, because response handling genuinely
 * varies (`r.ok`, a typed body, a 409 revision conflict) and a helper that
 * parsed would need a shape argument per call site.
 *
 * ⚠️ IT EXISTS BECAUSE THE THREE-LINE PREAMBLE HAD BEEN COPIED NINETEEN TIMES
 * (found by /dry-audit, 2026-08-28) and one copy was missing a line. Two of
 * those three lines are inert boilerplate; `credentials` is not. Every endpoint
 * here is behind the Ingress session cookie, so a call without it is a 401 —
 * and the site that had dropped it was `auth/verify`, the one that establishes
 * the session in the first place. It works, because same-origin is `fetch`'s
 * default, which is exactly the kind of fact a reader should not have to know.
 * A caller now gets the rule by CALLING rather than by remembering.
 *
 * ⚠️ THREE SITES DELIBERATELY DO NOT USE THIS, and each was read before being
 * left alone: the logout beacon in `ProfileContext` needs `credentials:
 * "include"` and `keepalive`, `telemetry` needs `keepalive` so a report
 * survives the page it is describing, and `storage` passes an `AbortSignal`.
 * `init` is spread last so any of them COULD adopt it; none has to.
 */
export function postJson(rel: string, body: unknown,
                         init: RequestInit = {}): Promise<Response> {
  return fetch(ingressPath(rel), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

/** The same, for an endpoint whose verb is PUT. See `postJson`. */
export function putJson(rel: string, body: unknown,
                        init: RequestInit = {}): Promise<Response> {
  return postJson(rel, body, { method: "PUT", ...init });
}
