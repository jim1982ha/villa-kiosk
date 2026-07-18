// src/components/onboarding/OnboardingWizard.tsx
// First-run setup: HA connection, single screen. When served as a Home
// Assistant add-on (Ingress), the connection is automatic via the same-origin
// Supervisor proxy (token injected server-side), so there's nothing to ask —
// this just waits for that connection and finishes on its own.
//
// The 3D model and villa-location steps this used to have were dropped: the
// model is handled entirely by BabylonCanvas (auto-detects the add-on's
// central model the same way in both modes — see storage.ts's
// probeStandaloneCentralModel — and falls back to its own inline uploader if
// none is found, with no onboarding involvement either way), and the
// location silently adopts the connected HA instance's own lat/lng once
// available, with no confirmation screen needed.

import { useEffect, useState } from "react";
import { Home, Plug, ArrowRight } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { normaliseHaUrl, resolveSiteTitle } from "@/config/AppConfig";
import { isIngress, ingressHaUrl } from "@/ha/ingress";
import { testConnection, type TestResult } from "@/ha/testConnection";

interface Props {
  onComplete: () => void;
}

/**
 * Best-effort guess at this villa's HA URL from the page's OWN address: this
 * app's own Cloudflare Tunnel convention (see the runbook this was built
 * against) puts Home Assistant at "ha-<same-hostname>" alongside wherever the
 * kiosk itself is served — e.g. the kiosk at
 * "https://villa.example.com/local/villa-kiosk/dist/index.html" implies HA is
 * at "https://ha-villa.example.com". Deliberately skipped for a bare LAN IP /
 * "localhost" (common for the wall-mounted-tablet LAN-direct setup — see
 * project conventions): there's no "ha-" sibling to guess there, so the field
 * is just left for the user to type their own local address.
 */
function deriveHaUrl(): string {
  try {
    const { protocol, hostname } = window.location;
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    if (isIp || hostname === "localhost" || !hostname.includes(".")) return "";
    if (hostname.startsWith("ha-")) return `${protocol}//${hostname}`;
    return `${protocol}//ha-${hostname}`;
  } catch {
    return "";
  }
}

export default function OnboardingWizard({ onComplete }: Props) {
  const { config, update } = useConfig();
  const { connect, connected, haConfig } = useHA();

  const ingress = isIngress();
  const [url, setUrl] = useState(ingress ? ingressHaUrl() : (config.haUrl || deriveHaUrl()));
  const [token, setToken] = useState(config.haToken);
  const [connecting, setConnecting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  // Set once we're ready to finish and are just giving haConfig a brief
  // window to arrive (see the effect below) so sun position starts accurate
  // instead of at the DEFAULT_CONFIG placeholder.
  const [finishing, setFinishing] = useState(false);

  const title = resolveSiteTitle(config, haConfig?.location_name);

  // As an add-on the kiosk reaches HA through the same-origin Supervisor proxy,
  // which injects the token server-side — so we connect token-less and never
  // show any fields at all. (The URL/token args are placeholders.)
  useEffect(() => {
    if (!ingress) return;
    const haUrl = ingressHaUrl();
    update({ haUrl });
    connect(haUrl, "").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingress]);

  const finish = (lat?: number, lng?: number) => {
    update({
      haUrl: normaliseHaUrl(url),
      haToken: token,
      ...(lat != null && lng != null ? { latitude: lat, longitude: lng } : {}),
      onboarded: true,
    });
    onComplete();
  };

  // Once connected (either mode), haConfig (villa location + instance name)
  // arrives asynchronously a moment later — give it a short window before
  // finishing rather than a dedicated confirmation screen; whichever comes
  // first (haConfig lands, or the timeout) completes onboarding.
  useEffect(() => {
    if (!connected) return;
    setFinishing(true);
    if (haConfig) {
      finish(haConfig.latitude, haConfig.longitude);
      return;
    }
    const t = setTimeout(() => finish(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, haConfig]);

  const runConnect = async () => {
    setConnecting(true);
    setResult(null);
    const r = await testConnection(normaliseHaUrl(url), token);
    setResult(r);
    setConnecting(false);
    if (r.ok) {
      update({ haUrl: normaliseHaUrl(url), haToken: token });
      connect(normaliseHaUrl(url), token).catch(() => {});
      // The `connected` effect above takes it from here once the real
      // connection (not this throwaway test socket) comes up.
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2><Home size={24} /> Welcome to {title}</h2>

        {ingress || finishing ? (
          <p className="sub">
            {finishing ? "Connected — finishing setup…" : "Connecting to Home Assistant…"}
          </p>
        ) : (
          <>
            <p className="sub">Connect this device to your villa's Home Assistant.</p>

            <label>Home Assistant URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://ha-yourvilla.example.com"
            />

            <label>Long-lived access token</label>
            <input
              type="password" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="eyJhbGciOi… (Profile → Security → Long-lived access tokens)"
            />

            {result && !result.ok && (
              <div className="test-result fail" style={{ whiteSpace: "pre-line" }}>
                {result.message}
                {result.trustUrl && (
                  <a
                    href={result.trustUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn ghost mt"
                    style={{ width: "100%", display: "inline-flex", justifyContent: "center" }}
                  >
                    Open {result.trustUrl} to trust its certificate
                  </a>
                )}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn primary" onClick={runConnect}
                disabled={connecting || !url || !token}
              >
                <Plug size={18} /> {connecting ? "Connecting…" : "Connect"} <ArrowRight size={18} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
