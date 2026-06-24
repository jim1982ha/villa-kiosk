// src/components/canvas/BabylonCanvas.tsx
// Owns the <canvas> + SceneManager lifecycle and wires HA state -> 3D visuals.

import { useEffect, useRef, useState } from "react";
import { SceneManager } from "@/babylon/SceneManager";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { loadModelFromIndexedDB, fetchAddonConfig, getModelMeta, clearStoredModel } from "@/utils/storage";
import { isIngress } from "@/ha/ingress";
import { parseSh3d } from "@/utils/sh3dParser";
import { saveMeshCatalog } from "@/utils/meshCatalog";
import ModelUploader from "@/components/settings/ModelUploader";
import type { EntityMapping } from "@/types/scene.types";

interface Props {
  onManager: (m: SceneManager | null) => void;
  onEntityPicked: (entityId: string) => void;
  onFloorChange: (floor: number) => void;
  onRoomChange: (room: string | null) => void;
  onNeedModel: () => void;
  onModelUploaded: () => void;
}

export default function BabylonCanvas({
  onManager, onEntityPicked, onFloorChange, onRoomChange, onNeedModel, onModelUploaded,
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
  // True when the error came from a failed addon-config model fetch — the user
  // should fix their add-on settings, not upload a file.
  const [addonError, setAddonError] = useState(false);

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
        const addonCfg = await fetchAddonConfig();
        let data: ArrayBuffer | null = null;
        let fromAddon = false;

        if (addonCfg.model_path) {
          // ── Add-on mode: ONLY use the centrally configured model. ──────────
          // No IndexedDB fallback — if the admin set model_path, that is the
          // authoritative source and per-browser uploads are irrelevant.
          const resp = await fetch(`/model/${addonCfg.model_path}`);
          if (!resp.ok) {
            setAddonError(true);
            throw new Error(
              `Central model not found at /model/${addonCfg.model_path} (HTTP ${resp.status}).\n` +
              `Check the add-on configuration: Settings → Add-ons → Villa Kiosk → Configuration.`,
            );
          }
          data = await resp.arrayBuffer();
          fromAddon = true;
        } else {
          // ── Standalone / dev mode: per-browser IndexedDB upload. ──────────
          data = await loadModelFromIndexedDB();
          // Reconcile a stale meta record: the browser can evict the (large) GLB
          // from IndexedDB while keeping the tiny localStorage meta, leaving the
          // app claiming a "stored model" that no longer exists. Clear it so the
          // no-model overlay and Settings agree with what actually loads.
          if (!data && getModelMeta()) await clearStoredModel();
        }

        if (cancelled) return; // StrictMode unmounted us mid-load
        if (!data) {
          // No GLB available (empty IndexedDB in standalone, or model_path unset
          // in the add-on). Show an explanatory overlay instead of silently
          // popping Settings open over a blank blue scene.
          setStatus("no-model");
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
      {status === "no-model" && (
        <div className="center-overlay">
          <div className="body-text">No 3D model loaded yet.</div>
          {isIngress() ? (
            <div className="muted body-text" style={{ whiteSpace: "pre-line" }}>
              Set <strong>model_path</strong> in the add-on configuration
              (Settings → Add-ons → Villa Kiosk → Configuration) to the GLB in
              your <code>/config/www/</code> folder.
            </div>
          ) : (
            <>
              <div className="muted body-text">
                Upload a villa GLB to start exploring.
              </div>
              <ModelUploader minimal onUploaded={onModelUploaded} />
            </>
          )}
        </div>
      )}
      {status === "error" && (
        <div className="center-overlay">
          <div className="danger-text">Failed to load the 3D model.</div>
          <div className="muted body-text" style={{ whiteSpace: "pre-line" }}>{errorMsg}</div>
          {!addonError && (
            <button className="btn primary" onClick={onNeedModel}>Upload model</button>
          )}
        </div>
      )}
    </>
  );
}
