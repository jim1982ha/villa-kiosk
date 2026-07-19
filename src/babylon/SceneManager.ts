// src/babylon/SceneManager.ts
// Owns the Babylon engine + scene and the on-demand render loop.
//
// On-demand rendering adapted for a first-person camera: instead of rendering
// every frame forever (which cooks a tablet GPU), we only render while there is
// activity — camera input, a running animation, or an entity visual change.
// `requestRender()` keeps the loop "awake" for a short window; when nothing asks
// for frames the loop idles at ~0% GPU. (Core 3Dash idea, generalised.)

import {
  Engine, Scene, Color3, Color4, Vector3, HemisphericLight, Material, PBRMaterial, Ray,
  Mesh,
  type AbstractMesh,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

import { CameraController } from "./CameraController";
import { OverviewController } from "./OverviewController";
import { LightingSystem } from "./LightingSystem";
import { SunController } from "./SunController";
import { SkyDome } from "./SkyDome";
import { FloorManager } from "./FloorManager";
import { PickHandler } from "./PickHandler";
import { EntityVisuals } from "./EntityVisuals";
import { RenderEnhancements } from "./RenderEnhancements";
import { loadModelInto } from "./ModelLoader";
import { resetLightPoolTextureCache } from "./LightPools";
import { resolveMeshToMapping, inferTypeFromEntityId, normaliseMeshName } from "@/config/EntityMap";
import { effectiveCategory } from "@/config/EntityCategories";
import { axisWorldScale } from "./meshUnits";
import { ENTITY_CALIBRATION_CM, ROOM_POLYGONS_CM, polygonCentroid } from "@/config/Sh3dCalibration";
import { solvePlanToWorld, planAngleToDir } from "./roomCalibration";
import type { PlanWorldPair } from "@/utils/affineFit";
import { pointInPolygon, type Pt2 } from "@/utils/geometry";
import { devLog } from "@/utils/devLog";
import { tapDebug } from "@/utils/tapDebug";
import { loadOverviewView, saveOverviewView } from "@/utils/storage";
import type { AppConfig, RenderConfig } from "@/config/AppConfig";
import type { HassEntity } from "@/types/ha.types";
import type { TeleportPoint } from "@/types/scene.types";

export interface SceneManagerOptions {
  config: AppConfig;
  /** Called when a mesh mapped to an entity is tapped (fast on/off action). */
  onEntityPicked: (entityId: string) => void;
  /** Called when a mesh mapped to an entity is long-pressed (open full panel). */
  onEntityLongPressed: (entityId: string) => void;
  /** Called when the active floor changes (staircase or button). */
  onFloorChange: (floor: number) => void;
  /** Called when the camera enters a new named room. */
  onRoomChange: (room: string | null) => void;
}

export class SceneManager {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: CameraController;
  readonly overview: OverviewController;
  readonly lighting: LightingSystem;
  readonly sun: SunController;
  readonly sky: SkyDome;
  readonly floors: FloorManager;
  readonly pick: PickHandler;
  readonly visuals: EntityVisuals;
  readonly renderFx: RenderEnhancements;

  private config: AppConfig;
  private hemi: HemisphericLight;
  /** True on iOS Safari / the HA companion WKWebView — used to strip the
   *  memory-hungry render targets (SSAO/IBL/sun shadows) that overrun iOS's
   *  low WebGL memory ceiling and crash-loop the loader (see the constructor). */
  private isIOS = false;
  private resizeObserver: ResizeObserver | null = null;
  private ready = false;
  private readyCallbacks = new Set<() => void>();
  private calibrateCallbacks = new Set<() => void>();
  private keepRenderingUntil = 0;
  private forceContinuous = 0; // ref count for animations/streams
  private loadedMeshes: AbstractMesh[] = [];
  private calibratedPoints: TeleportPoint[] | null = null;
  // The room the user last navigated to while in overview. Cleared on entering
  // overview; set by navigateTo. When they then switch to first-person we drop
  // them INTO that room (not back at the staircase) — otherwise a fresh/default
  // overview → first-person lands at the staircase.
  private lastNavigatedRoom: TeleportPoint | null = null;
  private highlightedMeshes: Mesh[] = [];
  private viewMode: "first-person" | "overview" = "first-person";
  /** Names of the real (polygon-backed) rooms from the last calibration —
   *  used to exclude them when deriving RoomHighlight's point-only "rooms"
   *  from config.teleportPoints (a real room polygon always wins). */
  private lastRoomPolyNames = new Set<string>();

  constructor(canvas: HTMLCanvasElement, opts: SceneManagerOptions) {
    this.config = opts.config;

    // iOS Safari / the HA companion app's WKWebView enforces a hard, low ceiling
    // on total WebGL memory (framebuffers + render targets + geometry). The
    // villa's decoded geometry is already tens of MB; on top of that a DPR-3
    // iPhone rendered here at 2× supersampling (hardwareScaling 0.5) with 4×
    // MSAA and every post-process render target, which overran that ceiling —
    // iOS then kills the web content and the app reloads the page, looping
    // forever on the "Loading the villa" spinner (reported: fine on desktop +
    // Android, crash-loops only on iPhone; smaller BAKE sizes don't help
    // because bake size only shrinks the light atlas, not the geometry or the
    // framebuffer). So on iOS: no MSAA, default power preference (high-
    // performance can make WKWebView refuse or drop the context), and render at
    // ~device-native resolution instead of 2× — a big cut in GPU memory that
    // keeps it under the ceiling. Non-iOS is unchanged.
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    this.isIOS = isIOS;
    this.engine = new Engine(canvas, !isIOS, {
      preserveDrawingBuffer: false,
      stencil: true,
      antialias: !isIOS,
      powerPreference: isIOS ? "default" : "high-performance",
    });
    // iOS: render at ≈CSS resolution or below (hardwareScaling ≥ 1) — a
    // DPR-3 phone drops to ~0.67× CSS, ~1/9th the drawing-buffer memory of the
    // non-iOS 2× supersample. Elsewhere keep the crisp up-to-2× supersampling.
    this.engine.setHardwareScalingLevel(
      isIOS ? Math.max(1, window.devicePixelRatio / 2)
            : 1 / Math.min(window.devicePixelRatio, 2));

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.7, 0.85, 1.0, 1);
    this.scene.collisionsEnabled = true;
    this.scene.gravity = new Vector3(0, -0.6, 0);

    // Always-on interior fill. This is independent of the time-of-day sun, so
    // walls keep their true colour (white reads white, not grey) even at night
    // or with the sun low. A light groundColor lifts undersides off pure black.
    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.95; // overwritten by renderFx.apply() below (config.render.hemiIntensity)
    hemi.diffuse = new Color3(1, 1, 1);
    // Warm-neutral ground bounce (was slightly blue 0.55,0.55,0.6). The blue cast
    // tinted undersides cyan once the night sun went warm, so keep the fill neutral
    // so white reads white at night.
    hemi.groundColor = new Color3(0.55, 0.54, 0.52);
    hemi.specular = new Color3(0.1, 0.1, 0.1);
    this.hemi = hemi;

    this.lighting = new LightingSystem(this.scene);
    // Procedural sky shown through the windows; driven by the same sun below.
    this.sky = new SkyDome(this.scene);
    this.sun = new SunController(this.scene, this.lighting, this.hemi, opts.config, this.sky);
    this.sun.setRenderHook(() => this.requestRender());
    this.visuals = new EntityVisuals(this.scene, opts.config, () => this.requestRender());

    // A tap/long-press checks state-badge hit-testing FIRST, falling through
    // to PickHandler's 3D raycast only when no badge was hit. Badges resolve
    // through this same gesture pipeline that already reliably handles 3D
    // meshes, rather than Babylon GUI's own per-control pointer observables —
    // see EntityVisuals.pickBadgeAt()'s docstring for why that was dropped.
    const handleTap = (x: number, y: number) => {
      tapDebug(`TAP client(${x.toFixed(0)},${y.toFixed(0)})`);
      const badgeEntity = this.visuals.pickBadgeAt(x, y);
      if (badgeEntity) { opts.onEntityPicked(badgeEntity); return; }
      this.pick.pickAtScreen(x, y);
    };
    const handleLongPress = (x: number, y: number) => {
      tapDebug(`LONGPRESS client(${x.toFixed(0)},${y.toFixed(0)})`);
      const badgeEntity = this.visuals.pickBadgeAt(x, y);
      if (badgeEntity) { opts.onEntityLongPressed(badgeEntity); return; }
      this.pick.pickAtScreen(x, y, true);
    };

    this.camera = new CameraController(this.scene, canvas, opts.config, {
      onRoomChange: opts.onRoomChange,
      onActivity: () => this.requestRender(),
      // Tap-to-pick is detected in the camera (sole owner of the pointer
      // pipeline) and dispatched to the picker — reliable on touch & mouse.
      onTap: handleTap,
      onLongPress: handleLongPress,
    });

    // FloorManager watches the camera for staircase transitions. Floor
    // switches toggle mesh visibility, so the on-demand renderer must wake up.
    this.floors = new FloorManager(this.scene, (floor) => {
      opts.onFloorChange(floor);
      this.visuals.setActiveFloor(floor);
      // Re-scope the blue "clickable" outlines to the newly-active floor (they're
      // set once at load; without this the 1F glows persist while you're on 2F).
      if (this.loadedMeshes.length) this.applyHighlight(this.loadedMeshes);
      this.requestRender();
    });
    this.floors.setCamera(this.camera);

    this.pick = new PickHandler(
      this.scene, opts.onEntityPicked, opts.config.entityMap, opts.config.meshBindings,
      opts.onEntityLongPressed,
      (x, y) => !!this.visuals.pickBadgeAt(x, y),
    );
    // The construction args above don't carry the RBAC type denials — push
    // them now so a restricted profile's first pick is already filtered.
    this.pick.setMaps(opts.config.entityMap, opts.config.meshBindings, opts.config.deniedTypes, opts.config.hiddenCategories);

    // Bird's-eye overview camera (a second control mode). Created up front but
    // dormant: its input is attached and it becomes the active camera only when
    // setViewMode("overview") is called. Tap-to-pick routes through the same
    // picker as first-person.
    this.overview = new OverviewController(this.scene, canvas, {
      onActivity: () => this.requestRender(),
      onTap: handleTap,
      onLongPress: handleLongPress,
    });
    this.overview.setNaturalScrolling(opts.config.naturalScrolling ?? true);
    // Badge size is the FIXED "Icon size" setting (config.entityIconScale) — it
    // does NOT change with the bird's-eye zoom level. (We used to grow/shrink
    // badges on every overview pan/zoom; the user expects the configured size to
    // hold at any zoom, so the zoom-driven rescale was removed.)

    // Render-quality stack (tone mapping, SSAO, shadows, IBL, light balance).
    // Created after both cameras exist so SSAO can attach to all of them; the
    // initial apply() pushes config.render onto the freshly-built scene.
    this.renderFx = new RenderEnhancements(this.scene);
    this.renderFx.apply(this.deviceRenderConfig(opts.config.render));
    // renderFx.apply() sets the *base* IBL intensity and builds the env texture.
    // Re-run the sun pass now so SunController gets the final word on the values
    // it owns (fill light + day/night-scaled IBL) with the texture in place.
    this.sun.applyRealSun();

    // Any pointer activity on the canvas (look-around drag, wheel, tap) wakes the
    // on-demand render loop so the view stays smooth.
    this.scene.onPointerObservable.add(() => this.requestRender());

    this.startRenderLoop();
    window.addEventListener("resize", this.handleResize);
    // Belt-and-suspenders alongside the window "resize" listener above: some
    // embedding contexts (reported: the HA Companion App's iOS Ingress
    // WebView) can resize the CANVAS'S OWN box — e.g. settling into its
    // final on-screen bounds after first paint — without ever firing a
    // window-level "resize" event, leaving Babylon's internal render buffer
    // sized for a stale aspect ratio while the CSS box has already moved on.
    // Since the buffer and the box then disagree, the rendered frame gets
    // squished/stretched to fit — reported as "the villa image is all
    // stretched" on iPhone, alongside black bars where the WebView's real
    // bounds turned out shorter than expected. ResizeObserver watches the
    // canvas ELEMENT directly, independent of whether window ever fires
    // anything, so it catches this class of resize too.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(canvas);
    }

    // Long-running-kiosk robustness. A wall tablet / WebView can LOSE the WebGL
    // context (GPU reset, memory pressure, the app being backgrounded). Babylon
    // restores it, but our render loop is ON-DEMAND, so after a restore nothing
    // asks it to repaint — the last frame stays frozen on screen and every touch
    // looks ignored (you can see the villa but can't move or navigate, in either
    // camera mode). Force a render window on restore — and whenever the page is
    // shown again — so the view always thaws and input visibly responds.
    this.engine.onContextLostObservable.add(() => {
      console.warn("[SceneManager] WebGL context lost — view frozen until restored");
    });
    this.engine.onContextRestoredObservable.add(() => {
      console.warn("[SceneManager] WebGL context restored — forcing repaint");
      this.requestRender(2000);
    });
    document.addEventListener("visibilitychange", this.handleVisibility);
    // Safety net for the case React cleanup CANNOT cover: when Home Assistant
    // re-navigates the Ingress iframe (sidebar away-and-back), the old
    // document is discarded WITHOUT React unmounting — so dispose() never
    // runs, and this scene's WebGL context (tens of MB of decoded textures +
    // geometry on the GPU) lingers until GC. Chrome caps live WebGL contexts
    // (~16) and thrashes as they pile up, which is what ballooned model
    // texture-upload ("import") time on repeat opens. `pagehide` fires exactly
    // when a document is being discarded/frozen — dispose here so the GPU
    // context is released immediately instead of waiting for GC.
    window.addEventListener("pagehide", this.handlePageHide);
  }

  private handlePageHide = (e: PageTransitionEvent) => {
    // `persisted` = the document is going into the bfcache and may be RESTORED
    // intact — disposing then would leave a dead canvas on return. Only tear
    // down on a true discard (persisted === false), which is the iframe-
    // navigation / tab-close case we actually need to release the GPU for.
    // (A WebGL-heavy page is rarely bfcache-eligible anyway, but be safe.)
    if (!e.persisted) this.dispose();
  };

  private startRenderLoop() {
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const active =
        this.forceContinuous > 0 ||
        now < this.keepRenderingUntil ||
        !this.config.renderOnDemand;
      if (active) this.scene.render();
    });
  }

  /** Keep rendering for a short window (covers input latency + transitions). */
  requestRender(durationMs = 350): void {
    this.keepRenderingUntil = Math.max(this.keepRenderingUntil, performance.now() + durationMs);
  }

  /** Pin continuous rendering (e.g. while a camera stream panel is open). */
  pinContinuous(): () => void {
    this.forceContinuous++;
    this.requestRender();
    return () => {
      this.forceContinuous = Math.max(0, this.forceContinuous - 1);
    };
  }

  private handleResize = () => {
    this.engine.resize();
    this.requestRender();
  };

  // A backgrounded kiosk/tab can suspend the rAF loop and drop the GL context;
  // on return, resize (the viewport may have changed) and force a repaint so the
  // frozen frame refreshes instead of sitting there ignoring touches until some
  // other event happens to wake the on-demand loop.
  private handleVisibility = () => {
    if (document.visibilityState === "visible") {
      this.engine.resize();
      this.requestRender(1500);
    }
  };

  /**
   * Bird's-eye backdrop colour, matched to the active UI theme so the void
   * around the floor plan never clashes with the surrounding chrome ("light
   * theme selected but the canvas stays pitch black" report). "auto" resolves
   * against the OS colour-scheme preference, same as the CSS media query.
   */
  private overviewBackdropColor(): Color4 {
    const theme = this.config.theme;
    const isLight = theme === "light" || (theme === "auto" && !window.matchMedia("(prefers-color-scheme: dark)").matches);
    return isLight
      ? new Color4(0.90, 0.93, 0.97, 1) // matches --bg-base light
      : new Color4(0.055, 0.062, 0.078, 1); // matches --bg-base dark
  }

  /**
   * Swap between first-person walking and the bird's-eye overview camera. Only
   * one controller owns canvas pointer input at a time (no capture race), and
   * picking always follows scene.activeCamera so tapping entities works in both.
   */
  setViewMode(mode: "first-person" | "overview"): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    if (mode === "overview") {
      this.camera.setMovement(0, 0); // stop any in-flight walk
      this.camera.detachInput();
      if (this.loadedMeshes.length) {
        const ext = this.worldExtends(this.loadedMeshes);
        this.overview.fitTo({ min: ext.min, max: ext.max });
        // A saved per-device default (see saveOverviewDefault) overrides the
        // auto-fit angle/tilt/zoom/pan — fitTo() still ran first so the pan
        // bounds and icon-zoom reference are correct for THIS model.
        const saved = loadOverviewView();
        if (saved) {
          this.overview.applyPose({
            alpha: saved.alpha, beta: saved.beta, radius: saved.radius,
            target: { x: saved.targetX, y: saved.targetY, z: saved.targetZ },
          });
        }
      }
      this.overview.enable();
      this.scene.activeCamera = this.overview.camera;
      this.floors.setFirstPerson(false); // walker camera is parked; don't let its Y drive floors
      this.lastNavigatedRoom = null; // fresh overview: a later → first-person defaults to the staircase
      // Bird's-eye floor plan reads best on a calm, neutral backdrop rather
      // than the bright daytime sky blue (which "crashes the eyes", day or
      // night). Hide the sky dome and pin a themed backdrop; lighting is untouched.
      this.sky.setEnabled(false);
      this.sun.setBackgroundOverride(this.overviewBackdropColor());
    } else {
      this.overview.disable();
      this.scene.activeCamera = this.camera.camera;
      this.camera.attachInput();
      this.floors.setFirstPerson(true); // walking now — feet elevation drives the storey
      // Where to drop the walker: INTO the room the user picked in overview if
      // there is one (so "select a room, switch to first-person" lands there),
      // else the default staircase spawn. Either way switch to that floor FIRST
      // so grounding settles on the right storey, and face open space (not a wall).
      if (this.loadedMeshes.length) {
        const spawn = this.lastNavigatedRoom
          ? this.roomSpawn(this.lastNavigatedRoom)
          : this.firstPersonSpawn();
        this.floors.switchToFloor(spawn.floor);
        this.camera.teleport(spawn, true);
      }
      // Restore the real sky for the immersive walk-through view.
      this.sky.setEnabled(true);
      this.sun.setBackgroundOverride(null);
      this.visuals.setIconZoomScale(1); // fixed screen size when walking
    }
    this.requestRender(600);
  }

  getViewMode(): "first-person" | "overview" {
    return this.viewMode;
  }

  /** The default first-person landing pose. Always on the GROUND FLOOR: the foot
   *  of the staircase if we can locate it, else a ground-floor living/entry room,
   *  else the first ground-floor room, else the origin. Never a 2F room. */
  private firstPersonSpawn(): TeleportPoint {
    const eye = this.config.eyeHeight ?? 1.7;
    const ground = (p: TeleportPoint) => p.floor === 1;
    return (
      this.staircaseSpawn() ??
      this.calibratedPoints?.find((p) => ground(p) && /main|living|salon|séjour|sejour|hall|entr/i.test(p.name)) ??
      this.calibratedPoints?.find(ground) ??
      this.calibratedPoints?.[0] ??
      { name: "Start", floor: 1, position: { x: 0, y: eye, z: 0 }, target: { x: 0, y: 1.6, z: 2 } }
    );
  }

  /** A horizontal look-target facing the MOST OPEN direction from (x,z): probe
   *  rays all around at eye height and aim down the one with the most clearance,
   *  so a spawn never stares straight into the nearest wall or a piece of
   *  furniture. Falls back to +Z if nothing blocks anywhere. */
  private bestFacing(x: number, z: number, y: number): { x: number; y: number; z: number } {
    const DIRS = 16;
    const REACH = 8;
    const blocks = (m: AbstractMesh) =>
      m.isPickable && m.isVisible && m.isEnabled() && m.checkCollisions && !m.metadata?.isMarker;
    let bestAng = 0;
    let bestDist = -1;
    for (let i = 0; i < DIRS; i++) {
      const a = (i / DIRS) * Math.PI * 2;
      const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
      const hit = this.scene.pickWithRay(new Ray(new Vector3(x, y, z), dir, REACH), blocks);
      const dist = hit?.hit ? hit.distance : REACH;
      if (dist > bestDist) { bestDist = dist; bestAng = a; }
    }
    return { x: x + Math.cos(bestAng) * 3, y, z: z + Math.sin(bestAng) * 3 };
  }

  /** Ground a room's calibrated centre on its own storey and face open space —
   *  used when switching overview → first-person into a selected room. */
  private roomSpawn(room: TeleportPoint): TeleportPoint {
    const eye = this.config.eyeHeight ?? 1.7;
    const x = room.position.x;
    const z = room.position.z;
    const y = this.estimateFloorY(x, z, room.floor) + eye;
    return { name: room.name, floor: room.floor, position: { x, y, z }, target: this.bestFacing(x, z, y - 0.1) };
  }

  /**
   * A spawn at the FOOT of the staircase on the ground floor. In this pipeline
   * stairs are baked into the fused `Structure` mesh, so there's no stair mesh to
   * measure — the reliable signal is a stair-NAMED element (a plan room, or an
   * entity mesh like `camera.staircase_2f_cam`). We take its plan XZ and ground
   * it on floor 1 → the 1F spot beneath/beside the stairwell. Falls back to real
   * stair GEOMETRY (split-structure GLBs) and finally null.
   */
  private staircaseSpawn(): TeleportPoint | null {
    const eye = this.config.eyeHeight ?? 1.7;
    const groundAt = (x: number, z: number): TeleportPoint => {
      const y = this.estimateFloorY(x, z, 1) + eye;
      return { name: "Staircase", floor: 1, position: { x, y, z }, target: this.bestFacing(x, z, y - 0.1) };
    };

    // 1. A room the plan names as a staircase.
    const namedRoom = this.calibratedPoints?.find((p) =>
      /stair|escalier|escalera|scala|treppe|stufe|trap\b/i.test(p.name));
    if (namedRoom) return groundAt(namedRoom.position.x, namedRoom.position.z);

    // 2. A stair-named entity/structure mesh marks the stairwell's plan XZ.
    const stairMesh =
      this.loadedMeshes.find((m) => /staircase|escalier/i.test(m.name)) ??
      this.loadedMeshes.find((m) => /\bstairs?\b|_stair/i.test(m.name));
    if (stairMesh) {
      stairMesh.computeWorldMatrix(true);
      const c = stairMesh.getBoundingInfo().boundingBox.centerWorld;
      return groundAt(c.x, c.z);
    }

    // 3. Real stair geometry (only present in split-structure GLBs).
    const stairs = this.loadedMeshes.filter(
      (m) => m.metadata?.isStair === true && m.getTotalVertices() > 0);
    if (!stairs.length) return null;
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of stairs) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bb.minimumWorld);
      max = Vector3.Maximize(max, bb.maximumWorld);
    }
    const alongX = max.x - min.x >= max.z - min.z;
    const crossC = alongX ? (min.z + max.z) / 2 : (min.x + max.x) / 2;
    const loEnd = alongX ? min.x : min.z;
    const hiEnd = alongX ? max.x : max.z;
    const span = hiEnd - loEnd || 1;
    const surfaceY = (along: number): number => {
      const ox = alongX ? along : crossC;
      const oz = alongX ? crossC : along;
      const hit = this.scene.pickWithRay(
        new Ray(new Vector3(ox, max.y + 2, oz), new Vector3(0, -1, 0), max.y - min.y + 4),
        (mm) => mm.metadata?.isStair === true);
      return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : Infinity;
    };
    const loY = surfaceY(loEnd + span * 0.1);
    const hiY = surfaceY(hiEnd - span * 0.1);
    const bottom = loY <= hiY ? loEnd : hiEnd;
    const dir = Math.sign((loY <= hiY ? hiEnd : loEnd) - bottom) || 1;
    const standAlong = bottom - dir * 1.2;
    const px = alongX ? standAlong : crossC;
    const pz = alongX ? crossC : standAlong;
    const tAlong = standAlong + dir * 3;
    return {
      name: "Staircase",
      floor: 1,
      position: { x: px, y: min.y + eye, z: pz },
      target: { x: alongX ? tAlong : crossC, y: min.y + eye + 0.3, z: alongX ? crossC : tAlong },
    };
  }

  /** Flip to the other view mode; returns the mode now active. */
  toggleViewMode(): "first-person" | "overview" {
    const next = this.viewMode === "overview" ? "first-person" : "overview";
    this.setViewMode(next);
    return next;
  }

  /** True if THIS device/browser has a saved default overview framing
   *  (see saveOverviewDefault) — drives the "Fix default view" button's
   *  pressed state so it reads as a toggle. */
  hasOverviewDefault(): boolean {
    return loadOverviewView() !== null;
  }

  /**
   * Persist the overview camera's CURRENT angle/tilt/zoom/pan as this
   * device's default framing, applied every time the app lands in overview
   * mode from now on (fresh load, model reload, or manually switching back).
   * Per-device (localStorage — see utils/storage.ts), never synced or
   * exported: a wall tablet and a phone need different framing for the same
   * villa, which is exactly why the plain auto-fit isn't always right. Only
   * meaningful while already in overview mode.
   */
  saveOverviewDefault(): void {
    if (this.viewMode !== "overview") return;
    const pose = this.overview.getPose();
    saveOverviewView({
      alpha: pose.alpha, beta: pose.beta, radius: pose.radius,
      targetX: pose.target.x, targetY: pose.target.y, targetZ: pose.target.z,
    });
  }

  /**
   * Jump to this device's saved default overview framing right now — the
   * anchor button's tap gesture (not just the automatic apply-on-landing in
   * setViewMode). Returns false (no-op) when nothing has been saved yet or
   * we're not currently in overview, so the caller can show the right hint.
   */
  applyOverviewDefault(): boolean {
    if (this.viewMode !== "overview") return false;
    const saved = loadOverviewView();
    if (!saved) return false;
    this.overview.applyPose({
      alpha: saved.alpha, beta: saved.beta, radius: saved.radius,
      target: { x: saved.targetX, y: saved.targetY, z: saved.targetZ },
    });
    return true;
  }

  /**
   * Navigate to a teleport point correctly for whichever mode is active:
   * first-person → animated camera teleport; overview → restore that room's
   * saved bird's-eye framing (angle/tilt/zoom) if one was set via long-press
   * on its card, otherwise just pan the bird's-eye target to the room centre
   * (stays in overview mode either way).
   */
  navigateTo(point: TeleportPoint): void {
    // Remember the target so a later overview → first-person switch lands here.
    this.lastNavigatedRoom = point;
    if (this.viewMode === "overview") {
      if (point.overviewPose) {
        this.overview.applyPose(point.overviewPose);
      } else {
        this.overview.panTo(point.position.x, point.position.z);
      }
    } else {
      this.camera.teleport(point);
    }
  }

  private worldExtends(meshes: AbstractMesh[]) {
    meshes.forEach((m) => m.computeWorldMatrix(true));
    const set = new Set(meshes);
    return this.scene.getWorldExtends((m) => set.has(m));
  }

  /** On iOS, strip the extra render targets (SSAO and the IBL env, the
   *  heaviest WebGL-memory consumers and the ones WKWebView is least able to
   *  afford) before applying a render config. Tone mapping + exposure stay.
   *  A no-op elsewhere. */
  private deviceRenderConfig(render: RenderConfig): RenderConfig {
    if (!this.isIOS) return render;
    return { ...render, ssao: false, ibl: false };
  }

  /**
   * Real floor-surface (walking-surface) Y for a given storey at (x, z). Used
   * to place a room's RoomHighlight glow (and its teleport point) on the
   * storey it's actually on.
   *
   * Cast a ray straight DOWN at the room's centre, hitting only that storey's
   * structure meshes: the first (highest) hit is the floor slab's top surface.
   * A room centroid sits in open floor, so the ray does NOT hit the wall tops
   * that ring the room — which is exactly why an earlier bbox-max approach put
   * a 2F glow on the CEILING: a wall's material-mesh bbox spans floor→ceiling
   * and its XZ footprint wraps the whole room, so "max Y of covering meshes"
   * returned the ceiling height, not the floor. FloorManager hides every
   * storey except the one being viewed, and picking skips disabled meshes, so
   * the target storey's meshes are momentarily force-enabled for the probe and
   * restored after. Falls back to 0 (ground) when nothing is hit.
   */
  private estimateFloorY(x: number, z: number, floor: number): number {
    const meshes = this.floors.getFloorMeshes(floor);
    if (!meshes.length) return 0;
    const saved = meshes.map((m) => [m.isEnabled(false), m.isPickable] as const);
    for (const m of meshes) { m.setEnabled(true); m.isPickable = true; }
    // World Y is metres after normalisation; ±1000 comfortably brackets any villa.
    const hit = this.scene.pickWithRay(
      new Ray(new Vector3(x, 1000, z), Vector3.Down(), 2000),
      (m) => meshes.includes(m),
    );
    meshes.forEach((m, i) => { m.setEnabled(saved[i][0]); m.isPickable = saved[i][1]; });
    return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : 0;
  }

  /**
   * For a STEPPED/sloped room (a staircase), sample the real floor surface on a
   * grid inside the polygon and return glow-mesh vertex data that HUGS the steps,
   * so RoomHighlight can drape the red glow over the treads instead of floating a
   * flat patch at the first-hit tread height. Returns null for flat rooms (caller
   * keeps the cheap flat patch) or when the grid would be too large.
   *
   * Picking skips setEnabled(false) meshes and FloorManager hides other storeys,
   * so this room's floor is force-shown for the probe then restored — the same
   * trick estimateFloorY uses.
   */
  private buildRoomConform(pts: Pt2[], floor: number): { positions: number[]; indices: number[] } | null {
    const meshes = this.floors.getFloorMeshes(floor);
    if (meshes.length === 0) return null;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const STEP = 0.25;
    const nx = Math.max(2, Math.ceil((maxX - minX) / STEP) + 1);
    const nz = Math.max(2, Math.ceil((maxZ - minZ) / STEP) + 1);
    if (nx * nz > 6000) return null; // safety cap → fall back to flat patch

    const saved = meshes.map((m) => [m.isEnabled(false), m.isPickable] as const);
    for (const m of meshes) { m.setEnabled(true); m.isPickable = true; }
    const restore = () => meshes.forEach((m, i) => { m.setEnabled(saved[i][0]); m.isPickable = saved[i][1]; });

    const xAt = (c: number) => Math.min(minX + c * STEP, maxX);
    const zAt = (r: number) => Math.min(minZ + r * STEP, maxZ);
    const probe = (x: number, z: number): number | null => {
      const hit = this.scene.pickWithRay(
        new Ray(new Vector3(x, 1000, z), Vector3.Down(), 2000), (m) => meshes.includes(m));
      return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : null;
    };

    // Cheap steppedness pre-check (~10 interior probes) so a big FLAT room never
    // pays for a full-grid raycast just to discover it isn't stepped.
    const quick: number[] = [];
    for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) {
      const y = probe(minX + (maxX - minX) * i / 4, minZ + (maxZ - minZ) * j / 4);
      if (y !== null) quick.push(y);
    }
    if (quick.length < 3 || Math.max(...quick) - Math.min(...quick) < 0.35) { restore(); return null; }

    // Stepped → sample the full grid at the real surface height.
    const H = new Array<number | null>(nx * nz).fill(null);
    for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
      const x = xAt(c), z = zAt(r);
      if (pointInPolygon(x, z, pts)) H[r * nx + c] = probe(x, z);
    }
    restore();

    const OFFSET = 0.03; // lift off the treads so the glow doesn't z-fight
    const positions: number[] = [];
    const vmap = new Map<number, number>();
    const vidx = (gi: number): number => {
      let v = vmap.get(gi);
      if (v === undefined) {
        v = positions.length / 3;
        positions.push(xAt(gi % nx), H[gi]! + OFFSET, zAt(Math.floor(gi / nx)));
        vmap.set(gi, v);
      }
      return v;
    };
    const indices: number[] = [];
    for (let r = 0; r < nz - 1; r++) for (let c = 0; c < nx - 1; c++) {
      const a = r * nx + c, b = a + 1, d = a + nx, e = d + 1;
      if (H[a] === null || H[b] === null || H[d] === null || H[e] === null) continue;
      const va = vidx(a), vb = vidx(b), vd = vidx(d), ve = vidx(e);
      // Two triangles, wound both ways so the glow reads from above and at a graze.
      indices.push(va, vb, ve, va, ve, vd, ve, vb, va, vd, ve, va);
    }
    return indices.length ? { positions, indices } : null;
  }

  private entityCalibration(): Record<string, { x: number; y: number }> {
    return this.config.sh3dEntities?.length
      ? Object.fromEntries(this.config.sh3dEntities.map((e) => [e.entityId, { x: e.x, y: e.y }]))
      : ENTITY_CALIBRATION_CM;
  }

  /**
   * Normalise the model to real-world metres. Preferred: derive the exact scale
   * from the .sh3d reference — entity meshes sit at known plan positions (cm), so
   * the ratio of their model-space distances to their real cm distances gives the
   * true scale (independent of orientation). Falls back to an order-of-magnitude
   * height heuristic when there are no calibration meshes (a non-SweetHome GLB).
   */
  private normalizeScale(meshes: AbstractMesh[]): number {
    const calib = this.entityCalibration();
    const pts: Array<{ wx: number; wz: number; px: number; py: number }> = [];
    const seen = new Map<string, { x: number; z: number; n: number }>();
    for (const m of meshes) {
      const map = resolveMeshToMapping(
        m.name, this.config.entityMap, this.config.meshBindings, this.config.deniedTypes,
      );
      if (!map || !(map.entityId in calib)) continue;
      // Use bounding-box centre rather than getAbsolutePosition(): when the model
      // was created from an OBJ (e.g. via the Blender pipeline), Blender sets every
      // object's node transform to (0,0,0) and encodes world positions entirely in
      // vertex data.  getAbsolutePosition() returns (0,0,0) for all such meshes;
      // the bounding-box centerWorld correctly reflects the actual vertex positions.
      m.computeWorldMatrix(true);
      const c = m.getBoundingInfo().boundingBox.centerWorld;
      const acc = seen.get(map.entityId) ?? { x: 0, z: 0, n: 0 };
      acc.x += c.x; acc.z += c.z; acc.n += 1;
      seen.set(map.entityId, acc);
    }
    for (const [id, acc] of seen) {
      pts.push({ wx: acc.x / acc.n, wz: acc.z / acc.n, px: calib[id].x, py: calib[id].y });
    }

    let scale = 1;
    if (pts.length >= 2) {
      // Median of pairwise (worldDistance / planDistanceCm) * 100  ==  model units
      // per metre. Invert to scale the model to metres.
      const ratios: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const wd = Math.hypot(pts[i].wx - pts[j].wx, pts[i].wz - pts[j].wz);
          const pdCm = Math.hypot(pts[i].px - pts[j].px, pts[i].py - pts[j].py);
          if (pdCm > 50) ratios.push(wd / (pdCm / 100)); // units per metre
        }
      }
      ratios.sort((a, b) => a - b);
      const unitsPerMetre = ratios[Math.floor(ratios.length / 2)];
      if (unitsPerMetre > 0) scale = 1 / unitsPerMetre;
      devLog(`[Villa] scale from .sh3d reference: ${scale.toPrecision(4)} (from ${pts.length} entities)`);
    } else {
      // Heuristic fallback: target a single-storey height of ~2-6 m.
      const h = this.worldExtends(meshes).max.y - this.worldExtends(meshes).min.y;
      if (h > 0) {
        while (h * scale > 6) scale /= 10;
        while (h * scale < 2) scale *= 10;
      }
      devLog(`[Villa] scale from height heuristic: ${scale} (no calibration meshes)`);
    }

    if (scale !== 1 && Number.isFinite(scale)) {
      for (const m of meshes) if (!m.parent) m.scaling.scaleInPlace(scale);
      meshes.forEach((m) => m.computeWorldMatrix(true));
    }
    const after = this.worldExtends(meshes);
    devLog(`[Villa] model size ${(after.max.x - after.min.x).toFixed(1)} x ${(after.max.y - after.min.y).toFixed(1)} x ${(after.max.z - after.min.z).toFixed(1)} m`);
    return scale;
  }

  /**
   * Re-centre the model horizontally on the world origin and drop its floor to
   * Y=0, so the app's centred teleport coordinates line up with ANY GLB.
   */
  private recenterModel(meshes: AbstractMesh[]): void {
    const ext = this.worldExtends(meshes);
    const cx = (ext.min.x + ext.max.x) / 2;
    const cz = (ext.min.z + ext.max.z) / 2;
    const offset = new Vector3(-cx, -ext.min.y, -cz);
    for (const m of meshes) {
      if (!m.parent) m.position.addInPlace(offset); // move only the top-level root(s)
    }
    meshes.forEach((m) => m.computeWorldMatrix(true));
  }

  /** Give the browser one animation-frame's worth of room to process pending
   *  input (a tap, a click) before the next heavy synchronous step below.
   *  Doesn't make any INDIVIDUAL step non-blocking — glTF parse/GPU-upload
   *  (inside loadModelInto) and indexMeshes/applyStructure's own per-mesh
   *  loops are each still one uninterrupted synchronous stretch — it only
   *  shrinks the LONGEST unbroken stretch by breaking loadModel's top-level
   *  sequence into several. See loadModel's docstring for the full context;
   *  this is a deliberate, partial mitigation, not a fix. */
  private yieldFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  /**
   * Load the GLB (from ArrayBuffer in IndexedDB or an uploaded File). Returns
   * a timing breakdown (see modelInfo.ts's LoadedModelInfo) so a slow load
   * can be attributed to Babylon's own import (parse/decode/GPU-upload,
   * inside loadModelInto) vs. this method's own post-processing below.
   *
   * Yields the main thread (see yieldFrame) between the major steps below —
   * a villa can genuinely be requested to preload BEFORE login (see
   * ProfileGate's modelPreloadable), and this whole sequence is otherwise one
   * continuous multi-second synchronous block that would freeze that screen's
   * clicks for its full duration. This does NOT make any single step
   * non-blocking (indexMeshes especially is still one long uninterrupted
   * call) — genuinely eliminating that needs moving Babylon into a Web
   * Worker, a separate, much larger undertaking. This only shortens the
   * longest unbroken freeze and gives input a few more chances to land.
   */
  async loadModel(data: ArrayBuffer): Promise<{ importMs: number; postMs: number }> {
    const result = await loadModelInto(this.scene, data, this.config.extraGlassHints ?? []);
    if (this.disposed) return { importMs: result.importMs, postMs: 0 }; // unmounted mid-load
    const tPostStart = performance.now();
    this.loadedMeshes = result.meshes;

    // Baked-lighting GLB (blender_pipeline --bake): the structure carries its
    // full Cycles-rendered lighting in its texture and renders unlit, so every
    // dynamic-light system stands down. Order matters: visuals BEFORE its
    // indexMeshes below (that's where per-entity PointLights would be created),
    // and renderFx BEFORE sun (SunController's exposure write must be the
    // final word — all its call paths run after renderFx.apply()).
    if (result.baked) {
      devLog("[SceneManager] baked mode ON — dynamic lighting disabled" +
        (result.lightmapped ? " (LIGHTMAP flavour: original textures × baked light)" : "") +
        (result.nightBlend ? "; night atlas present (day/night crossfade)" : ""));
    }
    this.visuals.setBakedMode(result.baked);
    this.renderFx.setBakedMode(result.baked);
    this.sun.setBakedMode(result.baked, result.nightBlend, result.glassDim);

    // --- Critical path: everything needed for a correct, navigable first paint.
    this.normalizeScale(result.meshes); // bring to metres BEFORE recentring
    this.recenterModel(result.meshes); // align to origin BEFORE indexing positions
    this.floors.indexFloors(result.meshes);
    this.pick.indexInteractiveMeshes(result.meshes); // taps work immediately

    await this.yieldFrame();
    if (this.disposed) return { importMs: result.importMs, postMs: performance.now() - tPostStart };
    this.visuals.indexMeshes(result.meshes); // entity badges/lights/state visuals — the single heaviest step

    await this.yieldFrame();
    if (this.disposed) return { importMs: result.importMs, postMs: performance.now() - tPostStart };
    this.applyStructure(result.meshes); // solid walls + collisions + hidden ceilings

    // Spawn at the default first-person pose (foot of the staircase on the ground
    // floor). Uses the stair GEOMETRY, so it doesn't need calibration to have run.
    this.camera.teleport(this.firstPersonSpawn(), true);

    // The villa is correct and interactive now — reveal it.
    this.markReady();
    this.requestRender(1000);
    const postMs = performance.now() - tPostStart;

    // --- Deferred: raycast-heavy / cosmetic passes that need not block the first
    // paint. Running them AFTER the first rendered frame is what stops "Loading
    // the villa" (and, on a wall tablet, several seconds of blocked main thread)
    // from waiting on the per-room floor raycasts + the stair-glow conform. The
    // Dashboard adopts the rooms/teleport grid via onCalibrated when it lands.
    this.scene.onAfterRenderObservable.addOnce(() => {
      this.camera.indexTeleportAnchors(result.meshes);
      this.applyHighlight(result.meshes); // blue glow on bound meshes (if enabled)
      this.calibrateRooms(result.meshes); // plan→world fit + room glow (fires onCalibrated)
      this.requestRender();
    });

    return { importMs: result.importMs, postMs };
  }

  /**
   * Fit the SweetHome plan -> model world transform using entity-named meshes at
   * known plan positions, then build correctly-placed room anchors + teleport
   * points. Falls back silently (keeps defaults) if too few meshes match — e.g.
   * for a different villa with no calibration entities.
   */
  private calibrateRooms(meshes: AbstractMesh[]): void {
    // Prefer plan data parsed from an uploaded .sh3d (works for ANY villa);
    // otherwise fall back to the built-in reference data.
    const entityCalib: Record<string, { x: number; y: number }> = this.config.sh3dEntities?.length
      ? Object.fromEntries(this.config.sh3dEntities.map((e) => [e.entityId, { x: e.x, y: e.y }]))
      : ENTITY_CALIBRATION_CM;
    const rooms = this.config.sh3dRooms?.length ? this.config.sh3dRooms : ROOM_POLYGONS_CM;

    const world = new Map<string, { x: number; z: number; n: number }>();
    for (const m of meshes) {
      const map = resolveMeshToMapping(
        m.name, this.config.entityMap, this.config.meshBindings, this.config.deniedTypes,
      );
      if (!map || !(map.entityId in entityCalib)) continue;
      // Use bounding-box centre (same reason as in normalizeScale above).
      m.computeWorldMatrix(true);
      const c = m.getBoundingInfo().boundingBox.centerWorld;
      const acc = world.get(map.entityId) ?? { x: 0, z: 0, n: 0 };
      acc.x += c.x;
      acc.z += c.z;
      acc.n += 1;
      world.set(map.entityId, acc);
    }

    const pairs: PlanWorldPair[] = [];
    for (const [id, acc] of world) {
      const plan = entityCalib[id];
      pairs.push({ px: plan.x, py: plan.y, wx: acc.x / acc.n, wz: acc.z / acc.n });
    }

    // --- Build the plan→world transform ---
    // Delegated to the pure solver in roomCalibration.ts (three strategies, in
    // order of accuracy). A manual flipX/flipZ override (Settings) is applied
    // on top of whichever runs. The solver only needs one scene query — the
    // no-entity fallback's "does a downward ray hit a floor here?" probe.
    const ext = this.worldExtends(meshes);
    const solution = solvePlanToWorld({
      pairs,
      rooms,
      modelWidth: ext.max.x - ext.min.x,
      modelDepth: ext.max.z - ext.min.z,
      hitsFloorAt: (wx, wz) => {
        const hit = this.scene.pickWithRay(
          new Ray(new Vector3(wx, 20, wz), new Vector3(0, -1, 0), 40),
          (m) => {
            if (!m.isPickable || !m.isVisible || m.metadata?.isMarker) return false;
            const bb = m.getBoundingInfo().boundingBox;
            return (bb.maximumWorld.y - bb.minimumWorld.y) < 0.8; // flat = floor/ground
          },
        );
        return hit?.hit ?? false;
      },
    });

    if (!solution) {
      console.warn("[Villa] room calibration skipped — no rooms and no entity meshes");
      this.calibratedPoints = null;
      return;
    }
    const planToWorld = solution.planToWorld;
    devLog(`[Villa] calibration: ${solution.strategy}`);

    // Transform each room polygon to model space; centroid → teleport point.
    const worldPolys: Array<{ name: string; pts: Pt2[]; floorY: number; conform?: { positions: number[]; indices: number[] } }> = [];
    const points: TeleportPoint[] = [];
    for (const room of rooms) {
      const pts = room.points.map((p) => planToWorld(p.x, p.y));
      // TeleportPoint.floor (and the rest of the app) only models two
      // storeys — clamp rather than widen that union for a hypothetical 3rd.
      const floor: 1 | 2 = (room.floor ?? 1) >= 2 ? 2 : 1;
      const c = polygonCentroid(room.points);
      const wc = planToWorld(c.x, c.y);
      const floorY = this.estimateFloorY(wc.x, wc.z, floor);
      // Surface-hug the glow ONLY for staircase rooms (matched by name). The
      // grid-probe raycasts the whole fused structure, so running it on every
      // room — especially the big outdoor/terrain polygons, which vary in height
      // and so false-positive as "stepped" — flooded load with tens of thousands
      // of raycasts and hung "Loading the villa". Stairs are the only case a flat
      // patch reads wrong, so scope it to them.
      const isStairRoom = /stair|escalier|escalera|scala|treppe|stufe|trap\b|steps?\b/i.test(room.name);
      let conform: { positions: number[]; indices: number[] } | undefined;
      if (isStairRoom) {
        try { conform = this.buildRoomConform(pts, floor) ?? undefined; }
        catch (err) { console.warn("[Villa] stair glow conform failed; using flat patch", err); }
      }
      worldPolys.push({ name: room.name, pts, floorY, conform });
      points.push({
        name: room.name,
        floor,
        position: { x: wc.x, y: floorY + 1.7, z: wc.z },
        target: { x: wc.x, y: floorY + 1.6, z: wc.z + 1.5 },
      });
    }

    this.calibratedPoints = points;
    this.camera.setTeleportPoints(points);
    this.camera.setRoomPolygons(worldPolys);
    this.visuals.setRoomPolygons(worldPolys);
    devLog(`[Villa] ${worldPolys.length} room polygons registered`);

    // Point-only "rooms" (named TeleportMenu viewpoints with no real polygon,
    // e.g. a staircase landing) — best-effort now from whatever
    // config.teleportPoints currently holds; re-synced properly a moment
    // later once Dashboard's onCalibrated handler adopts the freshly-fitted
    // points (see updateConfig's teleportPoints diff below).
    this.lastRoomPolyNames = new Set(worldPolys.map((r) => r.name.trim().toLowerCase()));
    this.syncRoomPoints();

    // Camera motion-beam directions: each camera's sh3d plan `angle` (yaw)
    // rotated into world space by the SAME planToWorld fit (translation
    // cancels out by transforming two nearby points and taking the
    // difference, so this works regardless of which of the three calibration
    // strategies above ran, or whether a manual mirror override is layered on
    // top), THEN tilted by `pitch` (SweetHome's "Horizontal rotation around X
    // axis" field) for a vertical component. `pitch` only tilts the plan-space
    // horizontal direction up/down — it isn't itself a plan-space quantity, so
    // it's applied AFTER the world-space yaw is known, scaling the horizontal
    // part by cos(pitch) and adding a vertical part, which keeps the result a
    // unit vector without needing its own world-transform trip.
    const cameraDirections = new Map<string, { x: number; y: number; z: number }>();
    if (this.config.sh3dEntities?.length) {
      for (const e of this.config.sh3dEntities) {
        const map = this.config.entityMap[e.entityId];
        if (!map || map.type !== "camera") continue;
        const d = planAngleToDir(e.angle);
        const p0 = planToWorld(e.x, e.y);
        const p1 = planToWorld(e.x + d.px, e.y + d.py);
        const wx = p1.x - p0.x, wz = p1.z - p0.z;
        const len = Math.hypot(wx, wz);
        if (len <= 1e-6) continue;
        const pitch = e.pitch ?? 0;
        // CONFIRMED live (2026-07-03): positive pitch tilts the beam DOWN, as
        // expected for a ceiling-mounted security camera looking into the
        // room — no sign flip needed. Only sensible over roughly 0°..90°
        // (level -> straight down); beyond 90° cos(pitch) goes negative and
        // flips the HORIZONTAL component to the opposite compass direction
        // while the vertical part stays downward (sin stays positive up to
        // 180°) — mathematically correct for a literal axis rotation (past
        // vertical the camera is now aiming behind-and-up), but easy to
        // mistake for a bug: a pitch of e.g. 140° combined with a small yaw
        // can point the beam at whatever's immediately behind the camera
        // instead of continuing to tilt "further down", clipping to a
        // near-invisible stub the instant it hits nearby geometry. Keep pitch
        // within 0°..90° in SweetHome for an intuitive result.
        const vy = -Math.sin(pitch);
        const horizScale = Math.cos(pitch) / len;
        cameraDirections.set(e.entityId, { x: wx * horizScale, y: vy, z: wz * horizScale });
      }
    }
    this.visuals.setCameraDirections(cameraDirections);

    // Notify listeners (Dashboard) so the teleport grid + room labels re-adopt
    // these freshly-fitted points — e.g. right after a manual mirror toggle.
    this.calibrateCallbacks.forEach((cb) => cb());
  }

  /** Push RoomHighlight's point-only "rooms": named TeleportMenu viewpoints
   *  (config.teleportPoints) that aren't covered by a real room polygon.
   *  Called after every recalibration AND live whenever config.teleportPoints
   *  changes on its own (e.g. the user just added "Staircase") — adding a
   *  named room shouldn't need a full model reload to start glowing. */
  private syncRoomPoints(): void {
    // teleportPoints store the CAMERA's eye position (see setAnchorHere/
    // addRoomHere), not the floor — same relation CameraController.groundCamera
    // uses in reverse (floorY = eyeY - eyeHeight). A room like "Staircase" is
    // anchored well above the recentred floor's y≈0, so the glow patch must
    // use ITS OWN local floor height, not the flat offset real room polygons
    // use, or it renders buried inside the stairs/slab below and never shows.
    const eyeHeight = this.config.eyeHeight ?? 1.7;
    const extras = this.config.teleportPoints
      .filter((p) => !this.lastRoomPolyNames.has(p.name.trim().toLowerCase()))
      .map((p) => ({ name: p.name, x: p.position.x, z: p.position.z, floorY: p.position.y - eyeHeight }));
    this.visuals.setRoomPoints(extras);
  }

  /** Model-space teleport points fitted on load, or null (use config defaults). */
  getCalibratedTeleportPoints(): TeleportPoint[] | null {
    return this.calibratedPoints;
  }

  /** Subscribe to re-calibration (load + every mirror-toggle re-fit). */
  onCalibrated(cb: () => void): () => void {
    this.calibrateCallbacks.add(cb);
    return () => this.calibrateCallbacks.delete(cb);
  }

  /**
   * Names of meshes a user could bind to an entity (excludes helper/structural
   * meshes). Powers the binding UI for an arbitrary villa.
   */
  getBindableMeshNames(): string[] {
    const skip = /^(collision_|trigger_|teleport_|label_|__root__)/i;
    const seen = new Set<string>();
    for (const m of this.loadedMeshes) {
      if (!m.name || skip.test(m.name)) continue;
      if ((m.getTotalVertices?.() ?? 1) === 0) continue; // skip empty transform nodes
      seen.add(m.name);
    }
    return [...seen].sort();
  }

  /** Re-apply entityMap + meshBindings live (after the user edits a binding). */
  reindex(config: AppConfig): void {
    this.config = config;
    this.pick.setMaps(config.entityMap, config.meshBindings, config.deniedTypes, config.hiddenCategories);
    this.visuals.updateConfig(config);
    this.visuals.indexMeshes(this.loadedMeshes);
    this.requestRender();
  }

  /**
   * Enforce solid (opaque) walls and wall collisions, per config. SweetHome
   * exports sometimes carry a low wall alpha; we force structural surfaces
   * opaque while leaving genuinely transparent things (glass/windows/curtains)
   * alone, and turn on collision for vertical barriers.
   */
  private applyStructure(meshes: AbstractMesh[]): void {
    // Name patterns that are explicitly collidable (walls, railings, glass barriers).
    const structuralByName =
      /wall|partition|cloison|railing|balustrade|banister|newel|column|pillar|fence|window|glass|slid|baie|vitr/i;
    // Stairs/steps in several languages — these must NEVER collide (you walk up
    // them via floor-following) and are tagged so the camera can climb them.
    const stairPat = /stair|step|escalier|marche|scala|treppe|stufe|trap\b/i;
    // Never block movement through these (floors, outdoor terrain, helpers, stairs).
    const neverCollide =
      /ground|floor|room_|terrain|grass|lawn|water|pool|sky|__root__|ceiling|plafond|toit|ramp|slope/i;
    // Ceiling/roof meshes to hide (first-person view; outdoor "roof" artefacts).
    const ceilingPat = /ceiling|plafond|toiture|toit(?!ure)/i;

    for (const m of meshes) {
      const name = m.name;
      if (/^(halo_|label_)/i.test(name) || m.metadata?.isMarker) continue;

      // HA entity fixtures (light.*, cover.*, fan.*, …) are owned entirely by
      // EntityVisuals — the structural pass must never hide or collide them.
      // The mesh name IS the entity_id (domain prefix before the first dot, even
      // with a Blender ".001" instance suffix), so a known domain marks it as an
      // entity. Without this skip, the ceiling-hide regex below matched any light
      // whose entity_id legitimately contains an architectural word and set it
      // invisible — e.g. light.bedroom_1_…_ceiling_b1 and
      // light.living_room_ceiling_led_… vanished while a sibling like
      // light.…_wallswicth_center (no "ceiling") stayed visible. Honors the
      // "only objects named by the HA convention" rule without hardcoding names.
      if (inferTypeFromEntityId(name)) continue;

      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      const meshH = bb.maximumWorld.y - bb.minimumWorld.y;
      const meshMinY = bb.minimumWorld.y;
      // Horizontal footprint — a single wall is tall but THIN in one axis; a
      // whole-house "fused" wall mesh is tall and LARGE in both axes; furniture
      // is tall but medium-bulky in both. So treat thin-or-large as wall-like.
      const footX = bb.maximumWorld.x - bb.minimumWorld.x;
      const footZ = bb.maximumWorld.z - bb.minimumWorld.z;
      const footMin = Math.min(footX, footZ);
      const footMax = Math.max(footX, footZ);

      // --- Tag stairs so the camera's floor-follower knows it may climb them ---
      const isStair = stairPat.test(name);
      m.metadata = { ...(m.metadata ?? {}), isStair };

      // --- Hide ceiling/roof meshes (named OR floating high above floor level) ---
      // "Above floor level" = bounding box bottom is above 2.5 m and the mesh
      // is flat (height < 0.3 m). This removes outdoor "roofs" and ceilings without
      // hiding Floor 2 elements (whose FLOOR sits at ≈ 3 m but has height > 0.3 m).
      // Pipeline-split structure groups are EXEMPT from the height heuristic:
      // blender_pipeline (≥2.6.0) already drops the top ceiling/roof in Blender,
      // and Babylon splits Structure_L1 into one child mesh per material — so a
      // thin upper-storey slab (a 1 cm SweetHome "Box" floor patch at 2.56 m)
      // is a flat lone primitive that this heuristic ate, leaving a see-through
      // hole in the 2F floor. Name-matched ceilings are still hidden.
      const isPipelineStructure = /^Structure(?:_L\d+|_Exterior)?$/i.test(normaliseMeshName(name));
      // Tag the load-bearing shell (floor slabs + walls + baked stairs) so the
      // camera can ground on the real FLOOR and never on furniture: these fused
      // meshes contain no furniture, so a downward ray against them alone finds
      // the walking surface even when a table/bed sits directly overhead.
      m.metadata = { ...(m.metadata ?? {}), isStructure: isPipelineStructure };
      if (ceilingPat.test(name) || (!isPipelineStructure && meshMinY > 2.5 && meshH < 0.35)) {
        m.isVisible = false;
        m.checkCollisions = false;
        continue;
      }

      // --- Collisions ---
      // Collide only with things that are genuinely walls/barriers, so the camera
      // doesn't snag on furniture (a tall wardrobe/fridge is bulky, not a wall):
      // 1) Explicit name match (wall_XXX, railing, glass …)
      // 2) Tall AND (thin in one axis = a single wall/partition, OR large in both
      //    axes = a fused whole-house wall mesh). Excludes bulky furniture
      //    (wardrobe/fridge) so you no longer snag on it. (Babylon collides
      //    against real triangles, so a fused wall mesh still blocks correctly.)
      const isWallShaped = meshH > 1.2 && (footMin < 0.5 || footMax > 3.0);
      const isExplicit = structuralByName.test(name);
      const isExcluded = neverCollide.test(name) || isStair;
      // Wall collisions are always on (the toggle was removed — you should
      // never walk through a wall); only shape/exclusion decides.
      m.checkCollisions = !isExcluded && (isExplicit || isWallShaped);

      // --- Opacity ---
      // alpha > 0.5 → wall/furniture that bled alpha → force opaque.
      // alpha ≤ 0.5 → deliberately transparent (glass, curtain sheer) → leave alone.
      const mat = m.material;
      if (mat && mat.alpha > 0.5) {
        mat.alpha = 1;
        mat.transparencyMode = Material.MATERIAL_OPAQUE;
        if (mat instanceof PBRMaterial) {
          mat.useAlphaFromAlbedoTexture = false;
          if (mat.albedoTexture) mat.albedoTexture.hasAlpha = false;
        }
      }
    }
    this.requestRender();
  }

  /**
   * Mark every mesh bound to an entity with a blue outline so it reads as
   * clickable. Toggled by config.highlightInteractive.
   *
   * This used to be a Babylon HighlightLayer (a screen-space glow effect) —
   * a post-process "EffectLayer" that renders the whole scene into its own
   * off-screen buffer and composites back via a stencil test. Babylon has a
   * long-standing, only partially fixed limitation where two simultaneously-
   * active EffectLayers corrupt each other's output exactly where their
   * affected meshes overlap on screen (BabylonJS/Babylon.js#4463), which
   * this app hit back when it also ran a GlowLayer for lit fixtures: an LED
   * strip printed broken/cut segments specifically where it passed near/
   * behind a highlighted curtain or TV. `renderOutline` is a per-mesh
   * property drawn in the NORMAL forward pass (an extruded backface
   * silhouette, depth-tested against the whole scene like any other mesh)
   * rather than a competing screen-space effect layer, so it can't corrupt —
   * or be corrupted by — any other EffectLayer this app ever adds.
   *
   * `outlineWidth` is a LOCAL-space offset — Babylon's outline shader adds
   * `normal * outlineWidth` to the vertex position BEFORE the world-matrix
   * multiply (see @babylonjs/core Shaders/outline.vertex.js), so it's in the
   * same units as the mesh's own vertex data. This model's GLB keeps
   * SweetHome's CENTIMETRE vertex data and the loader converts to metres by
   * scaling only the root node (~0.01) — the same unit trap that made the LED
   * strip repairs silent no-ops (see EntityVisuals/meshUnits.ts). A flat
   * `outlineWidth = 0.02` meant "0.02 local cm units", i.e. 0.2mm before the
   * root scale even applies — invisible on screen. Converting the intended
   * WORLD width through axisWorldScale (same helper the strip fixes use) is
   * what makes the outline actually render.
   *
   * An outline ALONE is still not enough, though: the kiosk's default view is
   * the whole-villa overview, where 1 screen pixel covers roughly 1–2cm of
   * floor — any sane outline width is a 2–3px rim, invisible in practice.
   * That's why "the blue glow" seemed gone even with the width bug fixed. So
   * each clickable mesh ALSO gets `renderOverlay`: a translucent blue tint
   * over the whole object, rendered by the same forward-pass component as the
   * outline (Rendering/outlineRenderer — NOT an EffectLayer). The full-surface
   * tint stays obvious at any
   * zoom level; the outline adds the crisp rim when close.
   */
  private applyHighlight(meshes: AbstractMesh[]): void {
    for (const m of this.highlightedMeshes) {
      m.renderOutline = false;
      m.renderOverlay = false;
    }
    this.highlightedMeshes = [];
    if (!this.config.highlightInteractive) { this.requestRender(); return; }

    const blue = new Color3(0.25, 0.55, 1.0);
    const targetWorldWidth = 0.04; // metres — outline rim, sized for close-up views
    const activeFloor = this.floors.getCurrentFloor();
    for (const m of meshes) {
      if (!m.isEnabled() || !m.isVisible) continue;
      // Blue "clickable" outlines must be contextual to the ACTIVE floor only.
      // The 2F view keeps the 1F shell + fixtures rendered underneath (cumulative
      // floors), so isEnabled/isVisible alone would keep 1F devices glowing while
      // you're on 2F (and vice-versa). Match the badge culler: show only the
      // active storey's fixtures. floorIndex is stamped by FloorManager on the
      // entity mesh (or its parent when the mesh is a split primitive).
      const floorIdx = (m.metadata as { floorIndex?: number } | null)?.floorIndex
        ?? (m.parent?.metadata as { floorIndex?: number } | null)?.floorIndex;
      if (floorIdx !== undefined && floorIdx !== activeFloor) continue;
      const mapping = resolveMeshToMapping(
        m.name, this.config.entityMap, this.config.meshBindings, this.config.deniedTypes,
      );
      if (!mapping) continue;
      // Climate meshes get their own always-on RED outline while running
      // (EntityVisuals.applyToMesh) — a live status signal, not a "this is
      // clickable" hint, so it must never fight this blue treatment for the
      // same mesh's outline/overlay properties.
      if (mapping.type === "climate") continue;
      // Glow only for categories currently shown (HUD chips): a hidden
      // category's objects shouldn't advertise themselves as clickable.
      const category = effectiveCategory(mapping.entityId, mapping.type, mapping.category);
      if (this.config.hiddenCategories.includes(category)) continue;
      if (!(m instanceof Mesh)) continue;
      const unit = axisWorldScale(m);
      // Outline offset follows the vertex normal (any direction), so a single
      // scalar is needed; scaling in this model is uniform (SceneManager
      // scales x/y/z together), so any one axis represents it.
      const localScale = unit.x || unit.y || unit.z || 1;
      m.outlineColor = blue;
      m.outlineWidth = targetWorldWidth / localScale;
      m.renderOutline = true;
      m.overlayColor = blue;
      m.overlayAlpha = 0.3;
      m.renderOverlay = true;
      this.highlightedMeshes.push(m);
    }
    this.requestRender();
  }

  applyEntityState(entity: HassEntity): void {
    this.visuals.apply(entity);
  }

  private markReady() {
    this.ready = true;
    this.readyCallbacks.forEach((cb) => cb());
    this.readyCallbacks.clear();
  }

  isReady(): boolean {
    return this.ready;
  }

  onReady(cb: () => void): () => void {
    this.readyCallbacks.add(cb);
    return () => this.readyCallbacks.delete(cb);
  }

  /**
   * Live-apply render-quality settings while the Settings sliders are dragged.
   * Re-runs the sun pass so the hemi/sun/ambient multipliers take effect, and
   * pushes the rest (tone mapping, SSAO, shadows, IBL) through renderFx.
   */
  setRenderConfig(render: RenderConfig): void {
    this.config = { ...this.config, render };
    this.renderFx.apply(this.deviceRenderConfig(render));
    this.sun.updateConfig(this.config);
    // lightPoolIntensity is EntityVisuals' own value (see LightPools.ts), not
    // part of the RenderEnhancements/SunController pipeline above.
    this.visuals.setLightPoolIntensity(render.lightPoolIntensity ?? 1);
    this.requestRender();
  }

  /** Returns true if this call did a structural mesh re-index (see
   *  structuralChanged below) — the caller uses this to know whether entity
   *  visuals were torn down and need repainting from their last known state. */
  updateConfig(config: AppConfig): boolean {
    const prev = this.config;
    this.config = config;

    // --- Change-detection gating ---------------------------------------------
    // updateConfig() fires on EVERY config mutation, including cheap UI toggles
    // like "show labels" / "highlight clickable". Re-running the lighting pass
    // (which rewrites scene.clearColor + the sky) and the structural pass (which
    // re-clones materials and recreates per-light PointLights) on every toggle
    // is what made the background flicker and the scene visibly hitch. Each heavy
    // subsystem now only re-runs when an input it actually depends on changed.
    // Config objects are recreated immutably by ConfigContext.update(), so a
    // reference change reliably marks "this slice was touched".
    const renderChanged =
      prev.render !== config.render ||
      prev.latitude !== config.latitude ||
      prev.longitude !== config.longitude;

    // A freshly (re)uploaded central .sh3d lands here asynchronously — see
    // BabylonCanvas's background "central SH3D refresh", which fetches +
    // parses it AFTER first paint and just calls update({ sh3dRooms,
    // sh3dEntities }), with no full remount to force a re-fit. Without this,
    // the new room names/shapes sat in config but nothing ever re-ran
    // calibrateRooms() to pick them up — the Rooms menu kept showing
    // whatever was calibrated at the PREVIOUS model load until a second full
    // reload happened to already have the fresh data cached from last time.
    const sh3dChanged =
      prev.sh3dRooms !== config.sh3dRooms || prev.sh3dEntities !== config.sh3dEntities;

    // indexMeshes()/applyStructure() only read entity↔mesh bindings; everything
    // else (glass hints, grass, model transform) takes effect on the next
    // model load, not here.
    const structuralChanged =
      prev.entityMap !== config.entityMap ||
      prev.meshBindings !== config.meshBindings ||
      sh3dChanged;

    // renderFx first (sets base IBL + builds/clears the env texture), THEN the
    // sun pass so SunController has the final word on the fill light + day/night
    // IBL scaling it owns. Same ordering as setRenderConfig() — keeping the two
    // call sites consistent is what stops the night fill from flickering.
    if (renderChanged) {
      this.renderFx.apply(this.deviceRenderConfig(config.render));
      this.sun.updateConfig(config);
    }
    // Theme flip while already in overview: re-pin the backdrop to match.
    if (prev.theme !== config.theme && this.viewMode === "overview") {
      this.sun.setBackgroundOverride(this.overviewBackdropColor());
    }
    this.camera.updateConfig(config);
    this.overview.setNaturalScrolling(config.naturalScrolling ?? true);
    this.pick.setMaps(config.entityMap, config.meshBindings, config.deniedTypes, config.hiddenCategories);
    this.visuals.updateConfig(config); // internally cheap; rebuilds labels only on its own diff

    // A room added/renamed/removed via the Rooms menu ("Add room here") should
    // start glowing (or stop) immediately — no model reload needed, unlike the
    // real room polygons which only change on a full recalibration.
    if (prev.teleportPoints !== config.teleportPoints) {
      this.syncRoomPoints();
    }

    if (this.loadedMeshes.length && structuralChanged) {
      this.visuals.indexMeshes(this.loadedMeshes);
      this.applyStructure(this.loadedMeshes);

      const prevEntityCount = Object.keys(prev.entityMap).length;
      const newEntityCount  = Object.keys(config.entityMap).length;
      const entityDelta = newEntityCount - prevEntityCount;

      const needsRecalibration =
        sh3dChanged ||
        entityDelta > 0;  // new entities improve the plan→world fit

      if (needsRecalibration) {
        this.calibrateRooms(this.loadedMeshes);
        // On bulk auto-detection (many entities added at once) the initial
        // spawn was computed from the old, sparse entityMap and is likely
        // wrong. Re-teleport to the corrected default (staircase) position now.
        if (entityDelta >= 5) this.camera.teleport(this.firstPersonSpawn(), true);
      }
    }

    if (
      this.loadedMeshes.length &&
      (structuralChanged || // a disabled/rebound entity must lose/gain its outline
        prev.highlightInteractive !== config.highlightInteractive ||
        prev.hiddenCategories.join() !== config.hiddenCategories.join())
    ) {
      this.applyHighlight(this.loadedMeshes);
    }
    this.requestRender();
    return structuralChanged;
  }

  /** All entity mappings resolved from the last model load (for Config Editor auto-population). */
  getAutoDetectedMappings() {
    return this.visuals.getDetectedMappings();
  }

  private disposed = false;

  dispose(): void {
    // Idempotent: both React unmount AND the pagehide safety net can call
    // this, and pagehide can even fire mid-unmount — a double dispose()
    // otherwise double-frees Babylon resources (throws) or, worse, tears down
    // a freshly-created NEXT scene if calls interleave.
    if (this.disposed) return;
    this.disposed = true;

    window.removeEventListener("resize", this.handleResize);
    this.resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("pagehide", this.handlePageHide);
    this.engine.stopRenderLoop(); // stop first — no frames render during teardown

    // Subsystems own DOM listeners / timers / GUI textures that scene.dispose()
    // does not necessarily reclaim — dispose each explicitly. (visuals holds a
    // fullscreen GUI AdvancedDynamicTexture + per-entity lights/shadow maps;
    // camera/overview hold canvas pointer/key listeners.)
    this.renderFx.dispose();
    this.sky.dispose();
    this.camera.dispose();
    this.overview.dispose();
    this.visuals.dispose();

    // Drop the module-level LightPools gradient cache so it can't hand the
    // NEXT scene a texture belonging to this now-disposed one (the getScene()
    // guard already regenerates, but this also frees the reference for GC).
    resetLightPoolTextureCache();

    this.scene.dispose();

    // engine.dispose() disposes GPU buffers, but the browser can still hold the
    // WebGL context itself alive (counting against Chrome's ~16-context cap)
    // until GC. Explicitly force the driver to release it NOW so repeated
    // iframe reloads don't accumulate live contexts and thrash GPU memory.
    // `_gl` is Babylon-internal but the only handle to the raw context; grab it
    // BEFORE dispose() (which nulls Babylon's own references).
    const gl = (this.engine as unknown as { _gl?: WebGLRenderingContext })._gl;
    this.engine.dispose();
    try {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // Best-effort — some contexts refuse the extension; not fatal.
    }
  }
}
