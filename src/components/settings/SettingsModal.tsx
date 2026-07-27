// src/components/settings/SettingsModal.tsx
// Appearance + render/movement tuning. A footer button opens the full Config
// Editor (villa coordinates, entity metadata, bindings, 3D model source) as
// a modal over the live villa. Device badge icons are hardcoded, not
// editable here — see babylon/badgeIcons.ts + badgeIconKeys.ts.
//
// There's no HA URL/token here anymore: the kiosk always reaches Home Assistant
// token-less through the add-on's Supervisor proxy, so there's nothing to enter.

import { useState } from "react";
import { Sliders, Sun, Moon, Monitor, SunMoon, Sparkles, Trash2 } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability, type Capability } from "@/auth/permissions";
import { useHA } from "@/ha/HAStateStore";
import { captureScene } from "@/config/scenes";
import { useScenes } from "@/config/ScenesContext";
import { useDraftCommit } from "@/hooks/useDraftCommit";
import { DEFAULT_SITE_TITLE, DEFAULT_RENDER, RENDER_PRESETS, type AppConfig, type RenderConfig, type QualityPreset } from "@/config/AppConfig";
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
  const { haConfig, entities } = useHA();
  const { scenes, setScenes } = useScenes();
  const [sceneName, setSceneName] = useState("");
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

  // Switching presets materialises a whole RenderConfig.
  const applyPreset = (quality: QualityPreset) => {
    applyRender({ ...RENDER_PRESETS[quality] });
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
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
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
            <label>Dashboard title</label>
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
        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

        {/* ── Render quality & look ────────────────────────────────────────
            Simplified to a single quality preset plus a few opt-in extras. The
            preset materialises a full render config; day/night warmth is handled
            automatically in the scene. */}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="settings-section-title" style={{ margin: 0 }}>Render quality &amp; look</div>
          <button
            className="btn ghost"
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => applyPreset(DEFAULT_RENDER.quality)}
            title="Restore the recommended look"
          >
            Reset look
          </button>
        </div>

        <label className="toggle" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={config.highlightInteractive}
            onChange={(e) => update({ highlightInteractive: e.target.checked })} />
          <span>Show blue glow around clickable devices</span>
        </label>

        <label style={{ marginTop: 14 }}>Quality preset</label>
        <select
          value={render.quality ?? DEFAULT_RENDER.quality}
          onChange={(e) => applyPreset(e.target.value as QualityPreset)}
          style={{ width: "100%" }}
        >
          <option value="performance">Performance — lightest, flattest</option>
          <option value="balanced">Balanced — adds contact shadows (AO)</option>
          <option value="high">High — best look (recommended)</option>
        </select>
        {(manager?.renderFx.isBaked() ?? false) && (
          <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
            This villa's model uses baked lighting, so contact shadows are
            already painted into its textures — contact shadows (AO) stay off
            for Balanced and High alike here; High still adds soft sky/ground
            ambient on top.
          </p>
        )}

        {/* Invert day/night moved to the header, next to the theme selector
            (a single active/inactive icon button) — see the .segmented-icons
            block above. */}
        <label style={{ marginTop: 14 }}>Brightness · {render.exposure.toFixed(2)}×</label>
        <input
          type="range" min={0.6} max={2} step={0.05} value={render.exposure}
          onChange={(e) => applyRender({ exposure: Number(e.target.value) })}
        />
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          Overall scene exposure. Raise it if the villa looks a little dark; updates live.
        </p>

        {/* Light effect strength + Night dimming side by side. Light effect
            strength scales a lit fixture's room illumination in BOTH villa
            flavours (2.31.0): the floor "light pool" decal in baked-lighting
            villas (see babylon/LightPools.ts — their unlit structure can't
            be brightened by a real light), and the real dynamic PointLight's
            intensity in non-baked villas (where it silently did nothing
            before). */}
        <div className="slider-pair">
          <div>
            <label>Light effect strength · {render.lightPoolIntensity.toFixed(1)}×</label>
            <input
              type="range" min={0.3} max={2} step={0.1} value={render.lightPoolIntensity}
              onChange={(e) => applyRender({ lightPoolIntensity: Number(e.target.value) })}
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

        <p className="muted body-text" style={{ marginTop: 10, fontSize: 11 }}>
          Badge size — {(config.entityIconScale ?? 1.0).toFixed(2)}× — is set with
          the +/- buttons next to the category filters in the top bar.
        </p>

        <label style={{ marginTop: 16 }}>Floating badge style</label>
        <select
          value={config.badgeStyle ?? "classic"}
          onChange={(e) => update({ badgeStyle: e.target.value as "classic" | "card" })}
          style={{ width: "100%" }}
        >
          <option value="classic">Classic — icon badge with a value pill</option>
          <option value="card">Card — coloured card with icon &amp; value inline</option>
        </select>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          Both show the same information — purely a look preference. The card
          style matches the dashboard layout with the icon and reading side by side.
        </p>

        <label className="toggle" style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={config.showSummaryBar ?? true}
            onChange={(e) => update({ showSummaryBar: e.target.checked })}
          />
          <span>Show the bottom summary bar (scenes, lights, AC, energy…)</span>
        </label>

        {/* ── Scenes ─────────────────────────────────────────────────────────
            One-tap snapshots of the whole villa's controllable state (lights,
            switches, fans, AC, covers, locks). Set the villa how you like it,
            name it, and Save — it then appears in the bottom summary bar to
            re-apply any time. Distinct from Home Assistant's own scenes. */}
        <div className="settings-section-title" style={{ margin: "18px 0 0" }}>Scenes</div>
        <p className="muted body-text" style={{ marginTop: 6, fontSize: 11 }}>
          Save the villa's current state (lights, AC, covers, locks…) as a named
          scene, then re-apply it in one tap from the bottom bar.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            type="text"
            value={sceneName}
            placeholder="New scene name (e.g. Movie night)"
            onChange={(e) => setSceneName(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            className="btn"
            disabled={!sceneName.trim()}
            onClick={() => {
              setScenes([...scenes, captureScene(sceneName, entities)]);
              setSceneName("");
            }}
          >
            <Sparkles size={16} /> Save current
          </button>
        </div>
        {scenes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {scenes.map((scene) => (
              <div
                key={scene.id}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                         gap: 10, padding: "8px 12px", borderRadius: 10, background: "var(--bg-input)" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <Sparkles size={15} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scene.name}</span>
                  <span className="muted" style={{ fontSize: 11 }}>· {scene.calls.length} devices</span>
                </span>
                <button
                  className="icon-btn"
                  style={{ width: 32, height: 32 }}
                  title={`Delete scene "${scene.name}"`}
                  aria-label={`Delete scene ${scene.name}`}
                  onClick={() => setScenes(scenes.filter((s) => s.id !== scene.id))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

        {/* ── Camera & movement ─────────────────────────────────────────────
            The two view modes' comfort settings, side by side: how the
            first-person walk-through feels, and how the bird's-eye view pans. */}
        <div className="settings-section-title" style={{ margin: 0 }}>First-person view</div>
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

        <div className="settings-section-title" style={{ margin: "18px 0 0" }}>Overview (bird&apos;s-eye) view</div>
        <label className="toggle" style={{ marginTop: 10 }}>
          <input
            type="checkbox" checked={config.naturalScrolling ?? true}
            onChange={(e) => update({ naturalScrolling: e.target.checked })}
          />
          <span>Natural scrolling</span>
        </label>

        <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "22px 0" }} />

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
