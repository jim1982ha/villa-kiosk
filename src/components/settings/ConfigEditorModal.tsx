// src/components/settings/ConfigEditorModal.tsx
// The full Config Editor, as a modal OVER the live villa (not a separate route).
// Opened from the Settings modal's footer; "Back" returns to Settings. Rendering
// it over the mounted Dashboard is what avoids the full GLB re-download/re-parse
// that the old /config route caused every time you left it — every edit here
// already applies to the live scene through ConfigContext.update(), so there is
// nothing to reload on the way out.

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { buildConfigExport, parseConfigImport } from "@/config/AppConfig";
import ConfigEditor from "./ConfigEditor";
import BindingsTable from "./BindingsTable";

interface Props {
  /** Return to the Settings modal this was opened from. */
  onBack: () => void;
  /** When opened from a device panel's edit shortcut, pre-filter the entity
   *  table to this entity_id so its row is right there. */
  focusEntityId?: string;
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
 * Owner-only backup/restore: bundles device↔room bindings, room definitions
 * (incl. saved viewports), device icons, enabled/disabled devices and every
 * First-person/Overview + Render quality + Device-icon Settings option into
 * one JSON file — importable on another vanilla install to reproduce this
 * villa's configuration exactly (see AppConfig.ConfigExportBundle for what's
 * deliberately excluded, e.g. the HA connection token).
 */
function BackupRestore() {
  const { config, update } = useConfig();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const exportConfig = () => {
    const bundle = buildConfigExport(config);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `villa-kiosk-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg({ text: "Configuration exported.", ok: true });
  };

  const importConfig = async (file: File) => {
    try {
      const patch = parseConfigImport(JSON.parse(await file.text()));
      if (!confirm(
        "Import this configuration?\n\nThis replaces device↔room bindings, room definitions, device icons and the First-person/Overview, Render quality and Device-icon settings on THIS device with the values from the file.",
      )) return;
      update(patch);
      setMsg({ text: "Configuration imported.", ok: true });
    } catch (err) {
      setMsg({ text: (err as Error).message, ok: false });
    }
  };

  return (
    <div>
      <p className="muted body-text" style={{ marginTop: 0, fontSize: 12 }}>
        Export everything you've configured on this villa — device↔room
        bindings, rooms &amp; saved viewports, device icons, enabled/disabled
        devices, and the First-person/Overview, Render quality and Device-icon
        settings — into one file. Import it on another (vanilla) install of
        this app to reproduce this setup automatically.
      </p>
      <div className="row" style={{ gap: 10, marginTop: 10 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={exportConfig}>
          <Download size={15} /> Export configuration
        </button>
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> Import configuration
        </button>
        <input
          ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importConfig(f); e.target.value = ""; }}
        />
      </div>
      {msg && <div className={`test-result ${msg.ok ? "ok" : "fail"}`} style={{ marginTop: 8 }}>{msg.text}</div>}
    </div>
  );
}

export default function ConfigEditorModal({ onBack, focusEntityId }: Props) {
  const { role } = useProfile();
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
          <p className="muted body-text" style={{ marginTop: 0, fontSize: 12 }}>
            Drives sun position and day/night for this villa.
          </p>
          <VillaCoordinates />

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Auto-detected entity settings
          </div>
          <ConfigEditor initialSearch={focusEntityId} />

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Bound 3D objects
          </div>
          <BindingsTable />

          {role === "owner" && (
            <>
              <div className="settings-section-title" style={{ marginTop: 28 }}>
                Backup &amp; restore
              </div>
              <BackupRestore />
            </>
          )}
        </div>

        <div className="settings-footer" style={{ justifyContent: "flex-end" }}>
          <button className="btn primary" onClick={onBack}>Done</button>
        </div>
      </div>
    </div>
  );
}
