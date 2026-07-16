// src/components/canvas/BabylonCanvas.tsx
// Owns the <canvas> + SceneManager lifecycle and wires HA state -> 3D visuals.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { SceneManager } from "@/babylon/SceneManager";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { filterConfigForRole, hasCapability } from "@/auth/permissions";
import { useHA } from "@/ha/HAStateStore";
import { loadModelFromIndexedDB, fetchAddonConfig, getModelMeta, clearStoredModel, versionedModelUrl, roomsPathFor } from "@/utils/storage";
import { setLoadedModelInfo, sha256Hex } from "@/utils/modelInfo";
import { isIngress } from "@/ha/ingress";
import { parseRoomData } from "@/utils/sh3dParser";
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
  onEntityLongPressed: (entityId: string) => void;
  onFloorChange: (floor: number) => void;
  onRoomChange: (room: string | null) => void;
  onNeedModel: () => void;
  onModelUploaded: () => void;
}

export default function BabylonCanvas({
  onManager, onEntityPicked, onEntityLongPressed, onFloorChange, onRoomChange, onNeedModel, onModelUploaded,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const managerRef = useRef<SceneManager | null>(null);
  const { config, update } = useConfig();
  const { role } = useProfile();
  const { subscribeAll, entities } = useHA();
  // What the SCENE is allowed to show for the active profile: role-denied
  // categories folded into the hidden set, denied entities stripped from the
  // entity map. The stored config stays complete (auto-detect below still
  // writes the full map); only the Babylon layer sees the filtered view.
  const sceneConfig = useMemo(
    () => (role ? filterConfigForRole(config, role) : config),
    [config, role],
  );
  const canManageModel = role != null && hasCapability(role, "manageModel");
  // Keep a live ref so the one-shot loadModel callback can read the latest config
  // without being recreated (BabylonCanvas mounts once with empty deps).
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);
  // The pick callbacks close over live HA state (entities/ws) and config, so they
  // are recreated on every relevant change. The SceneManager is created ONCE, so
  // capturing the callbacks directly would freeze them at their mount-time values
  // (empty entities, null ws) — every tap would then wrongly open the panel and
  // toggles would no-op. Route through refs so the scene always calls the latest.
  const onPickedRef = useRef(onEntityPicked);
  const onLongPressedRef = useRef(onEntityLongPressed);
  useEffect(() => { onPickedRef.current = onEntityPicked; }, [onEntityPicked]);
  useEffect(() => { onLongPressedRef.current = onEntityLongPressed; }, [onEntityLongPressed]);
  const [status, setStatus] = useState<"loading" | "ready" | "no-model" | "error">("loading");
  const [progress, setProgress] = useState(0); // 0..1 GLB download progress
  const [errorMsg, setErrorMsg] = useState("");
  // True when the error came from a failed addon-config model fetch — the user
  // should fix their add-on settings, not upload a file.
  const [addonError, setAddonError] = useState(false);
  // The central SH3D refresh below runs silently in the background by design
  // (so first paint isn't blocked on parsing a large SweetHome project) — but
  // "silent" also meant a genuine failure (bad path, unparsable file, no
  // named rooms) was invisible on a kiosk tablet with no devtools console.
  // Surface it instead of only console.warn-ing.
  const [sh3dSyncMsg, setSh3dSyncMsg] = useState<string | null>(null);

  // Create the scene once.
  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    const manager = new SceneManager(canvasRef.current, {
      config: sceneConfig,
      onEntityPicked: (id) => onPickedRef.current(id),
      onEntityLongPressed: (id) => onLongPressedRef.current(id),
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

        // Refresh central room names + calibration in the BACKGROUND from the
        // compact "<model>.rooms.json" sidecar the Blender pipeline emits next to
        // the GLB. (This replaced fetching the full multi-hundred-MB .sh3d, which
        // bundles the whole furniture catalog we never needed.) Doing it off the
        // render path keeps first paint fast and all clients in sync when the
        // file changes.
        if (fromAddon && addonCfg.model_path) {
          const roomsPath = roomsPathFor(addonCfg.model_path);
          void (async () => {
            try {
              const roomsResp = await fetch(await versionedModelUrl(roomsPath));
              if (!roomsResp.ok) {
                if (!cancelled) {
                  setSh3dSyncMsg(
                    `Central room data (${roomsPath}) not found (HTTP ${roomsResp.status}) — room names ` +
                    `weren't refreshed. Re-run the Blender pipeline and upload the .rooms.json in Settings.`,
                  );
                }
                return;
              }
              const roomsText = await roomsResp.text();
              const { rooms, entities: sh3dEntities } = parseRoomData(roomsText);
              if (cancelled) return;
              // If the central plan's room SET changed (admin swapped the file),
              // drop stale rooms so only the new plan's rooms remain — the scene
              // re-calibrates from the fresh set. If it's the same set (the usual
              // every-open refresh), leave teleportPoints alone so user-added
              // rooms + saved overview poses survive.
              const prevNames = (configRef.current.sh3dRooms ?? []).map((r) => r.name).sort().join("|");
              const nextNames = rooms.map((r) => r.name).sort().join("|");
              const roomsChanged = prevNames !== nextNames;
              update(roomsChanged
                ? { sh3dRooms: rooms, sh3dEntities, teleportPoints: [] }
                : { sh3dRooms: rooms, sh3dEntities });
            } catch (err) {
              console.warn("[BabylonCanvas] central room-data refresh failed", err);
              if (!cancelled) {
                setSh3dSyncMsg(`Failed to refresh room names from the central .rooms.json: ${(err as Error).message}`);
              }
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
  // updateConfig() only actually tears down/rebuilds meshes' visuals when it
  // detects a STRUCTURAL change (entityMap/meshBindings/sh3d); every other
  // config edit (a render slider drag, a HUD toggle, "Light effect strength")
  // fires this effect too but leaves existing visuals untouched. Repainting
  // every known HA entity's state is only needed after a real rebuild — doing
  // it unconditionally meant e.g. dragging a settings slider replayed the
  // FULL entity list on every tick, and typing a device label in Advanced
  // Settings (patch() on every keystroke) did the same per keystroke, which is
  // what made the UI feel sluggish while interacting with it.
  const repaintedOnceRef = useRef(false);
  useEffect(() => {
    const m = managerRef.current;
    if (!m) return;
    const structuralChanged = m.updateConfig(sceneConfig);
    // Apply the weather master switch live: unchecking "Live weather effects"
    // must clear existing particles now (no HA event fires on a settings change),
    // and re-checking it must re-apply the current weather immediately. Cheap
    // (id-prefix check only) so it can always run, unlike the full repaint below.
    m.weather.setEnabled(sceneConfig.weatherEffects);
    for (const e of Object.values(entities)) {
      if (e.entity_id.startsWith("weather.")) m.weather.setWeather(e.state);
    }
    if (structuralChanged || !repaintedOnceRef.current) {
      repaintedOnceRef.current = true;
      Object.values(entities).forEach((e) => m.applyEntityState(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneConfig]);

  // Pipe every state change into the scene (imperative — no React re-render of canvas).
  useEffect(() => {
    const off = subscribeAll((entity) => {
      const m = managerRef.current;
      if (!m) return;
      m.applyEntityState(entity); // real-mesh visuals + floating markers
      if (entity.entity_id === "sun.sun") m.sun.applyHaSunState(entity.state);
      // Always forward weather states; WeatherEffects gates on the master switch
      // internally (set via the [config] effect), avoiding a stale-closure read
      // of config.weatherEffects here.
      if (entity.entity_id.startsWith("weather.")) m.weather.setWeather(entity.state);
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
          {!canManageModel ? (
            <div className="muted body-text">
              Ask the owner to set up the villa's 3D model.
            </div>
          ) : isIngress() ? (
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
          {!addonError && canManageModel && (
            <button className="btn primary" onClick={onNeedModel}>Upload model</button>
          )}
        </div>
      )}
      {sh3dSyncMsg && (
        <div className="sh3d-sync-banner">
          <AlertTriangle size={16} />
          <span>{sh3dSyncMsg}</span>
          <button onClick={() => setSh3dSyncMsg(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
