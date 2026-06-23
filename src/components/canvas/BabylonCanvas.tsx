// src/components/canvas/BabylonCanvas.tsx
// Owns the <canvas> + SceneManager lifecycle and wires HA state -> 3D visuals.

import { useEffect, useRef, useState } from "react";
import { SceneManager } from "@/babylon/SceneManager";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { loadModelFromIndexedDB, fetchAddonConfig } from "@/utils/storage";
import { parseSh3d } from "@/utils/sh3dParser";
import { saveMeshCatalog } from "@/utils/meshCatalog";
import type { EntityMapping } from "@/types/scene.types";

interface Props {
  onManager: (m: SceneManager | null) => void;
  onEntityPicked: (entityId: string) => void;
  onFloorChange: (floor: number) => void;
  onRoomChange: (room: string | null) => void;
  onNeedModel: () => void;
}

export default function BabylonCanvas({
  onManager, onEntityPicked, onFloorChange, onRoomChange, onNeedModel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const managerRef = useRef<SceneManager | null>(null);
  const { config, update } = useConfig();
  const { subscribeAll, entities } = useHA();
  // Keep a live ref so the one-shot loadModel callback can read the latest config
  // without being recreated (BabylonCanvas mounts once with empty deps).
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);
  const [status, setStatus] = useState<"loading" | "ready" | "no-model" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Create the scene once.
  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    const manager = new SceneManager(canvasRef.current, {
      config,
      onEntityPicked,
      onFloorChange,
      onRoomChange,
    });
    managerRef.current = manager;
    onManager(manager);

    (async () => {
      try {
        // Priority 1: central model configured in the add-on options (all clients
        // share the same model — no per-browser upload). Priority 2: per-client
        // IndexedDB upload (dev mode / non-add-on / local override).
        const addonCfg = await fetchAddonConfig();
        let data: ArrayBuffer | null = null;
        let fromAddon = false;

        if (addonCfg.model_path) {
          try {
            const resp = await fetch(`/model/${addonCfg.model_path}`);
            if (resp.ok) { data = await resp.arrayBuffer(); fromAddon = true; }
            else console.warn(`[BabylonCanvas] /model/${addonCfg.model_path} → ${resp.status}`);
          } catch (err) {
            console.warn("[BabylonCanvas] central model fetch failed, trying IndexedDB", err);
          }
        }

        if (!data) data = await loadModelFromIndexedDB();

        if (cancelled) return; // StrictMode unmounted us mid-load
        if (!data) {
          setStatus("no-model");
          onNeedModel();
          return;
        }
        await manager.loadModel(data);

        // If a central SH3D is configured, load room names + calibration from
        // the server every time (keeps all clients in sync when the file changes).
        if (fromAddon && addonCfg.sh3d_path) {
          try {
            const sh3dResp = await fetch(`/model/${addonCfg.sh3d_path}`);
            if (sh3dResp.ok) {
              const sh3dBuf = await sh3dResp.arrayBuffer();
              const { rooms, entities } = await parseSh3d(sh3dBuf);
              if (rooms.length > 0) {
                update({ sh3dRooms: rooms, sh3dEntities: entities });
              }
            }
          } catch (err) {
            console.warn("[BabylonCanvas] central SH3D fetch failed", err);
          }
        }
        if (cancelled) return;
        // Expose mesh names for the binding UI.
        saveMeshCatalog(manager.getBindableMeshNames());
        // Auto-populate entityMap from meshes whose names are HA entity IDs
        // (cameras, fans, lights, etc.) so they appear in the Config Editor.
        const detected = manager.getAutoDetectedMappings();
        if (detected.length > 0) {
          const current = configRef.current;
          const additions: Record<string, EntityMapping> = {};
          for (const m of detected) {
            if (!current.entityMap[m.entityId]) additions[m.entityId] = m;
          }
          if (Object.keys(additions).length > 0) {
            update({ entityMap: { ...current.entityMap, ...additions } });
          }
        }
        // Paint the current entity states immediately (meshes + markers).
        Object.values(entities).forEach((e) => manager.applyEntityState(e));
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[BabylonCanvas] model load failed", err);
        setErrorMsg((err as Error).message);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      onManager(null);
      manager.dispose();
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply entity map + mesh bindings + markers to the live scene whenever
  // config edits happen (binding an object, dropping a marker, changing a
  // label/type) — no model reload. Then repaint current states so freshly
  // (re)created meshes/markers show the right on/off appearance immediately.
  useEffect(() => {
    const m = managerRef.current;
    if (!m) return;
    m.updateConfig(config);
    Object.values(entities).forEach((e) => m.applyEntityState(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // Pipe every state change into the scene (imperative — no React re-render of canvas).
  useEffect(() => {
    const off = subscribeAll((entity) => {
      const m = managerRef.current;
      if (!m) return;
      m.applyEntityState(entity); // real-mesh visuals + floating markers
      if (entity.entity_id === "sun.sun") m.sun.applyHaSunState(entity.state);
      if (config.weatherEffects && entity.entity_id.startsWith("weather.")) {
        m.weather.setWeather(entity.state);
      }
    });
    return off;
  }, [subscribeAll]);

  return (
    <>
      <canvas ref={canvasRef} className="babylon-canvas" />
      {status === "loading" && (
        <div className="center-overlay">
          <div className="spinner" />
          <div className="muted">Loading the villa…</div>
        </div>
      )}
      {status === "error" && (
        <div className="center-overlay">
          <div className="danger-text">Failed to load the 3D model.</div>
          <div className="muted body-text">{errorMsg}</div>
          <button className="btn primary" onClick={onNeedModel}>Upload model</button>
        </div>
      )}
    </>
  );
}
