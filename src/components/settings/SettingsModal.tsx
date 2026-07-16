// src/components/settings/SettingsModal.tsx
// HA connection + token + appearance. A footer button opens the full Config
// Editor (villa coordinates, entity metadata, bindings, 3D model source) as
// a modal over the live villa. Device badge icons are hardcoded, not
// editable here — see babylon/badgeIcons.ts + badgeIconKeys.ts.

import { useRef, useState } from "react";
import { Plug, Sliders, Sun, Moon, Monitor } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability, type Capability } from "@/auth/permissions";
import { useHA } from "@/ha/HAStateStore";
import { normaliseHaUrl, DEFAULT_SITE_TITLE, DEFAULT_RENDER, RENDER_PRESETS, type RenderConfig, type QualityPreset } from "@/config/AppConfig";
import { testConnection, type TestResult } from "@/ha/testConnection";
import { isIngress } from "@/ha/ingress";
import type { SceneManager } from "@/babylon/SceneManager";

interface Props {
  manager: SceneManager | null;
  onClose: () => void;
  /** Open the full Config Editor (a modal over the live villa). */
  onOpenConfigEditor: () => void;
}

export default function SettingsModal({ manager, onClose, onOpenConfigEditor }: Props) {
  const { config, update, replace } = useConfig();
  const { role } = useProfile();
  const { connect, haConfig } = useHA();
  // RBAC: which settings areas the active profile may use. Dashboard already
  // refuses to open this modal without "openSettings"; these narrow further.
  const can = (c: Capability) => role != null && hasCapability(role, c);

  // Snapshot the config at mount so Cancel can undo every live-applied tweak
  // (render preview, eye height, walk speed, and the toggles that update()
  // immediately) — restoring both the persisted config and the live scene.
  const initialConfigRef = useRef(config);
  const handleCancel = () => {
    replace(initialConfigRef.current);
    manager?.updateConfig(initialConfigRef.current);
    onClose();
  };
  const ingress = isIngress();

  const [siteTitle, setSiteTitle] = useState(config.siteTitle);
  const [url, setUrl] = useState(config.haUrl);
  const [token, setToken] = useState(config.haToken);
  const [eyeHeight, setEyeHeight] = useState(config.eyeHeight ?? 1.7);
  const [walkSpeed, setWalkSpeed] = useState(config.walkSpeed ?? 1);
  const [render, setRender] = useState<RenderConfig>(config.render ?? DEFAULT_RENDER);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  // Live-apply render tuning straight to the scene while dragging, so the user
  // can iterate on look/perf without saving + reloading.
  const applyRender = (patch: Partial<RenderConfig>) => {
    const next = { ...render, ...patch };
    setRender(next);
    manager?.setRenderConfig(next);
  };

  // Switching presets materialises a whole RenderConfig.
  const applyPreset = (quality: QualityPreset) => {
    applyRender({ ...RENDER_PRESETS[quality] });
  };

  // Live-apply so you can feel/see the change while dragging the sliders.
  const applyEyeHeight = (h: number) => {
    setEyeHeight(h);
    manager?.camera.setEyeHeight(h);
  };
  const applyWalkSpeed = (v: number) => {
    setWalkSpeed(v);
    manager?.camera.setWalkSpeed(v);
  };

  const save = () => {
    const cleanUrl = normaliseHaUrl(url);
    update({ siteTitle: siteTitle.trim(), haUrl: cleanUrl, haToken: token, eyeHeight, walkSpeed, render });
    // Only bounce the websocket when the connection details actually changed —
    // profiles that can't edit them (guests saving a theme tweak) keep the
    // live connection untouched.
    if (!ingress && (cleanUrl !== config.haUrl || token !== config.haToken)) {
      connect(cleanUrl, token).catch(() => {});
    }
    onClose();
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    setResult(await testConnection(normaliseHaUrl(url), token));
    setTesting(false);
  };

  return (
    <div className="modal-backdrop" onClick={handleCancel}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          {/* Theme selector lives in the header, icon-only + right-aligned —
              the Sun/Moon/Monitor glyphs are self-explanatory. Applied
              instantly (config.theme drives the data-theme attribute in
              ConfigContext) and persisted on Save. */}
          {can("customizeAppearance") && (
            <div className="segmented segmented-icons" role="group" aria-label="Theme">
              {([
                { key: "light", label: "Light theme", icon: Sun },
                { key: "dark", label: "Dark theme", icon: Moon },
                { key: "auto", label: "Auto (system) theme", icon: Monitor },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  className={config.theme === key ? "active" : ""}
                  onClick={() => update({ theme: key })}
                  aria-pressed={config.theme === key}
                  title={label}
                  aria-label={label}
                >
                  <Icon size={17} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="settings-body">

        {/* RBAC: shared branding — administration, not personal taste. */}
        {can("editConfig") && (
          <>
            <label>Dashboard title</label>
            <input
              value={siteTitle}
              onChange={(e) => setSiteTitle(e.target.value)}
              placeholder={haConfig?.location_name || DEFAULT_SITE_TITLE}
            />
          </>
        )}

        {!ingress && can("editConfig") && (
          <>
            <label>Home Assistant URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123" />

            <label>Long-lived access token</label>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhbGciOi…" />
          </>
        )}

        {!ingress && can("editConfig") && (
          <>
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
          </>
        )}

        {/* ── Visual & UI tuning ──────────────────────────────────────────
            Camera/movement, render quality and device icons. Available to any
            profile with "customizeAppearance" (guests included) — these are
            per-device comfort settings, not administration. */}
        {can("customizeAppearance") && (
        <>
        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

        {/* ── Camera & movement ─────────────────────────────────────────────
            The two view modes' comfort settings, side by side: how the
            first-person walk-through feels, and how the bird's-eye view pans. */}
        <h3 style={{ margin: 0, fontSize: 15 }}>First-person view</h3>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          How the walk-through camera feels. Both update live as you drag.
        </p>
        <div className="slider-pair" style={{ marginTop: 10 }}>
          <div>
            <label>Eye height · {eyeHeight.toFixed(2)} m</label>
            <input
              type="range" min={0.8} max={2.2} step={0.05} value={eyeHeight}
              onChange={(e) => applyEyeHeight(Number(e.target.value))}
            />
          </div>
          <div>
            <label>Walk speed · {walkSpeed.toFixed(1)}×</label>
            <input
              type="range" min={0.3} max={3} step={0.1} value={walkSpeed}
              onChange={(e) => applyWalkSpeed(Number(e.target.value))}
            />
          </div>
        </div>

        <h3 style={{ margin: "18px 0 0", fontSize: 15 }}>Overview (bird&apos;s-eye) view</h3>
        <label className="toggle" style={{ marginTop: 10 }}>
          <input
            type="checkbox" checked={config.naturalScrolling ?? true}
            onChange={(e) => update({ naturalScrolling: e.target.checked })}
          />
          <span>Natural scrolling</span>
        </label>

        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

        {/* ── Render quality & look ────────────────────────────────────────
            Simplified to a single quality preset plus a few opt-in extras. The
            preset materialises a full render config; day/night warmth is handled
            automatically in the scene. */}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Render quality &amp; look</h3>
          <button
            className="btn ghost"
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => applyPreset(DEFAULT_RENDER.quality)}
            title="Restore the recommended look"
          >
            Reset look
          </button>
        </div>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          Pick a quality preset — higher looks better, lower runs lighter on weak
          wall tablets. Everything updates live and saves with your config.
        </p>

        <label style={{ marginTop: 12 }}>Quality preset</label>
        <select
          value={render.quality ?? DEFAULT_RENDER.quality}
          onChange={(e) => applyPreset(e.target.value as QualityPreset)}
          style={{ width: "100%" }}
        >
          <option value="performance">Performance — lightest, flattest</option>
          <option value="balanced">Balanced — adds contact shadows (AO)</option>
          <option value="high">High — best look (recommended)</option>
        </select>

        <label style={{ marginTop: 14 }}>Brightness · {render.exposure.toFixed(2)}×</label>
        <input
          type="range" min={0.6} max={2} step={0.05} value={render.exposure}
          onChange={(e) => applyRender({ exposure: Number(e.target.value) })}
        />
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          Overall scene exposure. Raise it if the villa looks a little dark; updates live.
        </p>

        <label className="toggle" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={config.weatherEffects}
            onChange={(e) => update({ weatherEffects: e.target.checked })} />
          <span>Live weather effects (rain when it's raining)</span>
        </label>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          Mirrors your Home Assistant weather entity: rain shows when it's raining,
          nothing in clear/sunny/cloudy weather.
        </p>

        <label className="toggle" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={render.glow}
            onChange={(e) => applyRender({ glow: e.target.checked })} />
          <span>Glow around lit / active devices</span>
        </label>

        <label className="toggle" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={config.highlightInteractive}
            onChange={(e) => update({ highlightInteractive: e.target.checked })} />
          <span>Highlight clickable objects (blue outline)</span>
        </label>

        {/* Light effect strength + Night dimming side by side. Light effect
            strength controls the floor "light pool" a fixture casts when on
            (see babylon/LightPools.ts) — the visible substitute for real room
            lighting in baked-lighting villas, where a real dynamic light can
            never brighten the (unlit) structure regardless of range/intensity. */}
        <div className="slider-pair">
          <div>
            <label>Light effect strength · {render.lightPoolIntensity.toFixed(1)}×</label>
            <input
              type="range" min={0.3} max={2} step={0.1} value={render.lightPoolIntensity}
              onChange={(e) => applyRender({ lightPoolIntensity: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>Night dimming · {render.nightDimming.toFixed(1)}×</label>
            <input
              type="range" min={0} max={1} step={0.1} value={render.nightDimming}
              onChange={(e) => applyRender({ nightDimming: Number(e.target.value) })}
            />
          </div>
        </div>

        <p className="muted body-text" style={{ marginTop: 10, fontSize: 11 }}>
          Badge size — {(config.entityIconScale ?? 1.0).toFixed(2)}× — is set with
          the +/- buttons next to the category filters in the top bar.
        </p>

        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

        </>
        )}

        {/* The villa Latitude/Longitude, the old Rooms-mirror override, the
            backup buttons, the Inspector and the 3D model source (GLB / room
            data upload) used to sit on this landing screen. Coordinates,
            entity/binding editing and model upload now live in Advanced
            Settings (footer button below); the rest were removed — keeping
            this screen a short, everyday list.
            short, everyday list. */}

        </div>{/* end settings-body */}

        <div className="settings-footer">
          {/* Advanced Settings opens as a modal over the live villa (no reload). */}
          {can("editConfig") ? (
            <button className="btn ghost" onClick={onOpenConfigEditor}>
              <Sliders size={18} /> Advanced Settings
            </button>
          ) : <span />}
          <div className="row" style={{ gap: 12 }}>
            <button className="btn ghost" onClick={handleCancel}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
