// src/components/settings/SettingsModal.tsx
// Appearance + render/movement tuning. A footer button opens the full Config
// Editor (villa coordinates, entity metadata, bindings, 3D model source) as
// a modal over the live villa. Device badge icons are hardcoded, not
// editable here — see babylon/badgeIcons.ts + badgeIconKeys.ts.
//
// There's no HA URL/token here anymore: the kiosk always reaches Home Assistant
// token-less through the add-on's Supervisor proxy, so there's nothing to enter.

import Window from "@/components/common/Window";
import { eyeHeightOf } from "@/babylon/walkerSpawn";
import ModalFooter, { footerExits } from "@/components/common/ModalFooter";
import RemoteReplacedNote from "./RemoteReplacedNote";
import { useAppNotice } from "@/components/hud/AppNotice";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import OnOffToggle from "@/components/common/OnOffToggle";
import SettingRow, { SettingSlider, settingValue } from "@/components/common/SettingRow";
import {
  Sliders, Sun, Sunrise, Moon, Monitor, SunMoon, MousePointerClick, Move, Circle, CreditCard, PanelBottom, Radar,
  Settings2, MessageSquare, Maximize, SunDim, MoonStar, CloudSun, Lightbulb, Map as MapIcon, Eye, Footprints, Languages,
} from "lucide-react";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import { TipTitle } from "@/components/common/InfoTip";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan, type Capability } from "@/auth/permissions";
import { useHA } from "@/ha/HAStateStore";
import { useDraftedSlice } from "@/hooks/useDraftedSlice";
import { useScenePreview } from "@/hooks/useScenePreview";
import { DEFAULT_SITE_TITLE, type RenderConfig } from "@/config/AppConfig";
import { SETTINGS_KEYS } from "@/config/configSlice";
import type { SceneManager } from "@/babylon/SceneManager";
import { fmtDuration } from "@/components/panels/chartUtils";
import { ANNOUNCEMENT_NOTICE_MS, languageName, tabletLanguages } from "@/messages/announcements";
import { PendingFields } from "@/hooks/usePendingField";
import { FullScreenAnnouncements } from "./MessagesSettings";
import WhoGetsMessages from "./WhoGetsMessages";
import { LISTS_TITLE } from "@/messages/recipients";
import { ROLE_LABELS } from "@/auth/roles";

/** Settings' tabs (ticket 16 of "One inbox", owner 2026-10-28): General, all it held before; Messages, how this
 *  tablet shows the villa's announcements, and (owner, 2026-11-03) the villa's message settings, for a profile that may
 *  edit the villa's setup. */
export type SettingsTab = "general" | "messages";

interface Props {
  manager: SceneManager | null;
  onClose: () => void;
  /** Open the full Config Editor (a modal over the live villa). */
  onOpenConfigEditor: () => void;
  /** The open tab, held by the caller (pages/screen): the Cockpit's gear opens Messages. */
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
}

const TABS: ModalTab<SettingsTab>[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "messages", label: "Messages", icon: MessageSquare },
];

export default function SettingsModal({ manager, onClose, onOpenConfigEditor, tab, onTab }: Props) {
  const { config } = useConfig();
  const { role } = useProfile();
  const { haConfig } = useHA();
  // RBAC: which settings areas the active profile may use. Dashboard already
  // refuses to open this modal without "openSettings"; these narrow further.
  const can = (c: Capability) => roleCan(role, c);

  // Every setting here applies AND persists live: the scene previews on every
  // tick (load-bearing — a walk-speed slider that only took effect on Save
  // would be untunable), the config write is debounced (the WHOLE config
  // blob goes to localStorage on each write), and the draft records what THIS
  // dialog changed, item by item (its ledger):
  //
  //   dirty   = something it changed is not back to what it was, or a change is held for Save
  //   Save    = keep it, send what is held to the villa (Who gets the messages' lists), and forget the ledger
  //   Discard = put exactly those items back, which reverts the scene AND the store; drop what is held
  //
  // All of that is useDraftedSlice. ⚠️ THE SLICE IS EVERY KEY THIS DIALOG WRITES (configSlice SETTINGS_KEYS, listed
  // once) — and it is the ONLY way this dialog writes (tests/oracles/settings_baseline.mjs, settings_save.mjs).
  const slice = useDraftedSlice(SETTINGS_KEYS);
  const v = slice.view;
  const languages = [...new Set([...tabletLanguages(v.chatLanguages), v.tabletLanguage])];
  // The 3D view follows what this dialog shows (hooks/useScenePreview): a slider is felt while it is dragged, and
  // Cancel puts the view back by the same path. ⚠️ NO SLIDER MOVES THE SCENE ITSELF (to 2.496.499, Cancel within the
  // half-second the write waits left the camera at the cancelled eye height).
  useScenePreview(manager, v);

  // ⚠️ ONE WAY OF SAVING (owner, 2026-11-06): every control here, Who gets the messages' lists included, waits for
  // Save; nothing is saved at once (the "already saved" sections Cancel used to name are gone)
  const commit = {
    dirty: slice.dirty,
    saving: slice.saving,
    error: slice.problem,
    save: slice.save,
    // The sliders, the fields and the scene's preview read the slice's view,
    // so they all follow the reverted config with nothing to re-apply.
    discard: () => { slice.discard(); },
  };

  // Escape and the backdrop are Cancel (ModalFooter's footerExits, the footer's own): every change undone, said in a
  // passing notice — no question first (owner, 2026-10-20).
  const notice = useAppNotice();
  const closeModal = footerExits(commit, onClose, notice).cancel;

  // Shown as typed, stored trimmed.
  const applySiteTitle = (text: string) => slice.set({ siteTitle: text }, { stored: { siteTitle: text.trim() } });

  // Render tuning, previewed on the scene while dragging (useScenePreview), so the user can iterate on look/perf
  // without saving + reloading.
  const applyRender = (patch: Partial<RenderConfig>) => slice.set({ render: { ...v.render, ...patch } });
  const applyEyeHeight = (h: number) => slice.set({ eyeHeight: h });
  const applyWalkSpeed = (speed: number) => slice.set({ walkSpeed: speed });
  const eyeHeight = eyeHeightOf(v.eyeHeight);

  return (
    <Window kind="content" label="Settings" onClose={closeModal} className="settings-modal">
      <div className="modal-header">
        <h2>Settings</h2>
        {/* Theme selector lives in the header, icon-only + right-aligned —
            self-explanatory glyphs, no Save step (applies and persists
            instantly). The day/night preview override used to sit here too
            (a single invert toggle) — it's now a 3-way Day/Auto/Night
            control down by the Brightness/Night dimming sliders it's most
            related to, see the "Render quality & look" section below.

            THREE options, not four. 2.144.0 added an explicit "night" button
            beside Auto, which read as clutter for no gain: Auto ALREADY
            resolves to the night theme after dusk on its own (see
            utils/themeTime.ts), so the fourth glyph offered a state the
            kiosk reaches by itself, sitting next to the control that
            reaches it. The night theme itself is untouched — only the
            redundant way of asking for it is gone. A device that already
            has "night" stored keeps rendering in it; picking any of these
            three moves it off, so nothing can get stuck.

            ⚠️ THIS IS NOT THE DAY/NIGHT PREVIEW, and the two being mistaken
            for each other is a REPORTED problem, not a hypothetical one —
            by the person who commissioned both. They are genuinely
            different and neither is redundant:
              • this one themes the INTERFACE (panels, badges, text);
              • dayNightPreview below relights the VILLA (which baked atlas
                the 3D model shows), and only exists for a baked villa.
            An earlier attempt to separate them swapped one icon (Sunrise
            rather than Sun) and left both controls icon-only. That was not
            enough: two unlabelled icon triplets of sun/moon glyphs on one
            screen read as one duplicated control however the glyphs differ.
            Both now carry a written label, which is the part that was
            actually missing. Do not "de-duplicate" these by deleting one —
            that removes real capability. */}
        {can("customizeAppearance") && (
          <div className="settings-header-control">
            <span className="settings-inline-label">Interface</span>
          <SegmentedGroup ariaLabel="Interface theme" className="segmented-icons" active={v.theme} onChange={(theme) => slice.set({ theme }, { now: true })} options={[
            { key: "light", title: "Light interface theme", label: <Sun size={17} /> },
            { key: "dark", title: "Dark interface theme", label: <Moon size={17} /> },
            { key: "auto", title: "Auto, follows the system, and dims to the night theme after dark", label: <Monitor size={17} /> },
          ]} />
          </div>
        )}
      </div>
      {/* every profile that opens Settings: the Cockpit's gear opens it on Messages for the same profiles (doors.settings) */}
      <ModalTabs tabs={TABS} active={tab} onSelect={onTab} label="Settings sections" />

      <div className="modal-body">

      {tab === "messages" && (
        // ⚠️ ONE SECTION FOR FULL SCREEN (owner, 2026-11-03): this tablet's switch, then the villa's list, each picked
        // announcement with its own seconds (moved here from Advanced Settings' Messages tab, which is gone). The list
        // and "Who gets the messages" only for a profile that may edit the villa's setup. Both through this dialog's one
        // draft like every option here (Save keeps, Cancel puts back; the seconds wait in the draft's pending store, a
        // list's change is held there until Save sends it to the villa).
        <PendingFields pending={slice.pending}>
          <TipTitle title="Full-screen announcements" tip={<>
            The announcements picked here fill the screen of every device where full screen is on, each for its own
            time, then stay in the Cockpit's Inbox. A device with full screen off shows them under the category bar for
            {" "}{fmtDuration(ANNOUNCEMENT_NOTICE_MS)}.
          </>} />
          <OnOffToggle ariaLabel="Full screen on this device" title="Let a picked announcement fill the whole screen of this device"
            on={v.ringsFullScreen} onChange={(ringsFullScreen) => slice.set({ ringsFullScreen }, { now: true })}
            icon={<Maximize size={16} />} label="Full screen on this device" />
          {can("editConfig") && (
            <FullScreenAnnouncements value={v.fullScreen} onChange={(fullScreen) => slice.set({ fullScreen }, { now: true })} />
          )}
          {can("editConfig") && (
            <>
              <TipTitle title={LISTS_TITLE} tip={<>
                Who gets the villa's alerts and VESTA's messages on Telegram: urgent (P1) alerts go to both lists, P2
                alerts to the {ROLE_LABELS.ops}. With a list empty, they go to every Telegram chat.
              </>} />
              <WhoGetsMessages languages={v.chatLanguages} onLanguages={(chatLanguages) => slice.set({ chatLanguages }, { now: true })} />
            </>
          )}
          {/* ticket 28 of "One inbox" (owner, 2026-10-30): which of the chats' languages this tablet shows VESTA's
              messages in (messages/announcements tabletLanguages), the current pick kept so it can be undone; owner,
              2026-11-03: "very badly explained … clearer and also shorter": NOTHING drawn while there is nothing to
              choose (every chat in English) */}
          {languages.length > 1 && (
              <SettingRow icon={<Languages size={16} />} label="Language on this device"
                tip="The language VESTA's messages show in on this device: one of the chats' languages above.">
                <SegmentedGroup ariaLabel="Language on this device" active={v.tabletLanguage}
                  onChange={(code) => slice.set({ tabletLanguage: code }, { now: true })}
                  options={languages.map((code) => (
                    { key: code, title: `VESTA's messages in ${languageName(code)} on this device`, label: languageName(code) }))} />
              </SettingRow>
          )}
        </PendingFields>
      )}

      {tab === "general" && (
      <>
      {/* RBAC: shared branding — administration, not personal taste. */}
      {can("editConfig") && (
        <>
          <div className="settings-section-title" style={{ marginTop: 0 }}>Dashboard title</div>
          <input
            value={v.siteTitle}
            onChange={(e) => applySiteTitle(e.target.value)}
            onBlur={slice.flush}
            placeholder={haConfig?.location_name || DEFAULT_SITE_TITLE}
          />
        </>
      )}

      {/* ── Visual & UI tuning ──────────────────────────────────────────
          Render quality, camera/movement and device icons. Available to any
          profile with "customizeAppearance" (guests included) — these are
          per-device comfort settings, not administration. */}
      {can("customizeAppearance") && (
      <>

      {/* ── Render quality & look ────────────────────────────────────────
          Fixed at the "high" look by design (AppConfig.DEFAULT_RENDER) —
          no picker, and no "reset" affordance either now: with only three
          sliders left (Brightness/Night dimming/Light effect) each already
          shows its own live value, so resetting a look that's no longer a
          multi-dial preset just means dragging them back — not worth a
          dedicated button. Day/night warmth is handled automatically. */}
      <div className="settings-section-title">Render quality &amp; look</div>

      {/* ⚠️ ONE LINE PER SETTING (owner, 2026-11-03: "show the other menu (toggle, slider, etc) with the same layout, for
          consistency"): each is common/SettingRow, its icon and name at the left, its control at the right in a column
          of one width, an On | Off half as wide (common/OnOffToggle). ⚠️ ON A WIDE SCREEN, SEVERAL TO A LINE (owner,
          2026-11-03: Clickable Glow, Room glow and Natural Scroll; Brightness, Night dimming and Light effect strength; Map
          look, Summary bar and Villa lighting, owner 2026-11-03 again; Eye height and Walk speed): a .setting-line, each its name over its control; a phone keeps
          one per line. */}
      <div className="setting-line">
        <OnOffToggle ariaLabel="Blue glow for clickable devices" title="Blue glow around clickable devices"
          on={v.highlightInteractive} onChange={(highlightInteractive) => slice.set({ highlightInteractive }, { now: true })}
          icon={<MousePointerClick size={16} />} label="Clickable Glow" />
        {can("editConfig") && (
          <OnOffToggle ariaLabel="Room glow and camera cones" title="Room glow and camera cones, on every device"
            on={v.roomGlowAndCones} onChange={(roomGlowAndCones) => slice.set({ roomGlowAndCones }, { now: true })}
            icon={<Radar size={16} />} label="Room glow" tip={<>
              Light up the room in red and draw the camera's cone when presence is detected or a sensor triggers (the
              devices themselves still glow). It applies to every device.
            </>} />
        )}
        <OnOffToggle ariaLabel="Natural scrolling" title="Natural scrolling in the bird's-eye view"
          on={v.naturalScrolling} onChange={(naturalScrolling) => slice.set({ naturalScrolling }, { now: true })}
          icon={<Move size={16} />} label="Natural Scroll" />
      </div>

      {/* Brightness/Night dimming apply to every villa. ⚠️ A SLIDER'S VALUE AT THE END OF ITS NAME'S LINE, ITS TRACK UNDER
          (common/SettingSlider, owner 2026-11-06: "Night dimming · / 0.5×" wrapped on a phone) */}
      <div className="setting-line">
        <SettingSlider icon={<SunDim size={16} />} label="Brightness" value={settingValue.times(v.render.exposure)}
          tip="The overall exposure of the 3D view. Updates live." min={0.6} max={2} step={0.05} at={v.render.exposure}
          onChange={(exposure) => applyRender({ exposure })} />
        <SettingSlider icon={<MoonStar size={16} />} label="Night dimming" value={settingValue.times(v.render.nightDimming)}
          tip="How much extra dimming applies at night. Updates live." min={0} max={1} step={0.1} at={v.render.nightDimming}
          onChange={(nightDimming) => applyRender({ nightDimming })} />
        {/* Light effect strength scales a lit fixture's room illumination in BOTH villa flavours (2.31.0): the floor
            "light pool" decal in baked-lighting villas (babylon/LightPools.ts), the real PointLight's intensity in
            non-baked ones. */}
        <SettingSlider icon={<Lightbulb size={16} />} label="Light effect strength" value={settingValue.times(v.render.lightPoolIntensity)}
          min={0.3} max={2} step={0.1} at={v.render.lightPoolIntensity}
          onChange={(lightPoolIntensity) => applyRender({ lightPoolIntensity })} />
      </div>

      {/* ⚠️ NO PARAGRAPH UNDER AN OPTION (owner, 2026-10-22): its explanation is ONE (i) on its name (common/InfoTip).
          Map look shares its line with the Summary bar and Villa lighting; the villa's room glow and camera cones
          (AppConfig.roomGlowAndCones, every tablet's, editConfig only) share Clickable Glow's. */}
      <div className="setting-line">
        <SettingRow icon={<MapIcon size={16} />} label="Map look" tipLabel="About the map look" tip={<>
          Icon: a badge with its reading on a small pill; Card: a coloured card with its icon and reading. The badge
          size, {settingValue.times(config.entityIconScale)}, is set with the +/- buttons in the top bar.
        </>}>
          <SegmentedGroup ariaLabel="Floating badge style" active={v.badgeStyle} onChange={(badgeStyle) => slice.set({ badgeStyle }, { now: true })} options={[
            { key: "classic", title: "Icon badge style, the reading sits on a small pill under the icon", label: <><Circle size={16} /> <span className="badge-btn-label">Icon</span></> },
            { key: "card", title: "Card badge style, the reading sits inline beside the icon (default)", label: <><CreditCard size={16} /> <span className="badge-btn-label">Card</span></> },
          ]} />
        </SettingRow>
        <OnOffToggle ariaLabel="Summary bar" title="The summary bar at the bottom of the screen"
          on={v.showSummaryBar} onChange={(showSummaryBar) => slice.set({ showSummaryBar }, { now: true })}
          icon={<PanelBottom size={16} />} label="Summary bar" tip="The row of tiles at the bottom of the screen." />
        {/* the day/night preview override (AppConfig's dayNightPreview) only means anything for BAKED villas, whose
            day/night is a pre-rendered atlas crossfade worth previewing */}
        {(manager?.lightingMode().structureUnlit ?? false) && (
          // Sunrise, not Sun, for "Day": the Interface theme in the header uses Sun for its Light option. ⚠️ Distinct
          // from that INTERFACE theme: this relights the VILLA, that one themes the panels; the written name keeps
          // them apart.
          <SettingRow icon={<CloudSun size={16} />} label="Villa lighting" tip={<>
            Forces this villa's baked day or night look, or follows the real cycle on Auto. It relights the 3D
            model, unlike the Interface theme in the header, which only recolours the panels.
          </>}>
            <SegmentedGroup ariaLabel="Villa lighting" className="segmented-icons"
              active={v.render.dayNightPreview ?? "auto"} onChange={(dayNightPreview) => applyRender({ dayNightPreview })} options={[
              { key: "day", title: "Light the villa as daytime", label: <Sunrise size={17} /> },
              { key: "night", title: "Light the villa as night", label: <Moon size={17} /> },
              { key: "auto", title: "Automatic, the villa follows the real day/night cycle", label: <SunMoon size={17} /> },
            ]} />
          </SettingRow>
        )}
      </div>

      {/* ── Camera & movement: first-person walk-through comfort (Natural scrolling, a bird's-eye setting, is above). */}
      <div className="settings-section-title">First-person view</div>
      <div className="setting-line">
        <SettingSlider icon={<Eye size={16} />} label="Eye height" value={settingValue.metres(eyeHeight)}
          min={0.8} max={2.2} step={0.05} at={eyeHeight} onChange={applyEyeHeight} />
        <SettingSlider icon={<Footprints size={16} />} label="Walk speed" value={settingValue.times(v.walkSpeed)}
          min={0.3} max={3} step={0.1} at={v.walkSpeed} onChange={applyWalkSpeed} />
      </div>

      </>
      )}
      </>
      )}

      </div>{/* end modal-body */}

      {/* Save and Cancel are the footer's (footerExits); Escape and the backdrop run the same Cancel. */}
      <RemoteReplacedNote replaced={slice.replaced} onDismiss={slice.dismissReplaced} />
      <ModalFooter
        leading={can("editConfig") ? (
          // the footer's own button: the same pill, size, icon and word as Save and Cancel (owner, 2026-10-22)
          <button className="btn" onClick={onOpenConfigEditor} aria-label="Advanced Settings">
            <Sliders size={18} aria-hidden /><span className="btn-label">Advanced Settings</span>
          </button>
        ) : undefined}
        commit={commit}
        onClose={onClose}
      />
    </Window>
  );
}
