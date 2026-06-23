// src/pages/Dashboard.tsx
// Main page: 3D canvas + HUD + panels + teleport + settings + onboarding.

import { useCallback, useEffect, useState } from "react";
import BabylonCanvas from "@/components/canvas/BabylonCanvas";
import HUD from "@/components/hud/HUD";
import RoomLabel from "@/components/hud/RoomLabel";
import TeleportMenu from "@/components/teleport/TeleportMenu";
import PanelRouter from "@/components/panels/PanelRouter";
import SettingsModal from "@/components/settings/SettingsModal";
import BindDialog from "@/components/settings/BindDialog";
import MarkerDialog from "@/components/settings/MarkerDialog";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import { Link2, MapPin, X } from "lucide-react";
import type { Vec3 } from "@/types/scene.types";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { isIngress, ingressHaUrl } from "@/ha/ingress";
import { mappingForEntityId } from "@/config/EntityMap";
import type { SceneManager } from "@/babylon/SceneManager";
import type { ActivePanel } from "@/types/panel.types";
import type { TeleportPoint } from "@/types/scene.types";

export default function Dashboard() {
  const { config, update } = useConfig();
  const { connect, entities } = useHA();

  const [manager, setManager] = useState<SceneManager | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
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
      setActivePanel({ entityId, mapping });
    },
    [config.entityMap],
  );

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
        onFloorChange={(f) => setCurrentFloor(f)}
        onRoomChange={setRoom}
        onNeedModel={() => setSettingsOpen(true)}
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
