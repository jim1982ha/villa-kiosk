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
import { RECORDS_KEPT_DAYS_MAX, type AppConfig } from "@/config/AppConfig";
import { useModalA11y } from "@/hooks/useModalA11y";
import { Boxes, Home, LogOut, Upload, Wrench } from "lucide-react";
import InfoTip, { TipTitle } from "@/components/common/InfoTip";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import { useConfig } from "@/config/ConfigContext";
import { northOffsetFacing } from "@/babylon/skyMoment";
import { useProfile } from "@/auth/ProfileContext";
import CentralModelInfo from "./CentralModelInfo";
import { useGlbUpload, ModelFileInput } from "./useGlbUpload";
import ConfigEditor from "./ConfigEditor";
import BindingsTable from "./BindingsTable";
import TelemetryPanel from "./TelemetryPanel";
import GroupedDevices from "./GroupedDevices";
import UnavailableByDesign from "./UnavailableByDesign";
import EntityPicker from "./EntityPicker";
import InlineConfirm from "@/components/common/InlineConfirm";
import ModalFooter from "@/components/common/ModalFooter";
import DialogLayer from "@/components/common/DialogLayer";

/** ⚠️ EVERY TAB CARRIES TWO PANELS, AND THAT IS A RULE RATHER THAN AN
 *  ACCIDENT. This screen was a stack of six collapsible sections and read as
 *  clutter; splitting it one-section-per-tab would have traded a long scroll
 *  for six tabs that each hold one control, which is worse — Location is two
 *  number fields and Session is one button. Two panels per tab is what makes
 *  each one a SUBJECT ("where the villa is", "what devices exist", "what this
 *  box is doing") rather than a container.
 *
 *  System holds a third since 2.496.454: how long the maintenance record is kept, a setting of what this box does
 *  with the villa's records (owner, 2026-10-20: moved here from the add-on's configuration page).
 *
 *  ⚠️ AND THE NON-OWNER VIEW WAS SIZED TOO. Every System panel is owner-only,
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
  /** The heading the 3D view looks along, in degrees (SceneManager.viewHeadingDeg) — what "Set North" adopts. */
  viewHeadingDeg?: () => number | null;
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
/** Which way the model faces (owner, 2026-10-12: moved here from Settings, below
 *  the villa's coordinates — both place the villa on the real Earth, and the sun
 *  is drawn from the two together). The sun and moon are computed from the
 *  coordinates and the clock, but which way the MODEL faces is whatever its
 *  floor-plan export produced: this turns the whole sky to match. Set North
 *  stores the offset that makes the view's heading true north
 *  (skyMoment.northOffsetFacing — it stored the heading itself until
 *  2.496.404, and the morning sun came up in the west). Ships at 0 rather than a seeded guess, which
 *  would be right for one villa only. Applies live, like everything on this tab. */
function NorthOffset({ viewHeadingDeg }: { viewHeadingDeg?: () => number | null }) {
  const { config, update } = useConfig();
  const deg = config.northOffsetDeg;
  return (
    <>
      <label className="with-tip" style={{ marginTop: 14 }}>Model north offset · {deg}°
        <InfoTip label="About the model north offset">
          Face the villa's real north side and press Set North, or drag the slider until the shadows match. Only fixes
          which wall the light comes from: sunrise and sunset times are already right.
        </InfoTip>
      </label>
      {/* One control in two forms on one row: the slider sets the offset by
          hand, the button measures it from the view. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="range" min={0} max={359} step={1} value={deg}
          aria-label="Model north offset"
          style={{ flex: "1 1 auto", minWidth: 0 }}
          onChange={(e) => update({ northOffsetDeg: Number(e.target.value) })}
        />
        <button
          className="btn"
          // keeps its 44px target: flex would otherwise squeeze the padding out on a phone
          style={{ flexShrink: 0, whiteSpace: "nowrap" }}
          disabled={!viewHeadingDeg}
          onClick={() => {
            const h = viewHeadingDeg?.();
            if (h != null) update({ northOffsetDeg: northOffsetFacing(h) });
          }}
        >
          Set North
        </button>
      </div>
    </>
  );
}

/** The villa's "is it empty?" sensor (config/presence): a picker of the villa's on/off sensors, never free text —
 *  picked once for every screen (a shared setting, like the location). Nothing picked: no presence tile. */
function PresenceSensor() {
  const { config, update } = useConfig();
  return (
    <>
      <div className="settings-section-title">Villa presence</div>
      <label className="with-tip">"Villa empty" sensor
        <InfoTip label="About the villa empty sensor">
          The on/off sensor that is on when the villa is empty. Shown on every screen as the presence tile under the
          floors (Occupied, Empty or Unknown); tapping it tells why.
        </InfoTip>
      </label>
      <EntityPicker value={config.presenceSensor} domains={["binary_sensor"]} placeholder="Pick the villa's empty / occupied sensor"
        onChange={(id) => update({ presenceSensor: id })} onClear={() => update({ presenceSensor: "" })} />
    </>
  );
}

/** How long the Facility record is kept (config/recordsKeptDays): the villa's, applied by the server. Commits on
 *  blur/Enter or after a pause, like the coordinates; a value that is not a whole number of days in range commits
 *  nothing and the field falls back to the stored one. */
function RecordsKept() {
  const { config, update } = useConfig();
  const field = useDraftCommit<string>((_key, text) => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= RECORDS_KEPT_DAYS_MAX) update({ recordsKeptDays: n });
  }, COORD_COMMIT_MS);
  // label and field on one line, the field on the right (owner, 2026-10-22)
  return (
    <div className="settings-field-row">
      <label htmlFor="records-kept" className="with-tip">Keep maintenance records for (days)
        <InfoTip label="About keeping maintenance records">
          Photos, repaired faults, work done and money spent older than this are deleted. 0 keeps them for ever. A
          task's latest completion is always kept. Up to {RECORDS_KEPT_DAYS_MAX} days.
        </InfoTip>
      </label>
      <input
        id="records-kept" inputMode="numeric" style={{ maxWidth: 140 }}
        value={field.drafts.recordsKeptDays ?? String(config.recordsKeptDays)}
        onChange={(e) => field.draft("recordsKeptDays", e.target.value)}
        onBlur={() => field.flush("recordsKeptDays")}
        onKeyDown={(e) => e.key === "Enter" && field.flush("recordsKeptDays")}
      />
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
      {failed && (
        <div className="test-result fail" style={{ marginBottom: 10 }}>
          Could not reach the server, no session was signed out.
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

export default function ConfigEditorModal({ onBack, focusEntityId, onModelChanged, viewHeadingDeg }: Props) {
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
    <DialogLayer className="modal-backdrop" onClick={onBack}>
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
              <TipTitle title="Villa location" tip="Drives the sun's position, and day and night, for this villa." />
              <VillaCoordinates />
              <NorthOffset viewHeadingDeg={viewHeadingDeg} />

              <PresenceSensor />

              {/* No collapse: `BindingsTable` already opens on its three counts
                  with the lists themselves behind their own toggles, so this
                  tab states how much is bound without a click. */}
              <BindingsTable heading={<TipTitle title="Bound 3D objects" tip={<>
                Each bound 3D object controls a device's entity when tapped in the villa: change which entity here,
                without reloading the model; its name and display settings are with the device, in Devices. To prepare
                an entity whose 3D object is not in the model yet, add it here: its settings apply as soon as a model
                with an object named after its entity ID is uploaded. To bind one, expand the unbound objects and pick
                an entity for it. The entities not shown on the map have no 3D object: add one in the 3D model, or bind
                an unbound object to one, to control it from the villa.
              </>} />} />
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
              <TipTitle title="Auto-detected entity settings" tip={<>
                Entities listed here are auto-detected because their 3D object in the model is already named with the
                entity ID (e.g. camera.driveway). Edit the display name, room or panel type without reloading the model.
                Changes here apply to every device that opens the kiosk: this configuration is stored centrally by the
                add-on, like the 3D model itself, not per browser. With none yet, upload a model whose objects are named
                after entity IDs, or prepare one in Villa › Bound 3D objects.
              </>} />
              <ConfigEditor initialSearch={focusEntityId} />

              <GroupedDevices heading={<TipTitle title="Grouped devices" tip={<>
                Fold several entities that are really one physical device (e.g. a combo sensor with separate
                temperature and humidity entities) into a single map badge. Only the primary entity keeps a badge on the
                map; every other member's value and 24-hour history appear in that badge's detail view instead. To make
                one, pick the entity that should keep the map badge (e.g. temperature) under New group, then add the rest
                as members.
              </>} />} />

              <TipTitle title="Asleep between reports" tip={<>
                Devices that sleep between reports, such as a battery door sensor: their "unavailable" is normal. VESTA
                shows what each one last reported, never "Unavailable", and raises no fault for it; the VESTA Agent skips
                its offline checks for them too.
              </>} />
              <UnavailableByDesign />
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
              <TipTitle title="Device telemetry" tip={<>
                What every device that opens this kiosk has reported: load timings, script errors, graphics context
                losses and page-lifecycle transitions. This is how a problem on someone else's phone becomes
                diagnosable. Newest first; the add-on keeps the last 500 events. Copy and Download give the raw events
                (every field, not just the summary shown here); Clear empties the store.
              </>} />
              <TelemetryPanel />

              <div className="settings-section-title">Maintenance records</div>
              <RecordsKept />

              <TipTitle title="Session" tip={<>
                Log out all devices signs every device out immediately, this one included, whatever the add-on's
                "Session length" option says a sign-in should last. Use it if a tablet went missing or a passcode was
                seen by someone who shouldn't have it.
              </>} />
              <LogoutAllSection />
            </>
          )}
        </div>

        {/* No Save: every tab here applies LIVE to the 3D scene through
            `ConfigContext`, which is why the strip above is passed no `commit`
            and a tab switch can lose nothing. */}
        <ModalFooter onClose={onBack} note={`v${__APP_VERSION__}`} />
      </div>
    </DialogLayer>
  );
}
