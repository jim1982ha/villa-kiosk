// src/components/hud/HUD.tsx
// Top bar layout (three zones):
//   • Left   — villa brand (home icon + name + connection dot) + clock; on a
//              phone this is hidden entirely (connection status moves into
//              the right-side overflow menu instead — see hud-overflow) so
//              the category row keeps its width
//   • Center — category filter, then a label-size stepper (+/-)
//   • Right  — ONE attention entry (see openAttention: the count is always
//              every kind of problem; only the glyph and the destination
//              depend on the profile), then Briefings, the view switch, the
//              profile chip and Settings — grouped since they're all "who's
//              signed in / what needs attention" info, not map controls
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

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  // MapIcon, not Map: the bare name shadows the global Map constructor,
  // which this file also uses.
  Settings, LogOut, Map as MapIcon, PersonStanding,
  Minus, Plus, CircleHelp, TriangleAlert, ClipboardList, Newspaper,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { isCategoryAllowed } from "@/auth/permissions";
import { ROLE_LABELS } from "@/auth/roles";
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
import type { FacilityTab } from "@/components/fm/FacilityModal";
import { useVillaAttention } from "@/components/cockpit/useVillaAttention";
import { formatCountBadge } from "@/utils/countBadge";

// Label-size stepper (next to the category filter): each click moves
// entityIconScale by this much, clamped to the shared
// [ENTITY_ICON_SCALE_MIN, ENTITY_ICON_SCALE_MAX] bounds. The floor is NOT
// zero any more — see ENTITY_ICON_SCALE_MIN for why scale-to-zero was
// removed.
const LABEL_SCALE_STEP = 0.25;

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
  /** Entities with real geometry in the loaded model (see
   *  manager.mappedEntityIds) — same set SummaryBar uses, for the
   *  unavailable-devices list's "not on the map" section. */
  mappedEntityIds: Set<string>;
  /** Drill into an entity's full panel from the unavailable-devices list —
   *  wired to Dashboard's setActivePanel, same callback SummaryBar uses. */
  onOpenEntity: (entityId: string) => void;
  /** Open the Facility Manager workspace, optionally on a named tab.
   *
   *  ⚠️ ITS PRESENCE IS THE RBAC SWITCH FOR THE WHOLE ATTENTION ENTRY.
   *  Undefined exactly when the profile lacks `manageFacility` (see Dashboard),
   *  and the top bar's single attention button then wears a warning triangle
   *  and opens the standalone Cockpit instead of a clipboard opening Facility.
   *  The COUNT on it is the same either way — see `openAttention`. */
  onOpenFacility?: (tab?: FacilityTab) => void;
  /** Open a Facility RECORD — a fault ticket, or the maintenance schedule.
   *
   *  ⚠️ THE HUD'S COCKPIT HAS NO FACILITY AROUND IT, so a record row here has
   *  to travel out to Dashboard, which owns whether that dialog is open.
   *  Optional and gated the same way `onOpenFacility` is: a profile that may
   *  not manage the facility never receives it, and Cockpit then leaves those
   *  rows unopenable rather than opening the wrong thing. */
  onOpenFacilityRecord?: (kind: "fault" | "schedule", recordId: string) => void;
  /** Open the Briefings workspace. Undefined when the profile is not the owner
   *  — the entry is then not rendered at all. ⚠️ A RENDERING CONVENIENCE ONLY:
   *  the proxy refuses a non-owner write to /reports-config and a non-owner
   *  read of /reports-diagnostics whatever the browser sends.
   *
   *  ⚠️ "BRIEFINGS", NOT "REPORTS", AND THE DISTINCTION IS REAL. Facility
   *  already has a tab labelled "Report" with this exact `FileText` icon, and
   *  it is a different thing: a DOCUMENT the facility manager generates on
   *  demand, in Markdown, downloaded, a point-in-time record of readiness and
   *  spend. This is the AUTOMATED PERIODIC brief — scheduled, delivered by
   *  notification, composed from the villa's own alert layer. Two surfaces
   *  called "Report" wearing the same icon is a coin-flip for the reader.
   *
   *  The word is the product's own: every one of these is titled "Weekly
   *  property brief" or "Weekly facility brief" by the renderer. Opening
   *  Briefings and finding a brief is the whole of the naming rationale. The
   *  CODE keeps `reports` throughout — the backend package, the four
   *  `/reports-*` endpoints and the file names — because that is what the
   *  subsystem IS; only the label a person reads is disambiguated. */
  onOpenReports?: () => void;
  /** ⚠️ A SECOND DOOR, BECAUSE THEY ARE TWO SUBSYSTEMS. `onOpenReports` opens
   *  the AI's workspace; this opens the deterministic one — the checks, the
   *  briefing and the jobs your automations raised. Nothing an AI produces is
   *  behind this one and nothing deterministic is behind the other. */
  onOpenBriefings?: () => void;
  /** Long-press (or hold Enter/Space) a category filter icon — list every
   *  device in that category, the same group-modal every SummaryBar tile
   *  already opens. A plain tap keeps toggling that category's visibility. */
  onOpenCategory: (category: Category) => void;
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
  mappedEntityIds, onOpenEntity, onOpenFacility, onOpenFacilityRecord,
  onOpenReports, onOpenBriefings, onOpenCategory,
}: Props) {
  const { connection, haConfig } = useHA();
  const { config, update } = useConfig();
  const { role, beginSwitch } = useProfile();
  const clock = useClock();
  const title = resolveSiteTitle(config, haConfig?.location_name);
  const floors = [1, 2];
  const { flash: homeFlash, buttonProps: homeButtonProps } =
    useHomeAnchor(onApplyOverviewDefault, onSaveOverviewDefault);

  // THE SAME "needs attention" count Cockpit's own Needs Attention section
  // shows — unavailable devices + open faults + overdue schedules + active
  // alarms, via the one shared computation (see useVillaAttention's own
  // docstring). This button/menu badge used to show unavailableIds.length
  // alone, computed separately here from before Needs Attention was
  // unified — reported as "the button says 4, the modal says 5 things need
  // attention" once the two definitions had quietly drifted apart.
  const { attentionItems, health } = useVillaAttention(mappedEntityIds);
  // ── ONE ATTENTION ENTRY, WHATEVER THE PROFILE (2.570.0) ─────────────────
  //
  // ⚠️ THIS WAS TWO ICONS AND 2.569.0 MADE IT WORSE. Cockpit became a Facility
  // tab, and the alert icon was pointed at it — so an owner had a triangle and
  // a clipboard side by side opening the SAME dialog. "I see 2 Facility modals
  // (with 2 different icons)": the redundancy had been moved, not removed. I
  // argued at the time that keeping both was justified because they carried
  // different badges. They did, and that was the second half of the bug.
  //
  // ⚠️ THE BADGE COUNTS EVERYTHING, FROM THE ONE COMPUTATION. The alert icon
  // showed 5 (`buildAttentionItems`: unavailable devices + open faults +
  // overdue schedules + active alarms) while the Facility icon showed 1 (late
  // tasks + open faults, re-derived INLINE here from `scheduleBoard` and
  // `fmData.tickets`). Two numbers about one villa, on one bar, one of them a
  // strict subset of the other and neither labelled — the owner asked for the
  // exhaustive one. `useVillaAttention` is now the only source, which also
  // deletes a second implementation of "what is an open fault" that agreed with
  // the first purely by coincidence.
  //
  // What the profile changes is the DESTINATION and the GLYPH, never the count:
  // an operator who can reach Facility gets Facility (Cockpit is its first tab),
  // and everyone else gets the standalone Cockpit dialog. The icon matches the
  // dialog it opens, so the two profiles are each internally consistent.
  const [cockpitOpen, setCockpitOpen] = useState(false);
  const attention = attentionItems.length;
  const AttentionIcon = onOpenFacility ? ClipboardList : TriangleAlert;
  const attentionTitle = onOpenFacility
    ? "Facility — status, maintenance, readiness, faults"
    : "Cockpit — villa status at a glance";
  const attentionLabel = onOpenFacility
    ? "Open the facility workspace"
    : "Open Cockpit — villa status at a glance";
  // ⚠️ THE MENU ROW'S WORDING IS DECIDED HERE, NOT IN THE MENU. Both surfaces
  // read the same four values, so the phone and the tablet cannot end up naming
  // the same entry differently — the rule `.hud-overflow` exists to satisfy,
  // applied to the words as well as to the entry's existence.
  const attentionWord = onOpenFacility ? "Facility" : "Cockpit";
  const openAttention = () => {
    // ⚠️ THE LANDING TAB FOLLOWS THE BADGE. The icon said "5 things need
    // attention", so the tap has to show those five; with nothing to show,
    // Cockpit is a page reading "everything looks fine" in front of the work
    // board somebody opened Facility to reach.
    if (onOpenFacility) onOpenFacility(attention > 0 ? "cockpit" : undefined);
    else setCockpitOpen(true);
  };

  // ⚠️ THE SECOND COUNT IS GONE, NOT RELOCATED (2.570.0). It read
  // `scheduleBoard(fmData)` late-or-never plus unresolved `fmData.tickets` —
  // the same two loops `buildAttentionItems` already runs, written a second
  // time here, and therefore a second definition of "an open fault" that
  // matched the first only because nobody had changed either. That is the exact
  // shape of the drift which produced "the menu says 4 but the modal says 5"
  // and got the alert badge unified in 2.86.0; this copy simply outlived it.
  //
  // The surviving reason for it — "the point of a schedule is that you find out
  // you are late WITHOUT going looking" — is fully served by the one badge,
  // because overdue schedules are one of `buildAttentionItems`' four kinds.
  // A count that EXCLUDED four unavailable devices was the worse answer to that
  // requirement, not a different one.

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
  type RadialState = { cx: number; cy: number; activeFloor: number | null };
  // One ref per floor button — the dial anchors itself to whichever one was
  // actually held, so its screen position always matches the gesture.
  const floorBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [radial, setRadial] = useState<RadialState | null>(null);
  const floorLongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floorLongFired = useRef(false);

  const availFloors = floors.filter((f) => floorsAvailable.includes(f));
  const ROOM_R = 228;         // baseline outer-arc radius — the original, always-fine "few rooms" size
  const ROOM_MIN_ARC_PX = 48; // safe arc-length per room AT that baseline (228px radius, ~12° steps)
  const ROOM_VIEWPORT_PAD = 40; // top/bottom breathing room — matches the cy-clamp margin below
  const ROOM_R_FLOOR = 90;    // sanity floor so an extreme case never collapses the fan onto the button

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
    setRadial({ cx, cy, activeFloor: f });
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
            <VestaAppIcon size={44} />
          </button>
          <span id="home-btn-hint" className="sr-only">Hold Space (or right-click) to save the current view as the default</span>
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
              title="What do these colours mean?"
              aria-label="Map colour legend"
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
            <button
              className={`icon-btn${attention > 0 ? " has-alert" : ""}`}
              onClick={openAttention}
              title={attention > 0 ? health.summary : attentionTitle}
              aria-label={attentionLabel}
            >
              <AttentionIcon size={24} />
              {attention > 0 && (
                <span className="icon-btn-count" aria-hidden="true">
                  {formatCountBadge(attention)}
                </span>
              )}
            </button>
            {/* ⚠️ A HUD ENTRY NEEDS BOTH SURFACES, AND THIS ONE SHIPPED WITH
                ONE. `.hud-overflow` is `display:none` at every width EXCEPT the
                phone tier, so a menu item on its own is invisible on the desktop
                and the tablet — which is every device this villa is operated
                from. Briefings shipped in v2.537.0 menu-only and could not be
                opened at all on a 1324px laptop. Facility and the view switch
                have carried both copies from the start; this is the same rule,
                joined late. */}
            {/* ⚠️ THIS DOOR CHANGED WHAT IT OPENS IN 2.727.0, so its icon and
                its words changed with it. It used to lead to the briefing
                pipeline and now leads to the whole reasoning layer — concerns,
                approvals, memory, tuning, cost. An entry point whose label
                still described the old destination is how an owner ends up
                asking where Concerns are, which is exactly what happened. */}
            {onOpenReports && (
              <button
                className="icon-btn"
                onClick={onOpenReports}
                title="VESTA Agent — what the villa has concluded, what it is waiting on you for, and what it costs"
                aria-label="Open VESTA Agent"
              >
                <Sparkles size={24} />
              </button>
            )}
            {onOpenBriefings && (
              <button
                className="icon-btn"
                onClick={onOpenBriefings}
                title="Briefings — the scheduled report, what it checks, and the jobs your automations raised"
                aria-label="Open briefings"
              >
                <Newspaper size={24} />
              </button>
            )}
            {/* (The colour-legend button moved into the category row — it
                explains those very colours. See .hud-cat-help.) */}
            {/* First-person / bird's-eye switch, right after Facility — both
                are app-level "how am I looking at/managing this villa"
                controls rather than map content, so they sit together ahead
                of the profile chip and Settings. It used to sit right before
                Settings instead; moved at the user's request. On a phone
                this whole row collapses into the overflow menu, which
                carries its own copy (see .hud-menu). */}
            <ViewControls viewMode={viewMode} onToggleViewMode={onToggleViewMode} />
            {role && (
              <span className="hud-profile" title={`Signed in as ${ROLE_LABELS[role]}`}>
                <span className="hud-profile-name">{ROLE_LABELS[role]}</span>
                <button
                  className="icon-btn"
                  onClick={beginSwitch}
                  title="Switch profile"
                  aria-label={`Signed in as ${ROLE_LABELS[role]} — switch profile`}
                >
                  <LogOut size={18} />
                </button>
              </span>
            )}
            {canOpenSettings && (
              <button className="icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
                <Settings size={24} />
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
                {/* Connection status, repeated here (the top-bar .hud-brand
                    chip always shows its own dot too, phone included — see
                    its media queries) since this dropdown is the one place
                    Settings/profile live on a phone, and the profile line
                    is a natural spot for it — as a bare icon (no
                    "Connection: " text) sharing the line, not its own row. */}
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
                {/* The attention entry — the same button that sits beside the
                    profile chip on a roomy screen (see .hud-right-inline),
                    collapsed into a menu item here so a phone doesn't lose it,
                    just an extra tap. Count shown inline rather than as a
                    floating badge — this is a text row, not an icon.
                    ⚠️ ONE ROW, AND IT USED TO BE TWO. Both opened the same
                    dialog for anyone holding `manageFacility`, with two
                    different counts. Glyph, wording, destination and count all
                    come from the same four values the inline button reads, so
                    the two surfaces cannot say different things — which is the
                    rule `.hud-overflow` exists to satisfy in the first place. */}
                <button
                  role="menuitem"
                  className="hud-menu-item"
                  onClick={() => { setMenuOpen(false); openAttention(); }}
                >
                  <AttentionIcon size={18} />
                  <span>
                    {attentionWord}
                    {attention > 0 ? ` (${formatCountBadge(attention)})` : ""}
                  </span>
                </button>
                {onOpenReports && (
                  <button
                    role="menuitem"
                    className="hud-menu-item"
                    onClick={() => { setMenuOpen(false); onOpenReports(); }}
                  >
                    <Sparkles size={18} />
                    <span>VESTA Agent</span>
                  </button>
                )}
                {onOpenBriefings && (
                  <button
                    role="menuitem"
                    className="hud-menu-item"
                    onClick={() => { setMenuOpen(false); onOpenBriefings(); }}
                  >
                    <Newspaper size={18} />
                    <span>Briefings</span>
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
                  <span>Label size</span>
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

      {legendOpen && <LegendModal onClose={() => setLegendOpen(false)} />}

      {cockpitOpen && (
        <CockpitModal
          mappedEntityIds={mappedEntityIds}
          onClose={() => setCockpitOpen(false)}
          onOpenEntity={(id) => { setCockpitOpen(false); onOpenEntity(id); }}
          {...(onOpenFacilityRecord ? {
            onOpenRecord: (kind: "fault" | "schedule", recordId: string) => {
              setCockpitOpen(false);
              onOpenFacilityRecord(kind, recordId);
            },
          } : {})}
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
