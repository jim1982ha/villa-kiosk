// src/components/canvas/BabylonCanvas.tsx
// Owns the <canvas> + SceneManager lifecycle and wires HA state -> 3D visuals.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { SceneManager } from "@/babylon/SceneManager";
import { auditDrawCalls, countOrphanMaterials } from "@/babylon/sceneAudit";
import { formatProbe, registerProbeRunner } from "@/babylon/perfProbe";
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
import { markBoot, beginLoad, endLoad, bootTimeline, hiddenMsTotal } from "@/utils/bootTimeline";
import { saveMeshCatalog } from "@/utils/meshCatalog";
import { debugFlagEnabled } from "@/utils/devLog";
import { watchDisposed, staleDisposed } from "@/utils/leakWatch";
import ModelUploader from "@/components/settings/ModelUploader";
import ErrorReport from "@/components/ErrorReport";
import {
  isCrashLooping, crashLoopInfo, noteLoadStart, noteLoadPhase, noteModel,
  noteLoadSuccess, clearCrashLoop, noteContextLoss, captureError, buildReport,
} from "@/utils/diagnostics";
import type { EntityMapping } from "@/types/scene.types";
import type { ParsedRoomData } from "@/utils/sh3dParser";

type RoomsSyncResult =
  | { ok: true; rooms: ParsedRoomData["rooms"]; entities: ParsedRoomData["entities"] }
  | { ok: false; status: number }
  | { ok: false; error: Error };

/** Fetch + parse the central ".rooms.json" sidecar. Pulled out of the load
 *  effect so it can be STARTED the moment addonCfg.model_path is known —
 *  before the (multi-second) GLB import even begins, since this fetch has no
 *  dependency on the model's bytes or decode. Awaiting its result only
 *  happens later, once loadModel has resolved, by which point this has
 *  usually already finished in the background — see the call site. */
async function fetchRoomsSync(modelPath: string): Promise<RoomsSyncResult> {
  const roomsPath = roomsPathFor(modelPath);
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(await versionedModelUrl(roomsPath), { signal: ctrl.signal });
    clearTimeout(tid);
    if (!resp.ok) return { ok: false, status: resp.status };
    const { rooms, entities } = parseRoomData(await resp.text());
    return { ok: true, rooms, entities };
  } catch (err) {
    return { ok: false, error: err as Error };
  }
}

interface Props {
  onManager: (m: SceneManager | null) => void;
  onEntityPicked: (entityId: string, clientX: number, clientY: number) => void;
  onEntityLongPressed: (entityId: string, clientX: number, clientY: number) => void;
  /** A room-cluster chip was long-pressed (see EntityVisuals' room clustering) —
   *  opens the full entity list, same as before this was tap's job. */
  onClusterPicked: (room: string, entityIds: string[]) => void;
  /** A room-cluster chip was tapped — navigates to that room. */
  onClusterTapped: (room: string, entityIds: string[], roomNames: string[]) => void;
  onFloorChange: (floor: number) => void;
  onRoomChange: (room: string | null) => void;
  onNeedModel: () => void;
  onModelUploaded: () => void;
}

export default function BabylonCanvas({
  onManager, onEntityPicked, onEntityLongPressed, onClusterPicked, onClusterTapped, onFloorChange, onRoomChange, onNeedModel, onModelUploaded,
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
  // ── EVERY CALLBACK PROP, IN ONE REF, ASSIGNED DURING RENDER ─────────────
  //
  // Two separate reasons, and the second one is a memory leak that took three
  // releases to find, so both are written down.
  //
  // ── 1. Freshness (the original reason) ────────────────────────────────
  // The pick callbacks close over live HA state (entities/ws) and config, so
  // they are recreated on every relevant change. The SceneManager is created
  // ONCE, so capturing them directly freezes them at their mount-time values
  // (empty entities, null ws) — every tap would wrongly open the panel and
  // toggles would no-op.
  //
  // ── 2. A CLOSURE OVER A PROP RETAINS THE PARENT'S WHOLE RENDER SCOPE ───
  // `onFloorChange` is `(f) => setCurrentFloor(f)`, written inline in
  // Dashboard, so its closure IS Dashboard's render scope — and that scope
  // holds Dashboard's `manager` state. The mount effect below runs with `[]`
  // deps, so React keeps its closure (and its cleanup) for the life of the
  // canvas, which pins the render scope it was created in. At MOUNT time
  // Dashboard's `manager` was still the PREVIOUS villa. One dead SceneManager
  // retained per remount, each chaining to the one before it: measured at
  // ~35 MB apiece, and traced from a field heap snapshot as
  //
  //   scene.onPointerObservable -> Observer.callback (PickHandler)
  //     -> { …, onFloorChange, … } -> Dashboard's render scope -> old manager
  //
  // ── Why refs, and why assigned during RENDER rather than in an effect ──
  // A ref would not have been enough on its own. V8 allocates ONE context per
  // scope and puts a variable in it if ANY inner function references it — so
  // `useEffect(() => { xRef.current = x }, [x])` is itself a closure over `x`,
  // which context-allocates the prop and hands the mount effect exactly the
  // reference this is trying to remove. That is why the four callbacks that
  // were ALREADY routed through refs leaked anyway.
  //
  // A plain assignment during render captures nothing, so no prop is
  // context-allocated at all and the mount effect's scope cannot reach the
  // parent. It is the "latest ref" pattern; writing a ref during render is
  // safe here because nothing reads it during that render and a double-render
  // under StrictMode simply assigns the same value twice.
  //
  // THE RULE, and it is all-or-nothing: no closure in this component may name
  // a prop. One that does re-allocates the whole context and restores the
  // leak, silently — including a JSX handler like `() => onNeedModel()`.
  // Everything goes through `cbRef.current`.
  const cbRef = useRef({
    onManager, onEntityPicked, onEntityLongPressed, onClusterPicked,
    onClusterTapped, onFloorChange, onRoomChange, onNeedModel, onModelUploaded,
  });
  cbRef.current = {
    onManager, onEntityPicked, onEntityLongPressed, onClusterPicked,
    onClusterTapped, onFloorChange, onRoomChange, onNeedModel, onModelUploaded,
  };
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

    // performance.now() is measured from timeOrigin = NAVIGATION START, so this
    // single read is "how long the page took to get here": HTML, the ~6.6MB JS
    // bundle's download + parse + compile, React mounting, and the profile gate
    // resolving a stored session. None of that has ever been measured — the
    // load telemetry started at the model fetch — which is why the reported
    // parseMs (~2.1s desktop) was only about a third of the wait users actually
    // sit through (5-7s, cross-checked against the gap between the pageshow and
    // load records' own timestamps). Everything below exists to close that gap.
    const tBoot = performance.now();
    // The last milestone on the path bootTimeline reconstructs — everything
    // before it (HTML, bundle, React, and any time a person spent at the
    // profile/passcode screen) is now separately attributable instead of
    // collapsing into this single figure.
    // Opens a new load: clears the per-load marks so a REMOUNT (sign out, sign
    // back in) measures itself instead of inheriting the first load's. Must run
    // before markBoot("scene"), which is one of the marks it clears.
    const loadSeq = beginLoad();
    markBoot("scene");

    let cancelled = false;
    const canvasEl = canvasRef.current;

    let manager: SceneManager;
    const tEngineStart = performance.now();
    try {
      noteLoadPhase("engine-init");
      manager = new SceneManager(canvasEl, {
        config: sceneConfig,
        // Trampolines over the ONE ref — see cbRef. Naming a prop directly
        // here is what put Dashboard's render scope inside the scene graph.
        onEntityPicked: (id, x, y) => cbRef.current.onEntityPicked(id, x, y),
        onEntityLongPressed: (id, x, y) => cbRef.current.onEntityLongPressed(id, x, y),
        onClusterPicked: (room, ids) => cbRef.current.onClusterPicked(room, ids),
        onClusterTapped: (room, ids, roomNames) => cbRef.current.onClusterTapped(room, ids, roomNames),
        onFloorChange: (floor) => cbRef.current.onFloorChange(floor),
        onRoomChange: (room) => cbRef.current.onRoomChange(room),
      });
    } catch (err) {
      // WebGL unavailable/blocked — show a clear message, not a blank canvas.
      setReport(buildReport(captureError("WEBGL_INIT_FAILED", err, "SceneManager")));
      setStatus("error");
      return;
    }
    const tEngineDone = performance.now();
    managerRef.current = manager;
    cbRef.current.onManager(manager);

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

    /** Fold the central "<model>.rooms.json" sidecar into config, if it says
     *  anything new. Extracted only so the load sequence below reads as one
     *  line — the reasoning for WHERE it is called lives at the call site. */
    const applyRoomsSync = async (
      promise: Promise<RoomsSyncResult>, modelPath: string,
    ): Promise<void> => {
      const roomsPath = roomsPathFor(modelPath); // for the messages below only
      const result = await promise;
      if (cancelled) return;
      if (!result.ok && "status" in result) {
        setSh3dSyncMsg(
          `Central room data (${roomsPath}) not found (HTTP ${result.status}) — room names ` +
          "weren't refreshed. Re-run the Blender pipeline and upload the .rooms.json in Settings.",
        );
        return;
      }
      if (!result.ok) {
        if (result.error.name !== "AbortError") {
          console.warn("[BabylonCanvas] central room-data refresh failed", result.error);
          setSh3dSyncMsg(`Failed to refresh room names from the central .rooms.json: ${result.error.message}`);
        }
        return;
      }
      const { rooms, entities: sh3dEntities } = result;
      // Compare by CONTENT, not reference: parseRoomData returns fresh
      // arrays every open, so a reference check would force the
      // rebuild on every load even when nothing actually changed.
      const cur = configRef.current;
      const sameRooms = JSON.stringify(cur.sh3dRooms ?? []) === JSON.stringify(rooms);
      const sameEnts = JSON.stringify(cur.sh3dEntities ?? []) === JSON.stringify(sh3dEntities);
      if (sameRooms && sameEnts) return; // the common re-open case — nothing to do
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
      // Give React a beat to commit and run the [sceneConfig] effect, whose
      // updateConfig() writes the new config onto the SceneManager. That write
      // is the whole point of the wait: it happens synchronously at the top of
      // updateConfig, so once the effect has merely STARTED, the manager holds
      // the right room data and the loadModel below indexes against it.
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())));
    };

    (async () => {
      let loadErrorCode = "MODEL_LOAD_FAILED";
      try {
        noteLoadPhase("fetch-config");
        const tConfigStart = performance.now();
        const addonCfg = await fetchAddonConfig();
        const tConfigDone = performance.now();
        // Started here, not where it's awaited below: this fetch depends only
        // on addonCfg.model_path, so kicking it off now lets its round-trip
        // run in the shadow of the GLB's own multi-second import instead of
        // adding to the critical path serially after it.
        const roomsSyncPromise = addonCfg.model_path ? fetchRoomsSync(addonCfg.model_path) : null;
        let data: ArrayBuffer | null = null;
        /** Whether the profile screen's background download was reusable. */
        let usedPrefetch = false;
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
          usedPrefetch = claimed !== null;
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
        // Diagnostic-only (Settings' "which file is loaded" fingerprint) and
        // needed by nothing downstream — started now, alongside the bytes
        // it hashes, instead of after loadModel resolves, so it runs in the
        // shadow of the decode rather than adding to it.
        const sha256Promise = sha256Hex(data);

        // ── Central room data goes in BEFORE the model, not after (2.203.0) ──
        // This used to run in the reveal window, after loadModel had already
        // indexed every mesh. Applying it there changes `sh3dRooms`/
        // `sh3dEntities`, which SceneManager.updateConfig classes as
        // structural — so on any load where the room data had moved, the
        // villa was indexed TWICE: once by loadModel with the old data, then
        // wholesale again behind the loading overlay.
        //
        // Field telemetry put a number on it. An iPhone load reported
        // `rvRooms: 7243` of a `totalMs: 13196` — 55% of the entire load was
        // that second pass — with the first one visible right next to it as
        // `indexMeshes: 1977` inside `postMs`. Same shape on Android (3,870ms)
        // and on an older build (11,480ms of 22,927ms). It fires whenever the
        // GLB or its rooms sidecar changed since that device last opened,
        // which is exactly the load a person is most likely to be watching.
        //
        // Moved here, the second pass cannot happen: updateConfig's heavy
        // branch is gated on `this.loadedMeshes.length` (SceneManager), and
        // that is still empty at this point, so the config change lands for
        // free and loadModel then indexes ONCE with the right data already in
        // hand. The deferred calibrateRooms() inside loadModel gets it right
        // first time too, instead of re-fitting the plan→world transform.
        //
        // Placed after the GLB bytes rather than earlier on purpose: the
        // sidecar fetch was started back when addonCfg resolved, so it has had
        // the model's whole multi-megabyte download to complete in and this
        // await is normally instant. Awaiting it any earlier would put its
        // round-trip on the critical path serially instead of in the model's
        // shadow. A missing/hung sidecar still never blocks (5s abort inside
        // fetchRoomsSync, and a failure just proceeds without the refresh).
        if (fromAddon && addonCfg.model_path && roomsSyncPromise) {
          await applyRoomsSync(roomsSyncPromise, addonCfg.model_path);
          if (cancelled) return;
        }
        const tRoomsDone = performance.now();

        // The heavy step and the usual iOS OOM point: Draco decode + texture
        // decode + GPU upload of the whole villa.
        noteLoadPhase("import-mesh");
        // The versioned URL is the geometry's identity: it changes the instant a
        // different GLB is uploaded, so cached probes cannot outlive their model.
        const { importMs, postMs, phases, notes } = await manager.loadModel(data, loadedSource);
        if (cancelled) return;
        noteLoadPhase("post-process");
        const tParseDone = performance.now();

        // NOTHING between here and setStatus("ready") may be anything other
        // than "the villa would be WRONG on screen without it". Field
        // measurement (v2.94.0's revealMs) found this stretch to be the single
        // largest phase of the whole load — 5,655ms of 13,398ms on Android,
        // larger than Babylon's own import — because it had accumulated
        // bookkeeping that merely happened to be written here: a SHA-256 over
        // the entire 17MB GLB (a diagnostic fingerprint for Settings, AWAITED
        // before the reveal), a localStorage mesh-catalog write, and the
        // auto-detect config write. All of that now runs after the reveal, in
        // `finishAfterReveal` below.
        const meshNames = manager.getBindableMeshNames();
        const tMeshNames = performance.now();

        // Ship the phase split to the add-on. This is the measurement that
        // turns "the app is slow" into an actionable number — and it's per
        // DEVICE, so a phone that parses 5x slower than the desktop shows up
        // as itself rather than as an anecdote.
        const sendLoadTelemetry = (
          // `string` allowed since 2.118.0: the reveal split now also carries
          // the GPU renderer name, which is the field that distinguishes a
          // hardware draw from a software (SwiftShader) one.
          revealMs: number, totalMs: number, revealSplit: Record<string, number | string>,
        ) => reportTelemetry("load", {
          ...revealSplit,
          // The pre-scene half of the load, split into phases that can each be
          // acted on — html/bundle/react/gate — plus `waitMs` (time spent
          // waiting on a HUMAN at the profile or passcode screen) and
          // `activeMs` (= totalMs − waitMs), which is the figure to optimise
          // against. `jsKb` reports the DECODED weight of the JS this device
          // actually ran, so a stale build identifies itself.
          ...bootTimeline(totalMs),
          // ── The window that was previously invisible ────────────────────
          // bootMs: navigation start → this scene effect (HTML + the ~6.6MB JS
          // bundle's download/parse/compile + React mount + session resolve).
          // engineMs: constructing SceneManager (WebGL context, Babylon engine).
          // configMs: the /addon-config round trip.
          // revealMs: parse done → overlay actually lifted (sha256 over the
          //   whole GLB, mesh catalog write, auto-detect, per-entity state
          //   paint, the rooms-sync await and its double-rAF settle).
          // totalMs: navigation start → villa visible. THE number to judge.
          // Navigation-relative, so ONLY meaningful for the page's first load.
          // On a remount they would report "time since the page opened", which
          // is what made a healthy 2.5s reload look like a 35s regression —
          // `reloadMs` (from bootTimeline) carries the real figure instead.
          ...(loadSeq === 1 ? { bootMs: Math.round(tBoot) } : {}),
          engineMs: Math.round(tEngineDone - tEngineStart),
          configMs: Math.round(tConfigDone - tConfigStart),
          revealMs: Math.round(revealMs),
          ...(loadSeq === 1 ? { totalMs: Math.round(totalMs) } : {}),
          // Scenes disposed two or more loads ago that are still reachable.
          // Absent on a first load (nothing has been disposed yet) and zero on
          // a healthy remount — see leakWatch for what a non-zero value in
          // each key means, and why it is read here rather than at dispose.
          ...staleDisposed(loadSeq),
          // Did the background download started on the profile screen actually
          // get used? Without this, "is the pre-load working?" was a question
          // nobody could answer from a device they don't hold — the phase
          // timings alone can't distinguish a fast network from a prefetch
          // that was already finished before login. `prefetched:false` with a
          // large fetchMs means the head start was lost (no session yet AND
          // public_model_access off, an unauthorised /model/, or a model
          // replaced between the two).
          prefetched: usedPrefetch,
          bytes: data.byteLength,
          meshes: meshNames.length,
          fetchMs: Math.round(tFetchDone - tFetchStart),
          // Excludes the rooms-sync wait below, which sits between the two —
          // rolling it in would make parseMs mean two different things
          // depending on whether the sidecar had changed.
          parseMs: Math.round(tParseDone - tRoomsDone),
          // What the pre-model rooms-sync cost. This is the counterpart of the
          // old `rvRooms`, which measured the SECOND full re-index this
          // ordering removes: `rvRooms` should now be ~0 on every load, and
          // this should be small even when the sidecar HAS changed, because
          // all it does is settle config while the scene is still empty. If it
          // is ever large, the sidecar fetch is the thing to look at, not the
          // rebuild.
          roomsMs: Math.round(tRoomsDone - tFetchDone),
          importMs: Math.round(importMs),
          postMs: Math.round(postMs),
          source: fromAddon ? "addon" : "indexeddb",
          // Which STEP of our own post-processing dominates. Without this a
          // slow load is only ever "post was 3.4s" with no way to act on it.
          ...phases,
          // Names, not counts — currently the glass heuristic's own decisions.
          // See LoadResult.importNotes for why they have to travel this way.
          ...notes,
        });

        // Everything that does NOT change what is on screen, run once the villa
        // is already visible (see the reveal below). Ordered cheapest-first so
        // the diagnostics land quickly; none of it is awaited by the reveal.
        const finishAfterReveal = () => {
          if (cancelled) return;
          // Expose mesh names for the binding UI. A JSON.stringify of ~765
          // names into localStorage — synchronous, and worth nothing to a user
          // staring at a spinner.
          saveMeshCatalog(meshNames);
          // Fingerprint the GLB that actually loaded, so Settings can prove
          // which file is in use without needing to toggle an entity. Compare
          // against `shasum -a 256 <file>.glb` and `ls -l` on disk. Hashing
          // 17MB is genuinely expensive on a phone, and this is a diagnostic
          // read by one Settings row — it used to be AWAITED before the villa
          // could appear.
          void sha256Promise.then((sha256) => {
            if (cancelled) return;
            setLoadedModelInfo({
              url: loadedSource,
              bytes: data.byteLength,
              sha256,
              meshCount: meshNames.length,
              fetchMs: Math.round(tFetchDone - tFetchStart),
              // Same anchor as the telemetry field of this name — the rooms-sync
              // wait is not part of parsing the model.
              parseMs: Math.round(tParseDone - tRoomsDone),
              importMs: Math.round(importMs),
              postMs: Math.round(postMs),
            });
          }).catch(() => {});
          autoDetectEntities();
          // Draw-call structure: the ONE number that decides whether the Safari
          // frame cost has a lever left (see sceneAudit's header). Reported as
          // its own event rather than folded into `load`, because it describes
          // the MODEL rather than the load, and because it is only meaningful
          // next to the `frames` records — which arrive later and separately.
          try {
            const meshes = manager.getLoadedMeshes();
            reportTelemetry("drawcalls", {
              ...auditDrawCalls(meshes, configRef.current),
              orphanMats: countOrphanMaterials(manager.scene, meshes),
            });
          } catch { /* diagnostic only — never fail a load for it */ }
          // Measure this device and let the resolution valve settle it — see
          // SceneManager.calibrateResolution. After the reveal, so the couple
          // of seconds of rendering it needs are behind an already-visible
          // villa rather than in front of one.
          manager.calibrateResolution();
        };

        // Auto-populate entityMap from meshes whose names are HA entity IDs
        // (cameras, fans, lights, etc.) so they appear in the Config Editor.
        // Room is NOT resolved/stamped here any more — it's no longer part of
        // EntityMapping at all (see Dashboard.tsx's room-resolution effect
        // and config/EntityMap.ts's docstring): every entityMap entry's room
        // is computed live from HA's Area assignment / GLB geometry, so there
        // is nothing to seed on first detection.
        //
        // Deferred past the reveal (finishAfterReveal): on a load where it DOES
        // find something new, the `update()` below changes entityMap's key set,
        // which entityMapDiff classes as STRUCTURAL — a full multi-second
        // indexMeshes re-run. Behind the spinner that was invisible dead time;
        // after the reveal the villa is already usable while it settles. In the
        // steady state nothing is detected and this costs nothing either way.
        function autoDetectEntities() {
        const detected = manager.getAutoDetectedMappings();
        if (detected.length > 0) {
          const current = configRef.current;
          const additions: Record<string, EntityMapping> = {};
          // Live HA state, read once for this whole pass — a mesh literally
          // named after an entity_id (the pipeline's own naming convention)
          // that HA no longer reports (renamed/removed) used to get
          // auto-detected right back into entityMap on every single load,
          // even the load immediately after a user explicitly removed it via
          // Advanced Settings' "N entities no longer in Home Assistant ->
          // Remove N" — the auto-detect pass never checked whether the
          // entity was still real, only whether a mesh happened to carry its
          // name. Reported: climate.gym_room kept "coming back" no matter
          // how many times it was removed; confirmed via HA that the entity
          // genuinely no longer exists. Auto-detect exists to save typing
          // for a genuinely new, live entity — not to repopulate one that's
          // gone. (Minor accepted trade-off: if this runs before HA's
          // get_states has resolved, a real new entity could be skipped
          // here and only get picked up on the NEXT load — self-healing,
          // and far better than silently undoing an explicit removal.)
          const liveEntities = getEntitiesSnapshot();
          for (const m of detected) {
            if (current.entityMap[m.entityId]) continue;
            if (!liveEntities[m.entityId]) continue;
            additions[m.entityId] = m;
          }
          if (Object.keys(additions).length > 0) {
            update({ entityMap: { ...current.entityMap, ...additions } });
          }
        }
        }
        // Paint the current entity states immediately (meshes + markers). Read
        // a live snapshot, NOT the `entities` destructured above — this effect
        // has an empty dependency array (a one-shot "create the scene" run),
        // so `entities` would be frozen at whatever it was at MOUNT (almost
        // always still {}, since HA's initial hydrate is an async round-trip
        // that hasn't resolved yet) — see getEntitiesSnapshot's docstring.
        Object.values(getEntitiesSnapshot()).forEach((e) => manager.applyEntityState(e));
        const tStatesPainted = performance.now();

        // The central room data was applied BEFORE loadModel (see
        // applyRoomsSync's call site) — there is nothing left to do here.
        if (cancelled) return;

        // Everything is applied and settled — reveal the interactive villa.
        // NO shader pre-compilation here — 2.110.0 tried it and it was a
        // clear net loss, measured on the same villa:
        //   Android visibleMs 5,048 -> 9,096 (+4.0s), and stallMaxMs stayed at
        //   ~2,300ms, so it did not even remove the freeze it was written for.
        // Three reasons, all visible in that record:
        //   * it compiled 898 materials while the GLB has 371 — iterating every
        //     scene mesh reaches hidden pose variants, atlas carriers and the
        //     culled upper floor, none of which the first frame ever compiles;
        //   * one requestAnimationFrame per 4 materials is ~224 yields at ~16ms
        //     = ~3.6s of pure waiting added to the load;
        //   * forceCompilationAsync still blocks in large chunks anyway.
        // Babylon's own first frame is SMARTER than this: it compiles exactly
        // the shaders the visible set needs and nothing else. Leave it alone.
        // The real lever remains the material COUNT (371), which is a pipeline
        // change and shrinks both this and the primitive count behind parseMs.
        setStatus("ready");
        // Reported HERE, not where it is built above: only at this point do
        // revealMs/totalMs exist, and this is also the first moment sending it
        // costs the user nothing (it is a fire-and-forget POST that used to sit
        // in front of the reveal).
        const tReady = performance.now();
        // ── The blind spot this closes ────────────────────────────────────
        // `setStatus("ready")` is a REACT STATE UPDATE, not a picture. Every
        // number above stops here, and the operator was right that they do not
        // match what a person actually waits for: still to come are React's
        // commit, the overlay clearing, the browser's paint, and — the one
        // that can genuinely cost seconds — Babylon's FIRST RENDERED FRAME,
        // which is where 371 materials get their shaders compiled by the GPU
        // driver and 2.28M vertices are bound for the first time. Reporting a
        // "total" that ends before any of that is the same mistake `revealMs`
        // was created to fix in 2.94.0, one stage further down the pipe.
        //
        // So the record is now held until the villa is genuinely ON SCREEN.
        // It is fire-and-forget and already past the reveal, so waiting costs
        // the user nothing, and it buys a `visibleMs` that means what its name
        // says. The timeout matters: the render loop is ON-DEMAND (see
        // SceneManager), so if nothing ever asks for a frame the observable
        // would never fire and the whole record would be lost — a load that
        // never paints is exactly the case worth hearing about.
        // ── Why paintMs is split three ways (2.116.0) ──────────────────────
        // It used to be ONE number covering three unrelated waits, so a large
        // value could not be attributed and was repeatedly explained by guess
        // — first as GPU shader compilation, then as background throttling —
        // with the data unable to confirm or refute either. The three are:
        //   rdrMs  ready → Babylon's onAfterRender. This is our render call:
        //          shader compilation and buffer upload land here, and it is
        //          MAIN-THREAD time, so it should also show in stallMs.
        //   cmpMs  onAfterRender → the next rAF. The compositor actually
        //          putting the frame on screen. GPU-queue time lands here and
        //          is invisible to the long-task observer, which is exactly
        //          why it could never be told apart from the above.
        //   hidMs  of the total, how long the page was NOT BEING DRAWN. A
        //          hidden page cannot paint and its rAF does not fire, so any
        //          load spanning a hidden stretch reported that as if it were
        //          work. Measured (installVisibilityTracker), not inferred.
        // paintMs is kept, unchanged in meaning, so history stays comparable.
        const hiddenAtReady = hiddenMsTotal();
        let tRendered = 0;
        const sendWhenPainted = () => {
          let done = false;
          // ── Why the loop is PINNED until the first frame (2.117.0) ─────────
          // The render loop is on-demand: runRenderLoop only calls
          // scene.render() while `keepRenderingUntil` is still in the future.
          // markReady() asks for 1000ms and the requestRender() below adds
          // 350ms — and if the first frame has not landed inside that window,
          // THE LOOP GOES TO SLEEP HAVING NEVER DRAWN ANYTHING. Nothing then
          // renders until some unrelated event (a pointer move, an HA state
          // change, a fan tick) happens to wake it, and the villa sits
          // invisible in the meantime.
          //
          // This is what the 2.116.0 split caught: a load reporting
          // `rdrMs: 18971` with `cmpMs: 360`, `hidMs: 0` and `stallMs: 182`.
          // The compositor was fine, the page was never hidden, and the main
          // thread was IDLE for those 19 seconds — so it was never expensive
          // work, it was nothing happening at all. It also explains the wild
          // spread of that figure (2s to 52s): it was measuring how long until
          // something accidentally requested a frame.
          //
          // Pinning removes the race entirely — the loop cannot idle before it
          // has drawn once — and the pin is released the moment the frame is
          // confirmed (or the timeout gives up), so the on-demand behaviour
          // this app depends on for idle power is otherwise untouched.
          const releasePin = manager.pinContinuous();
          const finish = (painted: boolean) => {
            if (done) return;
            done = true;
            releasePin();
            const tPaint = performance.now();
            sendLoadTelemetry(tReady - tParseDone, tReady, {
              rvMeshNames: Math.round(tMeshNames - tParseDone),
              rvStates: Math.round(tStatesPainted - tMeshNames),
              rvRooms: Math.round(tReady - tStatesPainted),
              // "ready" → the first frame actually drawn. Shader compilation
              // for every visible material lands here.
              paintMs: Math.round(tPaint - tReady),
              // The three components above. `rdrMs` is only known if the
              // render observable actually fired (it hasn't on a timeout).
              ...(tRendered ? { rdrMs: Math.round(tRendered - tReady) } : {}),
              ...(tRendered ? { cmpMs: Math.round(tPaint - tRendered) } : {}),
              hidMs: Math.round(hiddenMsTotal() - hiddenAtReady),
              // ── WHICH renderer actually drew this (2.118.0) ───────────────
              // The decisive missing field. `webglInfo()` has always collected
              // this but only for the ERROR screen, so no successful load ever
              // carried it — and it is the one thing that distinguishes a GPU
              // draw from a CPU (SwiftShader) one. A software fallback renders
              // the first frame on the MAIN THREAD, which is exactly the shape
              // 2.117.0 exposed: a single ~11.6s blocking task. Read off the
              // LIVE engine rather than a throwaway canvas — creating a second
              // WebGL context purely to ask this question would add to the very
              // context pressure under investigation.
              ...((): Record<string, string> => {
                try {
                  // getGlInfo is on the concrete Engine, not the AbstractEngine
                  // the scene is typed with — narrow rather than widen.
                  const eng = manager.scene.getEngine() as unknown as {
                    getGlInfo?: () => { renderer?: string };
                  };
                  const gi = eng.getGlInfo?.();
                  return gi ? { gpu: String(gi.renderer ?? "").slice(0, 96) } : {};
                } catch { return {}; }
              })(),
              // Navigation start → the villa genuinely visible. THE number to
              // compare against a stopwatch — but ONLY true for the page's
              // FIRST load, exactly like totalMs/activeMs/bootMs above. On a
              // reload `tPaint` is still measured from the ORIGINAL navigation,
              // so reporting it as `visibleMs` produced a 98,239ms record for a
              // load whose real span (`reloadMs`) was 7,864ms — the identical
              // stale-anchor mistake bootMs/totalMs/waitMs made before 2.105.0,
              // just not caught then because paintMs/visibleMs didn't exist yet
              // (added 2.109.0, after that fix). `reloadMs` already carries the
              // correct load-relative figure through paint (it's read here,
              // inside bootTimeline(), AFTER tPaint), so `visibleMs` is simply
              // omitted on a reload rather than given a second, wrong meaning.
              ...(loadSeq === 1 ? { visibleMs: Math.round(tPaint) } : {}),
              paintTimedOut: painted ? 0 : 1,
            });
          };
          const timer = window.setTimeout(() => finish(false), 15000);
          manager.scene.onAfterRenderObservable.addOnce(() => {
            window.clearTimeout(timer);
            // Stamped BEFORE the rAF below, so the render half and the
            // compositor half can be told apart.
            tRendered = performance.now();
            // One more frame boundary so the compositor has actually put it on
            // screen, rather than reporting the moment the draw calls were
            // issued.
            requestAnimationFrame(() => finish(true));
          });
          // The loop is on-demand: make sure a frame is genuinely requested.
          manager.requestRender();
        };
        sendWhenPainted();
        // The villa is on screen; the bookkeeping can have the main thread now.
        finishAfterReveal();
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
      cbRef.current.onManager(null);
      // Grabbed BEFORE dispose() so the scene is still reachable to hand over.
      // Both are stored as WeakRefs, so this cannot itself retain anything —
      // see leakWatch's docstring for what the next load then reports.
      const disposedScene = manager.scene;
      manager.dispose();
      watchDisposed("mgr", manager, loadSeq);
      watchDisposed("scene", disposedScene, loadSeq);
      managerRef.current = null;
      // The scene is gone; the next sign-in starts a fresh load cycle and must
      // not inherit this one's gate/passcode/scene marks.
      endLoad();
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

  // ── `?debug` → __villaPerfProbe() ─────────────────────────────────────────
  // The frame-cost experiment, on the device, from the console. Attached here
  // because this is where a live manager is reachable; everything else about
  // it lives in babylon/perfProbe.ts. Also reported to telemetry, so a run on
  // the iPad — the device that matters and the one hardest to attach devtools
  // to — is readable afterwards from the Settings panel rather than needing a
  // console at the moment it ran.
  useEffect(() => {
    const run = async () => {
      const m = managerRef.current;
      if (!m) return [];
      // Read BEFORE the probe runs — it hides meshes and changes the hardware
      // scaling as part of the experiment, so afterwards these would describe
      // the last condition rather than the villa.
      const context = m.renderContext();
      const rows = await m.runRenderProbe();
      // Reported whichever way it was started, WITH the render context. A run
      // on the wall tablet is only readable at all because of this, and the
      // context is what lets one telemetry export stand on its own: the event
      // already carries the User-Agent, viewport, DPR and PWA flag from
      // report(), and this adds what was being drawn.
      reportTelemetry("probe", { ...context, rows });
      return rows;
    };
    // The button in the owner-only telemetry panel — the ONLY route on a
    // device with no console (see perfProbe's registry note).
    registerProbeRunner(run);

    // The console form, for a machine that has one.
    const w = window as Window & { __villaPerfProbe?: () => Promise<string> };
    if (debugFlagEnabled()) {
      w.__villaPerfProbe = async () => {
        const text = formatProbe(await run());
        console.log(text);
        return text;
      };
    }
    return () => {
      registerProbeRunner(null);
      delete w.__villaPerfProbe;
    };
  }, []);

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
          {/* aria-hidden: the spinner conveys nothing the status text below
              doesn't already say, and an unlabelled decorative element is
              noise to a screen reader. */}
          <div className="spinner" aria-hidden="true" />
          {/* role=status + aria-live=polite: the villa can take several
              seconds to decode, and without this a screen-reader user got
              silence between sign-in and the map appearing, with no way to
              tell "still working" from "finished, but empty". aria-busy
              marks the region as in-flight for assistive tech that reports
              it. Progress is announced politely, so it never interrupts. */}
          <div className="muted" role="status" aria-live="polite" aria-busy="true">
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
              <ModelUploader minimal onUploaded={() => cbRef.current.onModelUploaded()} />
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
            ? <button className="btn ghost" onClick={() => cbRef.current.onNeedModel()}>Upload model</button>
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
                <button className="btn ghost" onClick={() => { clearCrashLoop(); cbRef.current.onNeedModel(); }}>
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
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
