// src/components/settings/ConfigEditorModal.tsx
// The full Config Editor, as a modal OVER the live villa (not a separate route).
// Opened from the Settings modal's footer; "Back" returns to Settings. Rendering
// it over the mounted Dashboard is what avoids the full GLB re-download/re-parse
// that the old /config route caused every time you left it — every edit here
// already applies to the live scene through ConfigContext.update(), so there is
// nothing to reload on the way out.

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import ConfigEditor from "./ConfigEditor";
import BindingsTable from "./BindingsTable";
import TelemetryPanel from "./TelemetryPanel";
import GroupedDevices from "./GroupedDevices";

interface Props {
  /** Return to the Settings modal this was opened from. */
  onBack: () => void;
  /** When opened from a device panel's edit shortcut, pre-filter the entity
   *  table to this entity_id so its row is right there. */
  focusEntityId?: string;
}

/** A section title that doubles as a collapse toggle — for the two sections
 *  in this modal (auto-detected entities, device telemetry) whose lists can
 *  run long enough to dominate the whole screen on open. Collapsed by
 *  default so Advanced Settings opens on something scannable rather than a
 *  wall of rows; `defaultOpen` lets a specific entry point (jumping here to
 *  edit one entity) start expanded instead. */
function CollapsibleSection({
  title, defaultOpen = false, children,
}: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        className="settings-section-title settings-section-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && children}
    </>
  );
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
          <VillaCoordinates />
          <p className="muted body-text" style={{ marginTop: 6, fontSize: 12 }}>
            Drives sun position and day/night for this villa.
          </p>

          {/* Defaults open when arriving via a device panel's "edit" shortcut
              (focusEntityId set) — otherwise that jump would land on a
              collapsed section with the target row hidden. */}
          <CollapsibleSection title="Auto-detected entity settings" defaultOpen={!!focusEntityId}>
            <ConfigEditor initialSearch={focusEntityId} />
          </CollapsibleSection>

          <div className="settings-section-title" style={{ marginTop: 28 }}>
            Grouped devices
          </div>
          <GroupedDevices />

          <CollapsibleSection title="Bound 3D objects">
            <BindingsTable />
          </CollapsibleSection>

          {/* Owner only: the endpoint itself 403s other roles (it carries
              other people's user-agents and error text), so don't render a
              panel that could only ever show an error for them. */}
          {role === "owner" && (
            <CollapsibleSection title="Device telemetry">
              <TelemetryPanel />
            </CollapsibleSection>
          )}
        </div>

        <div className="settings-footer" style={{ justifyContent: "space-between" }}>
          <span className="muted body-text" style={{ fontSize: 12 }}>v{__APP_VERSION__}</span>
          <button className="btn primary" onClick={onBack}>Close</button>
        </div>
      </div>
    </div>
  );
}
