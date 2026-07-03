// src/components/hud/HUD.tsx
// Top bar layout (three zones):
//   • Left   — villa brand (home icon + name + connection dot) + clock
//   • Center — category filter (which device categories show their state tag)
//   • Right  — Settings, then the first-person / overview view toggle
// A left control column floats below the brand: the vertical floor switch
// (1F / 2F / Rooms), then the display-toggle stack (highlight clickable
// objects, show device state labels).
// Bottom bar: first-person joystick, or (in overview) an (i) button that
// toggles the navigation-tips card (hidden by default to keep the view clean).

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Home, Grid3x3, Settings, Map,
  PersonStanding, Sparkles, Tag, Info, Anchor,
  Armchair, Lightbulb, Wifi, Zap, ShieldCheck, MoreHorizontal,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { resolveSiteTitle } from "@/config/AppConfig";
import { CATEGORY_ORDER, CATEGORY_LABELS } from "@/config/EntityCategories";
import type { Category } from "@/types/scene.types";
import VirtualJoystick from "./VirtualJoystick";

type IconType = ComponentType<{ size?: number | string }>;

// Icons for the category-filter column — each toggles that category's state
// tags on/off on the map. Chosen to read distinctly at a glance since there
// are no text labels, only tooltips (see CATEGORY_LABELS).
const CATEGORY_ICONS: Record<Category, IconType> = {
  comfort: Armchair,
  light: Lightbulb,
  network: Wifi,
  energy: Zap,
  access_control: ShieldCheck,
  others: MoreHorizontal,
};

interface Props {
  currentFloor: number;
  floorsAvailable: number[];
  onSwitchFloor: (floor: number) => void;
  onOpenTeleport: () => void;
  onOpenSettings: () => void;
  onMove: (x: number, y: number) => void;
  viewMode: "first-person" | "overview";
  onToggleViewMode: () => void;
  /** Whether THIS device has a saved default overview framing (button's
   *  pressed/lit state). */
  hasOverviewDefault: boolean;
  /** Tap: jump to this device's saved default view right now. Returns false
   *  (no saved default to jump to) so the caller can show the right hint. */
  onApplyOverviewDefault: () => boolean;
  /** Long-press / right-click: (re)define the default as the overview
   *  camera's current angle/tilt/zoom/pan — reapplied every time the app
   *  lands in overview from now on. */
  onSaveOverviewDefault: () => void;
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function HUD({
  currentFloor, floorsAvailable, onSwitchFloor, onOpenTeleport,
  onOpenSettings, onMove,
  viewMode, onToggleViewMode,
  hasOverviewDefault, onApplyOverviewDefault, onSaveOverviewDefault,
}: Props) {
  const { connection, haConfig } = useHA();
  const { config, update } = useConfig();
  const clock = useClock();
  const title = resolveSiteTitle(config, haConfig?.location_name);
  const floors = [1, 2];
  const [hintOpen, setHintOpen] = useState(false);

  // Tap = jump to this device's saved default view; long-press / right-click
  // = (re)define it as the current framing (same tap-vs-hold convention as
  // the Rooms menu's re-anchor gesture and the in-scene badge gestures). A
  // brief confirmation line replaces the tips text for ~1.8s either way.
  const [viewFlash, setViewFlash] = useState<"applied" | "none" | "saved" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);

  const flashView = (kind: "applied" | "none" | "saved") => {
    setViewFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setViewFlash(null), 1800);
  };
  const cancelViewPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  const onViewBtnDown = () => {
    longFired.current = false;
    cancelViewPress();
    pressTimer.current = setTimeout(() => {
      longFired.current = true;
      onSaveOverviewDefault();
      flashView("saved");
    }, 480);
  };
  const onViewBtnClick = () => {
    cancelViewPress();
    if (longFired.current) { longFired.current = false; return; }
    flashView(onApplyOverviewDefault() ? "applied" : "none");
  };

  useEffect(() => { document.title = title; }, [title]);

  const connClass =
    connection === "connected" ? "online" : connection === "connecting" ? "connecting" : "offline";

  const toggleHighlight = () => update({ highlightInteractive: !config.highlightInteractive });
  const toggleLabels = () => update({ showEntityLabels: !config.showEntityLabels });
  const toggleCategory = (cat: Category) =>
    update({
      hiddenCategories: config.hiddenCategories.includes(cat)
        ? config.hiddenCategories.filter((c) => c !== cat)
        : [...config.hiddenCategories, cat],
    });

  const overviewActive = viewMode === "overview";

  return (
    <>
      <div className="hud-topbar">
        <div className="hud-brand">
          <Home size={22} />
          <span className="hud-title">{title}</span>
          <span
            className={`conn-dot ${connClass}`}
            title={`Connection: ${connection}`}
            role="img"
            aria-label={`Connection: ${connection}`}
          >
            <span className="dot" />
          </span>
          {/* Time sits right next to the villa name + connection dot. */}
          <span className="hud-clock">{clock}</span>
        </div>

        {/* Category filter: which device categories show their state tag on
            the map. Lit = category shown. Icon + tooltip only, no text. */}
        <div className="hud-center">
          <div className="hud-group">
            {CATEGORY_ORDER.map((cat) => {
              const hidden = config.hiddenCategories.includes(cat);
              const Icon = CATEGORY_ICONS[cat];
              return (
                <button
                  key={cat}
                  className={`icon-btn${hidden ? "" : " active"}`}
                  onClick={() => toggleCategory(cat)}
                  title={`${hidden ? "Show" : "Hide"} ${CATEGORY_LABELS[cat]} devices on the map`}
                  aria-label={`${CATEGORY_LABELS[cat]} devices on the map`}
                  aria-pressed={!hidden}
                >
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Settings, then the first-person / overview view toggle beside it. */}
        <div className="hud-right">
          <button className="icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
            <Settings size={20} />
          </button>
          <button
            className={`icon-btn${overviewActive ? " active" : ""}`}
            onClick={onToggleViewMode}
            title={overviewActive ? "Switch to first-person view" : "Switch to overview (bird's-eye) view"}
            aria-label={overviewActive ? "Switch to first-person view" : "Switch to overview (bird's-eye) view"}
          >
            {overviewActive ? <PersonStanding size={19} /> : <Map size={18} />}
          </button>
        </div>
      </div>

      {/* Left control column: floor switch (1F / 2F / Rooms), then the
          display-toggle stack (highlight clickable objects, show labels). */}
      <div className="hud-left-col">
        <div className="floor-switch-v">
          {floors.map((f) => (
            <button
              key={f}
              className={f === currentFloor ? "active" : ""}
              disabled={!floorsAvailable.includes(f)}
              title={floorsAvailable.includes(f) ? `Floor ${f}` : "Coming soon"}
              onClick={() => onSwitchFloor(f)}
            >
              {f}F
            </button>
          ))}
          <button onClick={onOpenTeleport} title="Rooms" aria-label="Rooms">
            <Grid3x3 size={18} />
          </button>
        </div>

        <div className="hud-stack">
          <button
            className={`icon-btn${config.highlightInteractive ? " active" : ""}`}
            onClick={toggleHighlight}
            title="Highlight clickable objects"
            aria-label="Highlight clickable objects"
            aria-pressed={config.highlightInteractive}
          >
            <Sparkles size={18} />
          </button>
          <button
            className={`icon-btn${config.showEntityLabels ? " active" : ""}`}
            onClick={toggleLabels}
            title="Show device state labels"
            aria-label="Show device state labels"
            aria-pressed={config.showEntityLabels}
          >
            <Tag size={18} />
          </button>
        </div>
      </div>

      <div className="bottom-bar">
        {viewMode === "first-person" ? (
          <VirtualJoystick onMove={onMove} />
        ) : (
          <div className="overview-help">
            {viewFlash ? (
              <div className="overview-hint">
                {viewFlash === "applied"
                  ? "Jumped to this device's default view."
                  : viewFlash === "saved"
                    ? "Default view updated for this device — it'll open here every reload."
                    : "No default view saved yet — long-press (or right-click) to set one."}
              </div>
            ) : hintOpen ? (
              <div className="overview-hint">
                Bird's-eye · drag or two-finger slide to pan · pinch/wheel to zoom · Shift+drag to rotate &amp; tilt · tap an object
              </div>
            ) : null}
            <div className="overview-help-buttons">
              <button
                className={`icon-btn${hasOverviewDefault ? " active" : ""}`}
                onPointerDown={onViewBtnDown}
                onPointerUp={cancelViewPress}
                onPointerLeave={cancelViewPress}
                onPointerCancel={cancelViewPress}
                onClick={onViewBtnClick}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSaveOverviewDefault();
                  flashView("saved");
                }}
                title="Tap to go to this device's default view · long-press / right-click to set it to the current view"
                aria-label="Go to this device's default overview view"
                aria-pressed={hasOverviewDefault}
              >
                <Anchor size={18} />
              </button>
              <button
                className={`icon-btn${hintOpen ? " active" : ""}`}
                onClick={() => setHintOpen((o) => !o)}
                title="Navigation tips"
                aria-label="Navigation tips"
                aria-expanded={hintOpen}
              >
                <Info size={20} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
