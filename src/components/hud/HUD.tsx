// src/components/hud/HUD.tsx
// Top bar layout (three zones):
//   • Left   — villa brand (home icon + name + connection dot) + clock; on a
//              phone this is hidden entirely (connection status moves into
//              the right-side overflow menu instead — see hud-overflow) so
//              the category row keeps its width
//   • Center — category filter, then a label-size stepper (+/-)
//   • Right  — Settings only
// A left control column floats below the brand: the vertical floor toggle
// (1F / 2F) + the Rooms dial button. (Device state labels are always shown;
// "Highlight clickable objects" moved to Settings.)
// Bottom bar: bottom-left always shows the first-person/bird's-eye view
// toggle, with the view-default (Anchor) button right below it while in
// overview; bottom-right shows the first-person movement joystick.

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Home, Compass, Settings, LogOut,
  Armchair, Lightbulb, Wifi, Zap, ShieldCheck, Puzzle,
  EllipsisVertical, Minus, Plus, CircleHelp, TriangleAlert, ClipboardList,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { isCategoryAllowed, hasCapability } from "@/auth/permissions";
import { ROLE_LABELS } from "@/auth/roles";
import { resolveSiteTitle } from "@/config/AppConfig";
import { CATEGORY_ORDER, CATEGORY_LABELS, categoryGradient } from "@/config/EntityCategories";
import { isUnavailable } from "@/utils/stateColors";
import { suggestDeviceGroups } from "@/config/deviceGroups";
import type { Category, TeleportPoint } from "@/types/scene.types";
import VirtualJoystick from "./VirtualJoystick";
import ViewControls from "./ViewControls";
import RadialRoomMenu, { type RadialItem } from "./RadialRoomMenu";
import LegendModal from "./LegendModal";
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import { useFmData } from "@/fm/FmDataContext";
import { scheduleBoard } from "@/fm/fmEngine";

type IconType = ComponentType<{ size?: number | string }>;

// Label-size stepper (next to the category filter): each click moves
// entityIconScale by this much, clamped to [0, LABEL_SCALE_MAX]. 0 = badges
// hidden entirely (scale-to-zero, see EntityVisuals.applyIconScale).
const LABEL_SCALE_STEP = 0.25;
const LABEL_SCALE_MAX = 3;

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
  /** Rooms-dial floor pick: switch to that floor AND frame its whole bird's-eye
   *  view (saved default), not just toggle visibility. */
  onShowFloor: (floor: number) => void;
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
  /** Entities with real geometry in the loaded model (see
   *  manager.mappedEntityIds) — same set SummaryBar uses, for the
   *  unavailable-devices list's "not on the map" section. */
  mappedEntityIds: Set<string>;
  /** Drill into an entity's full panel from the unavailable-devices list —
   *  wired to Dashboard's setActivePanel, same callback SummaryBar uses. */
  onOpenEntity: (entityId: string) => void;
  /** Open the Facility Manager workspace. Undefined when the profile lacks
   *  `manageFacility` — the button is then not rendered at all. */
  onOpenFacility?: () => void;
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
  currentFloor, floorsAvailable, onShowFloor, onOpenTeleport, onNavigateRoom,
  onOpenSettings, canOpenSettings, onMove,
  viewMode, onToggleViewMode,
  hasOverviewDefault, onApplyOverviewDefault, onSaveOverviewDefault,
  mappedEntityIds, onOpenEntity, onOpenFacility,
}: Props) {
  const { connection, haConfig, entities } = useHA();
  const { config, update } = useConfig();
  const { role, beginSwitch } = useProfile();
  const clock = useClock();
  const title = resolveSiteTitle(config, haConfig?.location_name);
  const floors = [1, 2];

  // Every DEVICE HA currently reports as unavailable/unknown/never-reported —
  // "device", not "entity": see the two folds below.
  const unavailableIds = useMemo(() => {
    // Candidate set is the UNION of config.entityMap's keys and mappedEntityIds
    // (every entity that resolved to real geometry on the map — see
    // manager.mappedEntityIds), not entityMap alone. A mesh literally NAMED
    // after its entity_id resolves to a working badge/panel via
    // resolveMeshToMapping's name-inference fallback WITHOUT ever getting a
    // saved entityMap entry — exactly the case of a device that no longer
    // exists in Home Assistant at all: there was never an edit to create that
    // entry. entityMap alone would silently miss it despite it being visibly
    // "in error" on the map right now.
    const candidates = new Set([...mappedEntityIds, ...Object.keys(config.entityMap)]);

    // Fold multi-entity physical devices down to ONE representative id, so
    // the count/list reflects DEVICES, not raw HA entities (e.g. one
    // combo sensor's separate _temperature/_humidity entities counting as
    // two). Two sources of "these are the same device": entities the owner
    // has explicitly grouped (config.deviceGroups), and same-device sensor
    // pairs the app can already recognise on its own by name pattern (see
    // suggestDeviceGroups) but that haven't been formally grouped yet — for
    // a diagnostic "what's broken" glance, requiring that manual step first
    // would just make the count look wrong for no good reason.
    const repOf = new Map<string, string>();
    for (const g of config.deviceGroups) {
      for (const memberId of g.memberEntityIds) repOf.set(memberId, g.primaryEntityId);
    }
    for (const s of suggestDeviceGroups(config.entityMap, config.deviceGroups)) {
      if (!repOf.has(s.memberEntityId)) repOf.set(s.memberEntityId, s.primaryEntityId);
    }

    // isUnavailable treats a missing live entity the same as a reported
    // unavailable/unknown state — same convention the map badges and status
    // pills already use. A disabled device is hidden everywhere else in the
    // app, so it's excluded here too.
    const reps = new Set<string>();
    for (const id of candidates) {
      if (config.entityMap[id]?.disabled) continue;
      // Ignore CONFIG DEBRIS: an entityMap entry that HA has never heard of
      // AND that has no geometry on the map is not a device in error, it's a
      // leftover key from a renamed entity or an older model — counting those
      // buried the handful of genuinely-broken devices under a pile of noise
      // (the reported "30" when only a few were actually wrong). A phantom
      // that IS on the map stays: that's a device you can see, faded, right
      // now, and is exactly the case this button has to report.
      if (!mappedEntityIds.has(id) && !entities[id]) continue;
      if (!isUnavailable(entities[id])) continue;
      reps.add(repOf.get(id) ?? id);
    }
    return [...reps];
  }, [config.entityMap, config.deviceGroups, mappedEntityIds, entities]);
  const [unavailableOpen, setUnavailableOpen] = useState(false);

  // Facility attention count: overdue/never-recorded maintenance plus unresolved
  // faults. Surfaced ON the button because the whole point of a schedule is
  // that you find out you're late WITHOUT having to go looking — an operator
  // who must open a modal to discover overdue work will discover it late.
  const { data: fmData } = useFmData();
  const facilityAttention = useMemo(() => {
    const lateTasks = scheduleBoard(fmData).filter(
      (s) => s.state === "overdue" || s.state === "never").length;
    const openFaults = fmData.tickets.filter((t) => t.status !== "resolved").length;
    return lateTasks + openFaults;
  }, [fmData]);
  const canControlAny = role != null && hasCapability(role, "controlEntities");

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

  // Keyboard equivalent of the two gestures above — this button previously had
  // ONLY pointer handlers, so Tab+Enter/Space did nothing at all (native button
  // keyboard activation dispatches a click, not pointer events, so onPointerDown/
  // onPointerUp never fired). Holding Enter/Space now mirrors a touch hold;
  // preventDefault on keydown suppresses the browser's own click-on-activation
  // so it can't ALSO fire and double-toggle the dial.
  const onRoomsKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (e.repeat) return; // ignore OS key-repeat while held, same as a still finger
    roomsLongFired.current = false;
    if (roomsLongTimer.current) clearTimeout(roomsLongTimer.current);
    roomsLongTimer.current = setTimeout(() => {
      roomsLongFired.current = true;
      closeRadial();
      onOpenTeleport();
    }, 450);
  };
  const onRoomsKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    onRoomsPointerUp();
  };

  const onRadialPick = (it: RadialItem) => {
    if (it.kind === "floor") {
      const f = Number(it.key.slice(1));
      onShowFloor(f);                                     // tap a floor → switch to it + frame its whole view …
      setRadial((r) => (r ? { ...r, activeFloor: f } : r)); // … and reveal its rooms
    } else {
      const point = config.teleportPoints.find((p) => p.name === it.label);
      if (point) onNavigateRoom(point);                   // tap a room → zoom there
      closeRadial();
    }
  };
  const onRadialBackdrop = () => {
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
  const [legendOpen, setLegendOpen] = useState(false);
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

  // The view toggle + default-view anchor (and their tap-vs-hold gesture) live
  // in <ViewControls>, rendered either here or inside the SummaryBar.

  useEffect(() => { document.title = title; }, [title]);

  const connClass =
    connection === "connected" ? "online" : connection === "connecting" ? "connecting" : "offline";

  const toggleCategory = (cat: Category) =>
    update({
      hiddenCategories: config.hiddenCategories.includes(cat)
        ? config.hiddenCategories.filter((c) => c !== cat)
        : [...config.hiddenCategories, cat],
    });

  const labelScale = config.entityIconScale ?? 1;
  const stepLabelScale = (delta: number) => {
    const next = Math.min(LABEL_SCALE_MAX, Math.max(0, Math.round((labelScale + delta) * 4) / 4));
    update({ entityIconScale: next });
  };


  return (
    <>
      {/* Rooms dial overlay — tappable chips + a dismiss backdrop (pointerdown
          driven; see RadialRoomMenu). */}
      <RadialRoomMenu
        items={radialItems}
        open={!!radial}
        onPick={onRadialPick}
        onBackdrop={onRadialBackdrop}
      />

      <div className="hud-topbar">
        {/* Hidden entirely on a phone (see .hud-brand mobile rule) — its
            connection status moves into the right-side overflow menu below
            instead of keeping any standalone button/space in the top bar. */}
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
                  // Lit in the SAME gradient as this category's badges on the
                  // map (see config/EntityCategories.categoryGradient), so the
                  // filter row doubles as a colour legend.
                  style={hidden ? undefined : {
                    background: categoryGradient(cat),
                    color: "#ffffff",
                  }}
                  onClick={() => toggleCategory(cat)}
                  title={`${hidden ? "Show" : "Hide"} ${CATEGORY_LABELS[cat]} devices on the map`}
                  aria-label={`${CATEGORY_LABELS[cat]} devices on the map`}
                  aria-pressed={!hidden}
                >
                  <Icon size={18} />
                </button>
              );
            })}
            {/* Unavailable devices — placed BEFORE the colour-legend help (and,
                unlike it, never collapsed into the mobile overflow menu: an
                error indicator earns a persistent, glanceable spot even on a
                phone, where CircleHelp is a rarely-needed reference). Always
                rendered, not only when count > 0, so its position is stable —
                a button that appears/disappears is easy to miss the one time
                it matters. Quiet (plain icon-btn) at zero; a red count badge
                takes over the instant something goes offline. */}
            <span className="hud-cat-sep" aria-hidden="true" />
            <button
              className={`icon-btn${unavailableIds.length > 0 ? " has-alert" : ""}`}
              onClick={() => setUnavailableOpen(true)}
              title={unavailableIds.length > 0
                ? `${unavailableIds.length} device${unavailableIds.length === 1 ? "" : "s"} unavailable`
                : "No unavailable devices"}
              aria-label="Show unavailable devices"
            >
              <TriangleAlert size={18} />
              {unavailableIds.length > 0 && (
                <span className="icon-btn-count" aria-hidden="true">
                  {unavailableIds.length > 99 ? "99+" : unavailableIds.length}
                </span>
              )}
            </button>
            {/* Facility workspace — maintenance, readiness, faults, spend.
                Sits beside the unavailable-devices alert because they are the
                same job: both answer "what needs me". Only rendered for a
                profile holding manageFacility. */}
            {onOpenFacility && (
              <button
                className={`icon-btn${facilityAttention > 0 ? " has-alert" : ""}`}
                onClick={onOpenFacility}
                title={facilityAttention > 0
                  ? `${facilityAttention} maintenance item${facilityAttention === 1 ? "" : "s"} need attention`
                  : "Facility — maintenance, readiness, faults"}
                aria-label="Open the facility workspace"
              >
                <ClipboardList size={18} />
                {facilityAttention > 0 && (
                  <span className="icon-btn-count" aria-hidden="true">
                    {facilityAttention > 99 ? "99+" : facilityAttention}
                  </span>
                )}
              </button>
            )}
            {/* The colour-legend (?) lives INSIDE the category row — it explains
                exactly these colours, so it belongs with them — fenced off by a
                separator. Roomy screens only: on a phone it stays in the
                overflow menu (see .hud-cat-help's media query), which is where
                the whole right-hand cluster collapses to. */}
            <span className="hud-cat-sep hud-cat-help" aria-hidden="true" />
            <button
              className="icon-btn hud-cat-help"
              onClick={() => setLegendOpen(true)}
              title="What do these colours mean?"
              aria-label="Map colour legend"
            >
              <CircleHelp size={18} />
            </button>
          </div>

          {/* Label size: steps the in-scene badge scale by 0.25 per click,
              down to 0 (hidden). Replaces the old Settings slider. Hidden on
              a phone (.hud-labelsize-btn, same breakpoint as .hud-cat-help) —
              a scrollable category row plus this pill was more than a narrow
              screen can show without scrolling to reach it; the SAME control
              lives in the overflow dropdown below instead, always reachable
              with no scroll. */}
          <div className="hud-group" role="toolbar" aria-label="Label size">
            <button
              className="icon-btn hud-labelsize-btn"
              onClick={() => stepLabelScale(-LABEL_SCALE_STEP)}
              disabled={labelScale <= 0}
              title="Decrease label size"
              aria-label="Decrease label size"
            >
              <Minus size={18} />
            </button>
            <button
              className="icon-btn hud-labelsize-btn"
              onClick={() => stepLabelScale(LABEL_SCALE_STEP)}
              disabled={labelScale >= LABEL_SCALE_MAX}
              title="Increase label size"
              aria-label="Increase label size"
            >
              <Plus size={18} />
            </button>

            {/* Overflow menu (phones only — see .hud-overflow's default
                display:none/mobile display:block): nested INSIDE this same
                pill as Minus/Plus rather than off in its own .hud-right
                section, so on a phone it reads as one continuous group of
                buttons instead of a visually mismatched standalone button.
                aria-haspopup/expanded + the outside-click ref stay on this
                specific button/wrapper regardless of where it sits in the
                layout. */}
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
                <div className="hud-menu" role="menu" aria-label="Settings and profile">
                  {/* Connection status — lives ONLY here on a phone (no standalone
                      top-bar button/space; see .hud-brand's mobile rule) — as a
                      bare icon (no "Connection: " text) sharing the profile
                      line, not its own row. */}
                  <div className="hud-menu-header">
                    {role && <span>Signed in as {ROLE_LABELS[role]}</span>}
                    <span
                      className={`conn-dot ${connClass}`}
                      title={`Connection: ${connection}`}
                      role="img"
                      aria-label={`Connection: ${connection}`}
                    >
                      <span className="dot" />
                    </span>
                  </div>
                  {/* Same control as the (hidden-on-mobile) inline Minus/Plus
                      — one row, not two menu items, since it's a single
                      stepper rather than two independent actions. Doesn't
                      close the menu on click (unlike every other item here):
                      stepping size is inherently a repeated action, and
                      re-opening the dropdown after every click would be far
                      more annoying than leaving it open. */}
                  <div className="hud-menu-item hud-menu-stepper" role="none">
                    <span>Label size</span>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        className="icon-btn"
                        onClick={() => stepLabelScale(-LABEL_SCALE_STEP)}
                        disabled={labelScale <= 0}
                        title="Decrease label size"
                        aria-label="Decrease label size"
                      >
                        <Minus size={16} />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => stepLabelScale(LABEL_SCALE_STEP)}
                        disabled={labelScale >= LABEL_SCALE_MAX}
                        title="Increase label size"
                        aria-label="Increase label size"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
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
                  <button
                    role="menuitem"
                    className="hud-menu-item"
                    onClick={() => { setMenuOpen(false); setLegendOpen(true); }}
                  >
                    <CircleHelp size={18} />
                    <span>Map colours</span>
                  </button>
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

        {/* Profile chip, then Settings (when permitted) — roomy screens only;
            a phone collapses these into the overflow menu above instead (see
            .hud-right-inline's mobile display:none). The first-person/bird's-
            eye toggle lives in the left column now (see hud-left-col). */}
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
            {/* (The colour-legend button moved into the category row — it
                explains those very colours. See .hud-cat-help.) */}
            {canOpenSettings && (
              <button className="icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
                <Settings size={20} />
              </button>
            )}
          </div>
        </div>
      </div>

      {legendOpen && <LegendModal onClose={() => setLegendOpen(false)} />}

      {unavailableOpen && (
        <SummaryGroupPanel
          group={{ title: "Unavailable devices", icon: TriangleAlert, entityIds: unavailableIds }}
          canControl={canControlAny}
          mappedEntityIds={mappedEntityIds}
          onClose={() => setUnavailableOpen(false)}
          onOpenEntity={(id) => { setUnavailableOpen(false); onOpenEntity(id); }}
          hideBulkToggle
        />
      )}

      {/* Left column: the floor toggle (1F / 2F) plus the Rooms dial button.
          Tapping a floor switches to it (and frames it in the bird's-eye); the
          Rooms button taps to a quick floor/room dial, long-press for the full
          Rooms list to add/edit. The first-person/bird's-eye toggle now lives
          in the bottom-left stack (see bottom-bar), directly above the
          view-default button it controls access to. */}
      <div className="hud-left-col">
        <div className="hud-stack">
          {availFloors.map((f) => (
            <button
              key={f}
              className={`icon-btn hud-floor-btn${currentFloor === f ? " active" : ""}`}
              onClick={() => onShowFloor(f)}
              title={`Show floor ${f}`}
              aria-label={`Show floor ${f}`}
              aria-pressed={currentFloor === f}
            >
              {f}F
            </button>
          ))}
          <button
            ref={roomsBtnRef}
            className={`icon-btn rooms-dial-btn has-hold-action${radial ? " active" : ""}`}
            title="Rooms — tap for the quick floor/room dial, long-press to add/edit rooms"
            aria-label="Rooms"
            aria-describedby="rooms-btn-hint"
            style={{ touchAction: "none" }}
            onPointerDown={onRoomsPointerDown}
            onPointerUp={onRoomsPointerUp}
            onPointerCancel={() => { if (roomsLongTimer.current) clearTimeout(roomsLongTimer.current); }}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={onRoomsKeyDown}
            onKeyUp={onRoomsKeyUp}
          >
            <Compass size={20} />
          </button>
          <span id="rooms-btn-hint" className="sr-only">Hold (or hold Enter/Space) to add or edit rooms</span>
        </div>
      </div>

      <div className="bottom-bar">
        {/* Bottom-left view controls — ALWAYS standalone here now, regardless
            of whether the SummaryBar (device/scene tiles) is shown. It used
            to move INTO that bar's own left section while the bar was
            visible; kept purely standalone instead so it never has to share
            width with however wide the tile row grows on a given screen —
            see .bottom-bar's z-index note in styles.css for how this stays
            clickable even when the (separately, absolutely positioned)
            SummaryBar happens to visually extend over this corner on a
            narrow phone. */}
        <ViewControls
          stacked
          viewMode={viewMode}
          onToggleViewMode={onToggleViewMode}
          hasOverviewDefault={hasOverviewDefault}
          onApplyOverviewDefault={onApplyOverviewDefault}
          onSaveOverviewDefault={onSaveOverviewDefault}
        />

        {/* Bottom-right: the first-person movement joystick. */}
        {viewMode === "first-person" && <VirtualJoystick onMove={onMove} />}
      </div>
    </>
  );
}
