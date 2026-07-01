// src/components/settings/SettingsModal.tsx
// HA connection + token + location + model + backup/restore. Plus a link to the
// full Config Editor and a button to toggle the Babylon Inspector for calibration.

import { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plug, Download, Upload, Bug, FileText, Info, Sliders, Sun, Moon, Monitor } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { normaliseHaUrl, DEFAULT_SITE_TITLE, DEFAULT_RENDER, DEFAULT_ENTITY_ICONS, RENDER_PRESETS, type RenderConfig, type QualityPreset } from "@/config/AppConfig";
import type { EntityType } from "@/types/scene.types";
import { testConnection, type TestResult } from "@/ha/testConnection";
import { exportBackup, importBackup, downloadBlob } from "@/utils/backup";
import { parseSh3d } from "@/utils/sh3dParser";
import { clearStoredModel, getModelMeta, fetchAddonConfig, uploadCentralModel, clearAddonConfigCache, type AddonConfig } from "@/utils/storage";
import { getLoadedModelInfo } from "@/utils/modelInfo";
import { isIngress } from "@/ha/ingress";
import ModelUploader from "./ModelUploader";
import type { SceneManager } from "@/babylon/SceneManager";

interface Props {
  manager: SceneManager | null;
  onClose: () => void;
  onModelChanged: () => void;
}

/** Friendly category names for the per-type device-icon editor. */
const ICON_CATEGORY_LABEL: Record<EntityType, string> = {
  light: "Lights",
  climate: "Climate",
  lock: "Locks",
  camera: "Cameras",
  cover: "Covers / blinds",
  fan: "Fans",
  binary_sensor: "Binary sensors",
  sensor: "Sensors",
  media_player: "Media players",
  switch: "Switches",
  input_boolean: "Input booleans",
  assist_satellite: "Assist satellites",
};

export default function SettingsModal({ manager, onClose, onModelChanged }: Props) {
  const { config, update, replace } = useConfig();
  const { connect, haConfig } = useHA();
  const navigate = useNavigate();

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
  const importRef = useRef<HTMLInputElement>(null);
  const sh3dRef = useRef<HTMLInputElement>(null);
  const [sh3dMsg, setSh3dMsg] = useState<string | null>(null);

  const loadSh3d = async (file: File) => {
    try {
      const { rooms, entities } = await parseSh3d(file);
      if (rooms.length === 0) {
        setSh3dMsg("No named rooms found in that .sh3d.");
        return;
      }
      update({
        sh3dRooms: rooms,
        sh3dEntities: entities,
      });
      setSh3dMsg(`Loaded ${rooms.length} rooms${entities.length ? ` + ${entities.length} calibration points` : ""}. Reloading…`);
      setTimeout(() => onModelChanged(), 600); // remount to re-fit room labels
    } catch (err) {
      setSh3dMsg((err as Error).message);
    }
  };

  const [modelMeta, setModelMeta] = useState(() => getModelMeta());
  const [addonCfg, setAddonCfg] = useState<AddonConfig | null>(null);
  useEffect(() => { fetchAddonConfig().then(setAddonCfg); }, []);

  // Central model upload (Ingress / add-on mode): push a GLB or SH3D straight to
  // the HA www folder via the supervisor-proxy, no SSH/Samba needed.
  const glbUploadRef = useRef<HTMLInputElement>(null);
  const sh3dUploadRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState<null | "glb" | "sh3d">(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const uploadCentral = async (file: File, kind: "glb" | "sh3d") => {
    const ext = kind === "glb" ? ".glb" : ".sh3d";
    if (!file.name.toLowerCase().endsWith(ext)) {
      setUploadMsg(`Please choose a ${ext} file.`);
      return;
    }
    setUploadBusy(kind);
    setUploadMsg(null);
    try {
      const { path, size } = await uploadCentralModel(file, kind);
      clearAddonConfigCache();
      setAddonCfg(await fetchAddonConfig());
      setUploadMsg(`Uploaded ${(size / 1_000_000).toFixed(1)} MB → www/${path}. Reloading…`);
      setTimeout(() => onModelChanged(), 600); // remount to load the new central model
    } catch (err) {
      setUploadMsg((err as Error).message);
    } finally {
      setUploadBusy(null);
    }
  };
  const loadedModel = getLoadedModelInfo();
  const [siteTitle, setSiteTitle] = useState(config.siteTitle);
  const [url, setUrl] = useState(config.haUrl);
  const [token, setToken] = useState(config.haToken);
  const [lat, setLat] = useState(String(config.latitude));
  const [lng, setLng] = useState(String(config.longitude));
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

  // Switching presets materialises a whole RenderConfig, but keeps the user's
  // independent "shadows" choice (it's an opt-in extra layered on any preset).
  const applyPreset = (quality: QualityPreset) => {
    applyRender({ ...RENDER_PRESETS[quality], shadows: render.shadows });
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
    update({ siteTitle: siteTitle.trim(), haUrl: cleanUrl, haToken: token, latitude: Number(lat), longitude: Number(lng), eyeHeight, walkSpeed, render });
    if (!ingress) {
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

  const doExport = async () => {
    const blob = await exportBackup(config, true);
    downloadBlob(blob, `villa-kiosk-backup-${Date.now()}.zip`);
  };

  const doImport = async (file: File) => {
    const { config: imported, modelImported } = await importBackup(file);
    if (imported) replace({ ...config, ...imported, haToken: config.haToken });
    if (modelImported) onModelChanged();
  };

  return (
    <div className="modal-backdrop" onClick={handleCancel}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
        </div>
        <div className="settings-body">

        <label>Dashboard title</label>
        <input
          value={siteTitle}
          onChange={(e) => setSiteTitle(e.target.value)}
          placeholder={haConfig?.location_name || DEFAULT_SITE_TITLE}
        />

        {/* ── Appearance ──────────────────────────────────────────────────
            Light / Dark / Auto. Applied instantly (config.theme drives the
            data-theme attribute in ConfigContext), and persisted on Save. */}
        <div className="settings-section-title">Appearance</div>
        <div className="segmented" role="group" aria-label="Theme">
          {([
            { key: "light", label: "Light", icon: Sun },
            { key: "dark", label: "Dark", icon: Moon },
            { key: "auto", label: "Auto", icon: Monitor },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={config.theme === key ? "active" : ""}
              onClick={() => update({ theme: key })}
              aria-pressed={config.theme === key}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          Auto follows this device's system light/dark setting.
        </p>

        {!ingress && (
          <>
            <label>Home Assistant URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123" />

            <label>Long-lived access token</label>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhbGciOi…" />
          </>
        )}

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

        {!ingress && (
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

        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

        <label>Eye height (walking) · {eyeHeight.toFixed(2)} m</label>
        <input
          type="range" min={0.8} max={2.2} step={0.05} value={eyeHeight}
          onChange={(e) => applyEyeHeight(Number(e.target.value))}
        />
        <p className="muted body-text" style={{ marginTop: 6 }}>
          Adjust until the view sits at natural standing height. Updates live.
        </p>

        <label style={{ marginTop: 16 }}>Walk speed · {walkSpeed.toFixed(1)}×</label>
        <input
          type="range" min={0.3} max={3} step={0.1} value={walkSpeed}
          onChange={(e) => applyWalkSpeed(Number(e.target.value))}
        />
        <p className="muted body-text" style={{ marginTop: 6 }}>
          Speed of the joystick and two-finger-swipe walking. Updates live.
        </p>

        <label className="toggle">
          <input
            type="checkbox" checked={config.naturalScrolling ?? true}
            onChange={(e) => update({ naturalScrolling: e.target.checked })}
          />
          <span>Natural scrolling (overview mode)</span>
        </label>
        <p className="muted body-text" style={{ marginTop: 6 }}>
          On: drag up = content moves up (map follows your finger). Off (Traditional):
          drag up = content scrolls down — like a web page. Affects overview camera pan and zoom.
        </p>

        <label className="toggle">
          <input
            type="checkbox" checked={config.wallCollisions}
            onChange={(e) => update({ wallCollisions: e.target.checked })}
          />
          <span>Wall collisions (can't walk through walls)</span>
        </label>
        {/* Live weather effects moved into "Render quality & look" below — it's a
            visual/scene option, so it belongs with the other look settings. */}

        {/* "Highlight clickable objects" and "Show device state labels" now live
            as direct toggles in the top bar (desktop) / a dropdown (mobile). */}

        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

        {/* ── Render quality & look ────────────────────────────────────────
            Simplified to a single quality preset plus two heavy opt-in extras
            (shadows, live weather). The preset materialises a full render config;
            day/night warmth is handled automatically in the scene. */}
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
          wall tablets. Shadows and live weather are the two heavy extras you can
          mix in. Everything updates live and saves with your config.
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
          <input type="checkbox" checked={render.shadows}
            onChange={(e) => applyRender({ shadows: e.target.checked })} />
          <span>Cast sun shadows (more depth — heaviest)</span>
        </label>

        <label className="toggle" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={config.weatherEffects}
            onChange={(e) => update({ weatherEffects: e.target.checked })} />
          <span>Live weather effects (rain when it's raining)</span>
        </label>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          Mirrors your Home Assistant weather entity: rain shows when it's raining,
          nothing in clear/sunny/cloudy weather.
        </p>

        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

        <h3 style={{ margin: 0, fontSize: 15 }}>Device state icons</h3>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          The in-scene badge for each device category. The icon shows the device
          type; its ring colour shows the live state (gold = on, dim = off,
          red = alert, faded = unreachable). Edit per category — paste any emoji.
        </p>

        <label style={{ display: "block", marginTop: 10 }}>
          Icon size — {(config.entityIconScale ?? 1.0).toFixed(1)}×
        </label>
        <input
          type="range" min={0.6} max={3} step={0.1}
          value={config.entityIconScale ?? 1.0}
          onChange={(e) => update({ entityIconScale: Number(e.target.value) })}
          style={{ width: "100%" }}
        />
        <p className="muted body-text" style={{ marginTop: 4, fontSize: 11 }}>
          Sets the base size of every badge. In the bird's-eye view the icons also
          grow as you zoom in and shrink as you zoom out.
        </p>

        <div className="row" style={{ flexWrap: "wrap", gap: 10, marginTop: 8 }}>
          {(Object.keys(DEFAULT_ENTITY_ICONS) as EntityType[]).map((type) => (
            <label key={type} style={{ display: "flex", alignItems: "center", gap: 8, width: "calc(50% - 5px)" }}>
              <input
                type="text"
                value={config.entityIcons?.[type] ?? DEFAULT_ENTITY_ICONS[type]}
                onChange={(e) => update({ entityIcons: { ...config.entityIcons, [type]: e.target.value } })}
                style={{ width: 44, textAlign: "center", fontSize: 18, padding: "4px 0" }}
                maxLength={4}
                aria-label={`${ICON_CATEGORY_LABEL[type]} icon`}
              />
              <span className="body-text" style={{ fontSize: 12 }}>{ICON_CATEGORY_LABEL[type]}</span>
            </label>
          ))}
        </div>
        <button
          className="btn ghost mt"
          style={{ fontSize: 12 }}
          onClick={() => update({ entityIcons: { ...DEFAULT_ENTITY_ICONS } })}
        >
          Reset icons to defaults
        </button>

        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

        <label className="toggle">
          <input
            type="checkbox" checked={config.calibrationFlipX}
            onChange={(e) => update({ calibrationFlipX: e.target.checked })}
          />
          <span>Mirror room detection left ↔ right</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox" checked={config.calibrationFlipZ}
            onChange={(e) => update({ calibrationFlipZ: e.target.checked })}
          />
          <span>Mirror room detection front ↔ back</span>
        </label>
        <p className="muted body-text" style={{ marginTop: 6 }}>
          The app auto-aligns rooms to the model. If the detected room is reversed
          versus the real villa (e.g. the laundry shows on the wrong side), toggle
          these to flip it. Updates live.
        </p>

        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

        {/* ── 3D model source ──────────────────────────────────────────────
            Add-on (Ingress) mode: the model is managed centrally via the add-on
            configuration page — NO per-browser upload UI. We only display which
            files are in use (read from the add-on options). Standalone / dev
            mode keeps the upload UI. */}
        {ingress ? (
          <>
          {addonCfg === null ? (
            <p className="muted body-text">Reading add-on configuration…</p>
          ) : addonCfg.model_path ? (
            /* Compact status line + (i) tooltip carrying the full model details
               (path, size, mesh count, SHA-256, source, SH3D) on hover/focus. */
            <div className="row spread" style={{ marginTop: 4 }}>
              <span className="body-text" style={{ fontWeight: 600, fontSize: 13, color: "var(--status-on)" }}>
                ✓ Central model active — all clients share the same view
              </span>
              <span className="info-tip">
                <button type="button" className="info-btn" aria-label="Model details">
                  <Info size={16} />
                </button>
                <div className="info-pop" role="tooltip">
                  <div className="row"><span>GLB</span><span><code>www/{addonCfg.model_path}</code></span></div>
                  {loadedModel && (
                    <>
                      <div className="row"><span>Loaded</span><span>{(loadedModel.bytes / 1_000_000).toFixed(2)} MB · {loadedModel.meshCount} meshes</span></div>
                      {loadedModel.sha256 && (
                        <div className="row"><span>SHA-256</span><span><code>{loadedModel.sha256}</code></span></div>
                      )}
                      <div className="row"><span>From</span><span><code>{loadedModel.url}</code></span></div>
                    </>
                  )}
                  <div className="row"><span>SH3D</span><span>{addonCfg.sh3d_path ? <code>www/{addonCfg.sh3d_path}</code> : "not configured (optional)"}</span></div>
                  <div style={{ marginTop: 8, color: "var(--text-dim)" }}>
                    Served from the add-on's configured paths (relative to <code>www/</code>). Set
                    <code> model_path</code> / <code>sh3d_path</code> under Settings → Add-ons → Villa Kiosk →
                    Configuration. Verify on disk: <code>shasum -a 256 {addonCfg.model_path.split("/").pop()}</code>
                  </div>
                </div>
              </span>
            </div>
          ) : (
            <div style={{ background: "color-mix(in srgb, var(--status-warning) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--status-warning) 40%, transparent)", borderRadius: 10, padding: "12px 14px", marginTop: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--status-warning)", marginBottom: 6 }}>
                ⚠ No central model yet
              </div>
              <p className="muted body-text" style={{ fontSize: 12, margin: 0 }}>
                Upload your <code>.glb</code> (and optional <code>.sh3d</code>) below — it's stored centrally
                so every kiosk loads it automatically. No SSH/Samba needed.
              </p>
            </div>
          )}

          {/* Central upload — writes straight into the HA www folder via the
              add-on, overwriting the current central files. */}
          <input ref={glbUploadRef} type="file" accept=".glb,model/gltf-binary" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCentral(f, "glb"); e.target.value = ""; }} />
          <input ref={sh3dUploadRef} type="file" accept=".sh3d" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCentral(f, "sh3d"); e.target.value = ""; }} />
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="btn ghost" style={{ flex: 1 }} disabled={uploadBusy !== null}
              onClick={() => glbUploadRef.current?.click()}>
              <Upload size={15} /> {uploadBusy === "glb" ? "Uploading…" : "Upload central GLB"}
            </button>
            <button className="btn ghost" style={{ flex: 1 }} disabled={uploadBusy !== null}
              onClick={() => sh3dUploadRef.current?.click()}>
              <Upload size={15} /> {uploadBusy === "sh3d" ? "Uploading…" : "Upload central SH3D"}
            </button>
          </div>
          <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
            Each upload overwrites the current central file and reloads every kiosk on next open.
          </p>
          {uploadMsg && <div className="test-result ok" style={{ marginTop: 8 }}>{uploadMsg}</div>}
          </>
        ) : (
          <>
            <label>3D model</label>
            <ModelUploader onUploaded={() => { setModelMeta(getModelMeta()); onModelChanged(); }} />
            {modelMeta && (
              <button
                className="btn ghost mt"
                style={{ width: "100%", color: "var(--status-danger)" }}
                onClick={async () => {
                  if (!confirm("Remove the stored 3D model?\n\nThe model is saved in this browser only — it is not part of the add-on data and must be re-uploaded after clearing.")) return;
                  await clearStoredModel();
                  setModelMeta(null);
                  onModelChanged();
                }}
              >
                Clear stored model ({modelMeta.name})
              </button>
            )}
            <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
              Tip: when deployed as a Home Assistant add-on, configure <strong>model_path</strong> in the
              add-on options to serve one shared model to all clients — no per-device upload needed.
            </p>

            {/* SH3D upload — standalone mode only */}
            <label style={{ marginTop: 16 }}>Room names (.sh3d) — optional</label>
            <button className="btn ghost" style={{ width: "100%" }} onClick={() => sh3dRef.current?.click()}>
              <FileText size={18} /> {config.sh3dRooms?.length ? `Loaded — ${config.sh3dRooms.length} rooms (replace)` : "Upload SweetHome .sh3d"}
            </button>
            <input
              ref={sh3dRef} type="file" accept=".sh3d" style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadSh3d(f);
              }}
            />
            <p className="muted body-text" style={{ marginTop: 6 }}>
              Reads room names + shapes straight from the SweetHome file so rooms are
              labelled automatically — works for any villa, no rebuild.
            </p>
            {sh3dMsg && <div className="test-result ok">{sh3dMsg}</div>}
          </>
        )}

        <div className="settings-section-title" style={{ marginTop: 22 }}>Advanced</div>
        <div className="tile-grid">
          <button
            className="tile-btn"
            onClick={() => {
              onClose();
              navigate("/config");
            }}
          >
            <Sliders size={20} />
            <span>Config Editor</span>
          </button>
          <button
            className="tile-btn"
            onClick={() => {
              onClose();
              manager?.toggleInspector();
            }}
          >
            <Bug size={20} />
            <span>Inspector</span>
          </button>
          <button className="tile-btn" onClick={doExport}>
            <Download size={20} />
            <span>Export backup</span>
          </button>
          <button className="tile-btn" onClick={() => importRef.current?.click()}>
            <Upload size={20} />
            <span>Import backup</span>
          </button>
          <input
            ref={importRef} type="file" accept=".zip" style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doImport(f);
            }}
          />
        </div>

        </div>{/* end settings-body */}

        <div className="settings-footer" style={{ justifyContent: "flex-end" }}>
          <div className="row" style={{ gap: 12 }}>
            <button className="btn ghost" onClick={handleCancel}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
