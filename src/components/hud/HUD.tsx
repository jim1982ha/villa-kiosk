// src/components/hud/HUD.tsx
// Top bar layout (three zones):
//   • Left   — villa brand (home icon + name + connection dot) + clock; on a
//              phone this is hidden entirely (connection status moves into
//              the right-side overflow menu instead — see hud-overflow) so
//              the category row keeps its width
//   • Center — category filter, then a label-size stepper (+/-)
//   • Right  — the Cockpit (the robot when a VESTA Agent is configured) +
//              Facility alerts, then Settings and, last, the round signed-in
//              badge — grouped together since they're all "who's signed in /
//              what needs attention" info, not map controls
// A left control column floats below the brand: the vertical floor toggle
// (1F / 2F) — a plain tap switches floor as before; a LONG-PRESS on either
// button opens the radial rooms dial pre-scoped to that floor, replacing the
// separate Rooms/Compass button this used to be a 3rd item in the stack —
// then, as its OWN section right below, not merged into that stack, the
// first-person/bird's-eye view toggle (previously a lone bottom-left corner
// button; moved here so the bottom bar stays free for the summary
// tiles/joystick and nothing floats unlabelled in a corner). (Device state
// labels are always shown; "Highlight clickable objects" moved to Settings.)
// Bottom bar: bottom-right shows the first-person movement joystick only.

import { useBackToClose } from "@/hooks/useBackToClose";
import { useOutsideClose } from "@/hooks/useOutsideClose";
import { useInterval } from "@/hooks/useInterval";
import { fmtChartTime } from "@/components/panels/chartUtils";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  // MapIcon, not Map: the bare name shadows the global Map constructor,
  // which this file also uses.
  Settings, Map as MapIcon, PersonStanding,
  Minus, Plus, CircleHelp, TriangleAlert, ClipboardList, Bot,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { isCategoryAllowed } from "@/auth/permissions";
import { ROLE_LABELS, ROLE_INITIALS } from "@/auth/roles";
import { resolveSiteTitle } from "@/config/AppConfig";
import { VestaAppIcon } from "@/components/VestaMark";
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_ICONS } from "@/config/EntityCategories";
import { ENTITY_ICON_SCALE_MIN, ENTITY_ICON_SCALE_MAX, clampIconScale } from "@/config/AppConfig";
import type { Category, TeleportPoint } from "@/types/scene.types";
import VirtualJoystick from "./VirtualJoystick";
import ViewControls from "./ViewControls";
import { useLongPress, HOLD_MS_HUD } from "@/hooks/useLongPress";
import { useHomeAnchor } from "./useHomeAnchor";
import RadialRoomMenu, { type RadialItem } from "./RadialRoomMenu";
import LegendModal from "./LegendModal";
import CockpitModal from "@/components/cockpit/CockpitModal";
import type { Doors } from "@/auth/doors";
import { useVillaAttention } from "@/components/cockpit/useVillaAttention";
import { useFmData } from "@/fm/FmDataContext";
import { fmAttention } from "@/fm/fmEngine";
import { formatCountBadge } from "@/utils/countBadge";
import { useAgent } from "@/agent/AgentContext";
import { awaitingAnswer } from "@/agent/agentView";

// Label-size stepper (next to the category filter): each click moves
// entityIconScale by this much, clamped to the shared
// [ENTITY_ICON_SCALE_MIN, ENTITY_ICON_SCALE_MAX] bounds. The floor is NOT
// zero any more — see ENTITY_ICON_SCALE_MIN for why scale-to-zero was
// removed.
const LABEL_SCALE_STEP = 0.25;

interface Props {
  currentFloor: number;
  floorsAvailable: number[];
  /** Rooms-dial floor pick: switch to that floor AND frame its whole bird's-eye
   *  view (saved default), not just toggle visibility. */
  onShowFloor: (floor: number) => void;
  onOpenTeleport: () => void;
  /** Rooms-dial navigation: jump straight to a room (switches floor + zooms in),
   *  bypassing the full Rooms list. */
  onNavigateRoom: (point: TeleportPoint) => void;
  /** Which windows this profile may open (auth/doors) — Settings, Facility,
   *  the agent. Every button below that leads to one is drawn by it, never by
   *  whether its callback was passed. */
  doors: Doors;
  onOpenSettings: () => void;
  onMove: (x: number, y: number) => void;
  viewMode: "first-person" | "overview";
  onToggleViewMode: () => void;
  /** Whether THIS device has a saved default overview framing — drives the
   *  brand icon's "not set yet" dot (see .hud-brand / useHomeAnchor), never
   *  a lit/active highlight (that would look like a stray toggle on the
   *  villa name rather than the app icon it still is). */
  hasOverviewDefault: boolean;
  /** Tap the brand icon: jump to this device's saved default view, switching
   *  into overview first if needed. Returns false when nothing is saved. */
  onApplyOverviewDefault: () => boolean;
  /** Long-press / right-click the brand icon: (re)define the default as the
   *  overview camera's current angle/tilt/zoom/pan. Returns false when not
   *  currently in overview (nothing to capture). */
  onSaveOverviewDefault: () => boolean;
  /** Drill into an entity's full panel from the unavailable-devices list —
   *  wired to Dashboard's setActivePanel, same callback SummaryBar uses. */
  onOpenEntity: (entityId: string) => void;
  /** Open the Facility Manager workspace — drawn only with `doors.facility`. */
  onOpenFacility: () => void;
  /** Open the VESTA Agent area. Without `doors.agent` the Cockpit button
   *  keeps its ⚠ icon and the Cockpit's footer has no "VESTA Agent" button. */
  onOpenAgent: () => void;
  /** Long-press (or hold Enter/Space) a category filter icon — list every
   *  device in that category, the same group-modal every SummaryBar tile
   *  already opens. A plain tap keeps toggling that category's visibility. */
  onOpenCategory: (category: Category) => void;
}

function useClock(): string {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), 1000 * 20);
  return fmtChartTime(now);
}

export default function HUD({
  currentFloor, floorsAvailable, onShowFloor, onOpenTeleport, onNavigateRoom,
  doors, onOpenSettings, onMove,
  viewMode, onToggleViewMode,
  hasOverviewDefault, onApplyOverviewDefault, onSaveOverviewDefault,
  onOpenEntity, onOpenFacility, onOpenAgent, onOpenCategory,
}: Props) {
  const { connection, haConfig } = useHA();
  const { config, update } = useConfig();
  const { role, beginSwitch } = useProfile();
  const clock = useClock();
  const title = resolveSiteTitle(config, haConfig?.location_name);
  const { flash: homeFlash, buttonProps: homeButtonProps } =
    useHomeAnchor(onApplyOverviewDefault, onSaveOverviewDefault);

  // THE SAME "needs attention" count Cockpit's own Needs Attention section
  // shows — unavailable devices + open faults + overdue schedules + active
  // alarms, via the one shared computation (see useVillaAttention's own
  // docstring). This button/menu badge used to show unavailableIds.length
  // alone, computed separately here from before Needs Attention was
  // unified — reported as "the button says 4, the modal says 5 things need
  // attention" once the two definitions had quietly drifted apart.
  const { attentionGroups, health } = useVillaAttention();
  // Opens Cockpit (the villa-wide status report), not the bare unavailable-
  // devices list directly any more — that list is now a drill-down INSIDE
  // Cockpit's Needs Attention section (see CockpitModal), reached the same
  // way. Name kept close to its old meaning since this is still the "how
  // many devices need attention" alert icon; only what it opens changed.
  const [cockpitOpen, setCockpitOpen] = useState(false);

  // Facility attention count: overdue/never-recorded maintenance plus unresolved
  // faults. Surfaced ON the button because the whole point of a schedule is
  // that you find out you're late WITHOUT having to go looking — an operator
  // who must open a modal to discover overdue work will discover it late.
  const { data: fmData } = useFmData();
  // The Facility's attention rule (fmEngine.fmAttention) — the Cockpit's too.
  const facilityAttention = useMemo(() => fmAttention(fmData).total, [fmData]);
  // The VESTA Agent: its presence dot, and how many of its messages wait for
  // an answer THIS profile can give (agentView.awaitingAnswer).
  const { status: agentStatus, messages: agentMessages } = useAgent();
  const agentOnline = agentStatus?.state === "online";
  const agentWaiting = useMemo(() => awaitingAnswer(agentMessages, agentStatus),
    [agentMessages, agentStatus]);
  const agentTitle = `VESTA Agent — ${agentOnline ? "online" : "offline"}`
    + (agentWaiting > 0 ? `, ${agentWaiting} message${agentWaiting === 1 ? "" : "s"} to answer` : "");
  // The agent's presence as the dot on its robot — the top bar's and the
  // phone menu's are this one element (.status-dot, 2.496.247).
  const agentDot = <span className={`status-dot ${agentOnline ? "on" : "warn"}`} aria-hidden="true" />;

  // ── Floor buttons now do double duty, no separate Rooms button any more:
  // a normal tap/click keeps the original behaviour (switch to that floor,
  // frame its whole bird's-eye view — onShowFloor), while a LONG-PRESS opens
  // the radial room-picker dial, pre-scoped to WHICHEVER floor button was
  // held — not necessarily the floor currently on screen, so long-pressing
  // "2F" while standing on 1F goes straight to 2F's rooms. No intermediate
  // floor-picker ring inside the dial any more either — holding a SPECIFIC
  // floor button already told it which floor you want, so re-offering both
  // floors as chips inside the dial was a redundant extra step. Tap a room
  // to zoom there, tap outside to dismiss. See RadialRoomMenu.
  // ───────────────────────────────────────────────────────────────────────
  /** `list`: the rooms do not fit the arc on this screen — they show as one
   *  scrollable column beside the floor buttons instead (see roomFanFits). */
  type RadialState = { cx: number; cy: number; activeFloor: number | null; list: boolean };
  // One ref per floor button — the dial anchors itself to whichever one was
  // actually held, so its screen position always matches the gesture.
  const floorBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [radial, setRadial] = useState<RadialState | null>(null);
  useBackToClose(() => setRadial(null), radial !== null);
  const floorLongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floorLongFired = useRef(false);

  // ⚠️ THE MODEL DECIDES HOW MANY STOREYS THERE ARE, NOT THIS LINE. This used
  // to be `[1, 2].filter((f) => floorsAvailable.includes(f))` — an intersection
  // with a literal, so a villa whose GLB detects a third storey got a floor 3
  // it could reach (FloorManager.getFloorsDetected feeds floorsAvailable, and
  // Dashboard.onFloorChange will switch to it) and no button to reach it with.
  // Sorted because the detection order is the mesh index's, not the reader's.
  const availFloors = useMemo(
    () => [...floorsAvailable].sort((a, b) => a - b), [floorsAvailable]);
  const ROOM_R = 228;         // baseline outer-arc radius — the original, always-fine "few rooms" size
  const ROOM_MIN_ARC_PX = 48; // safe arc-length per room AT that baseline (228px radius, ~12° steps)
  const ROOM_VIEWPORT_PAD = 40; // top/bottom breathing room — matches the cy-clamp margin below
  const ROOM_R_FLOOR = 90;    // sanity floor so an extreme case never collapses the fan onto the button
  const RADIAL_CHIP_HALF_W = 95; // half the widest room chip (.radial-item max-width: 190px)

  /** Half-angle (deg) of the room fan for `n` rooms: unchanged from before —
   *  a tight ~12° step per room until the spread saturates at ±86°. */
  const roomFanHalfAngle = (n: number): number =>
    n <= 1 ? 0 : Math.min(86, ((n - 1) * 12) / 2);

  /**
   * Outer arc radius for `n` rooms.
   *
   * The baseline (228px) reproduces the original "few rooms" look exactly,
   * unchanged. Past ~15 rooms the fan's angular spread saturates at ±86°, so
   * each ADDITIONAL room shrinks the angular slice between chips below the
   * safe arc-length that kept them apart at the baseline — this is what let
   * a long room list stack its labels on top of each other. Growing the
   * radius instead restores that same safe per-room spacing by giving the
   * (now-fixed) angular spread more physical arc to spend it on.
   *
   * That growth is capped by how much vertical room the CURRENT viewport
   * actually has, so the dial can never be pushed off-screen. Only once even
   * that cap can't fit the ideal spacing do labels start to overlap — a
   * deliberate, visible fallback for an unusually long room list, not a bug.
   */
  const roomFanRadius = (n: number): number => {
    const half = roomFanHalfAngle(n);
    let needed = ROOM_R;
    if (n > 1) {
      const stepRad = ((2 * half) / (n - 1)) * (Math.PI / 180);
      if (stepRad > 0) needed = Math.max(ROOM_R, ROOM_MIN_ARC_PX / stepRad);
    }
    const maxForViewport = window.innerHeight / 2 - ROOM_VIEWPORT_PAD;
    // ⚠️ NOT clamp(needed, ROOM_R_FLOOR, maxForViewport), which it looks like.
    // The FLOOR wins here: on a short viewport maxForViewport can fall below
    // ROOM_R_FLOOR, and clamp() would let the ceiling win and collapse the fan
    // to something unreadable. Written this way on purpose — do not converge.
    return Math.max(ROOM_R_FLOOR, Math.min(needed, maxForViewport));
  };

  /**
   * Whether `n` rooms fit the arc at their safe spacing on THIS screen, and the
   * arc fits across it.
   *
   * ⚠️ OVERLAP IS NO LONGER THE FALLBACK (owner, 2026-10-01). Past the viewport
   * cap the arc used to let labels overlap "as a deliberate, visible fallback":
   * on a phone held upright, 17 rooms of 1F stacked Bedroom 1 on Guest Bathroom
   * and WIC on Swimming Pool — unreadable, and a tap could land on the wrong
   * room. When the arc does not fit, the same rooms show as one scrollable
   * column instead; the arc stays wherever it fits (the wall tablet).
   */
  const roomFanFits = (n: number, cx: number): boolean => {
    const half = roomFanHalfAngle(n);
    let needed = ROOM_R;
    if (n > 1) {
      const stepRad = ((2 * half) / (n - 1)) * (Math.PI / 180);
      if (stepRad > 0) needed = Math.max(ROOM_R, ROOM_MIN_ARC_PX / stepRad);
    }
    const tallEnough = needed <= window.innerHeight / 2 - ROOM_VIEWPORT_PAD;
    const wideEnough = cx + needed + RADIAL_CHIP_HALF_W <= window.innerWidth - 8;
    return tallEnough && wideEnough;
  };

  const roomsForFloor = (f: number) =>
    config.teleportPoints
      .filter((p) => (p.floor ?? 1) === f)
      // Alphabetical, not model/creation order — reads as a deliberately
      // organised list rather than whatever order rooms happened to be added.
      .sort((a, b) => a.name.localeCompare(b.name));

  const buildRadialItems = (r: RadialState): RadialItem[] => {
    if (r.activeFloor == null) return [];
    const cosd = (d: number) => Math.cos((d * Math.PI) / 180);
    const sind = (d: number) => Math.sin((d * Math.PI) / 180);
    const arc = (i: number, n: number, half: number) =>
      n <= 1 ? 0 : -half + (2 * half) * (i / (n - 1));
    const rooms = roomsForFloor(r.activeFloor);
    if (r.list) {
      // one column: the menu lays it out (RadialRoomMenu), x/y unused
      return rooms.map((p) => ({ key: `r${p.name}`, label: p.name, kind: "room" as const, x: 0, y: 0, active: false }));
    }
    const half = roomFanHalfAngle(rooms.length);
    const radius = roomFanRadius(rooms.length);
    return rooms.map((p, i) => {
      const a = arc(i, rooms.length, half);
      return {
        key: `r${p.name}`, label: p.name, kind: "room",
        x: r.cx + radius * cosd(a), y: r.cy + radius * sind(a), active: false,
      };
    });
  };

  const closeRadial = () => setRadial(null);
  /** Open the dial anchored to floor `f`'s OWN button, pre-expanded to `f`'s
   *  rooms regardless of which floor is actually showing right now. */
  const openRadialForFloor = (f: number) => {
    const b = floorBtnRefs.current.get(f)?.getBoundingClientRect();
    if (!b) return;
    const radius = roomFanRadius(roomsForFloor(f).length);
    const cx = b.right + 16;
    // Clamp the centre so the tall outer arc always fits (never clipped top/bottom).
    const margin = radius + ROOM_VIEWPORT_PAD;
    const cy = Math.max(
      Math.min(margin, window.innerHeight / 2),
      Math.min(b.top + b.height / 2, window.innerHeight - margin),
    );
    setRadial({ cx, cy, activeFloor: f, list: !roomFanFits(roomsForFloor(f).length, cx) });
  };

  // ── DELIBERATELY NOT useLongPress — do not "DRY" this into the hook ───────
  // The category icons above did migrate, and this looks like the same
  // gesture, but it is not. This button's TAP acts on POINTER UP and it has no
  // onClick at all, precisely so the keyboard path below can preventDefault the
  // browser's click-on-activation; the hook's whole tap model is consumeClick,
  // i.e. an onClick that runs and is sometimes swallowed. It also omits
  // onPointerLeave on purpose, so dragging off the button and releasing still
  // switches floors, where the hook cancels. Converting it would restructure
  // working gesture code to look like a sibling it does not behave like.
  //
  // ⚠️ THE MECHANISM DIVERGES; THE DURATION MUST NOT. It did, silently, for
  // four releases: these two timers held the literal 450 while HOLD_MS_HUD —
  // whose docstring names "the HUD category icons, THE FLOOR BUTTONS and the
  // camera picker" as the three controls it stands for — was introduced at 480
  // in 2.380.0 by generalising from the other two without checking this one.
  // So the category icon and the floor button directly beneath it answered a
  // hold 30 ms apart, and the constant asserted they did not. A "do not DRY
  // this" note protects the shape of a gesture, and is exactly the thing that
  // lets a NUMBER inside it drift unread — the two decisions are separate and
  // only the first one was ever made here.
  const onFloorPointerDown = (f: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    floorLongFired.current = false;
    if (floorLongTimer.current) clearTimeout(floorLongTimer.current);
    floorLongTimer.current = setTimeout(() => {
      floorLongFired.current = true;
      openRadialForFloor(f);
    }, HOLD_MS_HUD);
  };
  const onFloorPointerUp = (f: number) => () => {
    if (floorLongTimer.current) { clearTimeout(floorLongTimer.current); floorLongTimer.current = null; }
    if (floorLongFired.current) return; // the long-press already opened the dial
    // Plain tap/click: ALWAYS the original floor-switch behaviour, even if a
    // dial happens to be open (e.g. left over from holding the other floor
    // button) — a normal tap must never be reinterpreted as a dial dismiss.
    closeRadial();
    onShowFloor(f);
  };

  // Keyboard equivalent of the two gestures above — a floor button previously
  // had only pointer handlers, so Tab+Enter/Space did nothing at all (native
  // button keyboard activation dispatches a click, not pointer events, so
  // onPointerDown/onPointerUp never fired). Holding Enter/Space now mirrors a
  // touch hold; preventDefault on keydown suppresses the browser's own
  // click-on-activation so it can't ALSO fire and switch floors right after.
  const onFloorKeyDown = (f: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (e.repeat) return; // ignore OS key-repeat while held, same as a still finger
    floorLongFired.current = false;
    if (floorLongTimer.current) clearTimeout(floorLongTimer.current);
    floorLongTimer.current = setTimeout(() => {
      floorLongFired.current = true;
      openRadialForFloor(f);
    }, HOLD_MS_HUD);
  };
  const onFloorKeyUp = (f: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    onFloorPointerUp(f)();
  };

  const onRadialPick = (it: RadialItem) => {
    if (it.kind === "manage") {
      closeRadial();
      onOpenTeleport();                                    // full Rooms list — create / edit / re-anchor
    } else {
      // Exact match is correct HERE and deliberately not `roomKey` (/dry-audit,
      // 2026-08-18): the radial's label IS the stored name — `label: p.name`
      // where these items are built — so this is an identity lookup on one
      // object, not a comparison of two independently-sourced room names.
      // TeleportMenu, which creates the data from typed input, does use roomKey.
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

  // The category pill still scrolls horizontally when its (variable) button
  // count exceeds the width its grid track got — it just no longer announces
  // it with an edge fade. See .hud-group-scroll for why that affordance was
  // removed rather than restyled, and do not reintroduce the measurement:
  // nothing reads it now.

  // On narrow screens the right-side controls (view mode, Settings, switch
  // profile) collapse into ONE overflow button with a dropdown — CSS decides
  // which of the two renderings is visible (same breakpoint as the rest of
  // the compact bar), this state only drives the dropdown. Closes on outside
  // tap and Escape, and after any action is chosen.
  const [menuOpen, setMenuOpen] = useState(false);
  // Back closes it, as it closes every other surface (and puts it on the one
  // list of what is open — see overlayOpen).
  useBackToClose(() => setMenuOpen(false), menuOpen);
  const [legendOpen, setLegendOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose([menuRef], menuOpen, () => setMenuOpen(false));

  // The view toggle + default-view anchor (and their tap-vs-hold gesture) live
  // in <ViewControls>, rendered either here or inside the SummaryBar.

  useEffect(() => { document.title = title; }, [title]);

  const connClass =
    connection === "connected" ? "online" : connection === "connecting" ? "connecting" : "offline";
  // The same status as a .status-dot's tone — the phone menu's role badge.
  const connTone = connClass === "online" ? "on" : connClass === "connecting" ? "pending" : "danger";

  const toggleCategory = (cat: Category) =>
    update({
      hiddenCategories: config.hiddenCategories.includes(cat)
        ? config.hiddenCategories.filter((c) => c !== cat)
        : [...config.hiddenCategories, cat],
    });

  // Tap a category icon = toggle its visibility (unchanged); HOLD it = list
  // every device in that category. Same tap-vs-hold convention as the floor
  // buttons' rooms dial and the camera panel's next-arrow picker — a single
  // shared timer is enough since only one category can be held at a time.
  // One shared hook, not a fourth hand-rolled timer: only one category can be
  // held at a time, so the callback reads whichever button armed it. This also
  // gains the movement threshold the hand-rolled version never had — the
  // category row is a horizontal scroller on a phone, and a hold that fired
  // mid-flick opened a device list nobody asked for.
  const heldCat = useRef<Category | null>(null);
  const catHold = useLongPress(() => {
    if (heldCat.current) onOpenCategory(heldCat.current);
  }, { holdMs: HOLD_MS_HUD, nativeButton: true });
  const onCatPointerDown = (cat: Category) => (e: React.PointerEvent) => {
    heldCat.current = cat;
    catHold.onPointerDown(e);
  };
  const onCatKeyDown = (cat: Category) => (e: React.KeyboardEvent) => {
    heldCat.current = cat;
    catHold.onKeyDown(e);
  };
  const onCatClick = (cat: Category) => () => {
    if (catHold.consumeClick()) return;
    toggleCategory(cat);
  };

  // Clamped on READ too, so a value persisted before the floor existed (a
  // stored 0) shows the stepper in a valid state instead of a stuck "-".
  const labelScale = clampIconScale(config.entityIconScale);
  const stepLabelScale = (delta: number) => {
    const next = clampIconScale(Math.round((labelScale + delta) * 4) / 4);
    update({ entityIconScale: next });
  };


  return (
    <>
      {/* Rooms dial overlay — tappable chips + a dismiss backdrop (pointerdown
          driven; see RadialRoomMenu). */}
      <RadialRoomMenu
        items={radialItems}
        open={!!radial}
        listAt={radial?.list ? radial.cx : null}
        onPick={onRadialPick}
        onBackdrop={onRadialBackdrop}
      />

      <div className="hud-topbar">
        {/* Shrinks progressively on a narrow screen (clock, then the villa
            name, then the connection dot, drop out — see .hud-brand's media
            queries) but is never fully hidden: even on a phone the home icon
            stays put. The dot has a duplicate in the overflow menu below
            (its header) for reachability once it drops here. */}
        <div className="hud-brand">
          {/* Tap: jump to this device's saved default overview view (see
              useHomeAnchor) — replaces the old floor-stack "anchor" button,
              which only ever showed up in overview mode; this one is always
              reachable. A small dot appears ONLY while no default is saved
              yet (an invitation to long-press and set one) — deliberately
              never an .active/lit background once one IS set, which would
              read as a stray toggle sitting on the app icon rather than the
              brand mark it still is the rest of the time. */}
          <button
            type="button"
            className={`hud-home-btn${hasOverviewDefault ? "" : " has-hold-action"}`}
            {...homeButtonProps}
            title="Tap for this device's default view · long-press / right-click to set it to the current view"
            aria-label="Go to this device's default overview view"
            aria-describedby="home-btn-hint"
          >
            {/* Sized to very nearly fill .hud-home-btn (--hud-pill-h): the
                mark is its own squircle, so its height IS the app icon's
                perceived height — a smaller glyph in a correctly-sized box
                looks exactly like the undersized icon this was reported as.
                A couple of px shy of the box so the focus ring and the
                has-hold-action dot still have somewhere to land. */}
            {/* size={null}: the rail width (--hud-rail-w) sizes it in CSS,
                so the tile and the floor block under it are one number. */}
            <VestaAppIcon size={null} />
          </button>
          <span id="home-btn-hint" className="sr-only">Hold Space (or right-click) to save the current view as the default</span>
          {/* The text clips here, not on .hud-brand: the app icon beside it
              carries the left rail's shadow, which a clipping parent would
              cut off (see .hud-brand-text). */}
          <span className="hud-brand-text">
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
          </span>
        </div>
        {homeFlash && (
          <div className="overview-hint hud-home-hint">
            {homeFlash === "applied"
              ? "Jumped to this device's default view."
              : homeFlash === "saved"
                ? "Default view updated for this device — it'll open here every reload."
                : homeFlash === "unavailable"
                  ? "Switch to overview (bird's-eye) view first to set a default."
                  : "No default view saved yet — long-press (or right-click) to set one."}
          </div>
        )}

        {/* Category filter: which device categories show their state tag on
            the map. Lit = category shown. Icon + tooltip only, no text. */}
        <div className="hud-center">
          <div
            className="hud-group hud-group-scroll"
            role="toolbar"
            aria-label="Device category filters"
          >
            {visibleCategories.map((cat) => {
              const hidden = config.hiddenCategories.includes(cat);
              const Icon = CATEGORY_ICONS[cat];
              return (
                <button
                  key={cat}
                  // No .has-hold-action here (unlike the floor buttons/camera
                  // next-arrow, which keep their dot) — these already have a
                  // full row of same-shaped neighbours, and the constant
                  // "you can hold this" hint read as visual clutter rather
                  // than a useful affordance, at the user's request.
                  className={`icon-btn${hidden ? "" : " active"}`}
                  {...catHold}
                  onPointerDown={onCatPointerDown(cat)}
                  // Space-only, and that now comes from the hook's nativeButton
                  // flag rather than from a rule restated per element.
                  onKeyDown={onCatKeyDown(cat)}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={onCatClick(cat)}
                  title={`${hidden ? "Show" : "Hide"} ${CATEGORY_LABELS[cat]} devices on the map — hold to list them`}
                  aria-label={`${CATEGORY_LABELS[cat]} devices on the map`}
                  aria-pressed={!hidden}
                >
                  <Icon size={24} />
                </button>
              );
            })}
            {/* The colour-legend (?) lives INSIDE the category row — it explains
                exactly these colours, so it belongs with them — fenced off by a
                separator. Roomy screens only: on a phone it stays in the
                overflow menu (see .hud-cat-help's media query), which is where
                the whole right-hand cluster collapses to. */}
            <span className="hud-cat-sep hud-cat-help" aria-hidden="true" />
            <button
              className="icon-btn hud-cat-help"
              onClick={() => setLegendOpen(true)}
              title="What do these colours mean — and the keyboard keys"
              aria-label="Map colours and keyboard keys"
            >
              <CircleHelp size={24} />
            </button>
          </div>

          {/* Label size: steps the in-scene badge scale by 0.25 per click,
              down to 0 (hidden). Replaces the old Settings slider. Hidden on
              a phone (.hud-labelsize-btn, same breakpoint as .hud-cat-help) —
              a scrollable category row plus this pill was more than a narrow
              screen can show without scrolling to reach it; the SAME control
              lives in the overflow dropdown (.hud-right) instead, always
              reachable with no scroll. The WRAPPER itself (not just its two
              buttons) is hidden at that breakpoint too — .hud-labelsize-group
              exists so that rule has something to target, since a `display:
              none`'d pair of children still leaves an empty pill rendering
              its own chip chrome (padding/border/background), which read as
              a stray blank rounded box sitting between the category row and
              the overflow button. */}
          <div className="hud-group hud-labelsize-group" role="toolbar" aria-label="Label size">
            <button
              className="icon-btn hud-labelsize-btn"
              onClick={() => stepLabelScale(-LABEL_SCALE_STEP)}
              disabled={labelScale <= ENTITY_ICON_SCALE_MIN}
              title="Decrease label size"
              aria-label="Decrease label size"
            >
              <Minus size={24} />
            </button>
            <button
              className="icon-btn hud-labelsize-btn"
              onClick={() => stepLabelScale(LABEL_SCALE_STEP)}
              disabled={labelScale >= ENTITY_ICON_SCALE_MAX}
              title="Increase label size"
              aria-label="Increase label size"
            >
              <Plus size={24} />
            </button>
          </div>
        </div>

        {/* Unavailable/Facility alerts, then the profile chip and Settings —
            roomy screens only; a phone collapses all of this into the
            overflow menu below instead (see .hud-right-inline's mobile
            display:none and the matching menu items further down). Alerts sit
            right before the profile chip since both answer "what needs my
            attention right now", same reasoning that used to keep them beside
            the category filter — just relocated so that row stays purely
            about map categories. The first-person/bird's-eye toggle lives in
            the left column now (see hud-left-col). ONE shared pill (the same
            .hud-group chrome the category row and label-size stepper use),
            not four separately-bordered buttons — .hud-group's own icon-btn
            reset also guarantees every button here is the same 38px height,
            so the alert button (which briefly had its OWN 48px glass button
            plus a genuinely-applied has-alert border once it left the old
            category row) can't read as bigger/higher than its neighbours. */}
        <div className="hud-right">
          <div className="hud-right-inline hud-group">
            {/* ONE button for the Cockpit and the agent (2.496.242): with an
                agent configured the Cockpit's icon IS the robot — its count
                (top right) stays the Cockpit's, the agent's presence dot sits
                bottom right — and the agent's own window opens from the
                Cockpit's footer. Without one, the ⚠ as before. */}
            <button
              className={`icon-btn${doors.agent ? " agent-btn" : ""}${attentionGroups.length > 0 ? " has-alert" : ""}`}
              onClick={() => setCockpitOpen(true)}
              title={(attentionGroups.length > 0 ? health.summary : "Cockpit — villa status at a glance")
                + (doors.agent ? ` · ${agentTitle}` : "")}
              aria-label={`Open Cockpit — villa status at a glance${doors.agent ? ` (${agentTitle})` : ""}`}
            >
              {doors.agent ? <Bot size={24} /> : <TriangleAlert size={24} />}
              {doors.agent && agentDot}
              {attentionGroups.length > 0 && (
                <span className="icon-btn-count" aria-hidden="true">
                  {formatCountBadge(attentionGroups.length)}
                </span>
              )}
            </button>
            {doors.facility && (
              <button
                className={`icon-btn${facilityAttention > 0 ? " has-alert" : ""}`}
                onClick={onOpenFacility}
                title={facilityAttention > 0
                  ? `${facilityAttention} maintenance item${facilityAttention === 1 ? "" : "s"} need attention`
                  : "Facility — maintenance, readiness, faults"}
                aria-label="Open the facility workspace"
              >
                <ClipboardList size={24} />
                {facilityAttention > 0 && (
                  <span className="icon-btn-count" aria-hidden="true">
                    {formatCountBadge(facilityAttention)}
                  </span>
                )}
              </button>
            )}
            {/* (The colour-legend button moved into the category row — it
                explains those very colours. See .hud-cat-help.) */}
            {/* (The first-person / bird's-eye switch moved to the left
                column, under 1F/2F — see .hud-left-col below.) */}
            {doors.settings && (
              <button className="icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
                <Settings size={24} />
              </button>
            )}
            {/* Who is signed in, as ONE round badge, last on the right
                (2.496.242): the role's letter(s) in place of the name + exit
                arrow. Same action as before — the profile switch, which keeps
                the villa loaded under the PIN pad (ProfileContext.beginSwitch). */}
            {role && (
              <button
                className="icon-btn hud-role-badge"
                onClick={beginSwitch}
                title={`Signed in as ${ROLE_LABELS[role]} — switch profile`}
                aria-label={`Signed in as ${ROLE_LABELS[role]} — switch profile`}
              >
                <span aria-hidden="true" className={`role-glyph${ROLE_INITIALS[role].length > 1 ? " two" : ""}`}>{ROLE_INITIALS[role]}</span>
              </button>
            )}
          </div>

          {/* Overflow menu (phones only — see .hud-overflow's default
              display:none/mobile display:block): Settings/profile/view-toggle
              collapse into this single button + dropdown, its own one-button
              .hud-group pill (same chrome/sizing as every other HUD section)
              sitting in the RIGHT grid track so it's pinned to the true edge
              of the bar. Previously nested inside the centered category
              group instead, which put "settings" wherever the category row's
              content happened to end rather than at the edge. */}
          <div className="hud-group hud-overflow" ref={menuRef}>
            <button
              className={`icon-btn${menuOpen ? " active" : ""}`}
              onClick={() => setMenuOpen((o) => !o)}
              title="Menu"
              aria-label="Menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {/* The SAME gear as the desktop bar's Settings button above, on
                  purpose: this button is where Settings lives on a phone, so
                  swapping it for an overflow glyph made one control look like
                  two different things depending on the width of the screen. */}
              <Settings size={24} />
            </button>
            {menuOpen && (
              <div className="hud-menu" role="menu" aria-label="Settings and profile">
                {/* Cockpit/Facility — the same two buttons that sit beside
                    the profile chip on a roomy screen (see
                    .hud-right-inline), collapsed into menu items here so a
                    phone doesn't lose access to either, just an extra tap
                    to reach them. Count shown inline rather than as a
                    floating badge — this is a text row, not an icon. */}
                <button
                  role="menuitem"
                  className="hud-menu-item"
                  onClick={() => { setMenuOpen(false); setCockpitOpen(true); }}
                  title={doors.agent ? agentTitle : undefined}
                >
                  {/* The agent's presence is the dot on its robot, as in the
                      top bar (owner, 2.496.247) — no "· agent online" text. */}
                  <span className="hud-menu-glyph">
                    {doors.agent ? <Bot size={18} /> : <TriangleAlert size={18} />}
                    {doors.agent && agentDot}
                  </span>
                  <span>
                    Cockpit{attentionGroups.length > 0 ? ` (${formatCountBadge(attentionGroups.length)})` : ""}
                    {doors.agent && <span className="sr-only">{` — ${agentTitle}`}</span>}
                  </span>
                </button>
                {doors.facility && (
                  <button
                    role="menuitem"
                    className="hud-menu-item"
                    onClick={() => { setMenuOpen(false); onOpenFacility(); }}
                  >
                    <ClipboardList size={18} />
                    <span>Facility{facilityAttention > 0 ? ` (${formatCountBadge(facilityAttention)})` : ""}</span>
                  </button>
                )}
                {/* Same control as the (hidden-on-mobile) inline Minus/Plus
                    — one row, not two menu items, since it's a single
                    stepper rather than two independent actions. Doesn't
                    close the menu on click (unlike every other item here):
                    stepping size is inherently a repeated action, and
                    re-opening the dropdown after every click would be far
                    more annoying than leaving it open. */}
                <div className="hud-menu-item hud-menu-stepper" role="none">
                  {/* "Label size (?)": the title is the way to the map-colours
                      legend on a phone (owner, 2.496.246) — it replaced the
                      menu's own "Map colours" row. Only the title opens it;
                      the −/+ beside it still only step the size. */}
                  <button
                    type="button"
                    role="menuitem"
                    className="hud-menu-help"
                    onClick={() => { setMenuOpen(false); setLegendOpen(true); }}
                    aria-label="Label size — what the map colours mean"
                  >
                    <span>Label size</span>
                    <CircleHelp size={18} aria-hidden="true" />
                  </button>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="icon-btn"
                      onClick={() => stepLabelScale(-LABEL_SCALE_STEP)}
                      disabled={labelScale <= ENTITY_ICON_SCALE_MIN}
                      title="Decrease label size"
                      aria-label="Decrease label size"
                    >
                      <Minus size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => stepLabelScale(LABEL_SCALE_STEP)}
                      disabled={labelScale >= ENTITY_ICON_SCALE_MAX}
                      title="Increase label size"
                      aria-label="Increase label size"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                {/* Same view switch as the inline row's, immediately before
                    Settings so the pairing matches the desktop layout. */}
                <button
                  role="menuitem"
                  className="hud-menu-item"
                  onClick={() => { setMenuOpen(false); onToggleViewMode(); }}
                >
                  {viewMode === "overview" ? <PersonStanding size={18} /> : <MapIcon size={18} />}
                  <span>{viewMode === "overview" ? "First-person view" : "Bird's-eye view"}</span>
                </button>
                {doors.settings && (
                  <button
                    role="menuitem"
                    className="hud-menu-item"
                    onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                  >
                    <Settings size={18} />
                    <span>Settings</span>
                  </button>
                )}
                {/* The same round badge as the desktop bar's (O, FM, G), and
                    the same action: back to the PIN pad (beginSwitch). Who is
                    signed in and the connection to Home Assistant are said by
                    the badge and its dot (owner, 2.496.247) — the menu's
                    "Signed in as …" header line repeated both and is gone. */}
                {role && (
                  <button
                    role="menuitem"
                    className="hud-menu-item"
                    onClick={() => { setMenuOpen(false); beginSwitch(); }}
                    title={`Signed in as ${ROLE_LABELS[role]} · Connection: ${connection}`}
                    aria-label={`Signed in as ${ROLE_LABELS[role]}, connection ${connection} — log out`}
                  >
                    <span className="hud-menu-glyph" aria-hidden="true">
                      <span className={`role-glyph${ROLE_INITIALS[role].length > 1 ? " two" : ""}`}>{ROLE_INITIALS[role]}</span>
                      <span className={`status-dot ${connTone}`} />
                    </span>
                    <span>Log out</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {legendOpen && <LegendModal onClose={() => setLegendOpen(false)} />}

      {cockpitOpen && (
        <CockpitModal
          onClose={() => setCockpitOpen(false)}
          onOpenEntity={(id) => { setCockpitOpen(false); onOpenEntity(id); }}
          doors={doors}
          onOpenAgent={onOpenAgent}
          agentOnline={agentOnline}
          agentWaiting={agentWaiting}
        />
      )}

      {/* Left column: the floor toggle (1F / 2F — the ONLY entry to the
          rooms dial, no separate Rooms button any more). A plain tap/click
          on 1F/2F keeps the original behaviour (switch to that floor, frame
          its whole bird's-eye view); a LONG-PRESS opens the radial
          room-picker dial, pre-scoped to THAT floor's rooms — see
          openRadialForFloor. (The default-view "anchor" that used to live
          here as a 4th button has moved onto the brand icon in the top bar —
          see .hud-brand above — so it's reachable from both view modes, not
          just overview.) Right below, as its OWN dedicated section (not
          merged into this stack — it's a different kind of control, "how am
          I looking" rather than "where"), the first-person/bird's-eye view
          TOGGLE: it used to be a lone standalone button in the bottom-left
          corner, with nothing else there to explain it and nothing to stop
          the (separately, absolutely positioned) SummaryBar's tile row from
          visually extending over it on a narrow phone. Neither the bottom
          bar (kept free for the tiles + joystick) nor the top bar (already
          tight on a phone) had room for a clearly-labelled home. */}
      <div className="hud-left-col">
        <div className="hud-stack">
          {availFloors.map((f) => (
            <button
              key={f}
              ref={(el) => { if (el) floorBtnRefs.current.set(f, el); else floorBtnRefs.current.delete(f); }}
              className={`icon-btn hud-floor-btn has-hold-action${currentFloor === f || radial?.activeFloor === f ? " active" : ""}`}
              title={`Show floor ${f} — hold for its rooms`}
              aria-label={`Show floor ${f} — hold for its rooms`}
              aria-describedby="floor-btn-hint"
              aria-pressed={currentFloor === f}
              style={{ touchAction: "none" }}
              onPointerDown={onFloorPointerDown(f)}
              onPointerUp={onFloorPointerUp(f)}
              onPointerCancel={() => { if (floorLongTimer.current) clearTimeout(floorLongTimer.current); }}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={onFloorKeyDown(f)}
              onKeyUp={onFloorKeyUp(f)}
            >
              {f}F
            </button>
          ))}
          <span id="floor-btn-hint" className="sr-only">Hold (or hold Enter/Space) for this floor's rooms</span>
          {/* The first-person / bird's-eye switch, last in the floor section
              and drawn like 1F/2F (owner, 2.496.248). Roomy screens only: on
              a phone it stays in the overflow menu (.hud-view-btn's media
              query, the same breakpoints as .hud-right-inline). */}
          <span className="hud-stack-sep hud-view-btn" aria-hidden="true" />
          <ViewControls className="hud-view-btn" viewMode={viewMode} onToggleViewMode={onToggleViewMode} />
        </div>
      </div>

      <div className="bottom-bar">
        {/* Bottom-right: the first-person movement joystick — the ONLY thing
            left in this bar now that the view-mode toggle moved to the left
            column (see hud-left-col). */}
        {viewMode === "first-person" && <VirtualJoystick onMove={onMove} />}
      </div>
    </>
  );
}
