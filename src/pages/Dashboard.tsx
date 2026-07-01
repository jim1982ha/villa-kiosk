// src/pages/Dashboard.tsx
// Main page: 3D canvas + HUD + panels + teleport + settings + onboarding.

import { useCallback, useEffect, useRef, useState } from "react";
import BabylonCanvas from "@/components/canvas/BabylonCanvas";
import HUD from "@/components/hud/HUD";
import RoomLabel from "@/components/hud/RoomLabel";
import TeleportMenu from "@/components/teleport/TeleportMenu";
import PanelRouter from "@/components/panels/PanelRouter";
import ConfirmDialog from "@/components/panels/ConfirmDialog";
import SettingsModal from "@/components/settings/SettingsModal";
import BindDialog from "@/components/settings/BindDialog";
import MarkerDialog from "@/components/settings/MarkerDialog";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import { Link2, MapPin, X } from "lucide-react";
import type { Vec3, EntityMapping } from "@/types/scene.types";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { isIngress, ingressHaUrl } from "@/ha/ingress";
import { mappingForEntityId } from "@/config/EntityMap";
import { isQuickToggle } from "@/utils/quickAction";
import { HAServices } from "@/ha/HAServiceCalls";
import type { SceneManager } from "@/babylon/SceneManager";
import type { ActivePanel } from "@/types/panel.types";
import type { TeleportPoint } from "@/types/scene.types";

export default function Dashboard() {
  const { config, update } = useConfig();
  const { connect, entities, ws } = useHA();

  const [manager, setManager] = useState<SceneManager | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  // Pending instant on/off action awaiting confirmation (Config Editor → Confirm).
  const [confirmAction, setConfirmAction] = useState<{ mapping: EntityMapping; on: boolean } | null>(null);
  const [teleportOpen, setTeleportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [room, setRoom] = useState<string | null>(null);
  const [currentFloor, setCurrentFloor] = useState(1);
  const [floorsAvailable, setFloorsAvailable] = useState<number[]>([1]);
  const [showOnboarding, setShowOnboarding] = useState(!config.onboarded);
  const [modelKey, setModelKey] = useState(0); // bump to force canvas remount
  const [bindMode, setBindMode] = useState(false);
  const [meshToBind, setMeshToBind] = useState<string | null>(null);
  const [placeMode, setPlaceMode] = useState(false);
  const [pointToPlace, setPointToPlace] = useState<Vec3 | null>(null);
  const [viewMode, setViewMode] = useState<"first-person" | "overview">("first-person");

  // Auto-connect on load / refresh. As an add-on we reach HA through the
  // same-origin Supervisor proxy (token injected server-side), so no credentials
  // are needed. Otherwise reconnect from the URL + token saved in localStorage.
  useEffect(() => {
    if (isIngress()) {
      connect(ingressHaUrl(), "").catch(() => {});
    } else if (config.haUrl && config.haToken) {
      connect(config.haUrl, config.haToken).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.haUrl, config.haToken]);

  // Real-sun fallback: if HA has no sun.sun entity, refresh lighting hourly.
  useEffect(() => {
    if (!manager) return;
    const haSun = entities["sun.sun"];
    if (haSun) {
      manager.sun.applyHaSunState(haSun.state);
      return;
    }
    manager.sun.applyRealSun();
    const t = setInterval(() => manager.sun.applyRealSun(), 1000 * 60 * 15);
    return () => clearInterval(t);
  }, [manager, entities]);

  const onEntityPicked = useCallback(
    (entityId: string) => {
      // mappingForEntityId handles type-upgrade for stored "sensor" fallbacks
      // (e.g. input_boolean entities bound before that domain was recognized).
      const mapping = mappingForEntityId(entityId, config.entityMap);
      if (!mapping) return;

      // Simple on/off entities act in-world without the panel. "Confirm" then gates
      // that instant toggle behind a yes/no dialog; without it, the tap toggles now.
      const entity = entities[entityId];
      if (isQuickToggle(mapping, entity)) {
        if (mapping.requiresConfirmation) {
          setConfirmAction({ mapping, on: entity?.state === "on" });
        } else {
          HAServices.toggleEntity(ws, entityId);
        }
        return;
      }

      // Rich entities (sliders, streams, info) open their control panel as before.
      setActivePanel({ entityId, mapping });
    },
    [config.entityMap, entities, ws],
  );

  // Long-press always opens the full control panel — even for quick-toggle
  // entities (lights/switches) — so brightness/colour stay reachable without the
  // panel popping up on every casual tap.
  const onEntityLongPressed = useCallback(
    (entityId: string) => {
      const mapping = mappingForEntityId(entityId, config.entityMap);
      if (!mapping) return;
      setActivePanel({ entityId, mapping });
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

  const onFloorChange = useCallback(
    (floor: number) => {
      if (!manager) return;
      if (manager.floors.hasFloor(floor)) {
        manager.floors.switchToFloor(floor);
        setCurrentFloor(floor);
      } else {
        // Floor not modelled yet.
        alert(`Floor ${floor} isn't modelled yet — coming soon.`);
      }
    },
    [manager],
  );

  // When the model finishes loading, read which floors exist and adopt the
  // room/teleport anchors the scene fitted to THIS model (so the teleport menu
  // and room labels are correct regardless of the GLB's scale/orientation).
  useEffect(() => {
    if (!manager) return;
    const adopt = () => {
      setFloorsAvailable(manager.floors.getFloorsDetected());
      const pts = manager.getCalibratedTeleportPoints();
      if (pts) update({ teleportPoints: pts });
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
      // In overview mode: pan the bird's-eye camera to the room — don't switch
      // floors or move the FP camera (that camera isn't active).
      if (viewMode === "first-person" && point.floor !== currentFloor) {
        onFloorChange(point.floor);
      }
      manager.navigateTo(point);
      setTeleportOpen(false);
    },
    [manager, viewMode, currentFloor, onFloorChange],
  );

  const pinContinuous = useCallback(() => manager?.pinContinuous() ?? (() => {}), [manager]);

  // Bind mode: tapping an object reports its mesh name to open the BindDialog.
  const enterBindMode = useCallback(() => {
    if (!manager) return;
    setSettingsOpen(false);
    setActivePanel(null);
    setBindMode(true);
    manager.setBindMode(true, (meshName) => setMeshToBind(meshName));
  }, [manager]);

  const exitBindMode = useCallback(() => {
    setBindMode(false);
    setMeshToBind(null);
    manager?.setBindMode(false);
  }, [manager]);

  // Place mode: tapping a surface drops a floating marker there.
  const enterPlaceMode = useCallback(() => {
    if (!manager) return;
    setSettingsOpen(false);
    setActivePanel(null);
    setPlaceMode(true);
    manager.setPlaceMode(true, (point) => setPointToPlace(point));
  }, [manager]);

  const exitPlaceMode = useCallback(() => {
    setPlaceMode(false);
    setPointToPlace(null);
    manager?.setPlaceMode(false);
  }, [manager]);

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
        onNeedModel={() => setSettingsOpen(true)}
        onModelUploaded={() => setModelKey((k) => k + 1)}
      />

      <RoomLabel room={room} />

      <HUD
        currentFloor={currentFloor}
        floorsAvailable={floorsAvailable}
        onSwitchFloor={onFloorChange}
        onOpenTeleport={() => setTeleportOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onEnterBindMode={enterBindMode}
        onEnterPlaceMode={enterPlaceMode}
        onMove={(x, y) => manager?.camera.setMovement(x, y)}
        viewMode={viewMode}
        onToggleViewMode={toggleViewMode}
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
        <PanelRouter active={activePanel} onClose={() => setActivePanel(null)} pinContinuous={pinContinuous} />
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.mapping.label}
          message={`${confirmAction.on ? "Turn off" : "Turn on"} ${confirmAction.mapping.label}?`}
          confirmLabel={confirmAction.on ? "Turn off" : "Turn on"}
          onConfirm={() => {
            HAServices.toggleEntity(ws, confirmAction.mapping.entityId);
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          manager={manager}
          onClose={() => setSettingsOpen(false)}
          onModelChanged={() => {
            setSettingsOpen(false);
            setModelKey((k) => k + 1);
          }}
        />
      )}

      {bindMode && (
        <div className="bind-banner">
          <span><Link2 size={18} /> Bind mode — tap an object in the villa to link it to an entity.</span>
          <button className="btn primary" onClick={exitBindMode}><X size={16} /> Done</button>
        </div>
      )}

      {meshToBind && (
        <BindDialog meshName={meshToBind} onClose={() => setMeshToBind(null)} />
      )}

      {placeMode && (
        <div className="bind-banner">
          <span><MapPin size={18} /> Place mode — tap anywhere in the villa to drop a control there.</span>
          <button className="btn primary" onClick={exitPlaceMode}><X size={16} /> Done</button>
        </div>
      )}

      {pointToPlace && (
        <MarkerDialog
          point={pointToPlace}
          floor={manager?.getCurrentFloor() ?? currentFloor}
          onClose={() => setPointToPlace(null)}
        />
      )}

      {showOnboarding && (
        <OnboardingWizard
          onComplete={() => {
            setShowOnboarding(false);
            setModelKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}
