// src/components/settings/ConfigEditorModal.tsx
// The full Config Editor, as a modal OVER the live villa (not a separate route).
// Opened from the Settings modal's footer; "Back" returns to Settings. Rendering
// it over the mounted Dashboard is what avoids the full GLB re-download/re-parse
// that the old /config route caused every time you left it — every edit here
// already applies to the live scene through ConfigContext.update(), so there is
// nothing to reload on the way out.

import { roleCan } from "@/auth/permissions";
import { useState } from "react";
import { PendingFields, usePendingField, type PendingField } from "@/hooks/usePendingField";
import { RECORDS_KEPT_DAYS_MAX, type AppConfig } from "@/config/AppConfig";
import { useModalA11y } from "@/hooks/useModalA11y";
import { Boxes, Home, LogOut, Upload, Wrench } from "lucide-react";
import InfoTip, { TipTitle } from "@/components/common/InfoTip";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import { DialogEdits, useConfig } from "@/config/ConfigContext";
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
import ModalFooter, { footerExits } from "@/components/common/ModalFooter";
import RemoteReplacedNote, { SaveProblemNote } from "./RemoteReplacedNote";
import { useAppNotice } from "@/components/hud/AppNotice";
import { useDraftedSlice } from "@/hooks/useDraftedSlice";
import { ADVANCED_SETTINGS_KEYS } from "@/config/configSlice";
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
  /** Settings is open underneath (the way in from its footer): ITS draft owns every change made here — Close returns
   *  to it, and its Save / Cancel keep or undo them. Opened on its own (a device window's "edit"), this dialog owns
   *  the same draft itself, with its own Save / Cancel (owner, 2026-10-22: Advanced Settings joins Save / Cancel). */
  withinSettings: boolean;
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
  const { config } = useConfig();
  // The SAME drafted-field seam every other Settings field uses (2.496.194):
  // the input shows the draft while one exists and the LIVE value otherwise.
  // This held its own `useState(String(config.latitude))`, never resynced —
  // Dashboard adopts Home Assistant's location once, asynchronously, and when
  // that landed with this dialog open the field kept the old number and a
  // blur wrote it back over the adopted one. A half-typed number ("-")
  // writes nothing; the field simply lapses to the stored value.
  // ⚠️ THE TYPED TEXT WAITS IN THE DIALOG'S ONE PENDING STORE (usePendingField, 2.496.500): Save lights while it is
  // typed, and closing before the pause no longer drops it.
  const coord = (key: "latitude" | "longitude", id: string, label: string, field: PendingField<string>) => (
    <div className="villa-location-coord">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} inputMode="decimal" value={field.shown ?? String(config[key])}
        onChange={(e) => field.draft(e.target.value, coordinateWrite(key, e.target.value))}
        onBlur={field.flush}
        onKeyDown={(e) => e.key === "Enter" && field.flush()}
      />
    </div>
  );
  const lat = usePendingField<string>("latitude", COORD_COMMIT_MS);
  const lng = usePendingField<string>("longitude", COORD_COMMIT_MS);
  return (
    <>
      {coord("latitude", "villa-lat", "Latitude", lat)}
      {coord("longitude", "villa-lng", "Longitude", lng)}
    </>
  );
}

/** What a coordinate typed writes: the number, or nothing while it is not one yet. */
function coordinateWrite(key: "latitude" | "longitude", text: string): Partial<AppConfig> | null {
  const n = Number(text);
  return Number.isFinite(n) && text.trim() !== "" ? { [key]: n } : null;
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
    <div className="villa-location-north">
      <label className="with-tip">Model north offset · {deg}°
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
    </div>
  );
}

/** The villa's "is it empty?" sensor (config/presence): a picker of the villa's on/off sensors, never free text —
 *  picked once for every screen (a shared setting, like the location). Nothing picked: no presence tile. */
function PresenceSensor() {
  const { config, update } = useConfig();
  return (
    <>
      {/* one (i) on the section title, the chosen sensor shown in its field like every linked entity (owner,
          2026-10-22: no "Villa empty" sensor label, no "Bound to" line under the field) */}
      <TipTitle title="Villa presence" tip={<>
        The on/off sensor that is on when the villa is empty. Shown on every screen as the presence tile under the
        floors (Occupied, Empty or Unknown); tapping it tells why.
      </>} />
      <EntityPicker value={config.presenceSensor} domains={["binary_sensor"]} placeholder="Pick the villa's empty / occupied sensor" hideCurrentLabel
        onChange={(id) => update({ presenceSensor: id })} onClear={() => update({ presenceSensor: "" })} />
    </>
  );
}

/** How long the Facility record is kept (config/recordsKeptDays): the villa's, applied by the server. Commits on
 *  blur/Enter or after a pause, like the coordinates; a value that is not a whole number of days in range commits
 *  nothing and the field falls back to the stored one. */
function RecordsKept() {
  const { config } = useConfig();
  const field = usePendingField<string>("recordsKeptDays", COORD_COMMIT_MS);
  const write = (text: string) => {
    const n = Number(text);
    return text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= RECORDS_KEPT_DAYS_MAX ? { recordsKeptDays: n } : null;
  };
  // label and field on one line, the field on the right (owner, 2026-10-22)
  return (
    <div className="settings-field-row">
      {/* the owner's words (2026-10-22); its (i) is the section title's */}
      <label htmlFor="records-kept">How many days Ticket attachment must be saved (in days)</label>
      <input
        id="records-kept" inputMode="numeric" className="field-narrow"
        value={field.shown ?? String(config.recordsKeptDays)}
        onChange={(e) => field.draft(e.target.value, write(e.target.value))}
        onBlur={field.flush}
        onKeyDown={(e) => e.key === "Enter" && field.flush()}
      />
    </div>
  );
}

/** Long enough to finish typing a coordinate; blur/Enter commit at once. */
const COORD_COMMIT_MS = 1500;

/** Immediately signs every device out — a lost tablet, a PIN someone saw.
 *  Two-tap confirm, same idiom as Facility's "Delete all" buttons: this
 *  signs the person clicking it out too, so it's worth pausing on. */
/** "Log out all devices", on every tab with its (i) on its right (owner, 2026-10-22), at the header's right since
 *  2026-10-24 (owner: Back took its footer place, where Settings' "Advanced Settings" opener is). */
function LogoutAll() {
  const { logoutAll } = useProfile();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="with-tip">
      {failed && (
        <span className="body-text sev-warning" role="alert">Could not reach the server, no session was signed out.</span>
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
        <button className="btn" onClick={() => setConfirming(true)} aria-label="Log out all devices">
          <LogOut size={18} aria-hidden /><span className="btn-label">Log out all devices</span>
        </button>
      )}
      <InfoTip label="About logging out all devices">
        Signs every device out immediately, this one included, whatever the add-on's "Session length" option says a
        sign-in should last. Use it if a tablet went missing or a passcode was seen by someone who shouldn't have it.
      </InfoTip>
    </div>
  );
}

export default function ConfigEditorModal({ onBack, withinSettings, focusEntityId, onModelChanged, viewHeadingDeg }: Props) {
  // ⚠️ ONE DRAFT FOR WHAT THIS DIALOG EDITS (configSlice.ADVANCED_SETTINGS_KEYS). Every edit below applies live through
  // ConfigContext.update and reaches every tablet; the draft records what this dialog itself changed, item by item. Over
  // Settings, Settings' draft records the same changes and this dialog just closes back to it; on its own, it is this
  // one's: Save keeps, Cancel (and Escape, and the backdrop) puts them back — the passing notices of every other dialog.
  const own = useDraftedSlice(ADVANCED_SETTINGS_KEYS);
  // why the last device-setup save did not reach the other tablets (DeviceConfigSync), said above the footer
  const { saveProblem, setSaveProblem } = useConfig();
  const notice = useAppNotice();
  const commit = withinSettings ? undefined : { dirty: own.dirty, save: own.save, discard: () => { own.discard(); } };
  // Over Settings, closing back writes what is still being typed here (as this dialog's): Settings' Save / Cancel then
  // own it like every other change made here.
  const back = () => { own.flush(); onBack(); };
  const exit = commit ? footerExits(commit, onBack, notice).cancel : back;
  // Focus trap + Escape + focus restore (see useModalA11y).
  const dialogRef = useModalA11y(exit);
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
  // Central GLB/room-data upload — Owner only. Lives in this modal's own footer, at its right, a footer button like
  // every other (owner, 2026-10-24), not the main app's top bar — it's an administration action scoped to Advanced
  // Settings.
  const glbUpload = useGlbUpload(canUploadModel, onModelChanged);

  // ⚠️ EVERY CONTROL BELOW WRITES AS THE DIALOG (DialogEdits): what the open drafts' Cancel takes back. The model
  // upload above writes its rooms from here (not as the dialog), and the devices the reloaded model finds are written
  // by the 3D view: neither is a change to cancel (2.496.499).
  return (
    <DialogEdits>
    <PendingFields pending={own.pending}>
    <DialogLayer className="modal-backdrop" onClick={exit}>
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
              FIRST focusable descendant) would otherwise land on the header's
              first button ("Log out all devices", or an (i)) and, for an (i),
              pop its tooltip on open with no hover at all. The heading is the
              conventional dialog-open focus target anyway; tabIndex={-1} makes
              it programmatically focusable without joining the normal Tab
              order. */}
          <h2 tabIndex={-1} data-autofocus>Advanced Settings <span className="modal-title-version">v{__APP_VERSION__}</span></h2>
          {/* ⚠️ BACK WHERE SETTINGS' OPENER IS, "LOG OUT ALL DEVICES" UP HERE (owner, 2026-10-24: "invert the position of
              Log out all devices and the Back button, so that Back appears at the same position as where Advanced
              Settings is in the previous menu"): Settings → Advanced Settings → Back is one spot under the finger; the
              model's details and upload sit at the bottom right, labelled on a desktop, icons on a phone. */}
          {roleCan(role, "editConfig") && (
            <div className="modal-header-actions">
              <LogoutAll />
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
              {/* Latitude, Longitude and the north offset on ONE line where there is room; on a phone the two
                  coordinates share a line and the offset takes the next (owner, 2026-10-22) */}
              <div className="villa-location-row">
                <VillaCoordinates />
                <NorthOffset viewHeadingDeg={viewHeadingDeg} />
              </div>

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

              <UnavailableByDesign heading={<TipTitle title="Asleep between reports" tip={<>
                Devices that sleep between reports, such as a battery door sensor: their "unavailable" is normal. VESTA
                shows what each one last reported, never "Unavailable", and raises no fault for it; the VESTA Agent skips
                its offline checks for them too.
              </>} />} />
            </>
          )}

          {/* Owner only: the telemetry endpoint itself 403s other roles (it
              carries other people's user-agents and error text), and logging
              every device out is an owner act. The tab is not rendered for
              other roles rather than rendered-and-403 — see the TABS filter. */}
          {tab === "system" && roleCan(role, "editConfig") && (
            <>
              <TipTitle title="Maintenance records" tip={<>
                Photos, repaired faults, work done and money spent older than this are deleted. 0 keeps them for ever. A
                task's latest completion is always kept. Up to {RECORDS_KEPT_DAYS_MAX} days.
              </>} />
              <RecordsKept />

              {/* `TelemetryPanel` pages its own log, so there is nothing here
                  for an outer collapse to save — and hiding the section also
                  hid the Refresh/Copy/Download/Probe buttons, which are the
                  reason somebody opens this tab. */}
              <TipTitle title="Device telemetry" tip={<>
                What every device that opens this kiosk has reported: load timings, script errors, graphics context
                losses and page-lifecycle transitions. This is how a problem on someone else's phone becomes
                diagnosable. Newest first; the add-on keeps the latest events, as many as its options allow. Copy and Download give the raw events
                (every field, not just the summary shown here); Clear empties the store.
              </>} />
              <TelemetryPanel />


            </>
          )}
        </div>

        {/* Every tab applies LIVE through `ConfigContext`, so a tab switch loses nothing. Over Settings: Close, back to
            Settings, whose Save / Cancel own these changes; on its own: this dialog's Save / Cancel (`commit`). */}
        <RemoteReplacedNote replaced={own.replaced} onDismiss={own.dismissReplaced} />
        <SaveProblemNote line={saveProblem} onDismiss={() => setSaveProblem(null)} />
        <ModalFooter onClose={back} commit={commit} back={{ go: exit, to: withinSettings ? "Settings" : undefined }}
          actions={canUploadModel ? (
            <>
              {glbUpload.addonCfg?.model_path && (
                <CentralModelInfo addonCfg={glbUpload.addonCfg} loadedModel={glbUpload.loadedModel} />
              )}
              <ModelFileInput upload={glbUpload} />
              <button
                className="btn"
                onClick={glbUpload.openPicker}
                disabled={glbUpload.uploadBusy !== null}
                title="Upload a GLB model"
                aria-label={glbUpload.progress.words ?? "Upload a GLB model"}
              >
                <Upload size={18} aria-hidden />
                <span className="btn-label">{glbUpload.progress.words ?? "Upload model"}</span>
                {/* on a phone the words are hidden: the progress stays on the icon */}
                {glbUpload.progress.mark && <span className="icon-btn-count btn-mark" aria-hidden>{glbUpload.progress.mark}</span>}
              </button>
            </>
          ) : withinSettings ? <span /> : undefined} />
      </div>
    </DialogLayer>
    </PendingFields>
    </DialogEdits>
  );
}
