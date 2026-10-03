// src/components/settings/ConfigEditorModal.tsx
// The full Config Editor, as a modal OVER the live villa (not a separate route).
// Opened from the Settings modal's footer; "Back" returns to Settings. Rendering
// it over the mounted Dashboard is what avoids the full GLB re-download/re-parse
// that the old /config route caused every time you left it — every edit here
// already applies to the live scene through ConfigContext.update(), so there is
// nothing to reload on the way out.

import { roleCan } from "@/auth/permissions";
import { useState } from "react";
import { useDraftCommit } from "@/hooks/useDraftCommit";
import type { AppConfig } from "@/config/AppConfig";
import { useModalA11y } from "@/hooks/useModalA11y";
import { Boxes, Home, LogOut, Upload, Wrench } from "lucide-react";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import CentralModelInfo from "./CentralModelInfo";
import { useGlbUpload, ModelFileInput } from "./useGlbUpload";
import ConfigEditor from "./ConfigEditor";
import BindingsTable from "./BindingsTable";
import TelemetryPanel from "./TelemetryPanel";
import GroupedDevices from "./GroupedDevices";
import InlineConfirm from "@/components/common/InlineConfirm";
import ModalFooter from "@/components/common/ModalFooter";

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
  // The SAME drafted-field seam every other Settings field uses (2.496.194):
  // the input shows the draft while one exists and the LIVE value otherwise.
  // This held its own `useState(String(config.latitude))`, never resynced —
  // Dashboard adopts Home Assistant's location once, asynchronously, and when
  // that landed with this dialog open the field kept the old number and a
  // blur wrote it back over the adopted one. A half-typed number ("-8.")
  // commits nothing; the draft simply lapses to the stored value.
  const field = useDraftCommit<string>((key, text) => {
    const n = Number(text);
    if (Number.isFinite(n) && text.trim() !== "") update({ [key]: n } as Partial<AppConfig>);
  }, COORD_COMMIT_MS);
  const coord = (key: "latitude" | "longitude", id: string, label: string) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id} inputMode="decimal" value={field.drafts[key] ?? String(config[key])}
        onChange={(e) => field.draft(key, e.target.value)}
        onBlur={() => field.flush(key)}
        onKeyDown={(e) => e.key === "Enter" && field.flush(key)}
      />
    </div>
  );
  return (
    <div className="coord-grid">
      {coord("latitude", "villa-lat", "Latitude")}
      {coord("longitude", "villa-lng", "Longitude")}
    </div>
  );
}
/** Long enough to finish typing a coordinate; blur/Enter commit at once. */
const COORD_COMMIT_MS = 1500;

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
        <InlineConfirm confirmLabel="Log out every device?"
          onConfirm={async () => {
            const ok = await logoutAll();
            setFailed(!ok);
            setConfirming(false);
          }}
          onCancel={() => setConfirming(false)} />
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
  const tabs = TABS.filter((t) => roleCan(role, "editConfig") || !t.owner);
  // ⚠️ THE EDIT SHORTCUT OPENS ON "Devices". Arriving from a device panel's
  // "edit" and landing on Villa would hide the row the operator came for —
  // the same defect the old collapse's `defaultOpen` guarded against one level
  // down, which is the guard this tab replaces rather than drops.
  const [tab, setTab] = useState<SettingsTab>(
    focusEntityId ? "devices" : (tabs[0]?.id ?? "villa"));
  const canUploadModel = roleCan(role, "manageModel");
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
        <div className="modal-header">
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
              <ModelFileInput upload={glbUpload} />
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

        {/* ⚠️ OUTSIDE `.modal-body`, LIKE FACILITY'S. The strip is chrome and
            the body scrolls; putting the tabs inside would scroll them out of
            reach on the long tabs — the entity table is hundreds of rows. */}
        <ModalTabs
          tabs={tabs}
          active={tab}
          onSelect={setTab}
          label="Settings sections"
        />

        <div className="modal-body">
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
          {tab === "system" && roleCan(role, "editConfig") && (
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
        <ModalFooter onClose={onBack} note={`v${__APP_VERSION__}`} />
      </div>
    </div>
  );
}
