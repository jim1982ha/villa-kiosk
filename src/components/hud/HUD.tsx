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
  Home, Compass, Settings, Map,
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
  /** Rooms-dial navigation: jump straight to a room (switches floor + zooms in),
   *  bypassing the full Rooms list. */
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

  // ── Rooms dial: SINGLE TAP opens the radial floor/room quick-nav (a tapped
  // popup, not a hold-and-slide); LONG-PRESS opens the full Rooms list for
  // creating / editing rooms. Inside the radial: tap a floor to switch to it +
  // reveal its rooms, tap a room to zoom there, tap outside to dismiss. See
  // RadialRoomMenu. ───────────────────────────────────────────────────────────
  type RadialState = { cx: number; cy: number; activeFloor: number | null };
  const roomsBtnRef = useRef<HTMLButtonElement>(null);
  const [radial, setRadial] = useState<RadialState | null>(null);
  const roomsLongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomsLongFired = useRef(false);
  // Ignore the backdrop click that belongs to the very tap that opened the dial
  // (that tap's synthesised click lands on the freshly-shown backdrop).
  const justOpened = useRef(false);

  const availFloors = floors.filter((f) => floorsAvailable.includes(f));
  const FLOOR_R = 78;    // inner arc radius (floors)
  const ROOM_R = 228;    // outer arc radius (rooms) — roomy so labels don't stack

  const buildRadialItems = (r: RadialState): RadialItem[] => {
    const items: RadialItem[] = [];
    const cosd = (d: number) => Math.cos((d * Math.PI) / 180);
    const sind = (d: number) => Math.sin((d * Math.PI) / 180);
    const arc = (i: number, n: number, half: number) =>
      n <= 1 ? 0 : -half + (2 * half) * (i / (n - 1));
    // Floors: a tight fan so 1F / 2F sit close together.
    availFloors.forEach((f, i) => {
      const a = arc(i, availFloors.length, 22);
      items.push({
        key: `f${f}`, label: `${f}F`, kind: "floor",
        x: r.cx + FLOOR_R * cosd(a), y: r.cy + FLOOR_R * sind(a),
        active: r.activeFloor === f,
      });
    });
    if (r.activeFloor != null) {
      const rooms = config.teleportPoints.filter((p) => (p.floor ?? 1) === r.activeFloor);
      // Spread rooms across a near-full right semicircle; a big radius keeps
      // even a long room list from stacking on top of each other.
      const half = rooms.length <= 1 ? 0 : Math.min(86, ((rooms.length - 1) * 12) / 2);
      rooms.forEach((p, i) => {
        const a = arc(i, rooms.length, half);
        items.push({
          key: `r${p.name}`, label: p.name, kind: "room",
          x: r.cx + ROOM_R * cosd(a), y: r.cy + ROOM_R * sind(a), active: false,
        });
      });
    }
    return items;
  };

  const closeRadial = () => setRadial(null);
  const openRadial = () => {
    const b = roomsBtnRef.current?.getBoundingClientRect();
    if (!b) return;
    const cx = b.right + 16;
    // Clamp the centre so the tall outer arc always fits (never clipped top/bottom).
    const margin = ROOM_R + 40;
    const cy = Math.max(
      Math.min(margin, window.innerHeight / 2),
      Math.min(b.top + b.height / 2, window.innerHeight - margin),
    );
    justOpened.current = true;
    setTimeout(() => { justOpened.current = false; }, 320);
    // Open pre-expanded on the floor you're currently on, so a room is one tap away.
    setRadial({ cx, cy, activeFloor: currentFloor ?? availFloors[0] ?? null });
  };

  const onRoomsPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    roomsLongFired.current = false;
    if (roomsLongTimer.current) clearTimeout(roomsLongTimer.current);
    roomsLongTimer.current = setTimeout(() => {
      roomsLongFired.current = true;
      closeRadial();          // if the dial was open, drop it
      onOpenTeleport();       // long-press → full Rooms list (create / edit)
    }, 450);
  };
  const onRoomsPointerUp = () => {
    if (roomsLongTimer.current) { clearTimeout(roomsLongTimer.current); roomsLongTimer.current = null; }
    if (roomsLongFired.current) return;   // the long-press already opened the full list
    if (radial) closeRadial(); else openRadial(); // tap toggles the dial
  };

  const onRadialPick = (it: RadialItem) => {
    if (it.kind === "floor") {
      const f = Number(it.key.slice(1));
      onSwitchFloor(f);                                   // tap a floor → switch to it …
      setRadial((r) => (r ? { ...r, activeFloor: f } : r)); // … and reveal its rooms
    } else {
      const point = config.teleportPoints.find((p) => p.name === it.label);
      if (point) onNavigateRoom(point);                   // tap a room → zoom there
      closeRadial();
    }
  };
  const onRadialBackdrop = () => {
    if (justOpened.current) return; // swallow the opening tap's stray click
    closeRadial();
  };

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
      <RadialRoomMenu
        items={radialItems}
        open={!!radial}
        onPick={onRadialPick}
        onBackdrop={onRadialBackdrop}
      />

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

      {/* Rooms dial — vertically centred on the left edge so its long-press
          radial fans out symmetrically over the whole height. Tap = full Rooms
          list; long-press = floor→room quick nav (also the floor switcher, so
          the old 1F/2F buttons were removed). */}
      <button
        ref={roomsBtnRef}
        className={`icon-btn rooms-dial-btn${radial ? " active" : ""}`}
        title="Rooms — tap for the quick floor/room dial, long-press to add/edit rooms"
        aria-label="Rooms"
        style={{ touchAction: "none" }}
        onPointerDown={onRoomsPointerDown}
        onPointerUp={onRoomsPointerUp}
        onPointerCancel={() => { if (roomsLongTimer.current) clearTimeout(roomsLongTimer.current); }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Compass size={20} />
      </button>

      {/* Left display-toggle stack (highlight clickable objects, show labels). */}
      <div className="hud-left-col">
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
