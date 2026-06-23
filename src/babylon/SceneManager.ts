// src/babylon/SceneManager.ts
// Owns the Babylon engine + scene and the on-demand render loop.
//
// On-demand rendering adapted for a first-person camera: instead of rendering
// every frame forever (which cooks a tablet GPU), we only render while there is
// activity — camera input, a running animation, or an entity visual change.
// `requestRender()` keeps the loop "awake" for a short window; when nothing asks
// for frames the loop idles at ~0% GPU. (Core 3Dash idea, generalised.)

import {
  Engine, Scene, Color3, Color4, Vector3, HemisphericLight, SceneLoader, Material, PBRMaterial, Ray,
  HighlightLayer, Mesh,
  type AbstractMesh,
} from "@babylonjs/core";
import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/loaders/glTF";

import { CameraController } from "./CameraController";
import { LightingSystem } from "./LightingSystem";
import { SunController } from "./SunController";
import { FloorManager } from "./FloorManager";
import { PickHandler } from "./PickHandler";
import { EntityVisuals } from "./EntityVisuals";
import { MarkerManager } from "./MarkerManager";
import { WeatherEffects } from "./WeatherEffects";
import { loadModelInto } from "./ModelLoader";
import { resolveMeshToMapping } from "@/config/EntityMap";
import { ENTITY_CALIBRATION_CM, ROOM_POLYGONS_CM, polygonCentroid } from "@/config/Sh3dCalibration";
import { fitAffine, affineResidual, spanArea, type PlanWorldPair } from "@/utils/affineFit";
import type { Pt2 } from "@/utils/geometry";
import type { AppConfig } from "@/config/AppConfig";
import type { HassEntity } from "@/types/ha.types";
import type { TeleportPoint } from "@/types/scene.types";

export interface SceneManagerOptions {
  config: AppConfig;
  /** Called when a mesh mapped to an entity is tapped. */
  onEntityPicked: (entityId: string) => void;
  /** Called when the active floor changes (staircase or button). */
  onFloorChange: (floor: number) => void;
  /** Called when the camera enters a new named room. */
  onRoomChange: (room: string | null) => void;
}

export class SceneManager {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: CameraController;
  readonly lighting: LightingSystem;
  readonly sun: SunController;
  readonly floors: FloorManager;
  readonly pick: PickHandler;
  readonly visuals: EntityVisuals;
  readonly markers: MarkerManager;
  readonly weather: WeatherEffects;

  private config: AppConfig;
  private ready = false;
  private readyCallbacks = new Set<() => void>();
  private calibrateCallbacks = new Set<() => void>();
  private keepRenderingUntil = 0;
  private forceContinuous = 0; // ref count for animations/streams
  private loadedMeshes: AbstractMesh[] = [];
  private calibratedPoints: TeleportPoint[] | null = null;
  private highlightLayer: HighlightLayer | null = null;

  constructor(canvas: HTMLCanvasElement, opts: SceneManagerOptions) {
    this.config = opts.config;

    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.7, 0.85, 1.0, 1);
    this.scene.collisionsEnabled = true;
    this.scene.gravity = new Vector3(0, -0.6, 0);

    // Always-on interior fill. This is independent of the time-of-day sun, so
    // walls keep their true colour (white reads white, not grey) even at night
    // or with the sun low. A light groundColor lifts undersides off pure black.
    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.95;
    hemi.diffuse = new Color3(1, 1, 1);
    hemi.groundColor = new Color3(0.55, 0.55, 0.6);
    hemi.specular = new Color3(0.1, 0.1, 0.1);

    this.lighting = new LightingSystem(this.scene);
    this.sun = new SunController(this.scene, this.lighting, opts.config);
    this.sun.setRenderHook(() => this.requestRender());
    this.visuals = new EntityVisuals(this.scene, opts.config, () => this.requestRender(), opts.onEntityPicked);
    this.markers = new MarkerManager(this.scene, () => this.requestRender());
    this.weather = new WeatherEffects(this.scene, () => this.requestRender());

    this.camera = new CameraController(this.scene, canvas, opts.config, {
      onRoomChange: opts.onRoomChange,
      onActivity: () => this.requestRender(),
    });

    // FloorManager watches the camera for staircase transitions.
    this.floors = new FloorManager(this.scene, opts.onFloorChange);
    this.floors.setCamera(this.camera);

    this.pick = new PickHandler(
      this.scene, opts.onEntityPicked, opts.config.entityMap, opts.config.meshBindings,
    );

    // Any pointer activity on the canvas (look-around drag, wheel, tap) wakes the
    // on-demand render loop so the view stays smooth.
    this.scene.onPointerObservable.add(() => this.requestRender());

    this.startRenderLoop();
    window.addEventListener("resize", this.handleResize);
  }

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

  private worldExtends(meshes: AbstractMesh[]) {
    meshes.forEach((m) => m.computeWorldMatrix(true));
    const set = new Set(meshes);
    return this.scene.getWorldExtends((m) => set.has(m));
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
      const map = resolveMeshToMapping(m.name, this.config.entityMap, this.config.meshBindings);
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
      console.log(`[Villa] scale from .sh3d reference: ${scale.toPrecision(4)} (from ${pts.length} entities)`);
    } else {
      // Heuristic fallback: target a single-storey height of ~2-6 m.
      const h = this.worldExtends(meshes).max.y - this.worldExtends(meshes).min.y;
      if (h > 0) {
        while (h * scale > 6) scale /= 10;
        while (h * scale < 2) scale *= 10;
      }
      console.log(`[Villa] scale from height heuristic: ${scale} (no calibration meshes)`);
    }

    if (scale !== 1 && Number.isFinite(scale)) {
      for (const m of meshes) if (!m.parent) m.scaling.scaleInPlace(scale);
      meshes.forEach((m) => m.computeWorldMatrix(true));
    }
    const after = this.worldExtends(meshes);
    console.log(`[Villa] model size ${(after.max.x - after.min.x).toFixed(1)} x ${(after.max.y - after.min.y).toFixed(1)} x ${(after.max.z - after.min.z).toFixed(1)} m`);
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

  /** Load the GLB (from ArrayBuffer in IndexedDB or an uploaded File). */
  async loadModel(data: ArrayBuffer): Promise<void> {
    const result = await loadModelInto(this.scene, data);
    this.loadedMeshes = result.meshes;
    this.normalizeScale(result.meshes); // bring to metres BEFORE recentring
    this.recenterModel(result.meshes); // align to origin BEFORE indexing positions
    this.floors.indexFloors(result.meshes);
    this.camera.indexTeleportAnchors(result.meshes);
    this.pick.indexInteractiveMeshes(result.meshes);
    this.visuals.indexMeshes(result.meshes);
    this.applyStructure(result.meshes); // solid walls + collisions
    this.applyHighlight(result.meshes); // blue glow on bound meshes (if enabled)

    // Fit the plan->world transform from entity-named meshes and lay out room
    // anchors / teleport points correctly for THIS model.
    this.calibrateRooms(result.meshes);

    // Recreate persisted floating markers for this villa.
    this.markers.sync(this.config.markers);

    // Spawn INSIDE a real room (the main/living room if we have it). Falls back to
    // the model centre. This matters for models with big outdoor areas, where the
    // bounding-box centre would land you outside on the garden.
    const spawn =
      this.calibratedPoints?.find((p) => /main|living/i.test(p.name)) ??
      this.calibratedPoints?.[0] ??
      { name: "Start", floor: 1 as const, position: { x: 0, y: this.config.eyeHeight, z: 0 }, target: { x: 0, y: 1.6, z: 2 } };
    this.camera.teleport(spawn, true);

    this.markReady();
    this.requestRender(1000);
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
      const map = resolveMeshToMapping(m.name, this.config.entityMap, this.config.meshBindings);
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
    // Three strategies, in order of accuracy:
    //   1. ≥3 well-spread entity meshes → full affine fit (exact; any rotation/mirror).
    //   2. 1–2 entity meshes → solve sign + translation against the bbox scale
    //      (deterministically fixes left/right + front/back mirroring).
    //   3. No entity meshes → raycast-vote orientation over all four mirror combos.
    // A manual flipX/flipZ override (Settings) is applied on top of whichever runs.
    let planToWorld: ((px: number, py: number) => { x: number; z: number }) | null = null;

    // Room-polygon bounding box + scale (needed by strategies 2 and 3).
    let pxMin = Infinity, pxMax = -Infinity, pyMin = Infinity, pyMax = -Infinity;
    for (const r of rooms) for (const p of r.points) {
      pxMin = Math.min(pxMin, p.x); pxMax = Math.max(pxMax, p.x);
      pyMin = Math.min(pyMin, p.y); pyMax = Math.max(pyMax, p.y);
    }
    const planCx = (pxMin + pxMax) / 2;
    const planCy = (pyMin + pyMax) / 2;
    const ext = this.worldExtends(meshes);
    const modelW = ext.max.x - ext.min.x;
    const modelD = ext.max.z - ext.min.z;
    const scaleX = pxMax > pxMin ? modelW / (pxMax - pxMin) : 0.01;
    const scaleZ = pyMax > pyMin ? modelD / (pyMax - pyMin) : 0.01;
    const planScale = (scaleX + scaleZ) / 2;
    // A correct fit should reproduce entity positions to well within the model
    // size; reject a fit whose RMS error exceeds this (ill-conditioned/mismatched).
    const residualLimit = 0.15 * Math.max(modelW, modelD, 1);

    // Strategy 1: affine fit (only if points span real 2D area and fit is tight).
    const M = pairs.length >= 3 && spanArea(pairs) > 1e4 ? fitAffine(pairs) : null;
    if (M && affineResidual(pairs, M) <= residualLimit) {
      planToWorld = (px, py) => M(px, py);
      console.log(
        `[Villa] calibration: affine fit from ${pairs.length} entity meshes ` +
        `(residual ${affineResidual(pairs, M).toFixed(2)} m)`,
      );
    } else if (pairs.length >= 1) {
      // Strategy 2: anchor on the entity centroid, choose the mirror signs that
      // best reproduce the observed entity world positions.
      const pCx = pairs.reduce((s, p) => s + p.px, 0) / pairs.length;
      const pCy = pairs.reduce((s, p) => s + p.py, 0) / pairs.length;
      const wCx = pairs.reduce((s, p) => s + p.wx, 0) / pairs.length;
      const wCz = pairs.reduce((s, p) => s + p.wz, 0) / pairs.length;
      let best = { xSign: 1, zSign: 1, err: Infinity };
      for (const xSign of [1, -1]) for (const zSign of [1, -1]) {
        let err = 0;
        for (const p of pairs) {
          const wx = wCx + (p.px - pCx) * planScale * xSign;
          const wz = wCz + (p.py - pCy) * planScale * zSign;
          err += (wx - p.wx) ** 2 + (wz - p.wz) ** 2;
        }
        if (err < best.err) best = { xSign, zSign, err };
      }
      const { xSign, zSign } = best;
      planToWorld = (px, py) => ({
        x: wCx + (px - pCx) * planScale * xSign,
        z: wCz + (py - pCy) * planScale * zSign,
      });
      console.log(
        `[Villa] calibration: ${pairs.length}-entity sign fit ` +
        `(flipX=${xSign < 0} flipZ=${zSign < 0}, scale=${planScale.toPrecision(4)})`,
      );
    } else if (rooms.length > 0) {
      // Strategy 3: no entity meshes — vote orientation by raycasting indoor room
      // centroids onto floor meshes across all four mirror combinations.
      const outdoorPat = /garden|pathway|terrace|patio|water|pool|outdoor|ext[eé]|lawn|grass|back.side|carport/i;
      const indoorRooms = rooms.filter((r) => !outdoorPat.test(r.name));
      const testRooms = indoorRooms.length >= 2 ? indoorRooms : rooms;

      const countHits = (xSign: number, zSign: number): number => {
        let hits = 0;
        for (const room of testRooms) {
          const c = polygonCentroid(room.points);
          const wx = (c.x - planCx) * planScale * xSign;
          const wz = (c.y - planCy) * planScale * zSign;
          const hit = this.scene.pickWithRay(
            new Ray(new Vector3(wx, 20, wz), new Vector3(0, -1, 0), 40),
            (m) => {
              if (!m.isPickable || !m.isVisible || m.metadata?.isMarker) return false;
              const bb = m.getBoundingInfo().boundingBox;
              return (bb.maximumWorld.y - bb.minimumWorld.y) < 0.8; // flat = floor/ground
            },
          );
          if (hit?.hit) hits++;
        }
        return hits;
      };

      let best = { xSign: 1, zSign: 1, hits: -1 };
      for (const xSign of [1, -1]) for (const zSign of [1, -1]) {
        const hits = countHits(xSign, zSign);
        if (hits > best.hits) best = { xSign, zSign, hits };
      }
      const { xSign, zSign } = best;
      planToWorld = (px, py) => ({
        x: (px - planCx) * planScale * xSign,
        z: (py - planCy) * planScale * zSign,
      });
      console.log(
        `[Villa] calibration: raycast-vote fallback (no entity meshes) ` +
        `flipX=${xSign < 0} flipZ=${zSign < 0}, ${best.hits}/${testRooms.length} hits`,
      );
    }

    if (!planToWorld) {
      console.warn("[Villa] room calibration skipped — no rooms and no entity meshes");
      this.calibratedPoints = null;
      return;
    }

    // Manual override (Settings): mirror the auto-fitted result about the model
    // centre (model is recentred on the origin) when detection comes out reversed.
    if (this.config.calibrationFlipX || this.config.calibrationFlipZ) {
      const base = planToWorld;
      const sx = this.config.calibrationFlipX ? -1 : 1;
      const sz = this.config.calibrationFlipZ ? -1 : 1;
      planToWorld = (px, py) => { const w = base(px, py); return { x: w.x * sx, z: w.z * sz }; };
      console.log(`[Villa] manual calibration override: flipX=${sx < 0} flipZ=${sz < 0}`);
    }

    // Transform each room polygon to model space; centroid → teleport point.
    const worldPolys: Array<{ name: string; pts: Pt2[] }> = [];
    const points: TeleportPoint[] = [];
    for (const room of rooms) {
      const pts = room.points.map((p) => planToWorld(p.x, p.y));
      worldPolys.push({ name: room.name, pts });
      const c = polygonCentroid(room.points);
      const wc = planToWorld(c.x, c.y);
      points.push({
        name: room.name,
        floor: 1,
        position: { x: wc.x, y: 1.7, z: wc.z },
        target: { x: wc.x, y: 1.6, z: wc.z + 1.5 },
      });
    }

    this.calibratedPoints = points;
    this.camera.setTeleportPoints(points);
    this.camera.setRoomPolygons(worldPolys);
    console.log(`[Villa] ${worldPolys.length} room polygons registered`);
    // Notify listeners (Dashboard) so the teleport grid + room labels re-adopt
    // these freshly-fitted points — e.g. right after a manual mirror toggle.
    this.calibrateCallbacks.forEach((cb) => cb());
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
    this.pick.setMaps(config.entityMap, config.meshBindings);
    this.visuals.updateConfig(config);
    this.visuals.indexMeshes(this.loadedMeshes);
    this.requestRender();
  }

  /** Enter/exit "tap an object to bind it" mode. */
  setBindMode(on: boolean, cb?: (meshName: string) => void): void {
    this.pick.setBindMode(on, cb);
  }

  /** Enter/exit "tap a spot to drop a control marker" mode. */
  setPlaceMode(on: boolean, cb?: (point: { x: number; y: number; z: number }) => void): void {
    this.pick.setPlaceMode(on, cb);
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
      if (ceilingPat.test(name) || (meshMinY > 2.5 && meshH < 0.35)) {
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
      m.checkCollisions = this.config.wallCollisions && !isExcluded && (isExplicit || isWallShaped);

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
   * Build (or rebuild) a HighlightLayer that draws a blue outline around every
   * mesh that is bound to an entity. Toggled by config.highlightInteractive.
   */
  private applyHighlight(meshes: AbstractMesh[]): void {
    if (this.highlightLayer) {
      this.highlightLayer.dispose();
      this.highlightLayer = null;
    }
    if (!this.config.highlightInteractive) return;

    const hl = new HighlightLayer("interactiveHL", this.scene);
    hl.outerGlow = true;
    hl.blurHorizontalSize = 0.4;
    hl.blurVerticalSize = 0.4;
    const blue = new Color3(0.25, 0.55, 1.0);

    for (const m of meshes) {
      if (!m.isEnabled() || !m.isVisible) continue;
      const mapping = resolveMeshToMapping(m.name, this.config.entityMap, this.config.meshBindings);
      if (!mapping) continue;
      if (!(m instanceof Mesh)) continue;
      try {
        hl.addMesh(m, blue);
      } catch {
        // Some meshes (no material, instanced, etc.) can't be highlighted.
      }
    }
    this.highlightLayer = hl;
    this.requestRender();
  }

  /** Re-sync floating markers from config (after add/remove/edit). */
  syncMarkers(): void {
    this.markers.sync(this.config.markers);
    this.requestRender();
  }

  /** Current active floor (for tagging a newly placed marker). */
  getCurrentFloor(): number {
    return this.floors.getCurrentFloor();
  }

  /** Fan a state change out to both real-mesh visuals and floating markers. */
  applyEntityState(entity: HassEntity): void {
    this.visuals.apply(entity);
    this.markers.apply(entity);
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

  updateConfig(config: AppConfig): void {
    const prev = this.config;
    this.config = config;
    this.sun.updateConfig(config);
    this.camera.updateConfig(config);
    this.pick.setMaps(config.entityMap, config.meshBindings);
    this.visuals.updateConfig(config);
    if (this.loadedMeshes.length) {
      this.visuals.indexMeshes(this.loadedMeshes);
      this.applyStructure(this.loadedMeshes);
      if (
        prev.calibrationFlipX !== config.calibrationFlipX ||
        prev.calibrationFlipZ !== config.calibrationFlipZ
      ) {
        this.calibrateRooms(this.loadedMeshes);
      }
      if (prev.highlightInteractive !== config.highlightInteractive) {
        this.applyHighlight(this.loadedMeshes);
      }
    }
    this.markers.sync(config.markers);
    this.requestRender();
  }

  /** All entity mappings resolved from the last model load (for Config Editor auto-population). */
  getAutoDetectedMappings() {
    return this.visuals.getDetectedMappings();
  }

  /** Toggle the Babylon Inspector — used to calibrate teleport coordinates. */
  async toggleInspector(): Promise<void> {
    try {
      if (this.scene.debugLayer.isVisible()) {
        this.scene.debugLayer.hide();
        return;
      }
      // The inspector bundle is a UMD file that expects window.BABYLON to exist.
      // With Vite's ES modules that global is never set — we set it here first.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      if (!win.BABYLON) {
        // The inspector UMD bundle tries to assign win.BABYLON.Inspector = …
        // ES module objects are frozen, so we spread into a plain mutable object.
        const core = await import("@babylonjs/core");
        win.BABYLON = { ...core };
      }
      await import("@babylonjs/inspector");
      await this.scene.debugLayer.show({ embedMode: true, overlay: true, globalRoot: document.body });
      this.requestRender();
    } catch (err) {
      console.error("[Inspector] failed to open:", err);
      alert("Inspector failed to load — see the browser console for details.");
    }
  }

  /** Used by ModelLoader fallback when no GLB exists yet. */
  static async tryLoadGLBString(scene: Scene, url: string): Promise<void> {
    await SceneLoader.AppendAsync("", url, scene);
  }

  dispose(): void {
    window.removeEventListener("resize", this.handleResize);
    this.camera.dispose();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
