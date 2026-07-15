// src/components/settings/ConfigEditorModal.tsx
// The full Config Editor, as a modal OVER the live villa (not a separate route).
// Opened from the Settings modal's footer; "Back" returns to Settings. Rendering
// it over the mounted Dashboard is what avoids the full GLB re-download/re-parse
// that the old /config route caused every time you left it — every edit here
// already applies to the live scene through ConfigContext.update(), so there is
// nothing to reload on the way out.

import { useState } from "react";
import { useConfig } from "@/config/ConfigContext";
import ConfigEditor from "./ConfigEditor";
import BindingsTable from "./BindingsTable";

interface Props {
  /** Return to the Settings modal this was opened from. */
  onBack: () => void;
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

export default function ConfigEditorModal({ onBack }: Props) {
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
          <ConfigEditor />

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Bound 3D objects
          </div>
          <BindingsTable />
        </div>

        <div className="settings-footer" style={{ justifyContent: "flex-end" }}>
          <button className="btn primary" onClick={onBack}>Done</button>
        </div>
      </div>
    </div>
  );
}
