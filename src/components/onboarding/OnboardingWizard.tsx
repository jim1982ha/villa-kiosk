// src/components/onboarding/OnboardingWizard.tsx
// First-run setup: HA connection -> upload model -> location -> done.

import { useState } from "react";
import { Home, Plug, ArrowRight, MapPin, CheckCircle2 } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { normaliseHaUrl } from "@/config/AppConfig";
import { testConnection, type TestResult } from "@/ha/testConnection";
import { getModelMeta } from "@/utils/storage";
import ModelUploader from "@/components/settings/ModelUploader";

interface Props {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const { config, update } = useConfig();
  const { connect } = useHA();

  const [step, setStep] = useState(0);
  const [url, setUrl] = useState(config.haUrl);
  const [token, setToken] = useState(config.haToken);
  const [lat, setLat] = useState(String(config.latitude));
  const [lng, setLng] = useState(String(config.longitude));
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [hasModel, setHasModel] = useState(() => !!getModelMeta());

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
            <h2><Home size={24} /> Welcome to TheLysHouse</h2>
            <p className="sub">Your interactive 3D villa dashboard. Let's connect it to Home Assistant.</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setStep(1)}>Get started <ArrowRight size={18} /></button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>Connect Home Assistant</h2>
            <p className="sub">Enter your HA URL and a long-lived access token (Profile → Security → Long-lived tokens).</p>
            <label>URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123" />
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
              <button className="btn primary" onClick={() => setStep(2)} disabled={!result?.ok}>Next <ArrowRight size={18} /></button>
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
              <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
              <button className="btn primary" onClick={() => setStep(3)} disabled={!hasModel}>Next <ArrowRight size={18} /></button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2><MapPin size={22} /> Location</h2>
            <p className="sub">Used for realistic sun position. Pre-filled for Bali.</p>
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
              <button className="btn primary" onClick={finish}>Open Villa Dashboard <ArrowRight size={18} /></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
