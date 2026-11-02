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
import {
  Sliders, Sun, Sunrise, Moon, Monitor, SunMoon, MousePointerClick, Move, Circle, CreditCard, PanelBottom, Radar,
  Settings2, MessageSquare, Maximize,
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
import { ADVANCED_SETTINGS_KEYS } from "@/config/configSlice";
import type { SceneManager } from "@/babylon/SceneManager";
import InfoTip from "@/components/common/InfoTip";
import { fmtDuration } from "@/components/panels/chartUtils";
import { useAnnouncements } from "@/messages/AnnouncementsContext";
import { ANNOUNCEMENT_NOTICE_MS, languageName, languagesOf } from "@/messages/announcements";
import { PendingFields } from "@/hooks/usePendingField";
import { FullScreenAnnouncements } from "./MessagesSettings";
import WhoGetsMessages from "./WhoGetsMessages";
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
  //   dirty   = something it changed is not back to what it was
  //   Save    = keep it, and forget the ledger
  //   Discard = put exactly those items back, which reverts the scene AND the store
  //
  // All of that is useDraftedSlice. ⚠️ THE SLICE IS EVERY KEY THIS DIALOG
  // WRITES, listed once — and it is the ONLY way this dialog writes: `set`
  // accepts no other key, so a control writing a key Discard would not
  // restore is a type error, not a silent gap (tests/oracles/settings_baseline.mjs).
  const SETTINGS_KEYS = [
    "badgeStyle", "eyeHeight", "highlightInteractive", "naturalScrolling",
    "render", "showSummaryBar", "siteTitle", "theme",
    "walkSpeed", "ringsFullScreen", "tabletLanguage",
    // ⚠️ THE VILLA'S (owner, 2026-11-03: moved here from Advanced Settings' Messages tab): a shared key, through the same
    // draft, Save keeping it and Cancel putting it back on every tablet.
    "fullScreen",
    // ⚠️ THE VILLA'S, NOT THIS DEVICE'S (owner, 2026-10-22: moved here from Advanced Settings): a shared key
    // (deviceConfig), so writing it reaches every tablet — through the same draft as every other option here, Save
    // keeping it and Cancel putting it back.
    "roomGlowAndCones",
    // ⚠️ AND EVERYTHING ADVANCED SETTINGS EDITS (owner, 2026-10-22: it joins this dialog's Save / Cancel). Advanced
    // Settings opens OVER this dialog, writes live through ConfigContext.update, and closes back here: these keys are
    // in this ONE draft, so its changes make Save live, Save keeps them, and Cancel puts them back as they were before
    // this dialog changed them — to every tablet, through the same update.
    ...ADVANCED_SETTINGS_KEYS,
  ] as const;
  const slice = useDraftedSlice(SETTINGS_KEYS);
  const v = slice.view;
  const { kept } = useAnnouncements();
  const languages = [...new Set([...languagesOf(kept), v.tabletLanguage])];
  // The 3D view follows what this dialog shows (hooks/useScenePreview): a slider is felt while it is dragged, and
  // Cancel puts the view back by the same path. ⚠️ NO SLIDER MOVES THE SCENE ITSELF (to 2.496.499, Cancel within the
  // half-second the write waits left the camera at the cancelled eye height).
  useScenePreview(manager, v);

  const commit = {
    dirty: slice.dirty,
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
        // and "Who gets the messages" only for a profile that may edit the villa's setup. The list writes through this
        // dialog's one draft like every option here (Save keeps it, Cancel puts it back; its seconds wait in the
        // draft's pending store); "Who gets the messages" is saved on the villa at once, as before.
        <PendingFields pending={slice.pending}>
          <TipTitle title="Full-screen announcements" tip={<>
            The announcements picked here fill the whole screen of every tablet where full screen is on, each for its
            own time; then they go, and their card stays in the Cockpit's Inbox. Close ends one sooner. A tablet can
            switch full screen off, a bedroom's at night for instance: there they show under the category bar like
            every other announcement, for {fmtDuration(ANNOUNCEMENT_NOTICE_MS)}.
          </>} />
          <OnOffToggle ariaLabel="Full screen on this tablet" title="Let a picked announcement fill the whole screen of this tablet"
            on={v.ringsFullScreen} onChange={(ringsFullScreen) => slice.set({ ringsFullScreen }, { now: true })}
            icon={<Maximize size={16} />} label="Full screen on this tablet" />
          {can("editConfig") && (
            <>
              <div className="settings-inline-label" style={{ marginTop: 12 }}>For every tablet</div>
              <FullScreenAnnouncements value={v.fullScreen} onChange={(fullScreen) => slice.set({ fullScreen }, { now: true })} />
            </>
          )}
          {/* ticket 28 of "One inbox" (owner, 2026-10-30): which of the languages VESTA wrote its words in this tablet
              shows (messages/announcements languagesOf), the current pick kept even if none holds it now; owner,
              2026-11-03: "i don't understand what this does", said plainly, and no lone button while English is all */}
          <TipTitle title="VESTA's messages on this tablet, in" tip={<>
            VESTA writes each message in the language of every chat that receives it (each chat's language is set on
            VESTA's page). Pick which of those languages this tablet shows. It translates nothing: a message written in
            one language only, the villa's own announcements and this tablet's buttons and menus stay as they are.
          </>} />
          {languages.length > 1 ? (
            <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <SegmentedGroup ariaLabel="VESTA's messages on this tablet, in" active={v.tabletLanguage}
                onChange={(code) => slice.set({ tabletLanguage: code }, { now: true })}
                options={languages.map((code) => (
                  { key: code, title: `VESTA's messages in ${languageName(code)} on this tablet`, label: languageName(code) }))} />
            </div>
          ) : (
            <span className="muted body-text">
              Only {languageName(languages[0])} so far: another language shows here once a chat receives VESTA's messages in it.
            </span>
          )}
          {can("editConfig") && (
            <>
              <TipTitle title="Who gets the messages" tip={<>
                The chats and phones that get the villa's messages, for the {ROLE_LABELS.owner} and for the{" "}
                {ROLE_LABELS.ops}. An urgent (P1) alert goes to both lists, a P2 alert to the {ROLE_LABELS.ops}'s; a
                notice goes to the list its automation names. VESTA sends its reminders to the same chats. An urgent or
                P2 alert with nobody listed goes to every Telegram chat of the villa, so it is never lost. A change here
                is saved on the villa at once.
              </>} />
              <WhoGetsMessages />
            </>
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

      {/* Blue-glow (a render/interaction toggle) and Natural scrolling (an
          Overview-camera toggle) don't share a topic — paired on one row,
          as single-button segmented toggles matching Summary bar's style
          below, purely for density at the user's request. .settings-
          row-half's flex-basis (not an inline style — see its own comment)
          keeps them on that one line on a phone too, matching desktop,
          not just on a roomy screen. */}
      <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <OnOffToggle ariaLabel="Blue glow for clickable devices" className="settings-row-half" title="Blue glow around clickable devices"
          on={v.highlightInteractive} onChange={(highlightInteractive) => slice.set({ highlightInteractive }, { now: true })}
          icon={<MousePointerClick size={16} />} label="Clickable Glow" />
        <OnOffToggle ariaLabel="Natural scrolling" className="settings-row-half" title="Natural scrolling in the bird's-eye view"
          on={v.naturalScrolling} onChange={(naturalScrolling) => slice.set({ naturalScrolling }, { now: true })}
          icon={<Move size={16} />} label="Natural Scroll" />
      </div>

      {/* Brightness/Night dimming apply to every villa; the day/night
          preview override (moved here from the header, no longer a single
          invert toggle — see AppConfig's dayNightPreview) only means
          anything for BAKED villas, whose day/night is a dramatic
          pre-rendered atlas crossfade worth previewing/overriding on
          demand rather than a plain lighting dim. .row + flex-wrap (not
          .slider-pair, which is a strict 2-col grid shared with the Eye
          height/Walk speed pair below): three equal thirds (owner,
          2026-11-03: "equally balanced in the modal width"), wrapping on
          a narrow screen. */}
      <div className="row" style={{ gap: 12, marginTop: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="settings-third">
          <label className="with-tip">Brightness · {v.render.exposure.toFixed(2)}×
            <InfoTip label="About Brightness">The overall exposure of the 3D view. Updates live.</InfoTip></label>
          <input
            type="range" min={0.6} max={2} step={0.05} value={v.render.exposure}
            onChange={(e) => applyRender({ exposure: Number(e.target.value) })}
          />
        </div>
        <div className="settings-third">
          <label className="with-tip">Night dimming · {v.render.nightDimming.toFixed(1)}×
            <InfoTip label="About Night dimming">How much extra dimming applies at night. Updates live.</InfoTip></label>
          <input
            type="range" min={0} max={1} step={0.1} value={v.render.nightDimming}
            onChange={(e) => applyRender({ nightDimming: Number(e.target.value) })}
          />
        </div>
        {(manager?.lightingMode().structureUnlit ?? false) && (
          // A third of the line, as its two sliders (owner, 2026-11-03: .settings-third), its icons filling it
          // (.daynight-segmented). Sunrise, not Sun,
          // for "Day": the Theme selector above already uses Sun for its
          // Light option, and the two sat close enough on the same screen
          // to read as the same control.
          // ⚠️ Distinct from the INTERFACE theme in the header — see the
          // long note there. This relights the VILLA; that one themes the
          // panels. The written label is what keeps them apart: it now sits
          // in a labelled wrapper like its slider siblings, so the control
          // states what it does instead of relying on the reader decoding a
          // sun/moon glyph that the header control also uses.
          <div className="settings-third">
          <label className="with-tip">Villa lighting
            <InfoTip label="About Villa lighting">
              Forces this villa's baked day or night look, or follows the real cycle on Auto. It relights the 3D
              model, unlike the Interface theme in the header, which only recolours the panels.
            </InfoTip></label>
          <SegmentedGroup ariaLabel="Villa lighting" className="segmented-icons daynight-segmented"
            active={v.render.dayNightPreview ?? "auto"} onChange={(dayNightPreview) => applyRender({ dayNightPreview })} options={[
            { key: "day", title: "Light the villa as daytime", label: <Sunrise size={17} /> },
            { key: "night", title: "Light the villa as night", label: <Moon size={17} /> },
            { key: "auto", title: "Automatic, the villa follows the real day/night cycle", label: <SunMoon size={17} /> },
          ]} />
          </div>
        )}
      </div>

      {/* Light effect strength scales a lit fixture's room illumination in
          BOTH villa flavours (2.31.0): the floor "light pool" decal in
          baked-lighting villas (see babylon/LightPools.ts — their unlit
          structure can't be brightened by a real light), and the real
          dynamic PointLight's intensity in non-baked villas (where it
          silently did nothing before). */}
      <label style={{ marginTop: 14 }}>Light effect strength · {v.render.lightPoolIntensity.toFixed(1)}×</label>
      <input
        type="range" min={0.3} max={2} step={0.1} value={v.render.lightPoolIntensity}
        onChange={(e) => applyRender({ lightPoolIntensity: Number(e.target.value) })}
      />

      {/* ⚠️ NO PARAGRAPH UNDER AN OPTION (owner, 2026-10-22): its explanation is ONE (i) on its title (common/InfoTip). */}
      <label className="with-tip" style={{ marginTop: 16 }}>Map look
        <InfoTip label="About the map look">
          Icon: a badge with a value pill. Card: a coloured card with icon and value inline. Both show the same
          information, purely a look preference. Badge size, {config.entityIconScale.toFixed(2)}×, is set with the
          +/- buttons next to the category filters in the top bar. Summary bar: the row of tiles at the bottom of the
          screen.
          {can("editConfig") && " Room glow: light up the room in red and draw the camera's cone when presence is "
            + "detected or a sensor triggers (the devices themselves still glow). It applies to every tablet."}
        </InfoTip></label>
      {/* The on-map badge look (Icon / Card), on its own line; then (owner, 2026-11-03: every on/off setting is On | Off,
          its name at the left) the Summary bar and, for a profile that may edit the villa's setup, the villa's room
          glow and camera cones (AppConfig.roomGlowAndCones, every tablet's; on this line since 2026-10-22), two
          halves that wrap together on a phone. */}
      <div className="row" style={{ gap: 10, marginTop: 6 }}>
        <SegmentedGroup ariaLabel="Floating badge style" active={v.badgeStyle} onChange={(badgeStyle) => slice.set({ badgeStyle }, { now: true })} options={[
          { key: "classic", title: "Icon badge style, the reading sits on a small pill under the icon", label: <><Circle size={16} /> <span className="badge-btn-label">Icon</span></> },
          { key: "card", title: "Card badge style, the reading sits inline beside the icon (default)", label: <><CreditCard size={16} /> <span className="badge-btn-label">Card</span></> },
        ]} />
      </div>
      <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <OnOffToggle ariaLabel="Summary bar" className="settings-row-half" title="The summary bar at the bottom of the screen"
          on={v.showSummaryBar} onChange={(showSummaryBar) => slice.set({ showSummaryBar }, { now: true })}
          icon={<PanelBottom size={16} />} label="Summary bar" />
        {can("editConfig") && (
          <OnOffToggle ariaLabel="Room glow and camera cones" className="settings-row-half" title="Room glow and camera cones, on every tablet"
            on={v.roomGlowAndCones} onChange={(roomGlowAndCones) => slice.set({ roomGlowAndCones }, { now: true })}
            icon={<Radar size={16} />} label="Room glow" />
        )}
      </div>

      {/* ── Camera & movement ─────────────────────────────────────────────
          First-person walk-through comfort. Bird's-eye's own "Natural
          scrolling" toggle moved up next to the blue-glow toggle above, so
          this section is first-person only now. No separator above (same
          "the title's own top margin is enough" rule every other section
          transition in this modal follows) — a redundant hr-plus-margin
          was the reported inconsistency. */}
      <div className="settings-section-title">First-person view</div>
      <div className="slider-pair" style={{ marginTop: 10 }}>
        <div>
          <label>Eye height · {eyeHeight.toFixed(2)} m</label>
          <input
            type="range" min={0.8} max={2.2} step={0.05} value={eyeHeight}
            onChange={(e) => applyEyeHeight(Number(e.target.value))}
          />
        </div>
        <div>
          <label>Walk speed · {v.walkSpeed.toFixed(1)}×</label>
          <input
            type="range" min={0.3} max={3} step={0.1} value={v.walkSpeed}
            onChange={(e) => applyWalkSpeed(Number(e.target.value))}
          />
        </div>
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
