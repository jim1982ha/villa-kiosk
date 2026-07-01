// src/components/hud/HUD.tsx
// Top bar layout (three zones):
//   • Left   — villa brand (home icon + name + connection dot) + clock
//   • Center — display + build action buttons, grouped into icon-only sections
//   • Right  — All Clear badge + Settings button (pinned far right)
// A left control column floats below the brand: the vertical floor switch
// (1F / 2F) then a single stacked block with Overview and Rooms.
// Bottom bar: first-person joystick, or (in overview) an (i) button that
// toggles the navigation-tips card (hidden by default to keep the view clean).

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Home, Grid3x3, Settings, Link2, MapPin, Map,
  PersonStanding, Sparkles, Tag, Eye, Wrench, Info,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { resolveSiteTitle } from "@/config/AppConfig";
import VirtualJoystick from "./VirtualJoystick";
import AlertBadge from "./AlertBadge";

interface Props {
  currentFloor: number;
  floorsAvailable: number[];
  onSwitchFloor: (floor: number) => void;
  onOpenTeleport: () => void;
  onOpenSettings: () => void;
  onEnterBindMode: () => void;
  onEnterPlaceMode: () => void;
  onMove: (x: number, y: number) => void;
  viewMode: "first-person" | "overview";
  onToggleViewMode: () => void;
}

type IconType = ComponentType<{ size?: number | string }>;

interface MenuItem {
  icon: IconType;
  label: string;
  onClick: () => void;
  active?: boolean; // present → rendered as a toggle (with a check), menu stays open
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Matches the same breakpoint the stylesheet uses to switch to the phone layout. */
function useIsMobile(): boolean {
  const query = "(max-width: 640px), (max-height: 560px)";
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setM(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return m;
}

/** A single icon button that opens a dropdown of items (used on mobile). */
function HudMenu({ icon: Icon, title, items }: { icon: IconType; title: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className="hud-menu" ref={ref}>
      <button
        className={`icon-btn${open ? " active" : ""}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon size={18} />
      </button>
      {open && (
        <div className="hud-menu-panel" role="menu">
          {items.map((it) => {
            const isToggle = it.active !== undefined;
            return (
              <button
                key={it.label}
                role="menuitem"
                className={`hud-menu-item${it.active ? " active" : ""}`}
                onClick={() => {
                  it.onClick();
                  if (!isToggle) setOpen(false); // toggles stay open so you can flip both
                }}
              >
                <it.icon size={17} />
                <span>{it.label}</span>
                {isToggle && <span className="hud-menu-check">{it.active ? "✓" : ""}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HUD({
  currentFloor, floorsAvailable, onSwitchFloor, onOpenTeleport,
  onOpenSettings, onEnterBindMode, onEnterPlaceMode, onMove,
  viewMode, onToggleViewMode,
}: Props) {
  const { connection, haConfig } = useHA();
  const { config, update } = useConfig();
  const clock = useClock();
  const isMobile = useIsMobile();
  const title = resolveSiteTitle(config, haConfig?.location_name);
  const floors = [1, 2];
  const [hintOpen, setHintOpen] = useState(false);

  useEffect(() => { document.title = title; }, [title]);

  const connClass =
    connection === "connected" ? "online" : connection === "connecting" ? "connecting" : "offline";

  // Shared item definitions so desktop pills and mobile dropdowns stay in sync.
  const toggleHighlight = () => update({ highlightInteractive: !config.highlightInteractive });
  const toggleLabels = () => update({ showEntityLabels: !config.showEntityLabels });

  const displayItems: MenuItem[] = [
    { icon: Sparkles, label: "Highlight clickable objects", onClick: toggleHighlight, active: config.highlightInteractive },
    { icon: Tag, label: "Show device state labels", onClick: toggleLabels, active: config.showEntityLabels },
  ];
  const buildItems: MenuItem[] = [
    { icon: Link2, label: "Bind 3D object to entity", onClick: onEnterBindMode },
    { icon: MapPin, label: "Drop control marker", onClick: onEnterPlaceMode },
  ];

  const overviewActive = viewMode === "overview";

  return (
    <>
      <div className="hud-topbar">
        <div className="hud-brand">
          <Home size={22} />
          <span className="hud-title">{title}</span>
          <span className={`conn-dot ${connClass}`} title={`Connection: ${connection}`}>
            <span className="dot" />
          </span>
          {/* Time sits right next to the villa name + connection dot. */}
          <span className="hud-clock">{clock}</span>
        </div>

        <div className="hud-center">
          {isMobile ? (
            <>
              <HudMenu icon={Eye} title="Display" items={displayItems} />
              <HudMenu icon={Wrench} title="Build" items={buildItems} />
            </>
          ) : (
            <>
              {/* Display toggles (lit when on) */}
              <div className="hud-group">
                <button
                  className={`icon-btn${config.highlightInteractive ? " active" : ""}`}
                  onClick={toggleHighlight}
                  title="Highlight clickable objects"
                >
                  <Sparkles size={18} />
                </button>
                <button
                  className={`icon-btn${config.showEntityLabels ? " active" : ""}`}
                  onClick={toggleLabels}
                  title="Show device state labels"
                >
                  <Tag size={18} />
                </button>
              </div>

              {/* Build */}
              <div className="hud-group">
                <button className="icon-btn" onClick={onEnterBindMode} title="Bind 3D object to entity">
                  <Link2 size={18} />
                </button>
                <button className="icon-btn" onClick={onEnterPlaceMode} title="Drop control marker">
                  <MapPin size={18} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* All Clear badge, then Settings pinned to the far right. */}
        <div className="hud-right">
          <AlertBadge />
          <button className="icon-btn" onClick={onOpenSettings} title="Settings">
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Left control column: floor switch, then the Overview + Rooms stack. */}
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
        </div>

        <div className="hud-stack">
          <button
            className={`icon-btn${overviewActive ? " active" : ""}`}
            onClick={onToggleViewMode}
            title={overviewActive ? "Switch to first-person view" : "Switch to overview (bird's-eye) view"}
          >
            {overviewActive ? <PersonStanding size={19} /> : <Map size={18} />}
          </button>
          <button className="icon-btn" onClick={onOpenTeleport} title="Rooms">
            <Grid3x3 size={18} />
          </button>
        </div>
      </div>

      <div className="bottom-bar">
        {viewMode === "first-person" ? (
          <VirtualJoystick onMove={onMove} />
        ) : (
          <div className="overview-help">
            {hintOpen && (
              <div className="overview-hint">
                Bird's-eye · drag or two-finger slide to pan · pinch/wheel to zoom · Shift+drag to rotate &amp; tilt · tap an object
              </div>
            )}
            <button
              className={`icon-btn${hintOpen ? " active" : ""}`}
              onClick={() => setHintOpen((o) => !o)}
              title="Navigation tips"
              aria-expanded={hintOpen}
            >
              <Info size={20} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
