// src/components/settings/ConfigEditorModal.tsx
// The full Config Editor, as a modal OVER the live villa (not a separate route).
// Opened from the Settings modal's footer; "Back" returns to Settings. Rendering
// it over the mounted Dashboard is what avoids the full GLB re-download/re-parse
// that the old /config route caused every time you left it — every edit here
// already applies to the live scene through ConfigContext.update(), so there is
// nothing to reload on the way out.

import { useEffect, useRef, useState, type RefObject } from "react";
import { Download, Upload, Info } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { buildConfigExport, parseConfigImport } from "@/config/AppConfig";
import { parseRoomData } from "@/utils/sh3dParser";
import { fetchAddonConfig, uploadCentralModel, clearAddonConfigCache, type AddonConfig } from "@/utils/storage";
import { getLoadedModelInfo } from "@/utils/modelInfo";
import ConfigEditor from "./ConfigEditor";
import BindingsTable from "./BindingsTable";
import GroupedDevices from "./GroupedDevices";

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
 * 3D model source — Owner only. The model is uploaded here straight into the
 * add-on's own /data store via the supervisor-proxy (no SSH/Samba, no path to
 * configure); every client then loads it from there. Moved here (out of the
 * everyday Settings screen) since it's an administration action, not a
 * preference.
 */
/** (i) tooltip carrying the full central-model details (path, size, mesh
 *  count, SHA-256, source, latest plan) on hover/focus. */
function CentralModelInfo({
  addonCfg, loadedModel, editable,
}: {
  addonCfg: AddonConfig;
  loadedModel: ReturnType<typeof getLoadedModelInfo>;
  editable: boolean;
}) {
  return (
    <span className="info-tip">
      <button type="button" className="info-btn" aria-label="Model details">
        <Info size={16} />
      </button>
      <div className="info-pop" role="tooltip">
          <div className="row">
            <span>Latest SH3D plan</span>
            <span>
              {addonCfg.rooms_upload?.original_name ? (
                <>
                  <code>{addonCfg.rooms_upload.original_name}</code>
                  {addonCfg.rooms_upload.uploaded_at &&
                    ` · ${new Date(addonCfg.rooms_upload.uploaded_at).toLocaleString()}`}
                </>
              ) : "—"}
            </span>
          </div>
          {/* Show the ORIGINAL uploaded filename (the one the user recognises),
              not the managed on-disk name — every upload overwrites the same
              managed file, so showing that would always read as "villa.glb" and
              look like the wrong file. Full name, allowed to wrap so a long name
              is never truncated. It's stored/served as villa.glb (see the
              "From" URL below + the footer). */}
          <div className="row">
            <span>GLB</span>
            <span style={{ wordBreak: "break-word", textAlign: "right" }}>
              <code>{addonCfg.model_upload?.original_name || addonCfg.model_path}</code>
              {addonCfg.model_upload?.uploaded_at &&
                ` · ${new Date(addonCfg.model_upload.uploaded_at).toLocaleString()}`}
            </span>
          </div>
          {loadedModel && (
            <>
              <div className="row"><span>Loaded</span><span>{(loadedModel.bytes / 1_000_000).toFixed(2)} MB · {loadedModel.meshCount} meshes</span></div>
              {/* Fetch = getting the bytes (network or cache); Parse = Babylon
                  building the scene from them. A fast fetch with a still-slow
                  overall load points at the parse, not the network/caching. */}
              <div className="row"><span>Load time</span><span>fetch {loadedModel.fetchMs}ms · parse {loadedModel.parseMs}ms</span></div>
              {/* Parse split further: import = Babylon's own SceneLoader call
                  (glTF parse, Draco decode, texture decode + GPU upload) vs.
                  post = this app's own mesh-indexing/structure setup after
                  that. Almost all of parse is normally import. */}
              <div className="row"><span>&nbsp;&nbsp;↳ parse split</span><span>import {loadedModel.importMs}ms · post {loadedModel.postMs}ms</span></div>
              {loadedModel.sha256 && (
                <div className="row"><span>SHA-256</span><span><code>{loadedModel.sha256}</code></span></div>
              )}
              <div className="row"><span>From</span><span><code>{loadedModel.url}</code></span></div>
            </>
          )}
          <div style={{ marginTop: 8, color: "var(--text-dim)" }}>
            {editable ? (
              <>
                Stored in the add-on's own <code>/data</code> volume (on disk as <code>villa.glb</code>)
                and served to every client from there — an upload overwrites it, so re-uploading a new
                file replaces the villa for everyone (the name above is the file it came from). The
                room-data sidecar (<code>.rooms.json</code>, emitted next to the GLB by the Blender
                pipeline) lives alongside it. Upload both below; there's no path to configure.
              </>
            ) : (
              <>
                Loaded from the add-on's central store — every client (sidebar or direct hostname)
                loads the same model. To replace it, upload a new GLB/room-data file from Advanced
                Settings on the Owner profile; other devices pick it up automatically on next open.
              </>
            )}
          </div>
      </div>
    </span>
  );
}

/**
 * The GLB/room-data/configuration upload-and-backup row + its explanatory
 * copy + result messages — shared by BOTH "a central model already exists"
 * and "ingress with no central model yet" (the two cases that both need this
 * exact row; only whether the central-upload buttons are enabled differs).
 * Kept as one component so standalone and Ingress can't drift apart here.
 */
function ModelActionsRow({
  canUploadCentrally, uploadBusy, uploadMsg, backupMsg,
  glbUploadRef, roomsUploadRef, configFileRef,
  onGlbFile, onRoomsFile, onConfigFile, onExport,
}: {
  canUploadCentrally: boolean;
  uploadBusy: "glb" | "rooms" | null;
  uploadMsg: { text: string; ok: boolean } | null;
  backupMsg: { text: string; ok: boolean } | null;
  glbUploadRef: RefObject<HTMLInputElement>;
  roomsUploadRef: RefObject<HTMLInputElement>;
  configFileRef: RefObject<HTMLInputElement>;
  onGlbFile: (file: File) => void;
  onRoomsFile: (file: File) => void;
  onConfigFile: (file: File) => void;
  onExport: () => void;
}) {
  return (
    <>
      {/* GLB/room-data upload only exists where there's a backend to accept
          it (Ingress) — a standalone page has none, so these two buttons are
          left out entirely there rather than shown disabled: a permanently
          non-functional button reads as broken, not as an explained state. */}
      {canUploadCentrally && (
        <>
          <input ref={glbUploadRef} type="file" accept=".glb,model/gltf-binary" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onGlbFile(f); e.target.value = ""; }} />
          <input ref={roomsUploadRef} type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onRoomsFile(f); e.target.value = ""; }} />
        </>
      )}
      <input ref={configFileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onConfigFile(f); e.target.value = ""; }} />
      <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        {canUploadCentrally && (
          <>
            <button className="btn ghost" style={{ flex: 1, minWidth: 160 }} disabled={uploadBusy !== null}
              onClick={() => glbUploadRef.current?.click()}>
              <Upload size={15} /> {uploadBusy === "glb" ? "Uploading…" : "Upload central GLB"}
            </button>
            <button className="btn ghost" style={{ flex: 1, minWidth: 160 }} disabled={uploadBusy !== null}
              onClick={() => roomsUploadRef.current?.click()}>
              <Upload size={15} /> {uploadBusy === "rooms" ? "Uploading…" : "Upload room data"}
            </button>
          </>
        )}
        <button className="btn ghost" style={{ flex: 1, minWidth: 160 }} onClick={() => configFileRef.current?.click()}>
          <Upload size={15} /> Import Configuration
        </button>
        <button className="btn ghost" style={{ flex: 1, minWidth: 160 }} onClick={onExport}>
          <Download size={15} /> Export Configuration
        </button>
      </div>
      <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
        {canUploadCentrally
          ? "Each upload overwrites the current central file and reloads every kiosk on next open. Room data is the small "
          : "Upload a central GLB/room data from the Villa Kiosk add-on's Advanced Settings instead — a standalone page has no backend to write them. Room data is the small "}
        <code>.rooms.json</code> the Blender pipeline emits next to the GLB —
        it carries the room names, shapes and device positions used to label rooms and place devices.
        Import/Export Configuration is a per-device backup of your device↔room bindings, room
        viewpoints, device icons and Settings preferences.
      </p>
      {uploadMsg && (
        <div className={`test-result ${uploadMsg.ok ? "ok" : "fail"}`} style={{ marginTop: 8 }}>
          {uploadMsg.text}
        </div>
      )}
      {backupMsg && (
        <div className={`test-result ${backupMsg.ok ? "ok" : "fail"}`} style={{ marginTop: 8 }}>
          {backupMsg.text}
        </div>
      )}
    </>
  );
}

function ModelSource({ onModelChanged }: { onModelChanged: () => void }) {
  const { config, update } = useConfig();

  // Owner-only backup/restore: bundles device↔room bindings, room definitions
  // (incl. saved viewports), device icons, enabled/disabled devices and every
  // First-person/Overview + Render quality + Device-icon Settings option into
  // one JSON file — importable on another vanilla install to reproduce this
  // villa's configuration exactly (see AppConfig.ConfigExportBundle for what's
  // deliberately excluded, e.g. the HA connection token, and the model/room
  // plan geometry, which is central/model-specific — see "Upload room data"
  // below, kept as a separate mechanism since it auto-syncs to every kiosk in
  // the villa, unlike this per-device file).
  const configFileRef = useRef<HTMLInputElement>(null);
  const [backupMsg, setBackupMsg] = useState<{ text: string; ok: boolean } | null>(null);

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

  // Adopt a room-data sidecar (<model>.rooms.json emitted by the Blender
  // pipeline) into this running client immediately after a central upload.
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
  };

  const [addonCfg, setAddonCfg] = useState<AddonConfig | null>(null);
  useEffect(() => { fetchAddonConfig().then(setAddonCfg); }, []);

  // Central upload: push a GLB or the room-data sidecar straight into the
  // add-on's /data store via the supervisor-proxy, no SSH/Samba needed.
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
      setUploadMsg({ text: `Uploaded ${mb < 1 ? `${(size / 1000).toFixed(0)} KB` : `${mb.toFixed(1)} MB`} → ${path}. Reloading…`, ok: true });
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
      {/* (i) sits inline with the title (not on its own row below) — only
          meaningful once a central model exists, so it's conditional here. */}
      <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 28 }}>
        <div className="settings-section-title" style={{ margin: 0 }}>3D model source</div>
        {addonCfg?.model_path && (
          <CentralModelInfo addonCfg={addonCfg} loadedModel={loadedModel} editable />
        )}
      </div>
      {addonCfg === null ? (
        <p className="muted body-text">Reading the central model…</p>
      ) : (
        // The kiosk is always backed by the add-on, so an upload always lands in
        // the add-on's /data store and reaches every client. When nothing's been
        // uploaded yet, prompt for it; otherwise just show the upload/backup row.
        <>
          {!addonCfg.model_path && (
            <div style={{ background: "color-mix(in srgb, var(--status-warning) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--status-warning) 40%, transparent)", borderRadius: 10, padding: "12px 14px", marginTop: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--status-warning)", marginBottom: 6 }}>
                ⚠ No central model yet
              </div>
              <p className="muted body-text" style={{ fontSize: 12, margin: 0 }}>
                Upload your <code>.glb</code> and its <code>.rooms.json</code> (both emitted by the
                Blender pipeline) below — stored in the add-on so every kiosk loads them
                automatically. No SSH/Samba needed.
              </p>
            </div>
          )}
          <ModelActionsRow
            canUploadCentrally uploadBusy={uploadBusy} uploadMsg={uploadMsg} backupMsg={backupMsg}
            glbUploadRef={glbUploadRef} roomsUploadRef={roomsUploadRef} configFileRef={configFileRef}
            onGlbFile={(f) => uploadCentral(f, "glb")} onRoomsFile={(f) => uploadCentral(f, "rooms")}
            onConfigFile={importConfig} onExport={exportConfig}
          />
        </>
      )}
    </div>
  );
}

export default function ConfigEditorModal({ onBack, focusEntityId, onModelChanged }: Props) {
  const { role } = useProfile();
  const { config, update } = useConfig();

  return (
    <div className="modal-backdrop" onClick={onBack}>
      <div
        className="modal settings-modal config-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Advanced Settings</h2>
        </div>

        <div className="settings-body">
          <div className="settings-section-title">Villa location</div>
          <VillaCoordinates />
          <p className="muted body-text" style={{ marginTop: 6, fontSize: 12 }}>
            Drives sun position and day/night for this villa.
          </p>

          {role === "owner" && <ModelSource onModelChanged={onModelChanged} />}

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Auto-detected entity settings
          </div>
          <ConfigEditor initialSearch={focusEntityId} />

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Grouped devices
          </div>
          <GroupedDevices />

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Bound 3D objects
          </div>
          <BindingsTable />

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Lighting
          </div>
          <label className="toggle" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={config.clipLightPools ?? true}
              onChange={(e) => update({ clipLightPools: e.target.checked })}
            />
            <span>Keep a light's floor glow inside its walls</span>
          </label>
          <p className="muted body-text" style={{ marginTop: 6, fontSize: 12 }}>
            Baked-lighting villas only. Trims each fixture's floor glow to the
            surrounding walls so it doesn't spill outside the house. Computed in
            the background, so turning lights on stays instant — turn it off on a
            low-end device that would rather skip the extra work.
          </p>
        </div>

        <div className="settings-footer" style={{ justifyContent: "space-between" }}>
          <span className="muted body-text" style={{ fontSize: 12 }}>v{__APP_VERSION__}</span>
          <button className="btn primary" onClick={onBack}>Close</button>
        </div>
      </div>
    </div>
  );
}
