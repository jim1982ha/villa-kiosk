// src/ha/connectionDiagnostics.ts
// Turns the (deliberately vague) browser WebSocket failures into actionable
// guidance. The #1 real-world gotcha: an HTTPS Home Assistant on a private IP
// uses a self-signed certificate. A browser will not open a `wss://` socket to
// a host whose certificate it hasn't already trusted — and, unlike a normal
// page load, the WebSocket API gives NO way to prompt the user to accept it and
// NO error detail. So the exact same URL + token "works on the laptop" (which
// has already visited the HA page and trusted the cert) but silently fails on a
// phone that never has. This module detects that situation and others.

export interface ConnectionDiagnosis {
  /** Short, human cause. */
  hint: string | null;
  /** If set, the user should open this URL once in THIS browser and accept the
   *  security warning, then retry (trusts the self-signed certificate). */
  trustUrl: string | null;
  /** True when the page protocol makes the connection impossible as configured. */
  blocking: boolean;
}

const PRIVATE_HOST =
  /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|.*\.local|homeassistant)$/i;

/**
 * Pre-flight check of an HA base URL against the page it runs in. Returns a
 * diagnosis even before we try to connect, plus an enriched message after a
 * failure (pass `failed: true`).
 */
export function diagnoseConnection(haUrl: string, failed = false): ConnectionDiagnosis {
  let target: URL | null = null;
  try {
    target = new URL(haUrl);
  } catch {
    return { hint: "That HA URL isn't valid. Use e.g. http://192.168.1.10:8123", trustUrl: null, blocking: true };
  }

  const pageHttps = typeof location !== "undefined" && location.protocol === "https:";
  const targetHttps = target.protocol === "https:";
  const privateHost = PRIVATE_HOST.test(target.hostname);

  // Hard block: an HTTPS page cannot open an insecure ws:// socket (mixed content).
  if (pageHttps && !targetHttps) {
    return {
      hint:
        "This page is served over HTTPS but the HA URL is http://, so the browser blocks the connection (mixed content). " +
        "Use an https:// HA URL, or open this kiosk over http://.",
      trustUrl: null,
      blocking: true,
    };
  }

  // The classic: HTTPS HA on a private IP → self-signed cert must be trusted first.
  if (targetHttps && privateHost) {
    return {
      hint: failed
        ? "Home Assistant uses a self-signed certificate on this address. This browser must trust it first: " +
          "open the HA URL below in a new tab, accept the security warning, then come back and retry. " +
          "(This is why it can work on one device but not another with the same URL and token.)"
        : null,
      trustUrl: target.origin,
      blocking: false,
    };
  }

  if (failed) {
    return {
      hint:
        "Couldn't reach Home Assistant. Check the device is on the same network, the URL host/port are correct, " +
        "and the token is a valid long-lived access token.",
      trustUrl: null,
      blocking: false,
    };
  }

  return { hint: null, trustUrl: null, blocking: false };
}
