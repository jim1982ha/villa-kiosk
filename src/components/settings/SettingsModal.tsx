// src/components/settings/SettingsModal.tsx
// Appearance + render/movement tuning. A footer button opens the full Config
// Editor (villa coordinates, entity metadata, bindings, 3D model source) as
// a modal over the live villa. Device badge icons are hardcoded, not
// editable here — see babylon/badgeIcons.ts + badgeIconKeys.ts.
//
// There's no HA URL/token here anymore: the kiosk always reaches Home Assistant
// token-less through the add-on's Supervisor proxy, so there's nothing to enter.

import { eyeHeightOf } from "@/babylon/walkerSpawn";
import { useState } from "react";
import ModalFooter from "@/components/common/ModalFooter";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import UnsavedChanges from "@/components/common/UnsavedChanges";
import { useModalA11y } from "@/hooks/useModalA11y";
import {
  Sliders, Sun, Sunrise, Moon, Monitor, SunMoon, MousePointerClick, Move, Circle, CreditCard, PanelBottom,
} from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan, type Capability } from "@/auth/permissions";
import { useHA } from "@/ha/HAStateStore";
import { useDraftedSlice } from "@/hooks/useDraftedSlice";
import { DEFAULT_SITE_TITLE, type RenderConfig } from "@/config/AppConfig";
import type { SceneManager } from "@/babylon/SceneManager";

interface Props {
  manager: SceneManager | null;
  onClose: () => void;
  /** Open the full Config Editor (a modal over the live villa). */
  onOpenConfigEditor: () => void;
}

export default function SettingsModal({ manager, onClose, onOpenConfigEditor }: Props) {
  const { config } = useConfig();
  const { role } = useProfile();
  const { haConfig } = useHA();
  // RBAC: which settings areas the active profile may use. Dashboard already
  // refuses to open this modal without "openSettings"; these narrow further.
  const can = (c: Capability) => roleCan(role, c);

  // Every setting here applies AND persists live: the scene previews on every
  // tick (load-bearing — a walk-speed slider that only took effect on Save
  // would be untunable), the config write is debounced (the WHOLE config
  // blob goes to localStorage on each write), and there is a BASELINE to go
  // back to:
  //
  //   dirty   = the live config differs from the baseline taken at open
  //   Save    = keep it, and make THIS the new baseline
  //   Discard = write the baseline back, which reverts the scene AND the store
  //
  // All of that is useDraftedSlice. ⚠️ THE SLICE IS EVERY KEY THIS DIALOG
  // WRITES, listed once — and it is the ONLY way this dialog writes: `set`
  // accepts no other key, so a control writing a key Discard would not
  // restore is a type error, not a silent gap (tests/oracles/settings_baseline.mjs).
  const SETTINGS_KEYS = [
    "badgeStyle", "eyeHeight", "highlightInteractive", "naturalScrolling",
    "northOffsetDeg", "render", "showSummaryBar", "siteTitle", "theme",
    "walkSpeed",
  ] as const;
  const slice = useDraftedSlice(SETTINGS_KEYS);
  const v = slice.view;

  const [askingClose, setAskingClose] = useState(false);

  const commit = {
    dirty: slice.dirty,
    save: slice.save,
    // The sliders and fields read the slice's view, so they follow the
    // reverted config with nothing to re-seed; only what this dialog drives
    // on the scene directly is re-applied.
    discard: () => {
      const baseline = slice.discard();
      manager?.setRenderConfig(baseline.render);
    },
  };

  // ⚠️ CLOSE ASKS WHEN THERE IS SOMETHING TO LOSE, and closes straight away
  // when there is not — a question with only one sensible answer is noise.
  const closeModal = () => {
    if (slice.dirty) { setAskingClose(true); return; }
    slice.flush();
    onClose();
  };
  // Focus trap + Escape + focus restore (see useModalA11y). Declared AFTER
  // closeModal deliberately — it closes over it, and this modal's close path
  // has to flush the debounced settings draft, so Escape must run the same
  // flush-then-close that the Close button and backdrop click do.
  const dialogRef = useModalA11y(closeModal);

  // Shown as typed, stored trimmed.
  const applySiteTitle = (text: string) => slice.set({ siteTitle: text }, { stored: { siteTitle: text.trim() } });

  // Live-apply render tuning straight to the scene while dragging, so the user
  // can iterate on look/perf without saving + reloading.
  const applyRender = (patch: Partial<RenderConfig>) => {
    const next = { ...v.render, ...patch };
    manager?.setRenderConfig(next);
    slice.set({ render: next });
  };

  // Live-apply so you can feel/see the change while dragging the sliders.
  const applyEyeHeight = (h: number) => {
    manager?.camera.setEyeHeight(h);
    slice.set({ eyeHeight: h });
  };
  const applyWalkSpeed = (speed: number) => {
    manager?.camera.setWalkSpeed(speed);
    slice.set({ walkSpeed: speed });
  };
  const eyeHeight = eyeHeightOf(v.eyeHeight);

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div
        ref={dialogRef}
        className="modal settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
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
              { key: "auto", title: "Auto — follows the system, and dims to the night theme after dark", label: <Monitor size={17} /> },
            ]} />
            </div>
          )}
        </div>
        <div className="modal-body">

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
          <SegmentedGroup ariaLabel="Blue glow for clickable devices" className="settings-row-half"
            active={v.highlightInteractive ? "on" : null} onChange={() => slice.set({ highlightInteractive: !v.highlightInteractive }, { now: true })}
            options={[{ key: "on", title: "Blue glow around clickable devices", label: <><MousePointerClick size={16} /> Clickable Glow</> }]} />
          <SegmentedGroup ariaLabel="Natural scrolling" className="settings-row-half"
            active={v.naturalScrolling ? "on" : null} onChange={() => slice.set({ naturalScrolling: !v.naturalScrolling }, { now: true })}
            options={[{ key: "on", title: "Natural scrolling in the bird's-eye view", label: <><Move size={16} /> Natural Scroll</> }]} />
        </div>

        {/* Brightness/Night dimming apply to every villa; the day/night
            preview override (moved here from the header, no longer a single
            invert toggle — see AppConfig's dayNightPreview) only means
            anything for BAKED villas, whose day/night is a dramatic
            pre-rendered atlas crossfade worth previewing/overriding on
            demand rather than a plain lighting dim. .row + flex-wrap (not
            .slider-pair, which is a strict 2-col grid shared with the Eye
            height/Walk speed pair below — a 3rd item would either squeeze
            those or need its own copy of that class) so the segmented
            control sits on the same line when there's room and drops to its
            own line first on a narrow screen, same pattern as the Clickable
            Glow/Natural Scroll row above. */}
        <div className="row" style={{ gap: 12, marginTop: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <label>Brightness · {v.render.exposure.toFixed(2)}×</label>
            <input
              type="range" min={0.6} max={2} step={0.05} value={v.render.exposure}
              onChange={(e) => applyRender({ exposure: Number(e.target.value) })}
            />
          </div>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <label>Night dimming · {v.render.nightDimming.toFixed(1)}×</label>
            <input
              type="range" min={0} max={1} step={0.1} value={v.render.nightDimming}
              onChange={(e) => applyRender({ nightDimming: Number(e.target.value) })}
            />
          </div>
          {(manager?.lightingMode().structureUnlit ?? false) && (
            // Sizing lives entirely in .daynight-segmented (styles.css), not
            // an inline style — a narrow-screen media query needs to override
            // it (full-width once it wraps onto its own line below the
            // sliders), which can't win against an inline style's
            // specificity. alignSelf: flex-end there lines the control's
            // BOTTOM edge up with the bottom of its slider siblings (where
            // the track/thumb sits), which is the part it should visually
            // match — `stretch` was tried first and read badly, growing the
            // control to the FULL label-plus-track height. Sunrise, not Sun,
            // for "Day": the Theme selector above already uses Sun for its
            // Light option, and the two sat close enough on the same screen
            // to read as the same control.
            // ⚠️ Distinct from the INTERFACE theme in the header — see the
            // long note there. This relights the VILLA; that one themes the
            // panels. The written label is what keeps them apart: it now sits
            // in a labelled wrapper like its slider siblings, so the control
            // states what it does instead of relying on the reader decoding a
            // sun/moon glyph that the header control also uses.
            <div style={{ flex: "0 0 auto", minWidth: 0 }}>
            <label>Villa lighting</label>
            <SegmentedGroup ariaLabel="Villa lighting" className="segmented-icons daynight-segmented"
              active={v.render.dayNightPreview ?? "auto"} onChange={(dayNightPreview) => applyRender({ dayNightPreview })} options={[
              { key: "day", title: "Light the villa as daytime", label: <Sunrise size={17} /> },
              { key: "night", title: "Light the villa as night", label: <Moon size={17} /> },
              { key: "auto", title: "Automatic — the villa follows the real day/night cycle", label: <SunMoon size={17} /> },
            ]} />
            </div>
          )}
        </div>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: "var(--text-2xs)" }}>
          Overall scene exposure, and how much extra dimming applies at night — both update live.
          {(manager?.lightingMode().structureUnlit ?? false) && " Villa lighting forces this villa's baked day or night look, or follows the real cycle on Auto — it relights the 3D model, unlike the Interface theme in the header, which only recolours the panels."}
        </p>

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

        {/* The sun and moon are computed from the villa's real coordinates and
            clock, but the direction vector assumes the MODEL's +Z axis points
            north — and a GLB's heading is whatever its floor-plan export
            produced. This turns the whole sky to match. Ships at 0 rather than
            a seeded guess, which would be right for one villa only. */}
        {/* Label and button share a row: they are one control in two forms —
            the slider states the offset, the button MEASURES it — so putting
            them together says that, and buys back the vertical space the old
            stacked button and four-line paragraph took in a modal that already
            scrolls on a phone. `gap` plus wrap keeps them legible if the label
            grows (it carries a live value) rather than crushing the button
            below --touch-min. */}
        <label style={{ marginTop: 14 }}>
          Model north offset · {v.northOffsetDeg}°
        </label>
        {/* The button rides the SLIDER's line, not the title's: they are one
            control in two forms — the slider sets the offset by hand, the
            button measures it from the view — so they belong on the same row,
            and the title stays a title. The slider takes the remaining width
            via flex:1 rather than a percentage, so the button's fixed box is
            subtracted rather than guessed at. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="range" min={0} max={359} step={1} value={v.northOffsetDeg}
            style={{ flex: "1 1 auto", minWidth: 0 }}
            onChange={(e) => slice.set({ northOffsetDeg: Number(e.target.value) }, { now: true })}
          />
          {/* The one-tap path, and the reason the slider is not the only one:
              the operator knows which way their villa faces, not what the
              offset is in degrees. Turn the view toward the real north side,
              press this, and the heading becomes the answer — viewHeadingDeg. */}
          <button
            className="btn"
            // Flex shrinks items within a line before it wraps them, so without
            // this the phone tier would squeeze `.btn`'s 18px padding out and
            // leave a sub-44px target, the one thing --touch-min exists to
            // prevent. minWidth:0 on the slider is its counterpart: a flex item
            // will not shrink below its intrinsic width without it, which would
            // push the button off the row instead.
            style={{ flexShrink: 0, whiteSpace: "nowrap" }}
            disabled={!manager}
            onClick={() => {
              const deg = manager?.viewHeadingDeg();
              if (deg != null) slice.set({ northOffsetDeg: Math.round(deg) }, { now: true });
            }}
          >
            Set North
          </button>
        </div>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: "var(--text-2xs)" }}>
          Face the villa's real north side and press Set North, or drag the
          slider until the shadows match. Only fixes which wall the light comes
          from — sunrise and sunset times are already right.
        </p>

        <p className="muted body-text" style={{ marginTop: 10, fontSize: "var(--text-2xs)" }}>
          Badge size — {config.entityIconScale.toFixed(2)}× — is set with
          the +/- buttons next to the category filters in the top bar.
        </p>

        <label style={{ marginTop: 16, display: "block" }}>Badge &amp; bottom bar style</label>
        {/* "Floating badge style" only ever named the first of these two
            controls (Default/Card, the on-map entity badge look) — the
            second is a completely different feature (whether the bottom
            Summary bar/Dock shows at all), so the old title undersold what
            the row actually controls. Not an even 50/50 split (see
            .badge-style-row in styles.css) — Default+Card is genuinely
            wider content than a single "Dock" button, so forcing equal
            halves would starve the pair while leaving Dock's half mostly
            empty; both groups instead grow to fill the row, weighted 2:1. */}
        <div className="row badge-style-row" style={{ gap: 10, marginTop: 6 }}>
          <SegmentedGroup ariaLabel="Floating badge style" className="settings-row-half" active={v.badgeStyle} onChange={(badgeStyle) => slice.set({ badgeStyle }, { now: true })} options={[
            { key: "classic", title: "Icon badge style — the reading sits on a small pill under the icon", label: <><Circle size={16} /> <span className="badge-btn-label">Icon</span></> },
            { key: "card", title: "Card badge style — the reading sits inline beside the icon (default)", label: <><CreditCard size={16} /> <span className="badge-btn-label">Card</span></> },
          ]} />
          {/* Single active/inactive button, its own one-item segmented group —
              reuses the exact same pill styling as the badge-style pair above
              rather than a checkbox row, at the user's request. Shares
              .settings-row-half's sizing (styles.css) so the two sit on one
              line even on a phone — this button's own label shortens further
              there (.settings-label-short/-full) since "Dock" leaves the
              Default/Card pair the most room. */}
          <SegmentedGroup ariaLabel="Summary bar" className="settings-row-half"
            active={v.showSummaryBar ? "on" : null} onChange={() => slice.set({ showSummaryBar: !v.showSummaryBar }, { now: true })}
            options={[{ key: "on", label: <><PanelBottom size={16} /><span className="settings-label-full">Summary bar</span><span className="settings-label-short">Dock</span></> }]} />
        </div>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: "var(--text-2xs)" }}>
          Classic: icon badge with a value pill. Card: coloured card with icon &amp; value inline —
          both show the same information, purely a look preference.
        </p>

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

        </div>{/* end modal-body */}

        {/* ⚠️ THE FOOTER OWNS THE CLOSE QUESTION for its own button; this file
            owns it for Escape and the backdrop. Both raise the SAME
            `UnsavedChanges` component, so the wording, the button order and —
            the one that matters — which answer the backdrop maps to cannot
            drift apart between the two gestures. */}
        <ModalFooter
          leading={can("editConfig") ? (
            <button className="btn ghost" onClick={onOpenConfigEditor}>
              <Sliders size={18} /> Advanced Settings
            </button>
          ) : undefined}
          commit={commit}
          onClose={() => { slice.flush(); onClose(); }}
        />
      </div>
      {askingClose && (
        <UnsavedChanges
          onSave={() => { commit.save(); setAskingClose(false); onClose(); }}
          onDiscard={() => { commit.discard(); setAskingClose(false); onClose(); }}
          onStay={() => setAskingClose(false)}
        />
      )}
    </div>
  );
}
