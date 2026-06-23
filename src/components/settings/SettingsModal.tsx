// src/components/settings/SettingsModal.tsx
// HA connection + token + location + model + backup/restore. Plus a link to the
// full Config Editor and a button to toggle the Babylon Inspector for calibration.

import { useRef, useState, useEffect } from "react";
import { Plug, Download, Upload, Bug, FileText } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { normaliseHaUrl, DEFAULT_SITE_TITLE } from "@/config/AppConfig";
import { testConnection, type TestResult } from "@/ha/testConnection";
import { exportBackup, importBackup, downloadBlob } from "@/utils/backup";
import { parseSh3d } from "@/utils/sh3dParser";
import { clearStoredModel, getModelMeta, fetchAddonConfig, type AddonConfig } from "@/utils/storage";
import { isIngress } from "@/ha/ingress";
import ModelUploader from "./ModelUploader";
import type { SceneManager } from "@/babylon/SceneManager";

interface Props {
  manager: SceneManager | null;
  onClose: () => void;
  onModelChanged: () => void;
}

export default function SettingsModal({ manager, onClose, onModelChanged }: Props) {
  const { config, update, replace, reset } = useConfig();
  const { connect, haConfig } = useHA();
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
  const [siteTitle, setSiteTitle] = useState(config.siteTitle);
  const [url, setUrl] = useState(config.haUrl);
  const [token, setToken] = useState(config.haToken);
  const [lat, setLat] = useState(String(config.latitude));
  const [lng, setLng] = useState(String(config.longitude));
  const [eyeHeight, setEyeHeight] = useState(config.eyeHeight ?? 1.7);
  const [walkSpeed, setWalkSpeed] = useState(config.walkSpeed ?? 1);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

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
    update({ siteTitle: siteTitle.trim(), haUrl: cleanUrl, haToken: token, latitude: Number(lat), longitude: Number(lng), eyeHeight, walkSpeed });
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
    <div className="modal-backdrop" onClick={onClose}>
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

        <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "22px 0" }} />

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
        <label className="toggle">
          <input
            type="checkbox" checked={config.weatherEffects}
            onChange={(e) => update({ weatherEffects: e.target.checked })}
          />
          <span>Live weather effects</span>
        </label>
        <p className="muted body-text" style={{ marginTop: 6 }}>
          Mirrors your Home Assistant weather entity in the scene. When it's
          raining you'll see rain; in clear, sunny or cloudy weather nothing is
          drawn — so good weather simply shows the villa as-is.
        </p>

        {/* "Highlight clickable objects" and "Show device state labels" now live
            as direct toggles in the top bar (desktop) / a dropdown (mobile). */}

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

        <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "22px 0" }} />

        {/* ── 3D model source ──────────────────────────────────────────────
            Add-on (Ingress) mode: the model is managed centrally via the add-on
            configuration page — NO per-browser upload UI. We only display which
            files are in use (read from the add-on options). Standalone / dev
            mode keeps the upload UI. */}
        {ingress ? (
          addonCfg === null ? (
            <p className="muted body-text">Reading add-on configuration…</p>
          ) : addonCfg.model_path ? (
            <div style={{ background: "rgba(107,170,117,0.1)", border: "1px solid rgba(107,170,117,0.3)", borderRadius: 10, padding: "12px 14px", marginTop: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--status-on, #6baa75)", marginBottom: 6 }}>
                ✓ Central model active — all clients share the same view
              </div>
              <div className="muted body-text" style={{ fontSize: 12 }}>
                <strong>GLB:</strong> <code>www/{addonCfg.model_path}</code>
              </div>
              {addonCfg.sh3d_path ? (
                <div className="muted body-text" style={{ fontSize: 12 }}>
                  <strong>SH3D:</strong> <code>www/{addonCfg.sh3d_path}</code>
                </div>
              ) : (
                <div className="muted body-text" style={{ fontSize: 12 }}>
                  <strong>SH3D:</strong> not configured (room names optional)
                </div>
              )}
              <p className="muted body-text" style={{ marginTop: 8, fontSize: 11 }}>
                These files are served from the add-on's configured paths (relative to the HA <code>www/</code> folder).
                To change them, open <strong>Settings → Add-ons → Villa Kiosk → Configuration</strong> in Home Assistant
                and edit <code>model_path</code> / <code>sh3d_path</code>.
              </p>
            </div>
          ) : (
            <div style={{ background: "rgba(224,170,80,0.1)", border: "1px solid rgba(224,170,80,0.35)", borderRadius: 10, padding: "12px 14px", marginTop: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--warning, #e0aa50)", marginBottom: 6 }}>
                ⚠ No central model configured
              </div>
              <p className="muted body-text" style={{ fontSize: 12, margin: 0 }}>
                Copy your <code>.glb</code> (and optional <code>.sh3d</code>) into the Home Assistant
                <code> /config/www/</code> folder, then set <code>model_path</code> (e.g.
                <code> villa-kiosk/TheLysHouse_1F.glb</code>) under
                <strong> Settings → Add-ons → Villa Kiosk → Configuration</strong> and restart the add-on.
              </p>
            </div>
          )
        ) : (
          <>
            <label>3D model</label>
            <ModelUploader onUploaded={() => { setModelMeta(getModelMeta()); onModelChanged(); }} />
            {modelMeta && (
              <button
                className="btn ghost mt"
                style={{ width: "100%", color: "var(--danger, #c0392b)" }}
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

        <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "22px 0" }} />

        <div className="row-buttons mt">
          <button
            className="btn ghost"
            onClick={() => {
              onClose();
              manager?.toggleInspector();
            }}
          >
            <Bug size={18} /> Inspector
          </button>
        </div>

        <div className="row-buttons mt">
          <button className="btn ghost" onClick={doExport}>
            <Download size={18} /> Export backup
          </button>
          <button className="btn ghost" onClick={() => importRef.current?.click()}>
            <Upload size={18} /> Import backup
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

        <div className="settings-footer">
          <button
            className="btn danger"
            title="Erase all saved settings (HA URL, token, bindings, markers, teleports) and restore defaults"
            onClick={() => {
              if (confirm("Reset EVERYTHING to defaults?\n\nThis erases your HA URL, token, entity bindings, markers and teleport points. Your uploaded 3D model is kept.")) {
                reset();
                onClose();
              }
            }}
          >
            Reset
          </button>
          <div className="row" style={{ gap: 12 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
