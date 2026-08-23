// src/components/settings/SettingsModal.tsx
// Appearance + render/movement tuning. A footer button opens the full Config
// Editor (villa coordinates, entity metadata, bindings, 3D model source) as
// a modal over the live villa. Device badge icons are hardcoded, not
// editable here — see babylon/badgeIcons.ts + badgeIconKeys.ts.
//
// There's no HA URL/token here anymore: the kiosk always reaches Home Assistant
// token-less through the add-on's Supervisor proxy, so there's nothing to enter.

import { useState } from "react";
import { useModalA11y } from "@/hooks/useModalA11y";
import ModalFooter from "@/components/common/ModalFooter";
import {
  Sliders, Sun, Sunrise, Moon, Monitor, SunMoon, MousePointerClick, Move, Circle, CreditCard, PanelBottom,
} from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability, type Capability } from "@/auth/permissions";
import { useHA } from "@/ha/HAStateStore";
import { useDraftCommit } from "@/hooks/useDraftCommit";
import { DEFAULT_SITE_TITLE, DEFAULT_RENDER, type AppConfig, type RenderConfig } from "@/config/AppConfig";
import type { SceneManager } from "@/babylon/SceneManager";

interface Props {
  manager: SceneManager | null;
  onClose: () => void;
  /** Open the full Config Editor (a modal over the live villa). */
  onOpenConfigEditor: () => void;
}

export default function SettingsModal({ manager, onClose, onOpenConfigEditor }: Props) {
  const { config, update } = useConfig();
  const { role } = useProfile();
  const { haConfig } = useHA();
  // RBAC: which settings areas the active profile may use. Dashboard already
  // refuses to open this modal without "openSettings"; these narrow further.
  const can = (c: Capability) => role != null && hasCapability(role, c);

  // Every setting here applies AND persists live now, matching Advanced
  // ⚠️ THIS DIALOG APPLIES LIVE AND STILL HAS A REAL DRAFT — those are not in
  // conflict, and reading them as one is what left Save permanently greyed
  // (reported 2026-08-23: a disabled button that can never enable reads as
  // broken, and it was, just not in the way it looked).
  //
  // Live preview is the POINT of these controls: a walk-speed slider that only
  // took effect on Save would be untunable, so every tick still reaches the
  // scene. What was missing is the other half — a BASELINE to return to. So:
  //
  //   the scene previews on every tick   (unchanged, and load-bearing)
  //   dirty  = the live config differs from the baseline taken at open
  //   Save   = keep it, and make THIS the new baseline
  //   Cancel = write the baseline back, which reverts the scene AND the store
  //
  // ⚠️ CANCEL REVERTS BY WRITING, not by withholding a write. Persistence here
  // is eager by design (see ConfigContext: the localStorage write is deferred
  // to an effect for cost, not for staging), so there is no un-written state to
  // drop — undoing means putting the old values back through the same path any
  // control uses, which is also why the scene follows for free.
  // ⚠️ THE BASELINE IS EVERY KEY THIS DIALOG WRITES, listed once below. A key
  // added to a control and not to that list is silently un-revertable: Cancel
  // would restore its nine siblings and leave that one changed, which is worse
  // than not offering Cancel. Pinned by tests/py/test_modal_shell.py, which
  // derives the list from the update()/scheduleCommit() call sites in this file.
  //
  // A slider/text field still needs a local echo for responsive typing/drag,
  // but committing config on every single tick would mean writing the WHOLE
  // config blob (entityMap included) to localStorage dozens of times a
  // second. So: apply to the live scene on every tick (unchanged), but
  // debounce the config commit — same pattern as Advanced Settings'
  // commitLabel (ConfigEditor.tsx) — and always flush before the modal
  // actually closes so a change made just before Close is never dropped.
  // Single (non-keyed) pending patch — see useDraftCommit's docstring for the
  // general pattern (same one Advanced Settings uses per-row). useDraftCommit
  // already flushes on unmount on its own, so there's no separate safety-net
  // effect needed here beyond the explicit flush in closeModal below.
  const SETTINGS_DRAFT_KEY = "settings";
  const pending = useDraftCommit<Partial<AppConfig>>((_key, patch) => update(patch), 500);
  const scheduleCommit = (patch: Partial<AppConfig>) =>
    pending.draft(SETTINGS_DRAFT_KEY, { ...pending.drafts[SETTINGS_DRAFT_KEY], ...patch });
  const flushPending = () => pending.flush(SETTINGS_DRAFT_KEY);
  const closeModal = () => { flushPending(); onClose(); };

  // ⚠️ DERIVED FROM THE CALL SITES, NOT FROM MEMORY — every key any control in
  // this file passes to update() or scheduleCommit(). See the note above.
  const SETTINGS_KEYS = [
    "badgeStyle", "eyeHeight", "highlightInteractive", "naturalScrolling",
    "northOffsetDeg", "render", "showSummaryBar", "siteTitle", "theme",
    "walkSpeed",
  ] as const;
  const slice = (c: AppConfig): Partial<AppConfig> => {
    const out: Record<string, unknown> = {};
    for (const k of SETTINGS_KEYS) out[k] = c[k];
    return out as Partial<AppConfig>;
  };
  // Captured once, on open. `useState`'s initialiser — not useRef with a live
  // read — so a config change while the dialog is open moves `dirty`, which is
  // the whole point, rather than moving the thing dirty is measured against.
  const [baseline, setBaseline] = useState<Partial<AppConfig>>(() => slice(config));
  // Content comparison, never reference: `render` is an object and is rebuilt
  // by every one of its own controls, so `!==` would report dirty forever.
  const dirty = JSON.stringify(slice(config)) !== JSON.stringify(baseline)
    || Object.keys(pending.drafts).length > 0;
  const commit = {
    dirty,
    save: () => { flushPending(); setBaseline(slice({ ...config, ...pending.drafts[SETTINGS_DRAFT_KEY] })); },
    // ⚠️ Restores through update(), so the scene reverts with the store. The
    // local echoes are re-seeded too — they are what the sliders render from,
    // and a reverted config behind a stale echo is the same lie one layer up.
    discard: () => {
      pending.cancel(SETTINGS_DRAFT_KEY);
      update(baseline);
      setSiteTitle(baseline.siteTitle ?? "");
      setEyeHeight(baseline.eyeHeight ?? 1.7);
      setWalkSpeed(baseline.walkSpeed ?? 1);
      setRender(baseline.render ?? DEFAULT_RENDER);
    },
  };
  // Focus trap + Escape + focus restore (see useModalA11y). Declared AFTER
  // closeModal deliberately — it closes over it, and this modal's close path
  // has to flush the debounced settings draft, so Escape must run the same
  // flush-then-close that the Close button and backdrop click do.
  const dialogRef = useModalA11y(closeModal);

  const [siteTitle, setSiteTitle] = useState(config.siteTitle);
  const [eyeHeight, setEyeHeight] = useState(config.eyeHeight ?? 1.7);
  const [walkSpeed, setWalkSpeed] = useState(config.walkSpeed ?? 1);
  const [render, setRender] = useState<RenderConfig>(config.render ?? DEFAULT_RENDER);

  const applySiteTitle = (v: string) => {
    setSiteTitle(v);
    scheduleCommit({ siteTitle: v.trim() });
  };

  // Live-apply render tuning straight to the scene while dragging, so the user
  // can iterate on look/perf without saving + reloading, and debounce-commit
  // the same object to config so it's remembered without a Save step.
  const applyRender = (patch: Partial<RenderConfig>) => {
    const next = { ...render, ...patch };
    setRender(next);
    manager?.setRenderConfig(next);
    scheduleCommit({ render: next });
  };

  // Live-apply so you can feel/see the change while dragging the sliders.
  const applyEyeHeight = (h: number) => {
    setEyeHeight(h);
    manager?.camera.setEyeHeight(h);
    scheduleCommit({ eyeHeight: h });
  };
  const applyWalkSpeed = (v: number) => {
    setWalkSpeed(v);
    manager?.camera.setWalkSpeed(v);
    scheduleCommit({ walkSpeed: v });
  };

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
        <div className="settings-header">
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
              <span className="settings-inline-label">Theme Modes</span>
            <div className="segmented segmented-icons" role="group" aria-label="Interface theme">
              {([
                { key: "light", label: "Light interface theme", icon: Sun },
                { key: "dark", label: "Dark interface theme", icon: Moon },
                { key: "auto", label: "Auto — follows the system, and dims to the night theme after dark", icon: Monitor },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  className={config.theme === key ? "active" : ""}
                  onClick={() => update({ theme: key })}
                  aria-pressed={config.theme === key}
                  title={label}
                  aria-label={label}
                >
                  <Icon size={17} />
                </button>
              ))}
            </div>
            </div>
          )}
        </div>
        <div className="settings-body">

        {/* RBAC: shared branding — administration, not personal taste. */}
        {can("editConfig") && (
          <>
            <div className="settings-section-title">Dashboard title</div>
            <input
              value={siteTitle}
              onChange={(e) => applySiteTitle(e.target.value)}
              onBlur={flushPending}
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
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="segmented settings-row-half" role="group" aria-label="Blue glow for clickable devices">
            <button
              className={config.highlightInteractive ? "active" : ""}
              onClick={() => update({ highlightInteractive: !config.highlightInteractive })}
              aria-pressed={config.highlightInteractive}
              title="Blue glow around clickable devices"
            >
              <MousePointerClick size={16} /> Clickable Glow
            </button>
          </div>
          <div className="segmented settings-row-half" role="group" aria-label="Natural scrolling">
            <button
              className={(config.naturalScrolling ?? true) ? "active" : ""}
              onClick={() => update({ naturalScrolling: !(config.naturalScrolling ?? true) })}
              aria-pressed={config.naturalScrolling ?? true}
              title="Natural scrolling in the bird's-eye view"
            >
              <Move size={16} /> Natural Scroll
            </button>
          </div>
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
            <label>Brightness · {render.exposure.toFixed(2)}×</label>
            <input
              type="range" min={0.6} max={2} step={0.05} value={render.exposure}
              onChange={(e) => applyRender({ exposure: Number(e.target.value) })}
            />
          </div>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <label>Night dimming · {render.nightDimming.toFixed(1)}×</label>
            <input
              type="range" min={0} max={1} step={0.1} value={render.nightDimming}
              onChange={(e) => applyRender({ nightDimming: Number(e.target.value) })}
            />
          </div>
          {(manager?.renderFx.isBaked() ?? false) && (
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
            <div className="segmented segmented-icons daynight-segmented" role="group" aria-label="Villa lighting">
              {([
                { key: "day", label: "Light the villa as daytime", icon: Sunrise },
                { key: "night", label: "Light the villa as night", icon: Moon },
                { key: "auto", label: "Automatic — the villa follows the real day/night cycle", icon: SunMoon },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  className={(render.dayNightPreview ?? "auto") === key ? "active" : ""}
                  onClick={() => applyRender({ dayNightPreview: key })}
                  aria-pressed={(render.dayNightPreview ?? "auto") === key}
                  title={label}
                  aria-label={label}
                >
                  <Icon size={17} />
                </button>
              ))}
            </div>
            </div>
          )}
        </div>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: "var(--text-2xs)" }}>
          Overall scene exposure, and how much extra dimming applies at night — both update live.
          {(manager?.renderFx.isBaked() ?? false) && " Villa lighting forces this villa's baked day or night look, or follows the real cycle on Auto — it relights the 3D model, unlike the Interface theme in the header, which only recolours the panels."}
        </p>

        {/* Light effect strength scales a lit fixture's room illumination in
            BOTH villa flavours (2.31.0): the floor "light pool" decal in
            baked-lighting villas (see babylon/LightPools.ts — their unlit
            structure can't be brightened by a real light), and the real
            dynamic PointLight's intensity in non-baked villas (where it
            silently did nothing before). */}
        <label style={{ marginTop: 14 }}>Light effect strength · {render.lightPoolIntensity.toFixed(1)}×</label>
        <input
          type="range" min={0.3} max={2} step={0.1} value={render.lightPoolIntensity}
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
          Model north offset · {(config.northOffsetDeg ?? 0)}°
        </label>
        {/* The button rides the SLIDER's line, not the title's: they are one
            control in two forms — the slider sets the offset by hand, the
            button measures it from the view — so they belong on the same row,
            and the title stays a title. The slider takes the remaining width
            via flex:1 rather than a percentage, so the button's fixed box is
            subtracted rather than guessed at. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="range" min={0} max={359} step={1} value={config.northOffsetDeg ?? 0}
            style={{ flex: "1 1 auto", minWidth: 0 }}
            onChange={(e) => update({ northOffsetDeg: Number(e.target.value) })}
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
              if (deg != null) update({ northOffsetDeg: Math.round(deg) });
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
          Badge size — {(config.entityIconScale ?? 1.0).toFixed(2)}× — is set with
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
          <div className="segmented settings-row-half" role="group" aria-label="Floating badge style">
            <button
              className={(config.badgeStyle ?? "card") === "classic" ? "active" : ""}
              onClick={() => update({ badgeStyle: "classic" })}
              aria-pressed={(config.badgeStyle ?? "card") === "classic"}
              title="Icon badge style — the reading sits on a small pill under the icon"
              aria-label="Icon badge style"
            >
              <Circle size={16} /> <span className="badge-btn-label">Icon</span>
            </button>
            <button
              className={(config.badgeStyle ?? "card") === "card" ? "active" : ""}
              onClick={() => update({ badgeStyle: "card" })}
              aria-pressed={(config.badgeStyle ?? "card") === "card"}
              title="Card badge style — the reading sits inline beside the icon (default)"
              aria-label="Card badge style"
            >
              <CreditCard size={16} /> <span className="badge-btn-label">Card</span>
            </button>
          </div>
          {/* Single active/inactive button, its own one-item segmented group —
              reuses the exact same pill styling as the badge-style pair above
              rather than a checkbox row, at the user's request. Shares
              .settings-row-half's sizing (styles.css) so the two sit on one
              line even on a phone — this button's own label shortens further
              there (.settings-label-short/-full) since "Dock" leaves the
              Default/Card pair the most room. */}
          <div className="segmented settings-row-half" role="group" aria-label="Summary bar">
            <button
              className={(config.showSummaryBar ?? true) ? "active" : ""}
              onClick={() => update({ showSummaryBar: !(config.showSummaryBar ?? true) })}
              aria-pressed={config.showSummaryBar ?? true}
            >
              <PanelBottom size={16} />
              <span className="settings-label-full">Summary bar</span>
              <span className="settings-label-short">Dock</span>
            </button>
          </div>
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
        <div className="slider-pair">
          <div>
            <label>Eye height · {eyeHeight.toFixed(2)} m</label>
            <input
              type="range" min={0.8} max={2.2} step={0.05} value={eyeHeight}
              onChange={(e) => applyEyeHeight(Number(e.target.value))}
            />
          </div>
          <div>
            <label>Walk speed · {walkSpeed.toFixed(1)}×</label>
            <input
              type="range" min={0.3} max={3} step={0.1} value={walkSpeed}
              onChange={(e) => applyWalkSpeed(Number(e.target.value))}
            />
          </div>
        </div>

        </>
        )}

        </div>{/* end settings-body */}

        {/* ⚠️ A FULL FOOTER, INCLUDING CANCEL — see the baseline note at the top of
            this component. This dialog applies live AND has a draft: Save keeps
            what you are looking at and rebaselines, Cancel writes the values
            from when it opened back through update(), which reverts the scene
            as well as the store. It carried a bare Close until 2026-08-23 on
            the reasoning that living controls cannot have a draft, which
            confused "already applied" with "cannot be undone". */}
        <ModalFooter
          commit={commit}
          leading={can("editConfig") ? (
            <button className="btn ghost" onClick={onOpenConfigEditor}>
              <Sliders size={18} /> Advanced Settings
            </button>
          ) : undefined}
          onClose={closeModal}
        />
      </div>
    </div>
  );
}
