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
  PersonStanding, Sparkles, Tag, Info, Anchor, LogOut,
  Armchair, Lightbulb, Wifi, Zap, ShieldCheck, Puzzle,
  EllipsisVertical,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { isCategoryAllowed } from "@/auth/permissions";
import { ROLE_LABELS } from "@/auth/roles";
import { resolveSiteTitle } from "@/config/AppConfig";
import { CATEGORY_ORDER, CATEGORY_LABELS } from "@/config/EntityCategories";
import type { Category, TeleportPoint } from "@/types/scene.types";
import VirtualJoystick from "./VirtualJoystick";
import RadialRoomMenu, { type RadialItem } from "./RadialRoomMenu";

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
  // Puzzle (not a dots/lines glyph) — reads as its own distinct shape rather
  // than being confused with the ⋮ overflow-menu button on small screens.
  others: Puzzle,
};

interface Props {
  currentFloor: number;
  floorsAvailable: number[];
  onSwitchFloor: (floor: number) => void;
  onOpenTeleport: () => void;
  /** Long-press marking-menu navigation: jump straight to a room (switches
   *  floor + zooms in), bypassing the full Rooms list. */
  onNavigateRoom: (point: TeleportPoint) => void;
  onOpenSettings: () => void;
  /** RBAC: whether the active profile may open Settings at all. */
  canOpenSettings: boolean;
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
  currentFloor, floorsAvailable, onSwitchFloor, onOpenTeleport, onNavigateRoom,
  onOpenSettings, canOpenSettings, onMove,
  viewMode, onToggleViewMode,
  hasOverviewDefault, onApplyOverviewDefault, onSaveOverviewDefault,
}: Props) {
  const { connection, haConfig } = useHA();
  const { config, update } = useConfig();
  const { role, beginSwitch } = useProfile();
  const clock = useClock();
  const title = resolveSiteTitle(config, haConfig?.location_name);
  const floors = [1, 2];
  const [hintOpen, setHintOpen] = useState(false);

  // ── Rooms button: single tap = full Rooms list (unchanged); long-press =
  // radial marking menu (floors → dwell to expand rooms → release on a room to
  // zoom there). See RadialRoomMenu + the gesture handlers below. ────────────
  const roomsBtnRef = useRef<HTMLButtonElement>(null);
  const [radial, setRadial] = useState<{
    cx: number; cy: number;
    activeFloor: number | null;
    hover: { kind: "floor"; floor: number } | { kind: "room"; name: string } | null;
  } | null>(null);
  const gest = useRef<{
    longTimer: ReturnType<typeof setTimeout> | null; longFired: boolean;
    dwellTimer: ReturnType<typeof setTimeout> | null; dwellFloor: number | null;
  }>({ longTimer: null, longFired: false, dwellTimer: null, dwellFloor: null });

  const availFloors = floors.filter((f) => floorsAvailable.includes(f));

  // Lay floors on an inner arc and (when one is expanded) its rooms on an outer
  // arc, both in the right-hand semicircle beside the button. Pure function of
  // the radial state — used BOTH to render (RadialRoomMenu) and to hit-test the
  // finger, so the two can never disagree.
  const buildRadialItems = (r: NonNullable<typeof radial>): RadialItem[] => {
    const items: RadialItem[] = [];
    const cosd = (d: number) => Math.cos((d * Math.PI) / 180);
    const sind = (d: number) => Math.sin((d * Math.PI) / 180);
    const arc = (i: number, n: number, a0: number, a1: number) =>
      n <= 1 ? (a0 + a1) / 2 : a0 + (a1 - a0) * (i / (n - 1));
    availFloors.forEach((f, i) => {
      const a = arc(i, availFloors.length, -46, 46);
      items.push({
        key: `f${f}`, label: `${f}F`, kind: "floor",
        x: r.cx + 86 * cosd(a), y: r.cy + 86 * sind(a),
        active: r.activeFloor === f || (r.hover?.kind === "floor" && r.hover.floor === f),
      });
    });
    if (r.activeFloor != null) {
      const rooms = config.teleportPoints.filter((p) => (p.floor ?? 1) === r.activeFloor);
      rooms.forEach((p, i) => {
        const a = arc(i, rooms.length, -88, 88);
        items.push({
          key: `r${p.name}`, label: p.name, kind: "room",
          x: r.cx + 168 * cosd(a), y: r.cy + 168 * sind(a),
          active: r.hover?.kind === "room" && r.hover.name === p.name,
        });
      });
    }
    return items;
  };

  const clearRadialTimers = () => {
    if (gest.current.longTimer) { clearTimeout(gest.current.longTimer); gest.current.longTimer = null; }
    if (gest.current.dwellTimer) { clearTimeout(gest.current.dwellTimer); gest.current.dwellTimer = null; }
  };
  const closeRadial = () => { clearRadialTimers(); gest.current.dwellFloor = null; setRadial(null); };

  // Nearest chip to the finger within a comfortable hit radius, computed from
  // the CURRENT radial state (so it matches exactly what's on screen).
  const hitTest = (r: typeof radial, px: number, py: number): RadialItem | null => {
    if (!r) return null;
    let best: RadialItem | null = null;
    let bestD = 48;
    for (const it of buildRadialItems(r)) {
      const d = Math.hypot(px - it.x, py - it.y);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  };

  const onRoomsPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    gest.current.longFired = false;
    try { roomsBtnRef.current?.setPointerCapture(e.pointerId); } catch { /* older WebView */ }
    clearRadialTimers();
    gest.current.longTimer = setTimeout(() => {
      gest.current.longFired = true;
      const b = roomsBtnRef.current?.getBoundingClientRect();
      if (!b) return;
      setRadial({ cx: b.right + 6, cy: b.top + b.height / 2, activeFloor: null, hover: null });
    }, 350);
  };

  const onRoomsPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!gest.current.longFired || !radial) return;
    const hit = hitTest(radial, e.clientX, e.clientY);
    const hover = !hit ? null
      : hit.kind === "floor"
        ? { kind: "floor" as const, floor: Number(hit.key.slice(1)) }
        : { kind: "room" as const, name: hit.label };
    // Dwell on a floor → expand its rooms after a short beat.
    if (hover?.kind === "floor") {
      if (gest.current.dwellFloor !== hover.floor) {
        gest.current.dwellFloor = hover.floor;
        if (gest.current.dwellTimer) clearTimeout(gest.current.dwellTimer);
        const floor = hover.floor;
        gest.current.dwellTimer = setTimeout(
          () => setRadial((p) => (p ? { ...p, activeFloor: floor } : p)), 280);
      }
    } else {
      gest.current.dwellFloor = null;
      if (gest.current.dwellTimer) { clearTimeout(gest.current.dwellTimer); gest.current.dwellTimer = null; }
    }
    setRadial((p) => (p ? { ...p, hover } : p));
  };

  const onRoomsPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    clearRadialTimers();
    try { roomsBtnRef.current?.releasePointerCapture(e.pointerId); } catch { /* */ }
    if (gest.current.longFired) {
      const hit = hitTest(radial, e.clientX, e.clientY); // release over a room → go there
      if (hit?.kind === "room") {
        const point = config.teleportPoints.find((p) => p.name === hit.label);
        if (point) onNavigateRoom(point);
      }
      closeRadial();
    } else {
      onOpenTeleport(); // quick tap → the full Rooms list, exactly as before
    }
  };

  const onRoomsPointerCancel = () => { if (gest.current.longFired) closeRadial(); };

  const radialItems = radial ? buildRadialItems(radial) : [];
  // Only the categories this profile may see get a filter button; the scene
  // enforces the same set (see filterConfigForRole), so the HUD never offers
  // a toggle that could reveal a denied category.
  const visibleCategories = role
    ? CATEGORY_ORDER.filter((c) => isCategoryAllowed(role, c))
    : CATEGORY_ORDER;

  // The category pill scrolls horizontally when its (variable) button count
  // exceeds the width its grid track got. CSS can't know whether the row
  // actually overflows, so the edge-fade "more buttons this way" hints are
  // toggled here from real scroll metrics — re-measured on scroll, on any
  // resize/rotation (ResizeObserver) and when the category set changes.
  const catRowRef = useRef<HTMLDivElement | null>(null);
  const [catFade, setCatFade] = useState({ left: false, right: false });
  useEffect(() => {
    const el = catRowRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const left = max > 1 && el.scrollLeft > 1;
      const right = max > 1 && el.scrollLeft < max - 1;
      setCatFade((p) => (p.left === left && p.right === right ? p : { left, right }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro.disconnect(); };
  }, [visibleCategories.length]);

  // On narrow screens the right-side controls (view mode, Settings, switch
  // profile) collapse into ONE overflow button with a dropdown — CSS decides
  // which of the two renderings is visible (same breakpoint as the rest of
  // the compact bar), this state only drives the dropdown. Closes on outside
  // tap and Escape, and after any action is chosen.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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
      {/* Long-press room dial overlay (pointer-events:none — the Rooms button's
          captured pointer drives selection; this just paints the chips). */}
      <RadialRoomMenu items={radialItems} />

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
          <div
            ref={catRowRef}
            className={`hud-group hud-group-scroll${catFade.left ? " fade-left" : ""}${catFade.right ? " fade-right" : ""}`}
            role="toolbar"
            aria-label="Device category filters"
          >
            {visibleCategories.map((cat) => {
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

        {/* Profile chip, Settings (when permitted), then the view toggle.
            Rendered twice: inline on roomy screens, collapsed into a single
            overflow-menu button on phones (CSS shows exactly one of the two). */}
        <div className="hud-right">
          <div className="hud-right-inline">
            {role && (
              <span className="hud-profile" title={`Signed in as ${ROLE_LABELS[role]}`}>
                <span className="hud-profile-name">{ROLE_LABELS[role]}</span>
                <button
                  className="icon-btn"
                  onClick={beginSwitch}
                  title="Switch profile"
                  aria-label={`Signed in as ${ROLE_LABELS[role]} — switch profile`}
                >
                  <LogOut size={16} />
                </button>
              </span>
            )}
            {canOpenSettings && (
              <button className="icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
                <Settings size={20} />
              </button>
            )}
            <button
              className={`icon-btn${overviewActive ? " active" : ""}`}
              onClick={onToggleViewMode}
              title={overviewActive ? "Switch to first-person view" : "Switch to overview (bird's-eye) view"}
              aria-label={overviewActive ? "Switch to first-person view" : "Switch to overview (bird's-eye) view"}
            >
              {overviewActive ? <PersonStanding size={19} /> : <Map size={18} />}
            </button>
          </div>

          <div className="hud-overflow" ref={menuRef}>
            <button
              className={`icon-btn${menuOpen ? " active" : ""}`}
              onClick={() => setMenuOpen((o) => !o)}
              title="Menu"
              aria-label="Menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <EllipsisVertical size={19} />
            </button>
            {menuOpen && (
              <div className="hud-menu" role="menu" aria-label="View, settings and profile">
                {role && <div className="hud-menu-header">Signed in as {ROLE_LABELS[role]}</div>}
                <button
                  role="menuitem"
                  className="hud-menu-item"
                  onClick={() => { setMenuOpen(false); onToggleViewMode(); }}
                >
                  {overviewActive ? <PersonStanding size={18} /> : <Map size={18} />}
                  <span>{overviewActive ? "First-person view" : "Overview view"}</span>
                </button>
                {canOpenSettings && (
                  <button
                    role="menuitem"
                    className="hud-menu-item"
                    onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                  >
                    <Settings size={18} />
                    <span>Settings</span>
                  </button>
                )}
                {role && (
                  <button
                    role="menuitem"
                    className="hud-menu-item"
                    onClick={() => { setMenuOpen(false); beginSwitch(); }}
                  >
                    <LogOut size={18} />
                    <span>Switch profile</span>
                  </button>
                )}
              </div>
            )}
          </div>
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
          <button
            ref={roomsBtnRef}
            title="Rooms — tap for the list, long-press for the quick room dial"
            aria-label="Rooms"
            style={{ touchAction: "none" }}
            onPointerDown={onRoomsPointerDown}
            onPointerMove={onRoomsPointerMove}
            onPointerUp={onRoomsPointerUp}
            onPointerCancel={onRoomsPointerCancel}
            onContextMenu={(e) => e.preventDefault()}
          >
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
