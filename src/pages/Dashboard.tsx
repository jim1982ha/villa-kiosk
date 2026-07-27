// src/pages/Dashboard.tsx
// Main page: 3D canvas + HUD + panels + teleport + settings + onboarding.

import { useCallback, useEffect, useRef, useState } from "react";
import BabylonCanvas from "@/components/canvas/BabylonCanvas";
import HUD from "@/components/hud/HUD";
import RoomLabel from "@/components/hud/RoomLabel";
import ServiceErrorToast from "@/components/hud/ServiceErrorToast";
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
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability, isMappingAllowed } from "@/auth/permissions";
import { useHA } from "@/ha/HAStateStore";
import { mappingForEntityId, displayLabelFor } from "@/config/EntityMap";
import { effectiveCategory, CATEGORY_COLORS } from "@/config/EntityCategories";
import { isUnavailable } from "@/utils/stateColors";
import { iconKeyFor } from "@/babylon/badgeIconKeys";
import { isQuickToggle } from "@/utils/quickAction";
import { HAServices } from "@/ha/HAServiceCalls";
import { installDailyAutoReload } from "@/utils/autoReload";
import type { SceneManager } from "@/babylon/SceneManager";
import type { ActivePanel } from "@/types/panel.types";
import type { TeleportPoint } from "@/types/scene.types";

/** binary_sensor device_classes that mean "someone/something moved" — the
 *  motion toast below announces these. Mirrors the ACCESS_BINARY_DC set
 *  EntityCategories uses to bucket the same sensors. */
const MOTION_DEVICE_CLASSES = new Set(["motion", "presence", "occupancy", "moving"]);

export default function Dashboard() {
  const { config, update } = useConfig();
  const { role } = useProfile();
  const { connect, entities, ws, haConfig, subscribeAll } = useHA();
  // ProfileGate does NOT guarantee a signed-in role before this page mounts
  // (v2.30.2's early scene preload — an explicit, informed trade-off, see
  // ProfileGate's modelPreloadable — mounts it pre-login on non-iOS
  // platforms) — `role` is genuinely null until then, so every capability
  // check below must (and does) treat that as "nothing allowed," same as an
  // unrecognised role would.
  const canControl = role != null && hasCapability(role, "controlEntities");
  const canOpenSettings = role != null && hasCapability(role, "openSettings");
  const canEditConfig = role != null && hasCapability(role, "editConfig");
  // Read inside the onCalibrated/onReady effect below (which intentionally
  // only depends on [manager], so its closure would otherwise see a stale
  // config.teleportPoints from whenever that effect last ran).
  const configRef = useRef(config);
  configRef.current = config;

  const [manager, setManager] = useState<SceneManager | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  const [teleportOpen, setTeleportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configEditorOpen, setConfigEditorOpen] = useState(false);
  // When Advanced Settings is opened from a device panel's edit shortcut, this
  // holds the entity_id to pre-filter the entity table on (null = opened from
  // Settings, so "Back" returns to Settings rather than just closing).
  const [configEditorFocus, setConfigEditorFocus] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [currentFloor, setCurrentFloor] = useState(1);
  const [floorsAvailable, setFloorsAvailable] = useState<number[]>([1]);
  /** Entities with real geometry in the loaded model (see manager.mappedEntityIds). */
  const [mappedEntityIds, setMappedEntityIds] = useState<Set<string>>(new Set());
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
    modalOpenRef.current = !!activePanel || teleportOpen || settingsOpen || configEditorOpen;
  }, [activePanel, teleportOpen, settingsOpen, configEditorOpen]);
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
    (entityId: string) => {
      const mapping = mappingForEntityId(entityId, config.entityMap);
      if (!mapping) return;
      if (!canControl || !role || !isMappingAllowed(role, entityId, mapping)) return;
      // linkedEntityId is configurable on every type (it universally drives
      // the badge's red ring — see EntityVisuals.badgeKind), but ONLY a
      // camera uses long-press to TOGGLE it — a camera's tap already IS its
      // panel (the fullscreen feed), so long-press is free to do something
      // else entirely. Every other type, including binary_sensor, keeps
      // long-press opening its detail panel exactly as before, even with a
      // linkedEntityId set — that field is ring-only for them.
      if (mapping.type === "camera" && mapping.linkedEntityId) {
        HAServices.toggleEntity(ws, mapping.linkedEntityId);
        return;
      }
      // A camera's normal panel IS its fullscreen feed (that's what a TAP
      // gives), so a long-press there would otherwise just repeat the tap.
      // Route it to the shared detail/Edit panel instead, matching what a
      // long-press does for every other entity type.
      setActivePanel({ entityId, mapping, detail: mapping.type === "camera" });
    },
    [config.entityMap, role, canControl, ws],
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

      const on = e.state === "on";
      const prev = wasOn.get(id);
      wasOn.set(id, on);
      if (!on || prev === undefined || prev) return; // only a fresh off->on edge

      const label = displayLabelFor(id, map?.label, e.attributes?.friendly_name as string | undefined);
      const room = map?.room;
      setNotice(room ? `Motion detected · ${room} — ${label}` : `Motion detected · ${label}`);
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

  // Tap the anchor button → jump to the saved default (if any).
  const applyOverviewDefault = useCallback((): boolean => manager?.applyOverviewDefault() ?? false, [manager]);

  // Long-press / right-click the anchor button → (re)define the default as
  // the current angle/tilt/zoom/pan.
  const saveOverviewDefault = useCallback(() => {
    manager?.saveOverviewDefault();
    setHasOverviewDefault(true);
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
        const freshNames = new Set(pts.map((p) => p.name));
        const prevByName = new Map(configRef.current.teleportPoints.map((p) => [p.name, p]));
        // A user-saved bird's-eye framing (Rooms-menu long-press in overview,
        // see TeleportMenu) is independent of the room-polygon fit that just
        // ran — carry it forward onto the refreshed point instead of losing
        // it every time a model reload or mirror-flip toggle re-calibrates.
        const merged = pts.map((p) => {
          const savedPose = prevByName.get(p.name)?.overviewPose;
          return savedPose ? { ...p, overviewPose: savedPose } : p;
        });
        const custom = configRef.current.teleportPoints.filter((p) => !freshNames.has(p.name));
        update({ teleportPoints: [...merged, ...custom] });
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
      />

      {/* Bottom dashboard strip — scene / quick-action / summary tiles,
          auto-derived from live entities. Centred so it sits between the
          bottom bar's corner controls (view toggle / joystick). */}
      <SummaryBar
        onOpenEntity={openEntityPanel}
        mappedEntityIds={mappedEntityIds}
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
              // Same two alert sources as EntityVisuals' badgeKind (map
              // badge), mirrored here so the panel header ring never
              // disagrees with the badge that was just tapped to open it. A
              // camera's own beam/ring-driving sensor IS liveMapping.linkedEntityId
              // now (the two fields merged into one), so this single check
              // covers it — no separate camera-only branch needed anymore.
              const lightLinkAlert =
                !!liveMapping.linkedEntityId
                  && entities[liveMapping.linkedEntityId]?.state === "on";
              const sensorOwnAlert = liveMapping.type === "binary_sensor" && ent?.state === "on";
              return {
                category,
                iconKey: iconKeyFor(mapping.type, ent),
                color: liveMapping.badgeColor,
                categoryColor: CATEGORY_COLORS[category].bottom,
                // Same isUnavailable() every status pill (UnavailableNotice,
                // LockPanel, CoverPanel, SensorPanel…) already uses — so the
                // header badge fades in step with the pill right below it,
                // instead of always rendering full-strength regardless of
                // live state (the map badge already fades; this icon didn't).
                unavailable: isUnavailable(ent),
                alertRing: lightLinkAlert || sensorOwnAlert,
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

      {settingsOpen && canOpenSettings && (
        <SettingsModal
          manager={manager}
          onClose={() => setSettingsOpen(false)}
          onOpenConfigEditor={() => { setSettingsOpen(false); setConfigEditorFocus(null); setConfigEditorOpen(true); }}
        />
      )}

      {/* Config Editor as a modal OVER the live villa (not a route) — leaving
          it returns to Settings with no GLB reload; edits already applied live. */}
      {configEditorOpen && canOpenSettings && (
        <ConfigEditorModal
          focusEntityId={configEditorFocus ?? undefined}
          onBack={() => {
            setConfigEditorOpen(false);
            // Opened from Settings → return there; opened from a device panel
            // (focus set) → just close back to the villa.
            if (configEditorFocus === null) setSettingsOpen(true);
            setConfigEditorFocus(null);
          }}
          onModelChanged={() => {
            // Refresh the scene in the BACKGROUND (remount the canvas) but keep
            // this modal open — closing it on every upload felt abrupt. The
            // modal's live controls use `manager?.…` so the brief remount
            // window (old manager torn down, new one not yet ready) is a safe no-op.
            setModelKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}
