// src/components/onboarding/OnboardingWizard.tsx
// First-run setup: HA connection -> upload model -> location -> done.
// When served as a Home Assistant add-on (Ingress), the connection is automatic
// via the same-origin Supervisor proxy (token injected server-side), so the
// "Connect Home Assistant" step is skipped entirely.

import { useEffect, useState } from "react";
import { Home, Plug, ArrowRight, MapPin, CheckCircle2 } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { normaliseHaUrl, resolveSiteTitle } from "@/config/AppConfig";
import { isIngress, ingressHaUrl } from "@/ha/ingress";
import { testConnection, type TestResult } from "@/ha/testConnection";
import { getModelMeta } from "@/utils/storage";
import ModelUploader from "@/components/settings/ModelUploader";

interface Props {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const { config, update } = useConfig();
  const { connect, connected, haConfig } = useHA();

  const ingress = isIngress();
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState(ingress ? ingressHaUrl() : config.haUrl);
  const [token, setToken] = useState(config.haToken);
  const [lat, setLat] = useState(String(config.latitude));
  const [lng, setLng] = useState(String(config.longitude));
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [hasModel, setHasModel] = useState(() => !!getModelMeta());

  const title = resolveSiteTitle(config, haConfig?.location_name);

  // As an add-on the kiosk reaches HA through the same-origin Supervisor proxy,
  // which injects the token server-side — so we connect token-less and skip the
  // whole "Connect Home Assistant" step. (The URL/token args are placeholders.)
  useEffect(() => {
    if (!ingress || connected) return;
    const haUrl = ingressHaUrl();
    update({ haUrl });
    connect(haUrl, "").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingress]);

  // Auto-fill the map coordinates from the HA instance once we're connected, so
  // the Location step is pre-confirmed rather than manually entered.
  useEffect(() => {
    if (haConfig) {
      setLat(String(haConfig.latitude));
      setLng(String(haConfig.longitude));
    }
  }, [haConfig]);

  const totalSteps = 5;

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    const r = await testConnection(normaliseHaUrl(url), token);
    setResult(r);
    setTesting(false);
    if (r.ok) {
      update({ haUrl: normaliseHaUrl(url), haToken: token });
      connect(normaliseHaUrl(url), token).catch(() => {});
    }
  };

  const finish = () => {
    update({
      haUrl: normaliseHaUrl(url),
      haToken: token,
      latitude: Number(lat),
      longitude: Number(lng),
      onboarded: true,
    });
    onComplete();
  };

  // From Welcome, skip the Connect step when we're already connected (add-on).
  const startStep = connected ? 2 : 1;
  const canLeaveConnect = connected || !!result?.ok;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="wizard-steps">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} className={`step ${i <= step ? "done" : ""}`} />
          ))}
        </div>

        {step === 0 && (
          <>
            <h2><Home size={24} /> Welcome to {title}</h2>
            <p className="sub">
              Your interactive 3D villa dashboard.{" "}
              {connected
                ? "Connected to Home Assistant automatically."
                : ingress
                  ? "Connecting to Home Assistant…"
                  : "Let's connect it to Home Assistant."}
            </p>
            <div className="modal-actions">
              <button
                className="btn primary"
                onClick={() => setStep(startStep)}
                disabled={ingress && !connected}
              >
                Get started <ArrowRight size={18} />
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>Connect Home Assistant</h2>
            <p className="sub">
              {ingress
                ? "Your HA address is detected automatically — just paste a long-lived access token (Profile → Security → Long-lived tokens)."
                : "Enter your HA URL and a long-lived access token (Profile → Security → Long-lived tokens)."}
            </p>
            <label>URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://homeassistant.local:8123"
              readOnly={ingress}
            />
            <label>Token</label>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhbGciOi…" />
            <button className="btn ghost mt" style={{ width: "100%" }} onClick={runTest} disabled={testing}>
              <Plug size={18} /> {testing ? "Testing…" : "Test connection"}
            </button>
            {result && (
              <div className={`test-result ${result.ok ? "ok" : "fail"}`} style={{ whiteSpace: "pre-line" }}>
                {result.message}
                {!result.ok && result.trustUrl && (
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
              <button className="btn ghost" onClick={() => setStep(0)}>Back</button>
              <button className="btn primary" onClick={() => setStep(2)} disabled={!canLeaveConnect}>Next <ArrowRight size={18} /></button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Upload the 3D model</h2>
            <p className="sub">
              The kiosk needs a <strong>.glb</strong> file (glTF Binary). Export it from
              SweetHome 3D → Blender, or use any GLB of your villa. After loading,
              you'll bind objects to Home Assistant entities by tapping them.
            </p>
            <ModelUploader onUploaded={() => setHasModel(true)} />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setStep(connected ? 0 : 1)}>Back</button>
              <button className="btn primary" onClick={() => setStep(3)} disabled={!hasModel}>Next <ArrowRight size={18} /></button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2><MapPin size={22} /> Location</h2>
            <p className="sub">
              Used for realistic sun position.{" "}
              {haConfig ? "Pre-filled from your Home Assistant instance." : "Pre-filled — adjust if needed."}
            </p>
            <div className="row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label>Latitude</label>
                <input value={lat} onChange={(e) => setLat(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Longitude</label>
                <input value={lng} onChange={(e) => setLng(e.target.value)} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setStep(2)}>Back</button>
              <button className="btn primary" onClick={() => setStep(4)}>Next <ArrowRight size={18} /></button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2><CheckCircle2 size={24} /> Ready</h2>
            <p className="sub">Everything is set. Walk through your villa and tap objects to control them.</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={finish}>Open Dashboard <ArrowRight size={18} /></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
