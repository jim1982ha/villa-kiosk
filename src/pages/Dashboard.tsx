// src/pages/Dashboard.tsx
// Main page: 3D canvas + HUD + panels + teleport + settings + onboarding.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BabylonCanvas from "@/components/canvas/BabylonCanvas";
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import { Layers } from "lucide-react";
import HUD from "@/components/hud/HUD";
import RoomLabel from "@/components/hud/RoomLabel";
import ServiceErrorToast from "@/components/hud/ServiceErrorToast";
import ConnectionBanner from "@/components/hud/ConnectionBanner";
import AppNotice from "@/components/hud/AppNotice";
import FirstRunTips from "@/components/hud/FirstRunTips";
import SummaryBar from "@/components/hud/SummaryBar";
import TapRipple, { RIPPLE_LIFETIME_MS, type Ripple } from "@/components/hud/TapRipple";
import { hasSeenFirstRunTips } from "@/utils/storage";
import TeleportMenu from "@/components/teleport/TeleportMenu";
import PanelRouter from "@/components/panels/PanelRouter";
import { PanelActionsProvider } from "@/components/panels/PanelActionsContext";
import SettingsModal from "@/components/settings/SettingsModal";
import ConfigEditorModal from "@/components/settings/ConfigEditorModal";
import { useConfig } from "@/config/ConfigContext";
import { roomKey } from "@/config/roomKey";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import RoomChoiceSheet, { type RoomChoice } from "@/components/hud/RoomChoiceSheet";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability, isMappingAllowed } from "@/auth/permissions";
import FacilityModal from "@/components/fm/FacilityModal";
import ReportsModal from "@/components/reports/ReportsModal";
import GuestReportModal from "@/components/fm/GuestReportModal";
import { useHA } from "@/ha/HAStateStore";
import { mappingForEntityId, displayLabelFor, resolveEntityRoom } from "@/config/EntityMap";
import { deriveHaScenes, scenesForRoom } from "@/config/haScenes";
import { effectiveCategory, categoryColor, CATEGORY_ICONS, CATEGORY_LABELS } from "@/config/EntityCategories";
import { badgeFaceAndRing } from "@/utils/deviceActivity";
import { dismissedEntitySet } from "@/config/dismissedEntities";
import { phantomEntity } from "@/utils/phantomEntity";
import { iconKeyFor } from "@/babylon/badgeIconKeys";
import { isQuickToggle } from "@/utils/quickAction";
import { useOptimisticToggle } from "@/hooks/useOptimisticToggle";
import { HAServices } from "@/ha/HAServiceCalls";
import { installDailyAutoReload } from "@/utils/autoReload";
import type { SceneManager } from "@/babylon/SceneManager";
import type { ActivePanel } from "@/types/panel.types";
import type { Category, TeleportPoint } from "@/types/scene.types";

/** binary_sensor device_classes that mean "someone/something moved" — the
 *  motion toast below announces these. Mirrors the ACCESS_BINARY_DC set
 *  EntityCategories uses to bucket the same sensors. */
const MOTION_DEVICE_CLASSES = new Set(["motion", "presence", "occupancy", "moving"]);

export default function Dashboard() {
  const { config, update, resolvedRooms, setResolvedRooms } = useConfig();
  const { role } = useProfile();
  const { connect, entities, suppressedEntityIds, ws, haConfig, subscribeAll, entityAreaNames } = useHA();
  // ProfileGate does NOT guarantee a signed-in role before this page mounts
  // (v2.30.2's early scene preload — an explicit, informed trade-off, see
  // ProfileGate's modelPreloadable — mounts it pre-login on non-iOS
  // platforms) — `role` is genuinely null until then, so every capability
  // check below must (and does) treat that as "nothing allowed," same as an
  // unrecognised role would.
  const canControl = role != null && hasCapability(role, "controlEntities");
  // Facility workspace: the facility manager (whose job it is) and the owner
  // (accountable for the property, signs off the monthly report).
  const canManageFacility = role != null && hasCapability(role, "manageFacility");
  const canReportFault = role != null && hasCapability(role, "reportFault");
  const canOpenSettings = role != null && hasCapability(role, "openSettings");
  const canEditConfig = role != null && hasCapability(role, "editConfig");
  // Read inside the onCalibrated/onReady effect below (which intentionally
  // only depends on [manager], so its closure would otherwise see a stale
  // config.teleportPoints from whenever that effect last ran).
  const configRef = useRef(config);
  configRef.current = config;
  // Same reasoning, for the motion-toast subscription below (deps: [subscribeAll]).
  const resolvedRoomsRef = useRef(resolvedRooms);
  resolvedRoomsRef.current = resolvedRooms;

  const [manager, setManager] = useState<SceneManager | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  const [teleportOpen, setTeleportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configEditorOpen, setConfigEditorOpen] = useState(false);
  const [facilityOpen, setFacilityOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  /** Device the Facility modal should open a blank fault for — set by a
   *  panel's "report a fault" shortcut, cleared as soon as the modal has
   *  consumed it so reopening Facility later doesn't resurrect the form. */
  const [faultForEntity, setFaultForEntity] = useState<string | null>(null);
  /** A Facility record the HUD's Cockpit asked to open — an existing ticket, or
   *  the schedule tab. ⚠️ DASHBOARD OWNS IT because Dashboard owns whether the
   *  Facility dialog is open at all; Cockpit can only ask. */
  const [facilityRecord, setFacilityRecord] =
    useState<{ kind: "fault" | "schedule"; id: string } | null>(null);
  /** Device a GUEST is reporting a problem with (see GuestReportModal). */
  const [guestReportFor, setGuestReportFor] = useState<string | null>(null);
  // When Advanced Settings is opened from a device panel's edit shortcut, this
  // holds the entity_id to pre-filter the entity table on (null = opened from
  // Settings, so "Back" returns to Settings rather than just closing).
  const [configEditorFocus, setConfigEditorFocus] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  // A tapped zoomed-out room-cluster chip (see EntityVisuals' LOD bands) — its
  // members open in the SAME group modal a bottom-bar tile uses, so a cluster
  // needs no UI concept of its own.
  const [clusterGroup, setClusterGroup] = useState<{ room: string; entityIds: string[] } | null>(null);
  // Long-press a HUD category filter icon — every device in that category,
  // the same group modal a SummaryBar tile or a room cluster opens. Only
  // computed once a category is actually held (cheap null-skip otherwise).
  const [categoryGroup, setCategoryGroup] = useState<Category | null>(null);
  // Live HA scenes (see config/haScenes.ts) — derived, not stored, so a scene
  // added/edited/removed in HA's own Scene Editor shows up here on the very
  // next entity update. Computed once here (not per-panel-open) since both
  // the cluster panel below AND SummaryBar's global tile need it.
  const haScenes = useMemo(
    () => deriveHaScenes(entities, suppressedEntityIds, resolvedRooms),
    [entities, suppressedEntityIds, resolvedRooms],
  );
  const [currentFloor, setCurrentFloor] = useState(1);
  const [floorsAvailable, setFloorsAvailable] = useState<number[]>([1]);
  /** Entities with real geometry in the loaded model (see manager.mappedEntityIds). */
  const [mappedEntityIds, setMappedEntityIds] = useState<Set<string>>(new Set());
  // A device with no badge/mesh of its own can still be represented ON the
  // map INDIRECTLY: it's some other mapped device's linkedEntityId (its ring
  // toggle) or motionEntityId (a camera's detection sensor, driving its
  // beam). Every "not on the map" / "devices offline" surface (HUD, the
  // SummaryBar group modals, Facility readiness) reads THIS augmented set
  // rather than the raw one, so a device like "AP Living Room LED" — no
  // geometry of its own, but the linkedEntityId of a mapped light switch —
  // stops being reported as missing from the map it's actually reachable
  // from. Recomputed from config, not baked into the raw set at load time,
  // so re-linking a device in Settings takes effect without a model reload.
  //
  // Dismissed entities (see AppConfig.dismissedEntityIds) are removed HERE
  // rather than at each list that renders them. This set is what every
  // "is it on the map / does it exist" surface downstream reads — the
  // unavailable-devices modal, the room-cluster list, Facility readiness —
  // so filtering once is what makes "Remove" mean the same thing in all of
  // them. It cannot be done by filtering config.entityMap instead: rebuilding
  // that object per render is exactly what forced a full multi-second Babylon
  // re-index in 2.58.0 (see filterConfigForRole's docstring), whereas this
  // derived Set is already recomputed and costs nothing.
  const dismissedIds = useMemo(
    () => dismissedEntitySet(config.dismissedEntityIds, entities),
    [config.dismissedEntityIds, entities],
  );
  const effectiveMappedEntityIds = useMemo(() => {
    const augmented = new Set<string>();
    for (const id of mappedEntityIds) if (!dismissedIds.has(id)) augmented.add(id);
    for (const mapping of Object.values(config.entityMap)) {
      if (mapping.linkedEntityId && !dismissedIds.has(mapping.linkedEntityId)) {
        augmented.add(mapping.linkedEntityId);
      }
      if (mapping.motionEntityId && !dismissedIds.has(mapping.motionEntityId)) {
        augmented.add(mapping.motionEntityId);
      }
    }
    return augmented;
  }, [mappedEntityIds, config.entityMap, dismissedIds]);
  // Mirrored into a ref for the motion-toast subscription below, which reads
  // it from inside a subscribeAll callback set up once ([subscribeAll] only)
  // — a plain closure over the memo would freeze on whatever set existed at
  // subscribe time.
  const effectiveMappedIdsRef = useRef(effectiveMappedEntityIds);
  effectiveMappedIdsRef.current = effectiveMappedEntityIds;
  // Diagnostic/hidden-in-HA entities are excluded UNLESS they're actually on
  // the map (effectiveMappedEntityIds — real geometry, or linked/motion to
  // something that has it): the same distinction the map badge itself uses
  // (a UniFi AP's diagnostic "State" sensor someone deliberately bound to a
  // mesh stays visible). This is NOT "show every diagnostic entity in this
  // category" — an orphan RSSI/battery/uptime sensor that was never bound to
  // anything visual stays filtered out exactly like before, category by
  // category, entity by entity; only ones with real map presence get the
  // exception.
  //
  // isMappingAllowed(role, ...) matters here specifically because this list
  // is built directly from the RAW config.entityMap, bypassing the Babylon
  // layer entirely — unlike a room-cluster's entityIds (sourced from
  // EntityVisuals, which already never creates a badge for a denied-type
  // entity — see indexMeshes/resolveMeshToMapping), nothing upstream of this
  // computation has applied RBAC at all. Without this check, a category a
  // role CAN see (e.g. "access_control") could still list an individually
  // denied TYPE within it (a role that allows cameras but denies locks,
  // say) — connected-profile-aware from the start, not left to the shared
  // SummaryGroupPanel to somehow guess.
  const categoryGroupEntityIds = useMemo(() => {
    if (!categoryGroup || !role) return [];
    return Object.entries(config.entityMap)
      .filter(([id, mapping]) => {
        // Same dismissal rule as every other surface — this list reads the raw
        // entityMap, so a row the owner removed would otherwise still appear
        // here (reported: gone from Advanced Settings, still in the category
        // modal) whenever the entityMap delete itself hasn't propagated yet.
        if (dismissedIds.has(id)) return false;
        if (!isMappingAllowed(role, id, mapping)) return false;
        const dc = entities[id]?.attributes.device_class as string | undefined;
        if (effectiveCategory(id, mapping.type, mapping.category, dc) !== categoryGroup) return false;
        if (suppressedEntityIds.has(id) && !effectiveMappedEntityIds.has(id)) return false;
        return true;
      })
      .map(([id]) => id);
  }, [categoryGroup, role, config.entityMap, entities, suppressedEntityIds, effectiveMappedEntityIds, dismissedIds]);
  const [modelKey, setModelKey] = useState(0); // bump to force canvas remount
  // Starts "overview" to match the actual landing view (see the one-shot
  // effect below): the HUD reads this to decide joystick vs. overview-help
  // in the bottom bar, and it used to default to "first-person" here, so the
  // joystick flashed on screen during the initial load before the one-shot
  // effect below caught up and flipped it — nothing is interactive yet
  // during loading anyway, so there's no reason this initial value should
  // ever have differed from the view the user actually lands in.
  const [viewMode, setViewMode] = useState<"first-person" | "overview">("overview");
  // Mirrors SceneManager.hasOverviewDefault() (a localStorage read) into React
  // state so the HUD button's pressed state updates immediately after
  // save/clear, without polling. Re-derived per manager since a model reload
  // swaps the manager but the saved device pose is still valid to show.
  const [hasOverviewDefault, setHasOverviewDefault] = useState(false);
  // General app notices (e.g. "this floor isn't modelled yet") — themed,
  // replaces a native alert() that used to break out of the kiosk's own
  // dark/light chrome entirely. See AppNotice.
  const [notice, setNotice] = useState<string | null>(null);
  // First-ever login on this device — see FirstRunTips/utils/storage's
  // hasSeenFirstRunTips docstring. Checked once, lazily, so it reflects
  // whatever was in localStorage when this component first mounted rather
  // than being re-evaluated (and potentially flipping on) on every render.
  const [showFirstRunTips, setShowFirstRunTips] = useState(() => !hasSeenFirstRunTips());
  // Tap-acknowledgment ripples for the in-scene quick-toggle gesture (tap a
  // light/switch -> instant HA call, no panel) — see TapRipple's docstring
  // for why this exists instead of predicting the on/off outcome.
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleIdRef = useRef(0);
  const spawnRipple = useCallback((x: number, y: number) => {
    const id = ++rippleIdRef.current;
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), RIPPLE_LIFETIME_MS);
  }, []);

  // Once-a-day auto-reload safety net (see utils/autoReload.ts) against a slow
  // background memory drift — only fires during its quiet overnight hour AND
  // when nothing's open AND no one's touched the kiosk recently, so it never
  // interrupts real use. Read via refs (not React deps) because the check runs
  // on a plain setInterval outside the render cycle; the refs just mirror
  // whatever's most recently rendered.
  const modalOpenRef = useRef(false);
  useEffect(() => {
    modalOpenRef.current = !!activePanel || teleportOpen || settingsOpen || configEditorOpen || facilityOpen || reportsOpen;
  }, [activePanel, teleportOpen, settingsOpen, configEditorOpen, facilityOpen, reportsOpen]);
  const lastInteractionRef = useRef(Date.now());
  useEffect(() => {
    const mark = () => { lastInteractionRef.current = Date.now(); };
    document.addEventListener("pointerdown", mark);
    document.addEventListener("keydown", mark);
    document.addEventListener("wheel", mark, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", mark);
      document.removeEventListener("keydown", mark);
      document.removeEventListener("wheel", mark);
    };
  }, []);
  useEffect(() => installDailyAutoReload(() =>
    !modalOpenRef.current && Date.now() - lastInteractionRef.current > 5 * 60_000,
  ), []);

  // Auto-connect on load / refresh. We always reach HA through the same-origin
  // Supervisor proxy (token injected server-side), so no credentials are needed.
  useEffect(() => {
    connect().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt the connected HA instance's own location for sun tracking, once, when
  // it arrives — replaces the old onboarding step that used to confirm it.
  const adoptedLocationRef = useRef(false);
  useEffect(() => {
    if (adoptedLocationRef.current || !haConfig) return;
    adoptedLocationRef.current = true;
    if (typeof haConfig.latitude === "number" && typeof haConfig.longitude === "number") {
      update({ latitude: haConfig.latitude, longitude: haConfig.longitude });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [haConfig]);

  // Real-sun fallback: if HA has no sun.sun entity, refresh lighting hourly.
  // Depend on sun.sun SPECIFICALLY, not the whole `entities` map — `entities`
  // gets a new reference on every single state_changed event for ANY entity
  // in the house (see HAStateStore's setEntities), so depending on it here
  // re-ran this effect (and tore down/recreated the interval) on every
  // unrelated sensor update instead of only when sun.sun itself changes.
  const haSun = entities["sun.sun"];
  useEffect(() => {
    if (!manager) return;
    if (haSun) {
      manager.sun.applyHaSunState(haSun.state);
      return;
    }
    manager.sun.applyRealSun();
    const t = setInterval(() => manager.sun.applyRealSun(), 1000 * 60 * 15);
    return () => clearInterval(t);
  }, [manager, haSun]);

  const onEntityPicked = useCallback(
    (entityId: string, clientX: number, clientY: number) => {
      // mappingForEntityId handles type-upgrade for stored "sensor" fallbacks
      // (e.g. input_boolean entities bound before that domain was recognized).
      const mapping = mappingForEntityId(entityId, config.entityMap);
      if (!mapping) return;
      // RBAC: the scene already hides badges for denied entities, but the raw
      // 3D mesh is still tappable — enforce the permission here too.
      if (!canControl || !role || !isMappingAllowed(role, entityId, mapping)) return;

      // Simple on/off entities act in-world without the panel: a tap toggles
      // instantly. A long-press always opens the full panel instead (see
      // onEntityLongPressed below) — that's the deliberate, harder-to-trigger
      // action a "confirm before acting" gate would otherwise provide.
      const entity = entities[entityId];
      if (isQuickToggle(mapping, entity)) {
        HAServices.toggleEntity(ws, entityId);
        // No panel opens for this path, so nothing on screen changes until
        // HA's real state_changed round-trip lands — spawn a tap ripple right
        // at the tap point so the gesture itself reads as acknowledged. See
        // TapRipple's docstring for why this doesn't predict on/off.
        spawnRipple(clientX, clientY);
        return;
      }

      // Rich entities (sliders, streams, info) open their control panel as before.
      setActivePanel({ entityId, mapping });
    },
    [config.entityMap, entities, ws, role, canControl, spawnRipple],
  );

  // Long-press always opens the full control panel — even for quick-toggle
  // entities (lights/switches) — so brightness/colour stay reachable without the
  // panel popping up on every casual tap.
  const onEntityLongPressed = useCallback(
    (entityId: string, clientX: number, clientY: number) => {
      const mapping = mappingForEntityId(entityId, config.entityMap);
      if (!mapping) return;
      if (!canControl || !role || !isMappingAllowed(role, entityId, mapping)) return;
      // Acknowledge the HOLD itself, the moment it's recognised (the gesture
      // now fires mid-press, not on release — see TapRecognizer). Every
      // long-press gets this, on desktop mouse as much as on touch: the ripple
      // is plain DOM with no pointer-type gate, it was simply never spawned on
      // this path before, so a held mouse button gave no feedback at all.
      // Deliberately the SAME affordance the quick-toggle tap uses rather than
      // a second bespoke one — one "your gesture registered" language.
      spawnRipple(clientX, clientY);
      // Long-press opens the compact panel — the SAME one every device's
      // long-press opens (state/controls + the linked-entity switch from
      // shared BasePanel chrome, see PanelActionsContext). A camera's own tap
      // already jumps into the live feed (its quick action, exactly like a
      // light's tap is an instant toggle — see quickAction.ts), so a camera
      // long-press asks PanelRouter for the compact panel explicitly
      // (`detail`) instead of repeating the feed. Every other type has no
      // distinct quick action, so tap and long-press already land on the same
      // panel with no flag needed — see ActivePanel's docstring for the full
      // reasoning.
      setActivePanel({ entityId, mapping, detail: mapping.type === "camera" });
    },
    [config.entityMap, role, canControl, spawnRipple],
  );

  // Announce motion the moment it's detected, wherever it happens: a brief
  // toast naming the room and the device that saw it. Subscribes to the raw
  // state stream (not `entities`) so it fires exactly once per transition
  // rather than on every unrelated re-render. Only OFF->ON edges announce;
  // a sensor already "on" when the page loads doesn't fire a stale alert.
  useEffect(() => {
    const wasOn = new Map<string, boolean>();
    return subscribeAll((e) => {
      const id = e.entity_id;
      if (!id.startsWith("binary_sensor.")) return;
      const map = configRef.current.entityMap[id];
      const deviceClass = e.attributes?.device_class as string | undefined;
      // A motion/presence detector, by device_class or (when HA doesn't report
      // one) by the same id hints categoryForEntity uses.
      const isMotion = MOTION_DEVICE_CLASSES.has(deviceClass ?? "")
        || /(^|[._])(motion|presence|occupancy|pir)([._]|$)/.test(id);
      if (!isMotion) return;
      // Only announce a sensor actually configured somewhere in the app —
      // real geometry in the model, or another mapping's Linked entity /
      // Motion sensor field (see effectiveMappedEntityIds above). Without
      // this, any motion/presence/occupancy sensor HA happens to expose
      // fires the toast, configured or not.
      if (!effectiveMappedIdsRef.current.has(id)) return;

      const on = e.state === "on";
      const prev = wasOn.get(id);
      wasOn.set(id, on);
      if (!on || prev === undefined || prev) return; // only a fresh off->on edge

      const label = displayLabelFor(id, map?.label, e.attributes?.friendly_name as string | undefined);
      const room = resolvedRoomsRef.current[id];
      // One phrasing for every source: the ROOM alone when known ("Motion
      // detected · Guest Bathroom"), never room + device suffixed together —
      // a camera's own motion entity has no `room` mapped and falls back to
      // its label ("Parking Motion"), which already reads as a place. Used to
      // append "— {label}" whenever a room WAS known too (a plain device
      // occupancy sensor's label, e.g. "Motion4 Occupancy"), so the identical
      // event read differently depending only on which entity fired it.
      setNotice(room ? `Motion detected · ${room}` : `Motion detected · ${label}`);
    });
  }, [subscribeAll]);

  // Open an entity's control panel from a SummaryBar tile (a lock/climate
  // "open" tile). The tile already gates on category permission before calling
  // this; the panel's own controls enforce RBAC for any action taken inside.
  const openEntityPanel = useCallback(
    (entityId: string) => {
      const mapping = mappingForEntityId(entityId, config.entityMap);
      if (mapping) setActivePanel({ entityId, mapping });
    },
    [config.entityMap],
  );

  // The open panel's LINKED entity (EntityMapping.linkedEntityId) — resolved
  // at top level rather than inside the provider's value below, because its
  // switch is optimistic and hooks can't run inside that conditional IIFE.
  // Optimistic because the switch otherwise can't move until the device
  // itself confirms, which for some integrations (an AP LED, say) genuinely
  // takes seconds — see useOptimisticToggle for the full reasoning.
  const linkedEntityId = activePanel
    ? (config.entityMap[activePanel.entityId] ?? activePanel.mapping).linkedEntityId
    : undefined;
  const linkedSend = useCallback(() => {
    if (linkedEntityId) HAServices.toggleEntity(ws, linkedEntityId);
  }, [ws, linkedEntityId]);
  const linkedToggle = useOptimisticToggle(
    linkedEntityId,
    linkedEntityId ? entities[linkedEntityId]?.state === "on" : false,
    linkedSend,
  );

  // The open panel's MOTION sensor (EntityMapping.motionEntityId) — camera-
  // only, and read-only: unlike linkedEntityId this drives the map's
  // detection beam from HA's own report, not something a switch can flip, so
  // there's no optimistic hook here, just the live state. Configured in
  // Advanced Settings' "Motion sensor" field but, until now, never actually
  // shown anywhere in the panel itself — a camera could have one wired up
  // with no way to see that from the panel that camera opens.
  const motionEntityId = activePanel?.mapping.type === "camera"
    ? (config.entityMap[activePanel.entityId] ?? activePanel.mapping).motionEntityId
    : undefined;

  // Open the app in the bird's-eye overview by default — seeing the whole villa
  // at a glance is the natural landing view. One-shot: fires the first time the
  // scene becomes ready (model loaded + fitted) and never overrides the user's
  // later manual camera toggles.
  const defaultedToOverview = useRef(false);
  useEffect(() => {
    if (!manager) return;
    // A new SceneManager means a cold start OR a fresh model (re)load (the canvas
    // remounts on upload, bumping modelKey). Re-arm the one-shot so the newly
    // loaded villa lands in the bird's-eye overview just like opening the add-on.
    defaultedToOverview.current = false;
    const goOverview = () => {
      if (defaultedToOverview.current) return;
      defaultedToOverview.current = true;
      manager.setViewMode("overview");
      setViewMode("overview");
    };
    if (manager.isReady()) goOverview();
    return manager.onReady(goOverview);
  }, [manager]);

  // Read this device's saved-default-view flag whenever the manager changes
  // (a model reload swaps it) so the HUD button's pressed state is correct
  // from the start, not just after the user next saves it.
  useEffect(() => {
    setHasOverviewDefault(manager?.hasOverviewDefault() ?? false);
  }, [manager]);

  // Tap the brand icon (see HUD.tsx's .hud-brand + useHomeAnchor) → jump to
  // the saved default. Unlike the old floor-stack anchor button (overview
  // mode only), this icon is always visible, so a press from first-person
  // switches into overview FIRST — setViewMode("overview") already applies
  // the saved default itself (or auto-fits, if none), see
  // SceneManager.setViewMode — before reporting whether one existed.
  const applyOverviewDefault = useCallback((): boolean => {
    if (!manager) return false;
    if (manager.getViewMode() !== "overview") {
      manager.setViewMode("overview");
      setViewMode("overview");
      return manager.hasOverviewDefault();
    }
    return manager.applyOverviewDefault();
  }, [manager]);

  // Long-press / right-click the brand icon → (re)define the default as the
  // CURRENT overview framing. Meaningless outside overview (there's no
  // framing to capture) — same guard SceneManager.saveOverviewDefault
  // already enforces; the boolean return just lets the confirmation flash
  // say so instead of silently doing nothing.
  const saveOverviewDefault = useCallback((): boolean => {
    if (!manager || manager.getViewMode() !== "overview") return false;
    manager.saveOverviewDefault();
    setHasOverviewDefault(true);
    return true;
  }, [manager]);

  const onFloorChange = useCallback(
    (floor: number) => {
      if (!manager) return;
      if (manager.floors.hasFloor(floor)) {
        manager.floors.switchToFloor(floor);
        setCurrentFloor(floor);
      } else {
        // Floor not modelled yet.
        setNotice(`Floor ${floor} isn't modelled yet — coming soon.`);
      }
    },
    [manager],
  );

  // Picking a floor chip in the Rooms dial. The dial reveals that floor's room
  // chips regardless (HUD-local state); this only decides what the SCENE does,
  // and it must PRESERVE the current view mode:
  //   • Overview  → switch to that storey and frame the whole floor (this
  //                 device's saved bird's-eye default, or the auto-fit).
  //   • First-person → do nothing to the camera/mode. You're browsing to a room;
  //                 picking one then teleports (and switches floors) in first-
  //                 person. Forcing overview here was the bad UX being reported.
  const handleShowFloor = useCallback(
    (floor: number) => {
      if (!manager) return;
      if (manager.getViewMode() === "overview") {
        onFloorChange(floor);
        manager.applyOverviewDefault();
      }
    },
    [manager, onFloorChange],
  );

  // When the model finishes loading, read which floors exist and adopt the
  // room/teleport anchors the scene fitted to THIS model (so the teleport menu
  // and room labels are correct regardless of the GLB's scale/orientation).
  useEffect(() => {
    if (!manager) return;
    const adopt = () => {
      setFloorsAvailable(manager.floors.getFloorsDetected());
      // Which devices are actually ON the 3D map — the SummaryBar's group
      // modals mark everything else as "not on the map" (it exists in HA but
      // has no geometry in this villa model).
      setMappedEntityIds(new Set(manager.mappedEntityIds()));
      const pts = manager.getCalibratedTeleportPoints();
      if (pts) {
        // Rooms fitted from the sh3d plan always refresh to the new fit
        // (that's the point of re-adopting after a mirror-flip toggle). Any
        // OTHER existing room — one the user added via "Add room here" that
        // has no sh3d counterpart, e.g. a staircase landing — has no fresh
        // entry to refresh from, so it must be preserved rather than dropped.
        // (Nothing to carry forward onto a refreshed point any more: a room's
        // bird's-eye framing is derived from its polygon on arrival rather
        // than stored, so the fresh fit already IS the whole truth.)
        const freshNames = new Set(pts.map((p) => p.name));
        const custom = configRef.current.teleportPoints.filter((p) => !freshNames.has(p.name));
        const next = [...pts, ...custom];
        // Only write when the fit actually MOVED something. This runs on every
        // model load and every re-calibration, and an unconditional update()
        // is never free even when the values are identical: it hands React a
        // new array, which re-persists the whole config to localStorage (see
        // ConfigContext's save effect) and re-runs everything downstream of
        // teleportPoints. The fitted geometry is quantised at the source
        // (SceneManager's `mm`), so equal geometry compares equal here.
        if (JSON.stringify(next) !== JSON.stringify(configRef.current.teleportPoints)) {
          update({ teleportPoints: next });
        }
      }
    };
    const offReady = manager.onReady(adopt);
    // Also re-adopt whenever the scene re-fits rooms (e.g. a mirror toggle in
    // Settings), so the teleport grid + room labels reflect the change live.
    const offCal = manager.onCalibrated(adopt);
    if (manager.isReady()) adopt();
    return () => {
      offReady();
      offCal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager]);

  // Room resolution: HA's own Area assignment wins whenever a device has
  // one; geometric detection (which room polygon the device's own mesh sits
  // inside) is the fallback for whatever HA hasn't organised into an Area
  // yet. Replaces the old "type a room into Advanced Settings" model — see
  // config/EntityMap.ts's docstring for the full reasoning. Recomputed
  // whenever HA's registry data changes (entityAreaNames — live, no reload,
  // see HAStateStore's *_registry_updated subscriptions), whenever the
  // entity list itself changes (a device newly mapped), or whenever the
  // scene's plan-to-world fit changes (same onReady/onCalibrated signals the
  // teleport-point adopt effect above uses — the geometric fallback needs a
  // fresh fit exactly like that effect does). Pushed to BOTH React (every
  // panel reads useConfig().resolvedRooms) and Babylon (SceneManager.
  // setResolvedRooms — badge grouping and motion-routing's room-highlight
  // read it there) so the two layers can never disagree.
  useEffect(() => {
    if (!manager) return;
    const recompute = () => {
      const resolved: Record<string, string> = {};
      for (const id of Object.keys(config.entityMap)) {
        resolved[id] = resolveEntityRoom(entityAreaNames[id], manager.roomForEntity(id));
      }
      // A linkedEntityId/motionEntityId TARGET (a camera's arm/disarm switch,
      // its detection sensor) is never itself a key of config.entityMap —
      // it's only ever a VALUE on some other device's mapping, the same
      // reason effectiveMappedEntityIds above has to separately augment
      // mappedEntityIds with it. This loop was skipping those ids entirely,
      // so they had no resolvedRooms entry at all and fell to "Other" in
      // every room/floor grouping regardless of what Area Home Assistant
      // actually had them in — reported as "linked/motion entities always
      // show up under Other". Resolved the same way as everything else:
      // HA's own Area for that specific entity_id (roomForEntity is always
      // null for these — they have no mesh of their own).
      for (const mapping of Object.values(config.entityMap)) {
        for (const linkedId of [mapping.linkedEntityId, mapping.motionEntityId]) {
          if (linkedId && !(linkedId in resolved)) {
            resolved[linkedId] = resolveEntityRoom(entityAreaNames[linkedId], manager.roomForEntity(linkedId));
          }
        }
      }
      manager.setResolvedRooms(resolved);
      setResolvedRooms(resolved);
    };
    recompute();
    const offReady = manager.onReady(recompute);
    const offCal = manager.onCalibrated(recompute);
    return () => {
      offReady();
      offCal();
    };
  }, [manager, entityAreaNames, config.entityMap, setResolvedRooms]);

  const handleTeleport = useCallback(
    (point: TeleportPoint) => {
      if (!manager) return;
      // Switch floors in BOTH camera modes: floor visibility is real now
      // (split-structure GLBs hide the upper storey), so panning the
      // bird's-eye camera to a 2F room must also reveal the 2F.
      if (point.floor !== currentFloor) {
        onFloorChange(point.floor);
      }
      manager.navigateTo(point);
      setTeleportOpen(false);
    },
    [manager, viewMode, currentFloor, onFloorChange],
  );

  // Tapping a room-cluster chip on the map does the SAME thing tapping that
  // room in the radial dial does (HUD's onRadialPick) — navigate to its
  // saved viewpoint — so the one gesture always has the one effect,
  // wherever "this room" is currently represented on screen. teleportPoints
  // already carries a per-room camera pose calibrated to fully frame that
  // specific room (see SceneManager.navigateTo/roomSpawn), so there's
  // nothing villa-specific to compute here. A room with no saved point
  // (e.g. the catch-all "Other" bucket) falls back to the long-press
  // behaviour — the entity list — rather than silently doing nothing.
  /** Rooms offered by a merged chip's tap, until one is chosen. */
  const [roomChoices, setRoomChoices] = useState<RoomChoice[] | null>(null);

  const goToRooms = useCallback(
    (rooms: string[]) => {
      // ── Tapping a room ALWAYS shows that room's badges ─────────────────
      // One call, no branches, no outcome to inspect. focusRoom exempts the
      // room from grouping (unconditional — see its docstring) and frames it;
      // it cannot report failure because there is no failure mode left to
      // report. Everything that used to sit here — "can it declutter?", a
      // saved-viewpoint fallback, a device-list fallback — existed to choose
      // between outcomes, and choosing is precisely what made one gesture
      // behave three different ways.
      //
      // In particular this must NEVER open the device list. A modal over the
      // map is not "showing the room"; it is the answer to a different
      // question (long-press, which still opens it), and reaching it from a
      // plain tap is what the report was about.
      manager?.focusRooms(rooms);
    },
    [manager],
  );

  /**
   * Press-and-hold on a room chip. A chip that names ONE room hands its devices
   * to the summary panel, as it always has. A MERGED chip asks which of its
   * rooms you meant instead — that question moved here from the plain tap in
   * 2.304.0, because a tap is the "show me" gesture and answering it with a
   * modal is the same mistake as answering it with a device list. Hold is where
   * this app puts every "give me the options" action.
   */
  const handleClusterHeld = useCallback(
    (room: string, entityIds: string[], roomNames: string[]) => {
      const merged = [...new Set(roomNames)].filter(Boolean);
      if (merged.length > 1) {
        setRoomChoices(merged.map((r) => {
          // The FIXED side, normalised ONCE outside the filter — the convention
          // roomKey.ts documents, and the reason a two-argument `sameRoom(a, b)`
          // was deleted rather than kept: it would re-normalise the fixed side
          // on every iteration, which is exactly what this site was doing (once
          // per entity, per room, inside a map over rooms).
          const key = roomKey(r);
          return {
            room: r,
            count: entityIds.filter((id) => roomKey(resolvedRooms[id] ?? "") === key).length,
          };
        }));
        return;
      }
      setClusterGroup({ room, entityIds });
    },
    [resolvedRooms],
  );

  const handleClusterTapped = useCallback(
    (room: string, _entityIds: string[], roomNames: string[]) => {
      // A chip that swallowed other chips stands for SEVERAL rooms, and a short
      // tap now goes to all of them at once: the camera frames their union and
      // every one of them is exempted from grouping, so what lands on screen is
      // the devices themselves and not another chip.
      //
      // It used to ask "which room did you mean?" in a modal, on the reasoning
      // that flying to whichever room won the chip's label would pick for the
      // user. The reasoning was sound and the answer was wrong: a plain tap is
      // the "show me" gesture, and answering it with a question is the same
      // mistake as answering it with a device list (see goToRooms). The
      // chooser is still there for when narrowing to ONE room is what you
      // want — it moved to press-and-hold, which is where this app puts every
      // "give me the options" action.
      const merged = [...new Set(roomNames)].filter(Boolean);
      goToRooms(merged.length > 0 ? merged : [room]);
    },
    [goToRooms],
  );

  // ── Hover tooltip: what is this badge? ────────────────────────────────
  // Mouse only. A touch device has no hover state, and the same gesture there
  // is already a tap that opens the panel, so a tooltip would either never
  // show or fight the tap. Throttled to one hit-test per animation frame:
  // pointermove fires far more often than the answer can change.
  // The one place the app decides what a device is called (useEntityLabel).
  const entityLabel = useEntityLabel();
  const [hoverBadge, setHoverBadge] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverRaf = useRef(0);
  useEffect(() => {
    if (!manager) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      // Only while the pointer is genuinely over the 3D view. The listener is
      // on the window (a badge is a GUI control on the canvas, not a DOM node,
      // so there is no element to hover), which means it also hears about the
      // camera feed, every panel and every modal — and it was naming badges
      // that happen to sit behind whatever the user is actually looking at.
      // Anything drawn OVER the villa is a different surface with its own
      // labelling, so the tooltip stops at the canvas.
      if (!(e.target instanceof Element) || !e.target.classList.contains("babylon-canvas")) {
        setHoverBadge(null);
        return;
      }
      const { clientX, clientY } = e;
      if (hoverRaf.current) return;
      hoverRaf.current = requestAnimationFrame(() => {
        hoverRaf.current = 0;
        const id = manager.hoverBadgeAt(clientX, clientY);
        setHoverBadge(id ? { id, x: clientX, y: clientY } : null);
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(hoverRaf.current);
      hoverRaf.current = 0;
    };
  }, [manager]);

  const pinContinuous = useCallback(() => manager?.pinContinuous() ?? (() => {}), [manager]);

  // Swap between first-person walking and the bird's-eye overview camera.
  const toggleViewMode = useCallback(() => {
    if (!manager) return;
    setViewMode(manager.toggleViewMode());
  }, [manager]);

  return (
    <>
      <BabylonCanvas
        key={modelKey}
        onManager={setManager}
        onEntityPicked={onEntityPicked}
        onEntityLongPressed={onEntityLongPressed}
        onClusterPicked={handleClusterHeld}
        onClusterTapped={handleClusterTapped}
        onFloorChange={(f) => setCurrentFloor(f)}
        onRoomChange={setRoom}
        onNeedModel={() => { if (canOpenSettings) setSettingsOpen(true); }}
        onModelUploaded={() => setModelKey((k) => k + 1)}
      />

      <RoomLabel room={room} />

      <TapRipple ripples={ripples} />

      <AppNotice message={notice} onExpire={() => setNotice(null)} />

      {role && showFirstRunTips && (
        <FirstRunTips onClose={() => setShowFirstRunTips(false)} />
      )}

      <ServiceErrorToast />

      {/* Persistent while the HA socket is down — the only connection signal
          that survives the phone tier, where the top bar's dot is hidden. */}
      <ConnectionBanner />

      <HUD
        currentFloor={currentFloor}
        floorsAvailable={floorsAvailable}
        onSwitchFloor={onFloorChange}
        onShowFloor={handleShowFloor}
        onOpenTeleport={() => setTeleportOpen(true)}
        onNavigateRoom={handleTeleport}
        onOpenSettings={() => { if (canOpenSettings) setSettingsOpen(true); }}
        canOpenSettings={canOpenSettings}
        onMove={(x, y) => manager?.camera.setMovement(x, y)}
        viewMode={viewMode}
        onToggleViewMode={toggleViewMode}
        hasOverviewDefault={hasOverviewDefault}
        onApplyOverviewDefault={applyOverviewDefault}
        onSaveOverviewDefault={saveOverviewDefault}
        mappedEntityIds={effectiveMappedEntityIds}
        onOpenEntity={openEntityPanel}
        onOpenFacility={canManageFacility ? () => setFacilityOpen(true) : undefined}
        onOpenFacilityRecord={canManageFacility ? (kind, id) => {
          setFacilityRecord({ kind, id });
          setFacilityOpen(true);
        } : undefined}
        onOpenReports={canEditConfig ? () => setReportsOpen(true) : undefined}
        onOpenCategory={setCategoryGroup}
      />

      {/* Bottom dashboard strip — scene / quick-action / summary tiles,
          auto-derived from live entities. Centred so it sits between the
          bottom bar's corner controls (view toggle / joystick). */}
      <SummaryBar
        onOpenEntity={openEntityPanel}
        mappedEntityIds={effectiveMappedEntityIds}
        scenes={haScenes}
      />

      {teleportOpen && (
        <TeleportMenu
          manager={manager}
          currentFloor={currentFloor}
          onClose={() => setTeleportOpen(false)}
          onTeleport={handleTeleport}
        />
      )}

      {activePanel && (
        <PanelActionsProvider
          value={{
            entityId: activePanel.entityId,
            // Owner-only: jump straight to this device's row in Advanced Settings.
            onEdit: canEditConfig
              ? () => {
                  setActivePanel(null);
                  setConfigEditorFocus(activePanel.entityId);
                  setConfigEditorOpen(true);
                }
              : undefined,
            // Same capability that gates the Facility workspace itself —
            // offering a shortcut into a screen the profile can't open would
            // be a dead end.
            // Every profile can report; only some can MANAGE. A guest gets a
            // one-screen report form, an owner/facility manager lands in the
            // Faults tab with the device filled in — same button, same intent,
            // the destination differs only by what the profile can act on.
            onReportFault: canReportFault
              ? () => {
                  setActivePanel(null);
                  if (canManageFacility) {
                    setFaultForEntity(activePanel.entityId);
                    setFacilityOpen(true);
                  } else {
                    setGuestReportFor(activePanel.entityId);
                  }
                }
              : undefined,
            // The device's exact map badge (same glyph/colour as the 3D view),
            // shown in the panel header and — for editors — clickable to recolour.
            badge: (() => {
              const { entityId, mapping } = activePanel;
              const ent = entities[entityId];
              // Read the colour from LIVE config, not activePanel.mapping (a
              // snapshot taken when the panel opened) — otherwise the header
              // badge wouldn't reflect a just-picked colour until reopened.
              const liveMapping = config.entityMap[entityId] ?? mapping;
              const category = effectiveCategory(
                entityId, mapping.type, liveMapping.category ?? mapping.category,
                ent?.attributes.device_class as string | undefined);
              // motionEntityId is deliberately NOT an alert source here — it
              // drives the map's detection beam, never a ring (see badgeKind).
              const linkedAlert = !!liveMapping.linkedEntityId && linkedToggle.isOn;
              return {
                category,
                iconKey: iconKeyFor(mapping.type, ent),
                color: liveMapping.badgeColor,
                categoryColor: categoryColor(category),
                // The ONE shared rule (deviceActivity.badgeSurfaceFor), same as
                // the map badge and the device lists — it already folds in the
                // unavailable check every status pill uses and the linked-entity
                // alert, both of which were hand-written here.
                //
                // `linkedAlert` is deliberately the OPTIMISTIC toggle state, not
                // the confirmed one: this header sits directly above the switch
                // the user just pressed, and the two are one thing, so a ring
                // lagging seconds behind its own switch would look like the bug
                // this was written to fix. The MAP badge stays on confirmed
                // state only — it is Babylon-side, and predicting scene
                // appearance is the thing that was rightly reverted before.
                ...(() => {
                  const b = badgeFaceAndRing(mapping.type, ent ?? phantomEntity(entityId), linkedAlert);
                  return { state: b.face, ringState: b.ring };
                })(),
              };
            })(),
            onSetBadgeColor: canEditConfig
              ? (hex) => {
                  const id = activePanel.entityId;
                  const prev = config.entityMap[id] ?? activePanel.mapping;
                  update({
                    entityMap: {
                      ...config.entityMap,
                      [id]: { ...prev, badgeColor: hex ?? undefined },
                    },
                  });
                }
              : undefined,
            // The linked-entity on/off switch, rendered by the shared panel
            // chrome — so it appears on EVERY device type whose
            // linkedEntityId is set, with no per-panel code. isOn/toggle come
            // from the optimistic hook above (declared at top level, since
            // hooks can't live inside this IIFE), so the switch moves the
            // instant it's clicked instead of waiting on a slow device.
            linked: linkedEntityId && canControl
              ? {
                  label: displayLabelFor(
                    linkedEntityId, config.entityMap[linkedEntityId]?.label,
                    entities[linkedEntityId]?.attributes.friendly_name),
                  isOn: linkedToggle.isOn,
                  toggle: linkedToggle.toggle,
                }
              : undefined,
            // Read-only — see motionEntityId's own comment above for why this
            // has no toggle. Shown regardless of canControl (a guest can't
            // flip it either way, but knowing a camera has motion detection
            // wired up is not a control action).
            motion: motionEntityId
              ? {
                  label: displayLabelFor(
                    motionEntityId, config.entityMap[motionEntityId]?.label,
                    entities[motionEntityId]?.attributes.friendly_name),
                  isOn: entities[motionEntityId]?.state === "on",
                }
              : undefined,
          }}
        >
          <PanelRouter
            active={activePanel}
            onClose={() => setActivePanel(null)}
            pinContinuous={pinContinuous}
            onOpenEntity={openEntityPanel}
          />
        </PanelActionsProvider>
      )}

      {/* Hover tooltip: the badge's name, follows the pointer. pointer-events
          are off so it can never become the hover target itself and flicker. */}
      {hoverBadge && (
        <div
          className="badge-tooltip"
          style={{ left: hoverBadge.x, top: hoverBadge.y }}
          role="tooltip"
        >
          {entityLabel(hoverBadge.id)}
        </div>
      )}
      {roomChoices && (
        <RoomChoiceSheet
          choices={roomChoices}
          onClose={() => setRoomChoices(null)}
          onPick={(room) => {
            setRoomChoices(null);
            goToRooms([room]);
          }}
        />
      )}
      {clusterGroup && (
        <SummaryGroupPanel
          group={{ title: clusterGroup.room, icon: Layers, entityIds: clusterGroup.entityIds }}
          canControl={canControl}
          mappedEntityIds={effectiveMappedEntityIds}
          onClose={() => setClusterGroup(null)}
          onOpenEntity={(id) => { setClusterGroup(null); openEntityPanel(id); }}
          roomScenes={scenesForRoom(haScenes, clusterGroup.room)}
          // Same rule as the category browse (Dashboard.tsx's categoryGroup,
          // below) and for the same reason: every id in clusterGroup.entityIds
          // came from EntityVisuals.updateClusters, which only ever includes
          // entities that already have a real badge/mesh — so there is no
          // "orphan diagnostic sensor" case here to filter, only "diagnostic
          // entity someone deliberately bound to the villa", which this list
          // should show like any other room member (matches this modal's own
          // count, which stopped excluding them for the identical reason).
          filterSuppressed={false}
        />
      )}

      {categoryGroup && (
        <SummaryGroupPanel
          group={{ title: CATEGORY_LABELS[categoryGroup], icon: CATEGORY_ICONS[categoryGroup], entityIds: categoryGroupEntityIds }}
          canControl={canControl}
          mappedEntityIds={effectiveMappedEntityIds}
          onClose={() => setCategoryGroup(null)}
          onOpenEntity={(id) => { setCategoryGroup(null); openEntityPanel(id); }}
          // categoryGroupEntityIds has ALREADY applied the precise
          // suppressed/diagnostic filtering (mapped-on-the-map entities kept,
          // orphan diagnostic sensors dropped) — this modal's own blanket
          // filterSuppressed=true default would otherwise strip the
          // legitimately-kept ones straight back out again.
          //
          // Load-bearing invariant, not a coincidence: mappedEntityIds here
          // is the SAME effectiveMappedEntityIds reference categoryGroupEntityIds
          // filtered against above. Every suppressed entity that survived
          // that filter is therefore, by construction, also in this set —
          // so SummaryGroupPanel's own onMap/offMap split (which reads THIS
          // prop) can never place a diagnostic entity under "Not on the
          // map"; it always lands in the on-map, room-grouped list instead.
          // If this prop is ever swapped for a differently-computed set,
          // that guarantee breaks — keep the two in lockstep.
          filterSuppressed={false}
        />
      )}

      {facilityOpen && canManageFacility && (
        <FacilityModal
          onClose={() => {
            setFacilityOpen(false); setFaultForEntity(null); setFacilityRecord(null);
          }}
          mappedEntityIds={effectiveMappedEntityIds}
          onOpenEntity={(id) => { setFacilityOpen(false); openEntityPanel(id); }}
          reportFaultFor={faultForEntity ?? undefined}
          onFaultFormOpened={() => { setFaultForEntity(null); setFacilityRecord(null); }}
          openFaultId={facilityRecord?.kind === "fault" ? facilityRecord.id : undefined}
          openScheduleTab={facilityRecord?.kind === "schedule"}
        />
      )}

      {reportsOpen && canEditConfig && (
        <ReportsModal onClose={() => setReportsOpen(false)} />
      )}

      {guestReportFor !== null && (
        <GuestReportModal
          entityId={guestReportFor}
          onClose={() => setGuestReportFor(null)}
        />
      )}

      {settingsOpen && canOpenSettings && (
        <SettingsModal
          manager={manager}
          onClose={() => setSettingsOpen(false)}
          // ── ADVANCED SETTINGS NESTS OVER SETTINGS, IT DOES NOT REPLACE IT ──
          // Settings STAYS MOUNTED underneath. Until 2.337.0 this closed it in
          // the same commit that opened Advanced — a SWAP — and that one line
          // cost five releases of the dismissal stack compensating for it from
          // the outside: a surface leaving and another arriving at the same
          // instant makes "what is on top" ambiguous for exactly as long as it
          // takes React to settle, and every Back press landing in that window
          // was answered by a handler belonging to a component that no longer
          // existed. Nesting is what the stack was built for, so the hazard is
          // deleted rather than worked around.
          onOpenConfigEditor={() => { setConfigEditorFocus(null); setConfigEditorOpen(true); }}
        />
      )}

      {/* Config Editor as a modal OVER the live villa (not a route) — leaving
          it returns to Settings with no GLB reload; edits already applied live. */}
      {configEditorOpen && canOpenSettings && (
        <ConfigEditorModal
          focusEntityId={configEditorFocus ?? undefined}
          onBack={() => {
            // Just close this one. Settings is still mounted underneath if it
            // was the way in, and was never opened if a device panel was — so
            // there is nothing to restore and nothing to decide.
            setConfigEditorOpen(false);
            setConfigEditorFocus(null);
          }}
          onModelChanged={() => setModelKey((k) => k + 1)}
        />
      )}
    </>
  );
}
