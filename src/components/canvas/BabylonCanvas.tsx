// src/components/canvas/BabylonCanvas.tsx
// Owns the <canvas> + SceneManager lifecycle and wires HA state -> 3D visuals.

import { useEffect, useRef, useState } from "react";
import { SceneManager } from "@/babylon/SceneManager";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { loadModelFromIndexedDB, fetchAddonConfig, getModelMeta, clearStoredModel, versionedModelUrl } from "@/utils/storage";
import { setLoadedModelInfo, sha256Hex } from "@/utils/modelInfo";
import { isIngress } from "@/ha/ingress";
import { parseSh3d } from "@/utils/sh3dParser";
import { saveMeshCatalog } from "@/utils/meshCatalog";
import ModelUploader from "@/components/settings/ModelUploader";
import type { EntityMapping } from "@/types/scene.types";

/**
 * Read a fetch Response to an ArrayBuffer while reporting download progress
 * (0..1). Used for the large central GLB so the loading overlay shows real
 * progress instead of an indeterminate spinner. Falls back to a plain
 * arrayBuffer() read when the stream or Content-Length isn't available (e.g. a
 * service-worker cache hit with no length header).
 */
async function readWithProgress(
  resp: Response,
  onProgress: (frac: number) => void,
): Promise<ArrayBuffer> {
  const total = Number(resp.headers.get("Content-Length")) || 0;
  if (!resp.body || !total) return resp.arrayBuffer();
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

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
  const [progress, setProgress] = useState(0); // 0..1 GLB download progress
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
        let loadedSource = "(per-browser IndexedDB upload)";

        if (addonCfg.model_path) {
          // ── Add-on mode: ONLY use the centrally configured model. ──────────
          // No IndexedDB fallback — if the admin set model_path, that is the
          // authoritative source and per-browser uploads are irrelevant.
          // Version-stamped URL → the service worker serves it from cache on
          // repeat opens (cache-first), so only the first load hits the network.
          const modelUrl = await versionedModelUrl(addonCfg.model_path);
          loadedSource = modelUrl;
          const resp = await fetch(modelUrl);
          if (!resp.ok) {
            setAddonError(true);
            throw new Error(
              `Central model not found at /model/${addonCfg.model_path} (HTTP ${resp.status}).\n` +
              `Check the add-on configuration: Settings → Add-ons → Villa Kiosk → Configuration.`,
            );
          }
          data = await readWithProgress(resp, (f) => { if (!cancelled) setProgress(f); });
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
        if (cancelled) return;

        // Fingerprint the GLB that actually loaded, so Settings can prove which
        // file is in use without needing to toggle an entity. Compare against
        // `shasum -a 256 <file>.glb` and `ls -l` on disk.
        const meshNames = manager.getBindableMeshNames();
        setLoadedModelInfo({
          url: loadedSource,
          bytes: data.byteLength,
          sha256: await sha256Hex(data),
          meshCount: meshNames.length,
        });

        // Expose mesh names for the binding UI.
        saveMeshCatalog(meshNames);
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

        // The villa is interactive now — clear the loading overlay BEFORE the
        // heavy, optional SH3D refresh below. Room labels already render from the
        // persisted config, so we don't make first paint wait on it.
        setStatus("ready");

        // Refresh central room names + calibration in the BACKGROUND. The SH3D
        // can be tens of MB (it's the full SweetHome project) and we fetch +
        // unzip + parse it only for room metadata — doing that inline blocked
        // first paint for seconds on mobile. This keeps all clients in sync when
        // the file changes without holding up the render.
        if (fromAddon && addonCfg.sh3d_path) {
          void (async () => {
            try {
              const sh3dResp = await fetch(await versionedModelUrl(addonCfg.sh3d_path));
              if (!sh3dResp.ok) return;
              const sh3dBuf = await sh3dResp.arrayBuffer();
              const { rooms, entities: sh3dEntities } = await parseSh3d(sh3dBuf);
              if (!cancelled && rooms.length > 0) {
                update({ sh3dRooms: rooms, sh3dEntities });
              }
            } catch (err) {
              console.warn("[BabylonCanvas] central SH3D refresh failed", err);
            }
          })();
        }
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
          <div className="muted">
            Loading the villa…{progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)}%` : ""}
          </div>
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
