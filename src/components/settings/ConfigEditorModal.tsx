// src/components/settings/ConfigEditorModal.tsx
// The full Config Editor, as a modal OVER the live villa (not a separate route).
// Opened from the Settings modal's footer; "Back" returns to Settings. Rendering
// it over the mounted Dashboard is what avoids the full GLB re-download/re-parse
// that the old /config route caused every time you left it — every edit here
// already applies to the live scene through ConfigContext.update(), so there is
// nothing to reload on the way out.

import { useEffect, useRef, useState } from "react";
import { Download, Upload, FileText, Info } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { buildConfigExport, parseConfigImport } from "@/config/AppConfig";
import { parseRoomData } from "@/utils/sh3dParser";
import { clearStoredModel, getModelMeta, fetchAddonConfig, uploadCentralModel, clearAddonConfigCache, type AddonConfig } from "@/utils/storage";
import { getLoadedModelInfo } from "@/utils/modelInfo";
import { isIngress } from "@/ha/ingress";
import ConfigEditor from "./ConfigEditor";
import BindingsTable from "./BindingsTable";
import GroupedDevices from "./GroupedDevices";
import ModelUploader from "./ModelUploader";

interface Props {
  /** Return to the Settings modal this was opened from. */
  onBack: () => void;
  /** When opened from a device panel's edit shortcut, pre-filter the entity
   *  table to this entity_id so its row is right there. */
  focusEntityId?: string;
  /** A GLB/room-data upload changed the model — remount the canvas to load it. */
  onModelChanged: () => void;
}

/** Villa coordinates (drive sun tracking). Applies live on blur rather than
 *  needing a Save button — guards against a half-typed number (e.g. "-8.")
 *  briefly producing NaN mid-edit. */
function VillaCoordinates() {
  const { config, update } = useConfig();
  const [lat, setLat] = useState(String(config.latitude));
  const [lng, setLng] = useState(String(config.longitude));

  const commitLat = () => {
    const n = Number(lat);
    if (Number.isFinite(n)) update({ latitude: n });
    else setLat(String(config.latitude));
  };
  const commitLng = () => {
    const n = Number(lng);
    if (Number.isFinite(n)) update({ longitude: n });
    else setLng(String(config.longitude));
  };

  return (
    <div className="coord-grid">
      <div>
        <label htmlFor="villa-lat">Latitude</label>
        <input
          id="villa-lat" inputMode="decimal" value={lat}
          onChange={(e) => setLat(e.target.value)}
          onBlur={commitLat}
          onKeyDown={(e) => e.key === "Enter" && commitLat()}
        />
      </div>
      <div>
        <label htmlFor="villa-lng">Longitude</label>
        <input
          id="villa-lng" inputMode="decimal" value={lng}
          onChange={(e) => setLng(e.target.value)}
          onBlur={commitLng}
          onKeyDown={(e) => e.key === "Enter" && commitLng()}
        />
      </div>
    </div>
  );
}

/**
 * 3D model source — Owner only. Add-on (Ingress) mode: the model is managed
 * centrally via the add-on configuration page, uploaded here straight into
 * the HA www folder via the supervisor-proxy (no SSH/Samba needed); we only
 * display which files are in use otherwise. Standalone/dev mode keeps a
 * per-browser upload instead. Moved here (out of the everyday Settings
 * screen) since it's an administration action, not a everyday preference.
 */
function ModelSource({ onModelChanged }: { onModelChanged: () => void }) {
  const { config, update } = useConfig();
  const ingress = isIngress();

  const roomsRef = useRef<HTMLInputElement>(null);
  const [roomsMsg, setRoomsMsg] = useState<string | null>(null);

  // Adopt a room-data sidecar (<model>.rooms.json emitted by the Blender
  // pipeline) — the tiny replacement for uploading the full .sh3d.
  const applyRoomData = (text: string) => {
    const { rooms, entities } = parseRoomData(text);
    update({
      sh3dRooms: rooms,
      sh3dEntities: entities,
      // A new plan replaces the villa's rooms wholesale — drop every previously
      // defined room (old rooms AND any "Add room here" points) so the Rooms
      // menu shows ONLY what this file defines. The scene re-calibrates on reload.
      teleportPoints: [],
    });
    return `Loaded ${rooms.length} rooms${entities.length ? ` + ${entities.length} calibration points` : ""}. Reloading…`;
  };

  const loadRoomData = async (file: File) => {
    try {
      setRoomsMsg(applyRoomData(await file.text()));
      setTimeout(() => onModelChanged(), 600); // remount to re-fit room labels
    } catch (err) {
      setRoomsMsg((err as Error).message);
    }
  };

  const [modelMeta, setModelMeta] = useState(() => getModelMeta());
  const [addonCfg, setAddonCfg] = useState<AddonConfig | null>(null);
  useEffect(() => { fetchAddonConfig().then(setAddonCfg); }, []);

  // Central upload (Ingress / add-on mode): push a GLB or the room-data sidecar
  // straight to the HA www folder via the supervisor-proxy, no SSH/Samba needed.
  const glbUploadRef = useRef<HTMLInputElement>(null);
  const roomsUploadRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState<null | "glb" | "rooms">(null);
  const [uploadMsg, setUploadMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const uploadCentral = async (file: File, kind: "glb" | "rooms") => {
    const okExt = kind === "glb" ? [".glb"] : [".json"];
    if (!okExt.some((e) => file.name.toLowerCase().endsWith(e))) {
      setUploadMsg({ text: `Please choose a ${okExt.join(" / ")} file.`, ok: false });
      return;
    }
    setUploadBusy(kind);
    setUploadMsg(null);
    try {
      const { path, size } = await uploadCentralModel(file, kind, file.name);
      // For the room-data sidecar, ALSO adopt it into this running client's
      // config so its rooms/beams take effect immediately (not just for other
      // clients on their next open).
      if (kind === "rooms") applyRoomData(await file.text());
      clearAddonConfigCache();
      setAddonCfg(await fetchAddonConfig());
      const mb = size / 1_000_000;
      setUploadMsg({ text: `Uploaded ${mb < 1 ? `${(size / 1000).toFixed(0)} KB` : `${mb.toFixed(1)} MB`} → www/${path}. Reloading…`, ok: true });
      setTimeout(() => onModelChanged(), 600); // remount to load the new central model
    } catch (err) {
      setUploadMsg({ text: (err as Error).message, ok: false });
    } finally {
      setUploadBusy(null);
    }
  };
  const loadedModel = getLoadedModelInfo();

  return (
    <div>
      {ingress ? (
        <>
        {addonCfg === null ? (
          <p className="muted body-text">Reading add-on configuration…</p>
        ) : addonCfg.model_path ? (
          /* Compact status line + (i) tooltip carrying the full model details
             (path, size, mesh count, SHA-256, source, room data) on hover/focus. */
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
                {/* Every central upload overwrites the file AT model_path, so
                    the served name above never changes — show what was
                    actually uploaded or the panel reads as "wrong file". */}
                {addonCfg.model_upload?.original_name && (
                  <div className="row">
                    <span>Uploaded</span>
                    <span>
                      <code>{addonCfg.model_upload.original_name}</code>
                      {addonCfg.model_upload.uploaded_at &&
                        ` · ${new Date(addonCfg.model_upload.uploaded_at).toLocaleString()}`}
                    </span>
                  </div>
                )}
                {loadedModel && (
                  <>
                    <div className="row"><span>Loaded</span><span>{(loadedModel.bytes / 1_000_000).toFixed(2)} MB · {loadedModel.meshCount} meshes</span></div>
                    {loadedModel.sha256 && (
                      <div className="row"><span>SHA-256</span><span><code>{loadedModel.sha256}</code></span></div>
                    )}
                    <div className="row"><span>From</span><span><code>{loadedModel.url}</code></span></div>
                  </>
                )}
                <div className="row"><span>Room data</span><span>{addonCfg.rooms_upload?.original_name ? <code>{addonCfg.rooms_upload.original_name}</code> : <code>{addonCfg.model_path.replace(/\.glb$/i, ".rooms.json").split("/").pop()}</code>}</span></div>
                <div style={{ marginTop: 8, color: "var(--text-dim)" }}>
                  Served from the add-on's <code>model_path</code> (relative to <code>www/</code>) — an
                  upload overwrites the file at that path, so the GLB name above stays the same
                  whatever file you pick ("Uploaded" shows the file it came from). The room-data
                  sidecar (<code>.rooms.json</code>, emitted next to the GLB by the Blender pipeline)
                  lives alongside it. Set <code>model_path</code> under Settings → Add-ons → Villa
                  Kiosk → Configuration. Verify on disk: <code>shasum -a 256 {addonCfg.model_path.split("/").pop()}</code>
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
              Upload your <code>.glb</code> and its <code>.rooms.json</code> (both emitted by the
              Blender pipeline) below — stored centrally so every kiosk loads them automatically.
              No SSH/Samba needed.
            </p>
          </div>
        )}

        {/* Central upload — writes straight into the HA www folder via the
            add-on, overwriting the current central files. */}
        <input ref={glbUploadRef} type="file" accept=".glb,model/gltf-binary" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCentral(f, "glb"); e.target.value = ""; }} />
        <input ref={roomsUploadRef} type="file" accept=".json,application/json" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCentral(f, "rooms"); e.target.value = ""; }} />
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <button className="btn ghost" style={{ flex: 1 }} disabled={uploadBusy !== null}
            onClick={() => glbUploadRef.current?.click()}>
            <Upload size={15} /> {uploadBusy === "glb" ? "Uploading…" : "Upload central GLB"}
          </button>
          <button className="btn ghost" style={{ flex: 1 }} disabled={uploadBusy !== null}
            onClick={() => roomsUploadRef.current?.click()}>
            <Upload size={15} /> {uploadBusy === "rooms" ? "Uploading…" : "Upload room data"}
          </button>
        </div>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          Each upload overwrites the current central file and reloads every kiosk on next open.
          Room data is the small <code>.rooms.json</code> the Blender pipeline emits next to the GLB —
          it carries the room names, shapes and device positions used to label rooms and place devices.
        </p>
        {uploadMsg && (
          <div className={`test-result ${uploadMsg.ok ? "ok" : "fail"}`} style={{ marginTop: 8 }}>
            {uploadMsg.text}
          </div>
        )}
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

          {/* Room-data sidecar upload — standalone mode only */}
          <label style={{ marginTop: 16 }}>Room data — optional</label>
          <button className="btn ghost" style={{ width: "100%" }} onClick={() => roomsRef.current?.click()}>
            <FileText size={18} /> {config.sh3dRooms?.length ? `Loaded — ${config.sh3dRooms.length} rooms (replace)` : "Upload room data"}
          </button>
          <input
            ref={roomsRef} type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadRoomData(f);
            }}
          />
          <p className="muted body-text" style={{ marginTop: 6 }}>
            The small <code>.rooms.json</code> the Blender pipeline emits next to the GLB — it carries
            the room names, shapes and device positions, giving automatic room labels + calibration
            for any villa.
          </p>
          {roomsMsg && <div className="test-result ok">{roomsMsg}</div>}
        </>
      )}
    </div>
  );
}

export default function ConfigEditorModal({ onBack, focusEntityId, onModelChanged }: Props) {
  const { config, update } = useConfig();
  const { role } = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);
  const [backupMsg, setBackupMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Owner-only backup/restore: bundles device↔room bindings, room definitions
  // (incl. saved viewports), device icons, enabled/disabled devices and every
  // First-person/Overview + Render quality + Device-icon Settings option into
  // one JSON file — importable on another vanilla install to reproduce this
  // villa's configuration exactly (see AppConfig.ConfigExportBundle for what's
  // deliberately excluded, e.g. the HA connection token).
  const exportConfig = () => {
    const bundle = buildConfigExport(config);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `villa-kiosk-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupMsg({ text: "Configuration exported.", ok: true });
  };

  const importConfig = async (file: File) => {
    try {
      const patch = parseConfigImport(JSON.parse(await file.text()));
      if (!confirm(
        "Import this configuration?\n\nThis replaces device↔room bindings, room definitions, device icons and the First-person/Overview, Render quality and Device-icon settings on THIS device with the values from the file.",
      )) return;
      update(patch);
      setBackupMsg({ text: "Configuration imported.", ok: true });
    } catch (err) {
      setBackupMsg({ text: (err as Error).message, ok: false });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onBack}>
      <div
        className="modal settings-modal config-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Advanced Settings</h2>
          {/* Export/import a full backup of this villa's configuration —
              Owner only, icon-only (same treatment as the theme selector in
              the Settings header). */}
          {role === "owner" && (
            <div className="segmented segmented-icons" role="group" aria-label="Backup & restore">
              <button onClick={exportConfig} title="Export configuration" aria-label="Export configuration">
                <Download size={17} />
              </button>
              <button onClick={() => fileRef.current?.click()} title="Import configuration" aria-label="Import configuration">
                <Upload size={17} />
              </button>
              <input
                ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importConfig(f); e.target.value = ""; }}
              />
            </div>
          )}
        </div>

        <div className="settings-body">
          {backupMsg && (
            <div className={`test-result ${backupMsg.ok ? "ok" : "fail"}`} style={{ marginBottom: 16 }}>
              {backupMsg.text}
            </div>
          )}

          <div className="settings-section-title">Villa location</div>
          <p className="muted body-text" style={{ marginTop: 0, fontSize: 12 }}>
            Drives sun position and day/night for this villa.
          </p>
          <VillaCoordinates />

          {role === "owner" && (
            <>
              <div className="settings-section-title" style={{ marginTop: 28 }}>
                3D model source
              </div>
              <ModelSource onModelChanged={onModelChanged} />
            </>
          )}

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Auto-detected entity settings
          </div>
          <ConfigEditor initialSearch={focusEntityId} />

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Bound 3D objects
          </div>
          <BindingsTable />

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Grouped devices
          </div>
          <GroupedDevices />
        </div>

        <div className="settings-footer" style={{ justifyContent: "flex-end" }}>
          <button className="btn primary" onClick={onBack}>Close</button>
        </div>
      </div>
    </div>
  );
}
