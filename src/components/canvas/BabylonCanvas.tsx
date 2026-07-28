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
import { claimPrefetch } from "@/utils/modelPrefetch";
import { fetchModelWithRetry } from "@/utils/fetchProgress";
import { setLoadedModelInfo, sha256Hex } from "@/utils/modelInfo";
import { parseRoomData } from "@/utils/sh3dParser";
import { report as reportTelemetry } from "@/utils/telemetry";
import { saveMeshCatalog } from "@/utils/meshCatalog";
import ModelUploader from "@/components/settings/ModelUploader";
import ErrorReport from "@/components/ErrorReport";
import {
  isCrashLooping, crashLoopInfo, noteLoadStart, noteLoadPhase, noteModel,
  noteLoadSuccess, clearCrashLoop, noteContextLoss, captureError, buildReport,
} from "@/utils/diagnostics";
import type { EntityMapping } from "@/types/scene.types";

interface Props {
  onManager: (m: SceneManager | null) => void;
  onEntityPicked: (entityId: string, clientX: number, clientY: number) => void;
  onEntityLongPressed: (entityId: string, clientX: number, clientY: number) => void;
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
  const { subscribeAll, getEntitiesSnapshot } = useHA();
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
  const [status, setStatus] = useState<"loading" | "ready" | "no-model" | "error" | "crash-loop">("loading");
  const [progress, setProgress] = useState(0); // 0..1 GLB download progress
  // True while fetchModelWithRetry is riding through a transient network
  // failure on the (public Cloudflare) model download — turns the plain
  // loading spinner into an honest "reconnecting…" message instead of a
  // frozen-looking bar, and (more importantly) means the load is SELF-HEALING
  // rather than dead-ending on the terminal error screen. See fetchModelWithRetry.
  const [reconnecting, setReconnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // Full copyable diagnostics report shown on the error / crash-loop screens.
  const [report, setReport] = useState("");
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

    // Break an iOS out-of-memory reload-loop before it repeats: if the scene
    // has already crashed the page several times in quick succession, don't
    // rebuild it — show the copyable diagnostics screen instead (see
    // utils/diagnostics). This is the only way to "catch" an OS-level OOM kill,
    // which tears the page down before any try/catch can run.
    if (isCrashLooping()) {
      const { count, sinceMs } = crashLoopInfo();
      const cap = captureError(
        "SCENE_LOAD_CRASH_LOOP",
        new Error(
          `The 3D scene failed to load ${count + 1} times in a row over ${Math.round(sinceMs / 1000)}s. ` +
          "The device most likely ran out of memory for this model.",
        ),
        "crash-loop-guard",
      );
      setReport(buildReport(cap));
      setStatus("crash-loop");
      return;
    }
    noteLoadStart();

    let cancelled = false;
    const canvasEl = canvasRef.current;

    let manager: SceneManager;
    try {
      noteLoadPhase("engine-init");
      manager = new SceneManager(canvasEl, {
        config: sceneConfig,
        onEntityPicked: (id, x, y) => onPickedRef.current(id, x, y),
        onEntityLongPressed: (id, x, y) => onLongPressedRef.current(id, x, y),
        onFloorChange,
        onRoomChange,
      });
    } catch (err) {
      // WebGL unavailable/blocked — show a clear message, not a blank canvas.
      setReport(buildReport(captureError("WEBGL_INIT_FAILED", err, "SceneManager")));
      setStatus("error");
      return;
    }
    managerRef.current = manager;
    onManager(manager);

    // A lost GPU/WebGL context (often memory pressure) would otherwise freeze
    // the canvas. Record it; if it happens before the villa finished loading,
    // surface the error instead of hanging.
    let reachedReady = false;
    const onCtxLost = (e: Event) => {
      e.preventDefault();
      noteContextLoss();
      if (!reachedReady) {
        setReport(buildReport(captureError(
          "WEBGL_CONTEXT_LOST",
          new Error("The GPU/WebGL context was lost (commonly from memory pressure)."),
          "webglcontextlost",
        )));
        setStatus("error");
      }
    };
    canvasEl.addEventListener("webglcontextlost", onCtxLost as EventListener, false);

    (async () => {
      let loadErrorCode = "MODEL_LOAD_FAILED";
      try {
        noteLoadPhase("fetch-config");
        const addonCfg = await fetchAddonConfig();
        let data: ArrayBuffer | null = null;
        let fromAddon = false;
        let loadedSource = "(per-browser IndexedDB upload)";
        const tFetchStart = performance.now();

        if (addonCfg.model_path) {
          // ── Central mode: ONLY use the add-on's centrally-stored model. ────
          // No IndexedDB fallback — once a central model exists (uploaded into
          // the add-on's /data store, reported by /addon-config), that is the
          // authoritative source and per-browser uploads are irrelevant.
          // Version-stamped URL → the service worker serves it from cache on
          // repeat opens (cache-first), so only the first load hits the network.
          noteModel({ path: addonCfg.model_path });
          noteLoadPhase("fetch-model");
          const modelUrl = await versionedModelUrl(addonCfg.model_path);
          loadedSource = modelUrl;
          // ProfileGate started downloading this exact URL in the background
          // as soon as the profile-select/PIN screen appeared (see
          // utils/modelPrefetch.ts) — reuse it instead of fetching again from
          // scratch. Falls back to a normal fetch below if nothing matches
          // (prefetch never started, targeted a different/stale URL, or
          // failed) so behaviour is identical to before whenever it can't help.
          const claimed = claimPrefetch(modelUrl);
          if (claimed) {
            const unsubscribe = claimed.onProgress((f) => { if (!cancelled) setProgress(f); });
            try {
              data = await claimed.promise;
            } catch {
              data = null; // prefetch failed — fall through to a normal fetch
            } finally {
              unsubscribe();
            }
          }
          if (!data) {
            // fetchModelWithRetry absorbs a transient NETWORK failure (dropped
            // connection, DNS blip) with a couple of quick retries — common on
            // the standalone hostname's public Cloudflare hop, rare on the HA
            // sidebar's local Ingress path, which is why the same GLB could
            // fail here and not there. An HTTP error status still surfaces
            // immediately below, unretried — that's a real "nothing there"
            // failure, not a blip.
            const { resp, data: fetched } = await fetchModelWithRetry(
              modelUrl,
              (f) => {
                if (cancelled) return;
                setProgress(f);
                // Real bytes flowing again (f > 0, not the 0 a retry resets to)
                // means the blip is over — drop the reconnecting notice.
                if (f > 0) setReconnecting(false);
              },
              () => { if (!cancelled) setReconnecting(true); },
            );
            if (!resp.ok) {
              setAddonError(true);
              loadErrorCode = `MODEL_FETCH_HTTP_${resp.status}`;
              throw new Error(
                `Central model not found at ${modelUrl} (HTTP ${resp.status}).\n` +
                "Re-upload it from Settings → Advanced Settings (Owner profile).",
              );
            }
            data = fetched;
          }
          noteModel({ bytes: data.byteLength });
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
        // Bytes are in hand — clear any lingering reconnecting notice even if
        // the successful fetch happened to report no progress fractions (a
        // cache hit / no Content-Length skips readWithProgress's onProgress).
        setReconnecting(false);
        const tFetchDone = performance.now();
        // The heavy step and the usual iOS OOM point: Draco decode + texture
        // decode + GPU upload of the whole villa.
        noteLoadPhase("import-mesh");
        const { importMs, postMs, phases } = await manager.loadModel(data);
        if (cancelled) return;
        noteLoadPhase("post-process");
        const tParseDone = performance.now();

        // Fingerprint the GLB that actually loaded, so Settings can prove which
        // file is in use without needing to toggle an entity. Compare against
        // `shasum -a 256 <file>.glb` and `ls -l` on disk.
        const meshNames = manager.getBindableMeshNames();
        setLoadedModelInfo({
          url: loadedSource,
          bytes: data.byteLength,
          sha256: await sha256Hex(data),
          meshCount: meshNames.length,
          fetchMs: Math.round(tFetchDone - tFetchStart),
          parseMs: Math.round(tParseDone - tFetchDone),
          importMs: Math.round(importMs),
          postMs: Math.round(postMs),
        });

        // Ship the phase split to the add-on. This is the measurement that
        // turns "the app is slow" into an actionable number — and it's per
        // DEVICE, so a phone that parses 5x slower than the desktop shows up
        // as itself rather than as an anecdote.
        reportTelemetry("load", {
          bytes: data.byteLength,
          meshes: meshNames.length,
          fetchMs: Math.round(tFetchDone - tFetchStart),
          parseMs: Math.round(tParseDone - tFetchDone),
          importMs: Math.round(importMs),
          postMs: Math.round(postMs),
          source: fromAddon ? "addon" : "indexeddb",
          // Which STEP of our own post-processing dominates. Without this a
          // slow load is only ever "post was 3.4s" with no way to act on it.
          ...phases,
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
        // Paint the current entity states immediately (meshes + markers). Read
        // a live snapshot, NOT the `entities` destructured above — this effect
        // has an empty dependency array (a one-shot "create the scene" run),
        // so `entities` would be frozen at whatever it was at MOUNT (almost
        // always still {}, since HA's initial hydrate is an async round-trip
        // that hasn't resolved yet) — see getEntitiesSnapshot's docstring.
        Object.values(getEntitiesSnapshot()).forEach((e) => manager.applyEntityState(e));

        // Sync central room names + calibration from the compact
        // "<model>.rooms.json" sidecar (the Blender pipeline emits it next to
        // the GLB) BEFORE revealing the villa. Applying it can trigger one heavy
        // structural rebuild (re-index + re-calibrate over every mesh); doing it
        // here, while the loading overlay is still up, keeps that work off an
        // already-visible map — which otherwise looked rendered but froze,
        // unclickable, for a few seconds. When the parsed data already matches
        // config (the common re-open case) we skip it entirely, so there's no
        // rebuild and no delay. A hung/missing fetch never blocks the reveal
        // (short timeout + it just proceeds without the refresh).
        if (fromAddon && addonCfg.model_path) {
          noteLoadPhase("post-process");
          const roomsPath = roomsPathFor(addonCfg.model_path);
          try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 5000);
            const roomsResp = await fetch(await versionedModelUrl(roomsPath), { signal: ctrl.signal });
            clearTimeout(tid);
            if (!cancelled && !roomsResp.ok) {
              setSh3dSyncMsg(
                `Central room data (${roomsPath}) not found (HTTP ${roomsResp.status}) — room names ` +
                "weren't refreshed. Re-run the Blender pipeline and upload the .rooms.json in Settings.",
              );
            } else if (!cancelled && roomsResp.ok) {
              const { rooms, entities: sh3dEntities } = parseRoomData(await roomsResp.text());
              if (!cancelled) {
                // Compare by CONTENT, not reference: parseRoomData returns fresh
                // arrays every open, so a reference check would force the
                // rebuild on every load even when nothing actually changed.
                const cur = configRef.current;
                const sameRooms = JSON.stringify(cur.sh3dRooms ?? []) === JSON.stringify(rooms);
                const sameEnts = JSON.stringify(cur.sh3dEntities ?? []) === JSON.stringify(sh3dEntities);
                if (!sameRooms || !sameEnts) {
                  // If the central plan's room SET changed (admin swapped the
                  // file), drop stale rooms so only the new plan's remain — the
                  // scene re-calibrates from the fresh set. Same set: leave
                  // teleportPoints alone so user-added rooms + saved overview
                  // poses survive.
                  const prevNames = (cur.sh3dRooms ?? []).map((r) => r.name).sort().join("|");
                  const nextNames = rooms.map((r) => r.name).sort().join("|");
                  update(prevNames !== nextNames
                    ? { sh3dRooms: rooms, sh3dEntities, teleportPoints: [] }
                    : { sh3dRooms: rooms, sh3dEntities });
                  // Give React a beat to commit + run the config effect (whose
                  // updateConfig does the structural rebuild) BEHIND the overlay,
                  // so we reveal an already-settled, interactive villa.
                  await new Promise<void>((r) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => r())));
                }
              }
            }
          } catch (err) {
            if ((err as Error).name !== "AbortError") {
              console.warn("[BabylonCanvas] central room-data refresh failed", err);
              if (!cancelled) {
                setSh3dSyncMsg(`Failed to refresh room names from the central .rooms.json: ${(err as Error).message}`);
              }
            }
          }
        }
        if (cancelled) return;

        // Everything is applied and settled — reveal the interactive villa.
        setStatus("ready");
        // Success: clear the crash-loop counter so a later legitimate reload
        // isn't mistaken for a loop, and stop the context-loss guard from
        // hijacking the screen once we're up.
        reachedReady = true;
        noteLoadSuccess();
      } catch (err) {
        if (cancelled) return;
        console.error("[BabylonCanvas] model load failed", err);
        setReport(buildReport(captureError(loadErrorCode, err, "loadModel")));
        setErrorMsg((err as Error).message);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      canvasEl.removeEventListener("webglcontextlost", onCtxLost as EventListener, false);
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
    // updateConfig() is async now — its structural branch yields the main
    // thread between its heavy steps (see SceneManager.updateConfig's
    // docstring) instead of freezing it in one uninterrupted block. `cancelled`
    // guards the entity-state replay below against firing on a stale run: if
    // sceneConfig changes again (or this component unmounts) while we're
    // still awaiting, React runs THIS effect's cleanup first, which is what
    // sets cancelled — so a superseded call's result is simply dropped
    // instead of replaying entity states from a rebuild that never happened.
    let cancelled = false;
    (async () => {
      const structuralChanged = await m.updateConfig(sceneConfig);
      if (cancelled) return;
      if (structuralChanged || !repaintedOnceRef.current) {
        repaintedOnceRef.current = true;
        // Live snapshot, not a closed-over `entities` — see getEntitiesSnapshot's
        // docstring; this effect's dep array ([sceneConfig]) doesn't include
        // `entities`, so the instance React actually runs can be one whose
        // closure captured a stale (often still-empty) entities value.
        Object.values(getEntitiesSnapshot()).forEach((e) => m.applyEntityState(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneConfig]);

  // Pipe every state change into the scene (imperative — no React re-render of canvas).
  useEffect(() => {
    const off = subscribeAll((entity) => {
      const m = managerRef.current;
      if (!m) return;
      m.applyEntityState(entity); // real-mesh visuals + floating markers
      if (entity.entity_id === "sun.sun") m.sun.applyHaSunState(entity.state);
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
            {reconnecting
              ? "Connection to the villa is unstable — reconnecting…"
              : `Loading the villa…${progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)}%` : ""}`}
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
        <ErrorReport
          title="Failed to load the 3D model"
          hint={<span style={{ whiteSpace: "pre-line" }}>{errorMsg}</span>}
          detail={report}
          actions={!addonError && canManageModel
            ? <button className="btn ghost" onClick={onNeedModel}>Upload model</button>
            : undefined}
        />
      )}
      {status === "crash-loop" && (
        <ErrorReport
          title="The villa couldn't be displayed on this device"
          hint={
            <>
              The 3D view failed to load several times in a row, so it was stopped
              to avoid an endless reload loop. This almost always means the device
              (typically an iPhone) ran out of memory for this model — a heavier
              GLB (more geometry/textures) can exceed iOS Safari's per-tab limit
              even when the same file works fine on a computer or Android phone.
              {canManageModel && " An Owner can upload a lighter model from Advanced Settings."}
              {" "}For troubleshooting, tap &ldquo;Show technical details&rdquo; below to copy a report.
            </>
          }
          detail={report}
          actions={
            <>
              <button className="btn ghost" onClick={() => { clearCrashLoop(); location.reload(); }}>
                Try once more
              </button>
              {canManageModel && (
                <button className="btn ghost" onClick={() => { clearCrashLoop(); onNeedModel(); }}>
                  Upload a lighter model
                </button>
              )}
            </>
          }
        />
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
