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
import {
  Sliders, Sun, Moon, Monitor, SunMoon, MousePointerClick, Move, Circle, CreditCard, PanelBottom,
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
  // Settings — there is nothing left to Cancel/Save, only a single Close.
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
          {/* Theme selector + day/night invert live together in the header,
              icon-only + right-aligned — self-explanatory glyphs, no Save
              step (both apply and persist instantly). */}
          {can("customizeAppearance") && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="segmented segmented-icons" role="group" aria-label="Theme">
                {([
                  { key: "light", label: "Light theme", icon: Sun },
                  { key: "dark", label: "Dark theme", icon: Moon },
                  { key: "auto", label: "Auto (system) theme", icon: Monitor },
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
              {/* Baked villas only: their day/night is a dramatic pre-rendered
                  atlas crossfade driven by the real sun — this forces the
                  OPPOSITE look on demand (preview the night render at noon, or
                  lift a villa back to daylight after dark). Hidden for
                  non-baked villas, whose day/night is just a lighting dim —
                  not worth a dedicated toggle. A single active/inactive icon
                  button (not a checkbox) so it sits naturally beside the
                  theme selector rather than as a labelled row further down. */}
              {(manager?.renderFx.isBaked() ?? false) && (
                <button
                  className={`icon-btn header-icon-btn${render.dayNightInvert ? " active" : ""}`}
                  onClick={() => applyRender({ dayNightInvert: !render.dayNightInvert })}
                  aria-pressed={!!render.dayNightInvert}
                  title="Invert day/night preview"
                  aria-label="Invert day/night preview"
                >
                  <SunMoon size={18} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="settings-body">

        {/* RBAC: shared branding — administration, not personal taste. */}
        {can("editConfig") && (
          <>
            <div className="settings-section-title" style={{ marginTop: 0 }}>Dashboard title</div>
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
            as single-button segmented toggles matching Bottom Summary bar's
            style below, purely for density at the user's request. */}
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <div className="segmented" role="group" aria-label="Blue glow for clickable devices" style={{ flex: "1 1 160px" }}>
            <button
              className={config.highlightInteractive ? "active" : ""}
              onClick={() => update({ highlightInteractive: !config.highlightInteractive })}
              aria-pressed={config.highlightInteractive}
              title="Blue glow around clickable devices"
            >
              <MousePointerClick size={16} /> Clickable Glow
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Natural scrolling" style={{ flex: "1 1 160px" }}>
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

        {/* Invert day/night moved to the header, next to the theme selector
            (a single active/inactive icon button) — see the .segmented-icons
            block above. */}
        <div className="slider-pair" style={{ marginTop: 14 }}>
          <div>
            <label>Brightness · {render.exposure.toFixed(2)}×</label>
            <input
              type="range" min={0.6} max={2} step={0.05} value={render.exposure}
              onChange={(e) => applyRender({ exposure: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>Night dimming · {render.nightDimming.toFixed(1)}×</label>
            <input
              type="range" min={0} max={1} step={0.1} value={render.nightDimming}
              onChange={(e) => applyRender({ nightDimming: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: "var(--text-2xs)" }}>
          Overall scene exposure, and how much extra dimming applies at night. Both update live.
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

        <p className="muted body-text" style={{ marginTop: 10, fontSize: "var(--text-2xs)" }}>
          Badge size — {(config.entityIconScale ?? 1.0).toFixed(2)}× — is set with
          the +/- buttons next to the category filters in the top bar.
        </p>

        <label style={{ marginTop: 16, display: "block" }}>Floating badge style</label>
        <div className="row" style={{ gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          <div className="segmented" role="group" aria-label="Floating badge style" style={{ flex: "1 1 200px" }}>
            <button
              className={(config.badgeStyle ?? "classic") === "classic" ? "active" : ""}
              onClick={() => update({ badgeStyle: "classic" })}
              aria-pressed={(config.badgeStyle ?? "classic") === "classic"}
            >
              <Circle size={16} /> Classic
            </button>
            <button
              className={config.badgeStyle === "card" ? "active" : ""}
              onClick={() => update({ badgeStyle: "card" })}
              aria-pressed={config.badgeStyle === "card"}
            >
              <CreditCard size={16} /> Card
            </button>
          </div>
          {/* Single active/inactive button, its own one-item segmented group —
              reuses the exact same pill styling as the badge-style pair above
              rather than a checkbox row, at the user's request. flex-basis
              matches its neighbour's so the two share a row on a roomy
              screen and each drop to full width on a phone (flex-wrap). */}
          <div className="segmented" role="group" aria-label="Bottom summary bar" style={{ flex: "1 1 200px" }}>
            <button
              className={(config.showSummaryBar ?? true) ? "active" : ""}
              onClick={() => update({ showSummaryBar: !(config.showSummaryBar ?? true) })}
              aria-pressed={config.showSummaryBar ?? true}
            >
              <PanelBottom size={16} /> Bottom Summary bar
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
        <div className="slider-pair" style={{ marginTop: 10 }}>
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

        <div className="settings-footer">
          {/* Advanced Settings opens as a modal over the live villa (no reload). */}
          {can("editConfig") ? (
            <button className="btn ghost" onClick={onOpenConfigEditor}>
              <Sliders size={18} /> Advanced Settings
            </button>
          ) : <span />}
          {/* Single Close button — everything above already applied + persisted
              live, so there's nothing to Cancel and nothing left to Save.
              Matches Advanced Settings' own footer (ConfigEditorModal). */}
          <button className="btn primary" onClick={closeModal}>Close</button>
        </div>
      </div>
    </div>
  );
}
