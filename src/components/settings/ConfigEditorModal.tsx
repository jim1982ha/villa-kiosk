// src/components/settings/ConfigEditorModal.tsx
// The full Config Editor, as a modal OVER the live villa (not a separate route).
// Opened from the Settings modal's footer; "Back" returns to Settings. Rendering
// it over the mounted Dashboard is what avoids the full GLB re-download/re-parse
// that the old /config route caused every time you left it — every edit here
// already applies to the live scene through ConfigContext.update(), so there is
// nothing to reload on the way out.

import { useState } from "react";
import { useModalA11y } from "@/hooks/useModalA11y";
import { Boxes, Home, LogOut, Upload, Wrench } from "lucide-react";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import CentralModelInfo from "./CentralModelInfo";
import { useGlbUpload } from "./useGlbUpload";
import ConfigEditor from "./ConfigEditor";
import BindingsTable from "./BindingsTable";
import TelemetryPanel from "./TelemetryPanel";
import GroupedDevices from "./GroupedDevices";

/** ⚠️ EVERY TAB CARRIES TWO PANELS, AND THAT IS A RULE RATHER THAN AN
 *  ACCIDENT. This screen was a stack of six collapsible sections and read as
 *  clutter; splitting it one-section-per-tab would have traded a long scroll
 *  for six tabs that each hold one control, which is worse — Location is two
 *  number fields and Session is one button. Two panels per tab is what makes
 *  each one a SUBJECT ("where the villa is", "what devices exist", "what this
 *  box is doing") rather than a container.
 *
 *  ⚠️ AND THE NON-OWNER VIEW WAS SIZED TOO. Both System panels are owner-only,
 *  so that whole tab is filtered out rather than rendered empty — a non-owner
 *  gets two tabs holding two panels apiece, which is the same shape. */
type SettingsTab = "villa" | "devices" | "system";

const TABS: (ModalTab<SettingsTab> & { owner?: true })[] = [
  { id: "villa", label: "Villa", icon: Home },
  { id: "devices", label: "Devices", icon: Boxes },
  { id: "system", label: "System", icon: Wrench, owner: true },
];

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

/** Immediately signs every device out — a lost tablet, a PIN someone saw.
 *  Two-tap confirm, same idiom as Facility's "Delete all" buttons: this
 *  signs the person clicking it out too, so it's worth pausing on. */
function LogoutAllSection() {
  const { logoutAll } = useProfile();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <>
      <p className="muted body-text" style={{ marginTop: 0, marginBottom: 10 }}>
        Signs every device out immediately — this one included — regardless of
        how long the "Session length" add-on option says a sign-in should
        last. Use it if a tablet went missing or a PIN was seen by someone who
        shouldn't have it.
      </p>
      {failed && (
        <div className="test-result fail" style={{ marginBottom: 10 }}>
          Could not reach the server — no session was signed out.
        </div>
      )}
      {confirming ? (
        <div className="modal-actions" style={{ margin: 0 }}>
          <button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
          <button
            className="btn danger"
            onClick={async () => {
              const ok = await logoutAll();
              setFailed(!ok);
              setConfirming(false);
            }}
          >
            Log out every device?
          </button>
        </div>
      ) : (
        <button className="btn ghost" onClick={() => setConfirming(true)}>
          <LogOut size={16} /> Log out all devices
        </button>
      )}
    </>
  );
}

export default function ConfigEditorModal({ onBack, focusEntityId, onModelChanged }: Props) {
  // Focus trap + Escape + focus restore (see useModalA11y).
  const dialogRef = useModalA11y(onBack);
  const { role } = useProfile();
  // ⚠️ FILTERED BEFORE THE INITIAL VALUE IS CHOSEN, so a non-owner can never
  // start on a tab that is not in their strip — which would render an empty
  // body under a tab bar highlighting nothing.
  const tabs = TABS.filter((t) => role === "owner" || !t.owner);
  // ⚠️ THE EDIT SHORTCUT OPENS ON "Devices". Arriving from a device panel's
  // "edit" and landing on Villa would hide the row the operator came for —
  // the same defect the old collapse's `defaultOpen` guarded against one level
  // down, which is the guard this tab replaces rather than drops.
  const [tab, setTab] = useState<SettingsTab>(
    focusEntityId ? "devices" : (tabs[0]?.id ?? "villa"));
  const canUploadModel = role === "owner";
  // Central GLB/room-data upload — Owner only. Lives in this modal's OWN
  // header (icon-only, same header-icon-btn treatment as the day/night
  // invert toggle in the Settings modal's header), not the main app's top
  // bar — it's an administration action scoped to Advanced Settings.
  const glbUpload = useGlbUpload(canUploadModel, onModelChanged);

  return (
    <div className="modal-backdrop" onClick={onBack}>
      <div
        ref={dialogRef}
        className="modal settings-modal config-editor-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Advanced settings"
      >
        <div className="settings-header">
          {/* tabIndex={-1} + data-autofocus: useModalA11y's default (the
              FIRST focusable descendant) would otherwise land here on the
              (i) model-info button — the very next element — whose tooltip
              is shown on `:focus-within` so keyboard Tab users can reach it
              too, not just mouse hover. Landing focus there on open then
              popped the tooltip immediately, with no hover at all. The
              heading is the conventional dialog-open focus target anyway;
              tabIndex={-1} makes it programmatically focusable without
              joining the normal Tab order. */}
          <h2 tabIndex={-1} data-autofocus>Advanced Settings</h2>
          {canUploadModel && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {glbUpload.addonCfg?.model_path && (
                <CentralModelInfo addonCfg={glbUpload.addonCfg} loadedModel={glbUpload.loadedModel} editable />
              )}
              <input
                ref={glbUpload.glbUploadRef} type="file" multiple hidden
                accept=".glb,.json,application/json,model/gltf-binary"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length) void glbUpload.uploadGlbAndRooms(files);
                }}
              />
              <button
                className="icon-btn header-icon-btn"
                onClick={glbUpload.openPicker}
                disabled={glbUpload.uploadBusy !== null}
                title="Upload GLB Model"
                aria-label="Upload GLB Model"
              >
                <Upload size={18} />
                {glbUpload.uploadPct !== null && (
                  <span className="icon-btn-count" aria-hidden="true">
                    {glbUpload.uploadRetry ? `↻${glbUpload.uploadRetry.attempt}` : `${glbUpload.uploadPct}%`}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>

        {/* ⚠️ OUTSIDE `.settings-body`, LIKE FACILITY'S. The strip is chrome and
            the body scrolls; putting the tabs inside would scroll them out of
            reach on the long tabs — the entity table is hundreds of rows. */}
        <ModalTabs
          tabs={tabs}
          active={tab}
          onSelect={setTab}
          label="Settings sections"
        />

        <div className="settings-body">
          {glbUpload.uploadMsg && (
            <div className={`test-result ${glbUpload.uploadMsg.ok ? "ok" : "fail"}`} style={{ marginTop: 0 }}>
              {glbUpload.uploadMsg.text}
            </div>
          )}

          {tab === "villa" && (
            <>
              <div className="settings-section-title">Villa location</div>
              <VillaCoordinates />
              <p className="muted body-text" style={{ marginTop: 6, fontSize: "var(--text-xs)" }}>
                Drives sun position and day/night for this villa.
              </p>

              {/* No collapse: `BindingsTable` already opens on its three counts
                  with the lists themselves behind their own toggles, so this
                  tab states how much is bound without a click. */}
              <div className="settings-section-title">Bound 3D objects</div>
              <BindingsTable />
            </>
          )}

          {tab === "devices" && (
            <>
              {/* ⚠️ NO COLLAPSE, AND THE HEADINGS STAY. Both sections used to be
                  behind a toggle, so this tab would open on two words and
                  nothing else. Each shows its first few rows with a filter above
                  and a "Show all" beneath (`common/TruncatedList`), which
                  answers "how many devices does this villa have" by looking
                  rather than by clicking. Arriving from a device panel's "edit"
                  pre-fills the filter, so the row that was come for is one of
                  the few on screen. */}
              <div className="settings-section-title">Auto-detected entity settings</div>
              <ConfigEditor initialSearch={focusEntityId} />

              <div className="settings-section-title">Grouped devices</div>
              <GroupedDevices />
            </>
          )}

          {/* Owner only: the telemetry endpoint itself 403s other roles (it
              carries other people's user-agents and error text), and logging
              every device out is an owner act. The tab is not rendered for
              other roles rather than rendered-and-403 — see the TABS filter. */}
          {tab === "system" && role === "owner" && (
            <>
              {/* `TelemetryPanel` pages its own log, so there is nothing here
                  for an outer collapse to save — and hiding the section also
                  hid the Refresh/Copy/Download/Probe buttons, which are the
                  reason somebody opens this tab. */}
              <div className="settings-section-title">Device telemetry</div>
              <TelemetryPanel />

              <div className="settings-section-title">Session</div>
              <LogoutAllSection />
            </>
          )}
        </div>

        {/* No Save: every tab here applies LIVE to the 3D scene through
            `ConfigContext`, which is why the strip above is passed no `commit`
            and a tab switch can lose nothing. */}
        <div className="settings-footer" style={{ justifyContent: "space-between" }}>
          <span className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>v{__APP_VERSION__}</span>
          <button className="btn primary" onClick={onBack}>Close</button>
        </div>
      </div>
    </div>
  );
}
