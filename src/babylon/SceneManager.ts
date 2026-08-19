// src/babylon/SceneManager.ts
// Owns the Babylon engine + scene and the on-demand render loop.
//
// On-demand rendering adapted for a first-person camera: instead of rendering
// every frame forever (which cooks a tablet GPU), we only render while there is
// activity — camera input, a running animation, or an entity visual change.
// `requestRender()` keeps the loop "awake" for a short window; when nothing asks
// for frames the loop idles at ~0% GPU. (Core 3Dash idea, generalised.)

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Ray } from "@babylonjs/core/Culling/ray";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import "@babylonjs/loaders/glTF";
// Side-effect only: patches Mesh.prototype's renderOutline/renderOverlay
// setters (used by applyHighlight below, the blue "clickable" glow) so they
// actually lazy-load Babylon's OutlineRenderer instead of silently doing
// nothing. @babylonjs/core's full barrel used to pull this in for free; this
// codebase's deep, tree-shaking-friendly imports do not — the same class of
// gap as Scene.pickWithRay (Culling/ray) and beginDirectAnimation
// (Animations/animatable) below and in CameraController.ts, both patched
// onto a prototype by a sibling file TypeScript's types can't distinguish
// from the one holding the class itself. Without this import,
// `mesh.renderOutline = true` is a plain, inert property assignment: no
// error, no outline, which is exactly why this bug passed every type check.
import "@babylonjs/core/Rendering/outlineRenderer";
// Side-effect only: patches AbstractMesh.prototype.createOrUpdateSubmeshesOctree
// (used by applyStructure below) — same prototype-patch pattern as the import
// just above.
import "@babylonjs/core/Culling/Octrees/octreeSceneComponent";
// Side-effect only, and this is the actual first-person-movement-freeze fix:
// registers Scene.CollisionCoordinatorFactory. Without it, `scene.
// collisionCoordinator` (accessed internally by Babylon's own moveWithCollisions
// — triggered the instant camera.cameraDirection is non-zero, i.e. only while
// actually walking, never while just looking around) throws "DefaultCollision-
// Coordinator needs to be imported before as it contains a side-effect required
// by your code" on EVERY SINGLE FRAME of movement — confirmed via production
// telemetry (WINDOW_ERROR, same message, every app version back to 2.132.0).
// `scene.collisionsEnabled = true` below only sets a flag; it never pulls this
// module in on its own. Same prototype-patch pattern as the two imports above.
import "@babylonjs/core/Collisions/collisionCoordinator";
import { roomKey } from "@/config/roomKey";

import { CameraController } from "./CameraController";
import { OverviewController, ZOOM_STEP_FACTOR } from "./OverviewController";
import { LightingSystem } from "./LightingSystem";
import { SunController } from "./SunController";
import { SkyDome } from "./SkyDome";
import { NightSky } from "./NightSky";
import { FloorManager } from "./FloorManager";
import { PickHandler } from "./PickHandler";
import { EntityVisuals } from "./EntityVisuals";
import { RenderEnhancements } from "./RenderEnhancements";
import { loadModelInto } from "./ModelLoader";
import { resetLightPoolTextureCache } from "./LightPools";
import { resolveMeshToMapping, inferTypeFromEntityId } from "@/config/EntityMap";
import { isIOS as detectIOS } from "@/utils/diagnostics";
import { report as reportTelemetry } from "@/utils/telemetry";
import { beginSpan } from "@/utils/perfSpans";
import { runPerfProbe, type ProbeRow } from "./perfProbe";
import { axisWorldScale } from "./meshUnits";
import { ENTITY_CALIBRATION_CM, ROOM_POLYGONS_CM, polygonCentroid } from "@/config/Sh3dCalibration";
import { solvePlanToWorld, planAngleToDir } from "./roomCalibration";
import { isCeilingMesh, structureRole, isResolvedCeiling } from "./meshRoles";
import type { PlanWorldPair } from "@/utils/affineFit";
import { pointInPolygon, type Pt2 } from "@/utils/geometry";
import { devLog, debugFlagEnabled } from "@/utils/devLog";
import { tapDebug } from "@/utils/tapDebug";
import { loadOverviewView, saveOverviewView } from "@/utils/storage";
import type { AppConfig, RenderConfig } from "@/config/AppConfig";
import type { HassEntity } from "@/types/ha.types";
import type { TeleportPoint } from "@/types/scene.types";
import { entityMapDelta } from "./entityMapDiff";
import { ModelKeyedStore } from "./modelStore";
import { exactViewBasis, projectToView, type ProjectedPoint } from "./badgeProjection";
import { cameraFrame } from "./cameraFrame";

// Cosmetic-vs-structural entityMap diffing lives in its own pure module (no
// Babylon, no scene state) — see entityMapDiff.ts for the full reasoning about
// which fields qualify and why.

// ── Continuous-animation frame cap (see requestAnimationRender) ─────────────
// Minimum gap between two frames drawn ONLY because something is animating
// (a spinning fan, a pulsing alert) with nobody interacting. 33ms ≈ 30fps:
// a ceiling fan is a rotationally symmetric blur at kiosk viewing distance
// and reads identically at 30 as at 60, so the second half of those frames
// bought nothing and cost a villa's GPU continuously for as long as a fan is
// left on. Interaction is never subject to this — see requestRender.
const ANIMATION_FRAME_MS = 33;
/** How long the CAMERA must have been still before the picture is drawn at the
 *  panel's own resolution. The same tail `requestRender` arms by default, so an
 *  ordinary orbit sharpens at exactly the moment it always has — this is the
 *  one input to that decision, and every branch of the render loop reads it. */
const SHARPEN_STILL_MS = 350;

/** Round a derived world coordinate to millimetres. Used where a computed
 *  position is about to be STORED rather than only drawn — see the teleport
 *  points built in calibrateRooms for why the precision has to be dropped. */
const mm = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * How far above the lowest room floor a room may sit and still count as
 * "ground level" when locating the foot of a staircase (see stairFoot).
 *
 * A real floor varies by a few centimetres across a villa — probes differ, and
 * plans carry thresholds and split levels — while a stair TREAD is at least one
 * riser up, and a riser is ~0.17 m. 0.30 m sits between the two, and is the same
 * clearance `roomStorey.ts` uses for the same shape of question (STOREY_MIN_MOUNT,
 * where the SIGN of the comparison cost a release).
 */
const STAIR_FOOT_TOLERANCE = 0.30;

/**
 * A room the PLAN calls a staircase. Hoisted because it had been written out
 * three times and a fourth was about to be added — and the fourth is the one
 * that matters, so the copies would have drifted exactly where correctness
 * depends on them agreeing. Multilingual for the same reason every other room
 * matcher here is: the plan is authored in the owner's language.
 */
const STAIR_ROOM_RE = /stair|escalier|escalera|scala|treppe|stufe|trap\b|steps?\b/i;

/**
 * The tallest structure rise that counts as SOMETHING TO STAND ON rather than
 * something in the way — a step, a threshold, a plinth, or the surface of a
 * raised room whose slab the floor probe reported from underneath.
 *
 * 0.70 m: a domestic step is ~0.17 m and a split-level change is a few of them;
 * a person's torso starts well above this, so nothing at head height can hide
 * under it. Deliberately larger than CameraController.STEP_CLEAR (0.55), which
 * answers a different question — what the collision capsule may climb WHILE
 * WALKING, rather than what a spawn may be placed on top of.
 */
const STAND_STEP_MAX = 0.70;


// ── Frame-time sampling (see sampleFrame) ───────────────────────────────────
// A gap above this is the render loop RESUMING — the app went idle, the tab
// was throttled, a modal held the thread — not one frame that took a second.
// Well clear of even a 10fps frame, so a genuinely terrible frame is still
// recorded as the bad news it is rather than filtered out as a resume.
const FRAME_GAP_MAX_MS = 400;
// ~10s of interaction at 60fps. Bounds both the array and, with the report
// cap, how much a pathological session can send.
const FRAME_SAMPLE_MAX = 600;
// Below this a "burst" is a tap or a one-frame nudge, and its percentiles
// would be noise quoted to one decimal place.
const FRAME_SAMPLE_MIN = 45;
/** Frames the RESOLUTION VALVE needs before it may act — see flushFrameSamples
 *  for why this is separate from, and lower than, the telemetry minimum. About
 *  a third of a second at 60fps and over a second at 13fps, which is enough to
 *  be sure of a device's frame budget and short enough that a single pan on a
 *  struggling tablet is sufficient. */
const VALVE_SAMPLE_MIN = 20;
// Telemetry is a fixed-size ring in /data shared with every other device; a
// long session orbiting the villa must not evict the load and sync records
// this is meant to be read ALONGSIDE. The first few bursts answer the
// question; the hundredth adds nothing.
const FRAME_REPORT_MAX = 8;
// Below ~25fps interaction stops feeling like direct manipulation — that is
// the point at which supersampling is no longer worth what it costs.
const FRAME_SLOW_MS = 40;
// What easeResolution aims for once it has decided to act (~45fps). Not 60:
// overshooting to the resolution floor on one marginal burst would spend the
// whole quality budget to chase frames the display may not even present.
const FRAME_TARGET_MS = 22;
// 1.0 = one backbuffer pixel per CSS pixel. Never coarser than this — see
// easeResolution for the rainbow-speckle regression that sets this floor.
const HW_SCALE_FLOOR = 1;
// The starting cap: up to 2x CSS, whatever the panel claims. On a DPR-3 phone
// that is TWO THIRDS of native pixel density, and the compositor upscales the
// finished frame by 1.5x on its way to the screen. Icon strokes and hairline
// rings are the highest-frequency thing this app draws, so they are where that
// shows first — reported as "the glyphs look very pixelised", correctly.
const HW_START_CAP = 2;

// How far to push the horizon down in OVERVIEW, in the sky dome's own world
// units (its radius is 500 — see SkyDome.setHorizonDrop for why this is not an
// angle). The angle it buys is atan(drop / 500).
//
// 200 (~22°) was not enough: the overview's usual near-top-down framing still
// looked at plain black, and the colour only appeared once the view had been
// deliberately tilted toward horizontal. 700 is ~54°, which reaches the tilt
// the overview actually sits at.
//
// Openly unphysical, and chosen that way on the user's explicit "it's ok if
// that's not too realistic": at this offset the graded band shows even looking
// steeply down, where a real sky would hand you ground. That is the right trade
// here — the overview is a map of a villa against a sky, not a simulation of
// standing under one. FIRST PERSON KEEPS 0, where it must: the horizon belongs
// at eye level, and anything else puts the sea's edge below the terrace floor.
const OVERVIEW_HORIZON_DROP = 700;

// ── Zoom-to-room framing (see computeRoomOverviewPose) ──────────────────────
// How much of the BINDING SCREEN AXIS the room's own footprint should occupy.
//
// ── A ROOM IS SHOWN WITH ITS SURROUNDINGS, NOT EDGE TO EDGE (2.426.0) ───────
// This was a margin — 0.18, i.e. the footprint filled 85% of the axis — and it
// was reported as bad UX with four screenshots: the pool filled the glass
// corner to corner with no context at all, and the living room cropped its own
// curtains off the sides. The user then dragged to the shot they wanted and the
// log recorded it, twice: rung 271.223 -> ~152, and rung 170.860 -> ~117. Both
// asked for 1.5-1.8x more room around the subject.
//
// Restated as a FRACTION because that is the decision actually being made —
// "how much of the frame is the room" — and because it is then the same
// vocabulary as CHIP_MAX_VIEWPORT_FRACTION and CARD_MAX_VIEWPORT_FRACTION,
// which answer the same shape of question for the other two composite objects.
//
// ⚠️ It is applied AFTER the per-axis max, so it is a property of whichever
// axis binds — which is what makes one number behave identically on a portrait
// phone, a landscape laptop and a tablet either way. A margin expressed against
// one axis, or against the footprint's diagonal, is the 2.362.0 bug: the same
// room wanted radius 36 at one aspect and 51 at another.
//
// The entity-bounds fallback takes a SMALLER fraction (a wider shot), because
// device anchors sit inside the room rather than at its walls, so their box
// under-states it and the shot has to cover what the box does not describe.
const ROOM_FIT_VIEWPORT_FRACTION = 0.6;
const ROOM_FIT_VIEWPORT_FRACTION_ENTITIES = 0.45;
// Floor under the fitted radius, for a "room" that measures as a point (a
// single device, or a one-entity teleport spot) and would otherwise ask the
// camera to fly arbitrarily close. Expressed in world units = metres.
const MIN_ROOM_FIT_RADIUS = 1.5;
// NOTE for anyone tempted to add a tuning constant back here: two used to
// live at this spot and both are gone (2.209.0).
//   * DECLUTTER_RADIUS_MARGIN (0.85) padded the declutter zoom so it would
//     still clear groupBadges' QUANTISED step. That is arithmetic, not a
//     margin — solveRoomZoomRadius (which is what minPxPerWorldToDeclutterRoom
//     became) now snaps onto the step ladder itself and there is nothing left
//     to pad.
//   * DECLUTTER_RADIUS_MIN_FRACTION (0.5) capped how far the declutter step
//     could tighten the shot, because a fan and its own light kit once drove
//     the camera point-blank onto a bed. The cap was the wrong description of
//     that problem: the shot was bad because the room's OTHER badges were off
//     screen, not because it was closer than half the wall fit. The framing
//     constraint below says exactly that, and says it for every room instead
//     of approximately for all of them.

export interface SceneManagerOptions {
  config: AppConfig;
  /** Called when a mesh mapped to an entity is tapped (fast on/off action).
   *  clientX/clientY are the tap's screen position — used to spawn a brief
   *  tap-acknowledgment ripple at the DOM layer (see Dashboard's onEntityPicked)
   *  since a quick on/off tap has no panel/badge change to confirm it landed. */
  onEntityPicked: (entityId: string, clientX: number, clientY: number) => void;
  /** Called when a mesh mapped to an entity is long-pressed (open full panel). */
  onEntityLongPressed: (entityId: string, clientX: number, clientY: number) => void;
  /** A room-cluster chip was LONG-pressed — hand its members to the existing
   *  SummaryGroupPanel rather than opening any single device. Kept on
   *  long-press (this used to be the tap gesture) so the same "press and
   *  hold to see everything here" pattern the HUD uses elsewhere still opens
   *  it; a plain tap now navigates to the room instead (onClusterTapped). */
  onClusterPicked?: (room: string, entityIds: string[], roomNames: string[]) => void;
  /** A room-cluster chip was tapped (short press) — the same "tap a room →
   *  zoom there" gesture the radial room dial already uses (HUD's
   *  onRadialPick), so pressing whatever currently represents "this room" —
   *  a dial chip or a crowded map badge cluster — always does the same
   *  thing and builds the same muscle memory. */
  onClusterTapped?: (room: string, entityIds: string[], roomNames: string[]) => void;
  /** Called when the active floor changes (staircase or button). */
  onFloorChange: (floor: number) => void;
  /** Called when the camera enters a new named room. */
  onRoomChange: (room: string | null) => void;
}

/** The stair-glow mesh data RoomHighlight drapes over treads. */
interface ConformData { positions: number[]; indices: number[] }

/** FNV-1a over the polygon, quantised to millimetres. A hash rather than the
 *  raw point list because this becomes a localStorage key and a 40-vertex
 *  outdoor polygon would otherwise write a kilobyte of key per entry. */
/**
 * SweetHome bleeds alpha onto surfaces that are meant to be solid, so anything
 * still MOSTLY opaque is treated as a bleed and forced fully opaque; anything
 * at or under half is taken as deliberate (glass, a curtain sheer) and left
 * alone.
 *
 * A free function rather than an inline block at the bottom of applyStructure's
 * loop because the ceiling branch `continue`s before reaching that bottom, and
 * for two releases nobody noticed the ceiling was the ONE surface the rule was
 * not reaching — the surface where a bled alpha means you look through it at
 * the sky. A rule that must apply to a mesh classified early has to be callable
 * from where that classification happens.
 */
/**
 * The area a mesh's triangles actually COVER, projected onto the ground plane,
 * in m². Not its bounding box.
 *
 * ⚠️ THE BOUNDING BOX LIED, AND IT LIED BY AN ORDER OF MAGNITUDE (2.456.0).
 * `ceiling geometry: foot=649.5m2 (51.3% of villa)` was a sum of bounding boxes,
 * and the per-mesh dump showed why that is not a coverage figure at all:
 * `Structure_Ceiling_L0_primitive8` reports a 27.7 x 13.7 m box — 379 m² — from
 * **20 vertices**, i.e. at most five small quads scattered far apart. A box
 * around scattered panels is the size of the SCATTER, not of the panels.
 *
 * That mattered because the whole "drawn but unseen" conclusion rested on it:
 * half the villa appearing to be covered ruled out "there is simply no ceiling
 * here", and it should not have. Projected triangle area cannot make that
 * mistake — it is the number that says whether there is anything overhead.
 */
function projectedAreaXZ(m: AbstractMesh): number {
  const pos = m.getVerticesData(VertexBuffer.PositionKind);
  const idx = m.getIndices();
  if (!pos || !idx) return 0;
  const w = m.computeWorldMatrix(true);
  const a = Vector3.Zero(); const b = Vector3.Zero(); const c = Vector3.Zero();
  let area = 0;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    for (const [j, v] of [[idx[i], a], [idx[i + 1], b], [idx[i + 2], c]] as const) {
      Vector3.TransformCoordinatesFromFloatsToRef(
        pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2], w, v);
    }
    // Half the cross product's Y component — the triangle's own area projected
    // straight down, which is what "covers the floor below" means. Absolute,
    // so a downward-facing ceiling counts the same as an upward-facing one.
    area += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  }
  return area;
}

/**
 * Horizontal triangle area in a height band, split by which way it FACES.
 *
 * ⚠️ THIS IS THE TEST THAT SEPARATES "the pipeline dropped the ceiling" FROM
 * "SweetHome never exported one" (2.462.0), and it is the question the owner
 * asked directly: their room settings have "Display ceiling" checked, so where
 * did it go?
 *
 * blender_pipeline `_split_for_bake` peels a storey's ceiling off the fused
 * Structure by taking **DOWN-FACING** horizontal faces in a band around the
 * storey boundary (`_ceiling_face_mask(..., facing=-1)`), with a 1.2 m² minimum
 * component area. Anything it does not take stays fused inside `Structure` —
 * where the app can still see it, because by then Draco is decoded. So:
 *
 *   down ≈ 0 and up ≈ 0  → the OBJ has no ceiling here. Model/export problem.
 *   down ≈ 0 and up LARGE → the faces EXIST and point the wrong way, so the
 *                           peel's `facing=-1` filter skipped them. That also
 *                           explains why a ceiling had to be forced
 *                           double-sided in 2.449.0 — SweetHome slabs carry
 *                           inverted normals, and the same inversion defeats
 *                           the peel. FIX: the pipeline, not the app.
 *   down LARGE            → the peel's band or area threshold is too tight.
 *
 * Debug-flag gated and bbox-prefiltered: `Structure` is ~1.4M triangles across
 * ~190 primitives, and this walks index data, so it must not run on a normal
 * boot.
 */
function horizontalAreaInBand(
  m: AbstractMesh, loY: number, hiY: number,
): { down: number; up: number; byHeight: Map<number, number> } {
  const out = { down: 0, up: 0, byHeight: new Map<number, number>() };
  const bb = m.getBoundingInfo().boundingBox;
  if (bb.maximumWorld.y < loY || bb.minimumWorld.y > hiY) return out;
  const pos = m.getVerticesData(VertexBuffer.PositionKind);
  const idx = m.getIndices();
  if (!pos || !idx) return out;
  const w = m.computeWorldMatrix(true);
  const a = Vector3.Zero(); const b = Vector3.Zero(); const c = Vector3.Zero();
  for (let i = 0; i + 2 < idx.length; i += 3) {
    for (const [j, v] of [[idx[i], a], [idx[i + 1], b], [idx[i + 2], c]] as const) {
      Vector3.TransformCoordinatesFromFloatsToRef(
        pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2], w, v);
    }
    const cy = (a.y + b.y + c.y) / 3;
    if (cy < loY || cy > hiY) continue;
    // Cross product of the two edges: its Y component is the projected area
    // (signed by facing), its length is twice the true area.
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    // Same 0.85 threshold the pipeline's own mask uses, so the two answers are
    // comparable rather than merely similar.
    if (Math.abs(ny) / len <= 0.85) continue;
    if (ny < 0) out.down += len / 2; else out.up += len / 2;
    // Which HEIGHTS the unpeeled area sits at, in 10 cm buckets. This is the
    // number the pipeline's band has to be set from: its lower edge is
    // `base + 0.80 * storeyHeight`, and a room with a dropped ceiling (a
    // bathroom, a laundry) sits below that and is silently excluded. A total
    // says the peel is wrong; a histogram says what to change it to.
    if (ny < 0) {
      const k = Math.round(cy * 10) / 10;
      out.byHeight.set(k, (out.byHeight.get(k) ?? 0) + len / 2);
    }
  }
  return out;
}

function forceOpaque(m: AbstractMesh): void {
  const mat = m.material;
  if (!mat || mat.alpha <= 0.5) return;
  mat.alpha = 1;
  mat.transparencyMode = Material.MATERIAL_OPAQUE;
  if (mat instanceof PBRMaterial) {
    mat.useAlphaFromAlbedoTexture = false;
    if (mat.albedoTexture) mat.albedoTexture.hasAlpha = false;
  }
}

function polygonKey(pts: Pt2[], floor: number): string {
  let h = 0x811c9dc5;
  for (const p of pts) {
    const s = `${Math.round(p.x * 1000)},${Math.round(p.z * 1000)};`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return `f${floor}:${(h >>> 0).toString(36)}:${pts.length}`;
}

export class SceneManager {
  readonly engine: Engine;
  readonly scene: Scene;
  /** Per-frame draw-call and evaluation-time counters — see sampleFrame. */
  private instrumentation: SceneInstrumentation | null = null;
  readonly camera: CameraController;
  readonly overview: OverviewController;
  readonly lighting: LightingSystem;
  readonly sun: SunController;
  readonly sky: SkyDome;
  readonly floors: FloorManager;
  readonly pick: PickHandler;
  readonly visuals: EntityVisuals;
  readonly renderFx: RenderEnhancements;
  private nightSky: NightSky;

  private config: AppConfig;
  private hemi: HemisphericLight;
  /** True on iOS Safari / the HA companion WKWebView — used to strip the
   *  memory-hungry render targets (SSAO/IBL/sun shadows) that overrun iOS's
   *  low WebGL memory ceiling and crash-loop the loader (see the constructor). */
  private isIOS = false;
  private resizeObserver: ResizeObserver | null = null;
  /** Watches <html data-theme> — see handleThemeChange for why the attribute
   *  is the signal rather than config.theme. */
  private themeObserver: MutationObserver | null = null;
  private ready = false;
  private readyCallbacks = new Set<() => void>();
  private calibrateCallbacks = new Set<() => void>();
  private keepRenderingUntil = 0;
  private forceContinuous = 0; // ref count for animations/streams
  /** Budget for frames driven ONLY by a continuous animation — see
   *  requestAnimationRender / ANIMATION_FRAME_MS. */
  private animateUntil = 0;
  private lastAnimFrameAt = 0;
  /** Frame-time samples for the `frames` telemetry record — see sampleFrame. */
  private frameSamples: number[] = [];
  /** Cost of the scene.render() call itself, paired with frameSamples. */
  private renderSamples: number[] = [];
  private lastFrameAt = 0;
  private frameReportsSent = 0;
  /** performance.now() of the last WebGL context loss, 0 when not lost — used
   *  to report how long the view was actually dead. */
  private contextLostAt = 0;
  private loadedMeshes: AbstractMesh[] = [];
  /** Ceiling/roof meshes, as classified by applyStructure. Kept as a list so
   *  the view toggle can show them while walking and hide them for the
   *  bird's-eye cut-away, without re-running the classification or re-deriving
   *  it from names. Empty on a GLB whose pipeline already dropped the ceiling
   *  in Blender — which is the common case, and is reported by ?debug rather
   *  than left looking like a broken feature. */
  private ceilingMeshes: AbstractMesh[] = [];
  /** Reused by the ceiling-overhead probe — see setCeilingState. */
  private readonly ceilingRay = new Ray(Vector3.Zero(), new Vector3(0, 1, 0), 10);
  private calibratedPoints: TeleportPoint[] | null = null;
  /** Bumped by every calibration, so a cosmetic tail still yielding between
   *  frames can tell that a newer fit has superseded the geometry it holds. */
  private calibGeneration = 0;
  /** Scratch for computeRoomOverviewPose's four-corner footprint projection.
   *  Runs once per room tap, but projectToView writes into a caller-owned
   *  point by contract and this keeps that contract honest. */
  private fitScratch: ProjectedPoint = { px: 0, py: 0, pz: 0 };

  /**
   * The stair rooms' surface-hugging glow, carried across loads.
   *
   * The LAST of the raycast-bound passes to get this treatment, and the one
   * with the most rays behind it: a 0.25m grid over a stair room, measured at
   * 904ms for two rooms on an M1 and ~1800-2000ms on an iPhone. Chunking
   * (2.355.0) stopped it blocking, but the work is still done in full on every
   * load for geometry that cannot have changed.
   *
   * Keyed by the polygon itself (quantised, hashed) plus the storey, NOT by the
   * room's name: the name is not what the answer depends on, and a room that is
   * renamed should keep its glow while a room whose shape is edited must lose
   * it. A `null` entry is cached too — "this room is flat, use the patch" is an
   * answer, and re-deriving it costs nine probes.
   */
  private conformCache = new Map<string, ConformData | null>();
  private conformStore = new ModelKeyedStore<ConformData | null>(
    "vk.conform1.", /^vk\.conform\d*\./,
  );
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
  /** World-space room outlines with their own floor heights, kept so the spawn
   *  logic can ask "is this spot on a GROUND-LEVEL room floor" — see stairFoot.
   *  Everything else consumes them through camera/visuals. */
  private worldRoomPolys: Array<{ name: string; pts: Pt2[]; floorY: number }> = [];

  /** Kept so handlePageShow can ask "is this canvas still on screen?" — the
   *  test that distinguishes a real React unmount from an iOS
   *  background/restore of the same document. */
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, opts: SceneManagerOptions) {
    this.canvas = canvas;
    this.config = opts.config;

    // iOS Safari / the HA companion app's WKWebView enforces a hard, low ceiling
    // on total WebGL memory (framebuffers + render targets + geometry). A
    // DPR-3 iPhone rendered at 2× supersampling with 4× MSAA + every
    // post-process target used to overrun that ceiling and crash-loop — but
    // the dominant term was always the DECODED MODEL, and the pipeline's
    // v2.9.0 micro-UV collapse halved it (~321MB → ~170MB measured on the
    // real villa). With that headroom back, iPhone no longer needs the old
    // maximum-aggression tier (no MSAA + rendering BELOW CSS resolution),
    // whose single-sample minification of high-frequency tile textures also
    // showed as rainbow speckle noise around lit floors — reported
    // side-by-side vs a clean Android render of the same GLB. All devices
    // now render at the same up-to-2×-CSS supersample with MSAA; what
    // remains iOS-specific is the "default" power preference (WKWebView can
    // refuse/drop a high-performance context) and deviceRenderConfig()'s
    // SSAO/IBL strip — cheap insurance, and the crash-loop guard still
    // catches a device that genuinely can't take it. On modern iPadOS the
    // UA says "MacIntel" (desktop-class browsing) — the maxTouchPoints
    // check is what actually catches those.
    const isIOS = detectIOS();
    this.isIOS = isIOS;
    // `antialias` is a CONTEXT ATTRIBUTE — it can only be chosen here.
    //
    // ⚠️ ANTI-ALIASING IS THE POSITIONAL ARGUMENT, NOT THE OPTIONS FIELD.
    // Engine's signature is (canvas, antialias?, options?, adaptToDeviceRatio?)
    // and ThinEngine's constructor does `if (antialias != null)
    // options.antialias = antialias` — the positional one overwrites the
    // object. A release shipped a user setting into the options field with a
    // hardcoded `true` still in the slot that beats it, so the setting changed
    // nothing and the unchanged frame times read convincingly as "MSAA is not
    // the cost". Only reporting the DRIVER's own SAMPLES caught it. Both are
    // passed the same value now so the two can never disagree again.
    //
    // It stays ON, and that is now a MEASURED decision rather than a cautious
    // one. Same iPad, same CSS resolution, MSAA the only variable, from the
    // frame-cost probe:
    //
    //                        4x MSAA    no MSAA
    //   baseline               27ms       26ms
    //   empty scene, no GUI    18ms       19ms
    //   quarter pixels          6ms        6ms
    //
    // Free, on the slowest device this app runs on — indistinguishable from
    // noise, and worse on one row. So there is nothing to buy by turning it
    // off and smoother edges to lose. Resolution is the entire frame cost (see
    // calibrateResolution); anti-aliasing is not part of it.
    //
    // Do not re-open this without re-reading aaSamples in the probe record:
    // the first attempt at this measurement tested nothing at all, because the
    // positional argument above was overriding the request, and the unchanged
    // numbers looked exactly like a real null result.
    const ANTIALIAS = true;
    this.engine = new Engine(canvas, ANTIALIAS, {
      preserveDrawingBuffer: false,
      stencil: true,
      antialias: ANTIALIAS,
      powerPreference: isIOS ? "default" : "high-performance",
    });
    // Up-to-2× supersampling everywhere (1× on a DPR-1 desktop; a DPR≥2
    // phone/tablet renders at 2× CSS — ~native on DPR 2, ⅔ native on DPR 3).
    // Where that is too much for the device, calibrateResolution measures it
    // shortly after the reveal and the valve backs it off — per device, from
    // its own frame times, with nothing for anyone to configure.
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, HW_START_CAP));

    this.scene = new Scene(this.engine);
    // Two clock reads and a counter reset per frame, against frames measured at
    // 35ms — the cost is not observable, and without it engine._drawCalls is
    // never reset per frame (nothing else calls fetchNewFrame on it), so the
    // count would accumulate for the life of the session and mean nothing.
    this.instrumentation = new SceneInstrumentation(this.scene);
    this.instrumentation.captureActiveMeshesEvaluationTime = true;
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
    // Moon + stars. Entirely optional to the rest of the scene, and computed
    // from date/lat/lng — an install without HA's opt-in Moon integration gets
    // exactly the same night sky, which is the requirement.
    this.nightSky = new NightSky(this.scene);
    this.sun.setNightSky(this.nightSky);
    // Sun and moon are framed against the camera, so a tilt re-places both —
    // through ONE observer (SkyDome's), because two would race for ordering and
    // leave the moon a frame behind the sun in a sky they are meant to share.
    this.sky.setFramingHook(() => this.nightSky?.reframe());

    this.sun.setRenderHook(() => this.requestRender());
    this.visuals = new EntityVisuals(
      this.scene, opts.config,
      () => this.requestRender(),
      () => this.requestAnimationRender(),
    );

    // A tap/long-press checks state-badge hit-testing FIRST, falling through
    // to PickHandler's 3D raycast only when no badge was hit. Badges resolve
    // through this same gesture pipeline that already reliably handles 3D
    // meshes, rather than Babylon GUI's own per-control pointer observables —
    // see EntityVisuals.pickBadgeAt()'s docstring for why that was dropped.
    const handleTap = (x: number, y: number) => {
      tapDebug(`TAP client(${x.toFixed(0)},${y.toFixed(0)})`);
      // Entity groups (tier 4) first, and before badges:
      // a group's members are hidden exactly while it is drawn, so it cannot
      // steal a tap from a badge anyone can see. Unlike a room chip, a TAP
      // opens the device list rather than navigating — you are already looking
      // at the room, so "which of these did you mean" is the only question
      // left, and it is the same list the room chip's long-press opens.
      const eGroup = this.visuals.pickEntityGroupAt(x, y);
      if (eGroup) {
        // A CARD's cell opens that device directly — the same panel its own
        // badge would have opened, one tap, no list in between.
        if (eGroup.entityId) { opts.onEntityPicked(eGroup.entityId, x, y); return; }
        // ── NO CELL: LOOK FOR A BADGE BEFORE FALLING BACK TO THE LIST ─────
        // A group's own members are hidden while it draws, which used to make
        // "the group cannot steal a tap from a badge anyone can see" true by
        // construction. It stopped being true when a card grew past one badge
        // box: a card is anchored bottom-edge-on-anchor, so a 2x2 one reaches
        // two badge-heights straight up, while `placeEntityGroups` still tests
        // it against badges as a disc of half a box — deliberately, because
        // measuring at the full card would send groups to their room's chip
        // that a count would have seated. A card can therefore cover a badge
        // belonging to another pile entirely.
        //
        // So a tap that landed on the card but in no cell — a count badge, or
        // the empty bottom-right of a three-member grid — asks the badges
        // first. A tap that lands on something visible belongs to that thing.
        const under = this.visuals.pickBadgeAt(x, y, true);
        if (under) { opts.onEntityPicked(under, x, y); return; }
        if (opts.onClusterPicked) {
          opts.onClusterPicked(eGroup.room, eGroup.entityIds, []);
          return;
        }
      }
      const badgeEntity = this.visuals.pickBadgeAt(x, y, true);
      if (badgeEntity) { opts.onEntityPicked(badgeEntity, x, y); return; }
      // ── ROOM CHIPS LAST AMONG THE GUI TIERS (2.430.0) ─────────────────────
      // This ran FIRST, on the premise that "a chip only exists while its room
      // is too crowded to show individual badges, so this can never take a tap
      // away from a badge the user can actually see". That premise is false
      // whenever a room is FOCUSED: the chip belongs to room A while room B's
      // exempt badges and pair-cards draw on top of it, so the chip was taking
      // taps from devices the user could see — and painting over them too.
      //
      // Asking it last is the same rule this function already states two tiers
      // up: a tap that lands on something visible belongs to that thing. Safe
      // because pickBadgeAt tests the DRAWN controls (Control.contains) with no
      // slop ring of its own, so it can only pre-empt the chip where a badge is
      // genuinely painted. Paired with `container.zIndex = -1` on the chip in
      // EntityVisuals.ensureCluster — paint order and hit order must agree.
      const cluster = this.visuals.pickClusterAt(x, y);
      if (cluster && opts.onClusterTapped) {
        opts.onClusterTapped(cluster.room, cluster.entityIds, cluster.roomNames);
        return;
      }
      this.pick.pickAtScreen(x, y);
    };
    const handleLongPress = (x: number, y: number) => {
      tapDebug(`LONGPRESS client(${x.toFixed(0)},${y.toFixed(0)})`);
      // Entity groups first, and the CELL ANSWERS FIRST — exactly as it does in
      // handleTap, because a cell IS that device's badge. A summary of 2-6
      // draws one badge box per member and hides the badges themselves, so a
      // cell is not a shorthand for the group: it is the only representation
      // that device has on screen while the card is drawn. Both gestures must
      // therefore mean on a cell what they mean on a lone badge — tap toggles,
      // press-and-hold opens the details — or press-and-hold silently loses
      // the one thing it exists for at exactly the moment two identical icons
      // (two lights, say) make telling them apart matter most. It used to open
      // the group list here on the argument that a long press is the "show me
      // all of them" gesture; that argument holds for a ROOM CHIP, which
      // represents a room and never a device, and for a COUNT badge, which
      // names no device either. Both still open the list, below and above.
      const eGroup = this.visuals.pickEntityGroupAt(x, y);
      if (eGroup) {
        if (eGroup.entityId) { opts.onEntityLongPressed(eGroup.entityId, x, y); return; }
        // NO CELL — a count badge, or the empty bottom-right of a three-member
        // grid, or the gap between two cards. Same exception as the tap path:
        // a card can cover a badge belonging to another pile entirely (see
        // handleTap), so ask the badges before answering for something the
        // card merely happens to be drawn over.
        const under = this.visuals.pickBadgeAt(x, y, true);
        if (under) { opts.onEntityLongPressed(under, x, y); return; }
        if (opts.onClusterPicked) {
          opts.onClusterPicked(eGroup.room, eGroup.entityIds, []);
          return;
        }
      }
      const badgeEntity = this.visuals.pickBadgeAt(x, y, true);
      if (badgeEntity) { opts.onEntityLongPressed(badgeEntity, x, y); return; }
      // Room chips LAST, for the reason handleTap spells out: a chip paints
      // BEHIND badges and cards (zIndex -1), so it must not answer for a pixel
      // one of them is drawn on. Both gestures moved together — a tap and a
      // press-and-hold resolving to different objects at one point is worse
      // than either order.
      const cluster = this.visuals.pickClusterAt(x, y);
      if (cluster && opts.onClusterPicked) {
        opts.onClusterPicked(cluster.room, cluster.entityIds, cluster.roomNames);
        return;
      }
      this.pick.pickAtScreen(x, y, true);
    };

    /**
     * Double-tap / double-click on EMPTY map → zoom in one level, gliding.
     *
     * "Empty" is the whole of the condition. This fires on the second press's
     * DOWN, by which time the first tap has already released and done its own
     * job — so a double tap on a light has already toggled it once, and zooming
     * as well would make a mis-tap move the camera. The test is the same
     * cascade `handleTap` resolves through, in the same order (chip, summary,
     * badge, 3D mesh), asked as a question instead of as an action: if any of
     * them would have answered, this was not empty map and there is nothing to
     * do here.
     *
     * Overview only. The first-person camera has had double-tap-to-walk since
     * long before this, and it means something else there; the shared piece is
     * the RECOGNISER (TapRecognizer.isDoublePress), not the action.
     */
    const handleDoubleTap = (x: number, y: number) => {
      if (this.viewMode !== "overview") return;
      if (this.visuals.pickClusterAt(x, y)) return;
      if (this.visuals.pickEntityGroupAt(x, y)) return;
      if (this.visuals.pickBadgeAt(x, y)) return;
      if (this.pick.entityAtScreen(x, y)) return;
      tapDebug(`DOUBLETAP zoom at (${x.toFixed(0)},${y.toFixed(0)})`);
      // Pull toward the ground point under the finger, when there is one — the
      // villa is not a plane, so a tap on the sky simply zooms where it looks.
      this.overview.zoomStep(ZOOM_STEP_FACTOR, this.groundPointAt(x, y) ?? undefined);
    };

    this.camera = new CameraController(this.scene, canvas, opts.config, {
      onRoomChange: opts.onRoomChange,
      // MOTION — both camera controllers route every pose change here.
      onActivity: () => { this.motionPending = true; this.requestRender(); },
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
      // A storey switch swaps the slab under a walker who may not have moved a
      // millimetre, and the floor follower now declines to re-probe a spot it
      // has already answered — so tell it the answer is stale.
      this.camera.invalidateFloorProbe();
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
      onActivity: () => {
        // Keep badges their configured size at the fit and zoomed IN, but shrink
        // them once zoomed OUT past the fit so a far zoom-out can't pile every
        // badge into one fixed-size blob over a tiny villa. Only the THRESHOLD
        // is pushed: the scale itself is derived from the zoom rung inside the
        // layout pass, because a scale computed from the raw radius here landed
        // on a lattice offset from the rung's and made one rung mean two
        // layouts (2.417.0 — see OverviewController.getFitRadius).
        if (this.viewMode === "overview") {
          this.visuals.setIconZoomFit(this.overview.getFitRadius());
        }
        this.requestRender();
      },
      onTap: handleTap,
      onLongPress: handleLongPress,
      onDoubleTap: handleDoubleTap,
      onAnimating: (ms) => this.requestAnimationRender(ms),
    });
    this.overview.setNaturalScrolling(opts.config.naturalScrolling ?? true);
    // Badge size holds at the configured "Icon size" (config.entityIconScale) for
    // all standard framings; only a zoom-OUT past the whole-villa fit scales it
    // down (getIconZoomCap). (We used to grow/shrink
    // badges on every overview pan/zoom; the user expects the configured size to
    // hold at any zoom, so the zoom-driven rescale was removed.)

    // The `walk:` diagnostic reports BOTH raycasts that run while the camera
    // moves, not just the badge one — the floor follower is the other, and no
    // capture has ever measured it. Wired here, where both objects exist, so
    // neither subsystem has to know the other.
    this.visuals.setWalkFloorCost(() => this.camera.floorProbeCost);
    // The ceiling's state while WALKING — see EntityVisuals.setCeilingState for
    // why every previous ceiling report was taken in the one view that hides
    // them. `active` is read from the meshes the last frame actually submitted,
    // which is the only one of the three that Babylon owns rather than us.
    this.visuals.setCeilingState(() => {
      const active = new Set(this.scene.getActiveMeshes().data);
      let enabled = 0; let visible = 0; let drawn = 0;
      for (const m of this.ceilingMeshes) {
        if (m.isEnabled()) enabled += 1;
        if (m.isVisible) visible += 1;
        if (active.has(m)) drawn += 1;
      }
      // ⚠️ THE ONE QUESTION SIX ROUNDS NEVER ASKED: is there a ceiling above the
      // walker's head RIGHT NOW? Every counter so far has been about the SET of
      // ceiling meshes — how many exist, are enabled, are visible, are lit, are
      // opaque — and all of them can read perfectly while the room the person is
      // standing in has nothing over it. One ray straight up from the eye
      // answers it and cannot be argued with: a height means the geometry is
      // there and the fault is in rendering it; `none` means the GLB does not
      // ship a ceiling over this spot and no amount of app-side work will
      // conjure one. 11 meshes, once per `walk:` line, so the cost is nil.
      const eye = this.camera.camera.position;
      this.ceilingRay.origin.copyFrom(eye);
      this.ceilingRay.direction.set(0, 1, 0);
      this.ceilingRay.length = 10;
      let above: number | null = null;
      for (const m of this.ceilingMeshes) {
        if (!m.isEnabled() || !m.isVisible) continue;
        const info = this.ceilingRay.intersectsMesh(m, false);
        if (!info.hit || !info.pickedPoint) continue;
        if (above === null || info.pickedPoint.y < above) above = info.pickedPoint.y;
      }
      // ⚠️ WHERE THE WALKER IS, AND HOW FAR THE NEAREST CEILING IS. `above=none`
      // was uninterpretable without these: it could mean "the model has no
      // ceiling in this wing" or "there is one 40 cm away and the alignment is
      // off", and those are opposite conclusions. `near=` is the horizontal
      // distance to the closest ceiling panel's centre — metres means absent,
      // centimetres means misplaced.
      let near = Infinity;
      for (const m of this.ceilingMeshes) {
        const c = m.getBoundingInfo().boundingBox.centerWorld;
        near = Math.min(near, Math.hypot(c.x - eye.x, c.z - eye.z));
      }
      return {
        enabled, visible, active: drawn, above,
        at: { x: eye.x, y: eye.y, z: eye.z },
        near: Number.isFinite(near) ? near : null,
      };
    });

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
    // The second (and last) motion entry point — a finger on the glass is
    // motion whether or not the camera has decided to move yet.
    this.scene.onPointerObservable.add(() => { this.motionPending = true; this.requestRender(); });

    // Land on the bird's-eye OVERVIEW camera from the very first rendered frame.
    // Before the model finishes loading the active camera used to be the
    // first-person walker, so on iPhone/iPad the loading screen flashed a view
    // INTO a wall/door (the walker's default pose) behind the "Loading the
    // villa…" overlay. Rendering the overview backdrop instead keeps the wait
    // neutral. viewMode intentionally stays "first-person" here so the
    // Dashboard's on-ready setViewMode("overview") still runs the real
    // auto-fit (fitTo needs the loaded mesh extents, unavailable this early);
    // this only swaps which camera renders + the backdrop while we wait.
    this.camera.detachInput();          // avoid a two-controller pointer-capture race
    this.overview.enable();
    this.scene.activeCamera = this.overview.camera;
    // ⚠️ STARTUP IS OVERVIEW, AND SAYS SO. This block switches to the overview
    // camera while the model loads, but used to leave `viewMode` at its
    // declared "first-person" default and disable the dome "while we wait".
    // setViewMode early-returns when the mode it is handed already matches, so
    // any path reaching overview without a mode CHANGE left the sky switched
    // off for the rest of the session: no gradient, no sun, no moon, no stars,
    // just overviewBackdropColor behind the villa. Reported three times, and
    // 2.391.0 only fixed the horizon drop — it set the tilt of a dome that was
    // never turned on.
    //
    // Recording the mode here is what makes the later setViewMode("overview")
    // a correct no-op instead of the only thing holding the sky up. The dome
    // costs nothing to render during load (it is infiniteDistance, one draw
    // call) and a sky behind a loading villa beats a flat slab of colour.
    this.viewMode = "overview";
    this.sky.setEnabled(true);
    // The horizon drop is stated HERE as well as in setViewMode, because
    // this block puts the app in overview VISUALLY while leaving `viewMode` at
    // its "first-person" default — and setViewMode early-returns when the mode
    // it is handed already matches. Any path that reaches overview without a
    // mode CHANGE therefore skipped the drop entirely, leaving the dome at a
    // first-person horizon under a camera that looks down: no gradient, no sun,
    // no moon, no stars, just the loading backdrop below. Same early-return
    // that bit 2.383.0's aim flag; stating startup state explicitly is the fix
    // that works for both.
    this.sky.setHorizonDrop(OVERVIEW_HORIZON_DROP);
    this.nightSky?.setHorizonDrop(OVERVIEW_HORIZON_DROP);
    // The dome is on now and is infiniteDistance, so it covers the frame and
    // this only shows where the dome does not — which is nowhere. Kept rather
    // than nulled because it is still the right answer for the instants before
    // the first sky update lands, and it is theme-aware (see the method).
    this.sun.setBackgroundOverride(this.overviewBackdropColor());

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
    // The one place the resolved theme is published (see handleThemeChange).
    // Guarded on the value actually differing: ConfigContext re-applies the
    // attribute on a timer for an "auto" kiosk, and rebuilding every badge
    // every five minutes for a no-op write would be a real cost on a wall
    // tablet this app is otherwise careful to let idle.
    if (typeof MutationObserver !== "undefined") {
      let lastTheme = document.documentElement.getAttribute("data-theme");
      this.themeObserver = new MutationObserver(() => {
        const next = document.documentElement.getAttribute("data-theme");
        if (next === lastTheme) return;
        lastTheme = next;
        this.handleThemeChange();
      });
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
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
      this.contextLostAt = performance.now();
    });
    this.engine.onContextRestoredObservable.add(() => {
      console.warn("[SceneManager] WebGL context restored — forcing repaint");
      // How long the view was actually dead, and how long the rebuild itself
      // blocked. Restoring a context re-uploads every texture and buffer in
      // the scene on the MAIN thread, which is the leading candidate for the
      // "came back to the kiosk and it froze / the browser offered to kill the
      // page" reports — but that was inferred from a bare occurrence count,
      // never measured. These two numbers are what makes the next report
      // arguable from evidence instead of from plausibility.
      const lostAt = this.contextLostAt;
      const restoreStart = performance.now();
      reportTelemetry("context-restored", {
        deadMs: lostAt ? Math.round(restoreStart - lostAt) : undefined,
        meshes: this.scene.meshes.length,
        textures: this.scene.textures.length,
      });
      this.contextLostAt = 0;
      this.requestRender(2000);
      // Measured after the frame the repaint actually happens on, so it
      // includes Babylon's re-upload rather than just the observable call.
      this.scene.onAfterRenderObservable.addOnce(() => {
        reportTelemetry("context-restored", {
          phase: "repainted",
          blockedMs: Math.round(performance.now() - restoreStart),
        });
      });
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
    // Recovery net for the disposal above — see handlePageShow.
    window.addEventListener("pageshow", this.handlePageShow);
  }

  private handlePageHide = () => {
    // Deliberately does NOT dispose, on any platform.
    //
    // It used to tear the engine down whenever `persisted` was false, with an
    // iOS exemption added after that produced a dead canvas there. The
    // exemption was right and the rule around it was wrong: Android Chrome
    // fires pagehide with persisted=FALSE when a PWA is merely backgrounded
    // too, and then restores the SAME document on return. Disposing meant the
    // villa had to be rebuilt every time the user switched apps — reported as
    // the map reloading on every return, which is exactly what iOS had been
    // exempted from.
    //
    // Nothing is leaked by leaving it alone. A genuine navigation or tab close
    // unmounts React, which calls dispose() through the normal path, and the
    // browser reclaims the context regardless; GPU pressure while backgrounded
    // is handled by the context-lost/restored observers above, which is the
    // mechanism actually designed for it.
    //
    // The argument is kept in the signature for the listener's type, but the
    // `persisted` flag is not consulted: it cannot be trusted to mean "will be
    // restored" on either mobile platform.
  };

  /**
   * If we come back to a document we already tore down, get it working again.
   *
   * Belt-and-braces for the disposal above: `persisted` is not reliable across
   * browsers (that's the iOS bug in handlePageHide), so rather than trust it a
   * second time, this asks the only question that actually matters — "is this
   * scene dead while its canvas is still on screen?" — and forces a reload if
   * so. A reload costs a few seconds; the alternative is the permanently blank,
   * unresponsive canvas that made the app unusable on iPhone. Guarded so it can
   * only ever fire once per document, so a reload can never loop.
   */
  private handlePageShow = () => {
    if (!this.disposed || this.reloadedAfterDispose) return;
    if (!this.canvas.isConnected) return; // genuinely unmounted — React owns it
    this.reloadedAfterDispose = true;
    console.warn("[SceneManager] page restored onto a disposed scene — reloading");
    // Fire BEFORE the reload (sendBeacon survives teardown). If this ever
    // shows up in telemetry it means handlePageHide tore down a document that
    // then came back — i.e. the iOS bug recurring on some other platform.
    reportTelemetry("recovered", { reason: "pageshow-on-disposed-scene" });
    window.location.reload();
  };

  private startRenderLoop() {
    this.engine.runRenderLoop(() => {
      // A hidden document has nothing to show, and requestAnimationFrame is
      // only *usually* throttled while hidden — a backgrounded PWA window is
      // not a guarantee. Cheap, unconditional insurance that a kiosk left on a
      // side monitor for weeks never pays for frames nobody can see.
      if (document.hidden) return;
      const now = performance.now();

      // ── ONE RULE DECIDES RESOLUTION: HOW LONG SINCE THE CAMERA MOVED ──────
      // Not "which branch of the loop are we in", which is what it was until
      // 2.329.0 and is why the glyphs could sit blurred indefinitely: sharpening
      // only ever happened in the IDLE branch, and there are two ordinary states
      // in which the loop never reaches it. A single animation anywhere — one
      // fan left on, which requestAnimationRender's own docstring calls "the
      // single most common state a kiosk is in" — parks it in the animation
      // branch forever, and `renderOnDemand: false` parks it in the interactive
      // one. Both were permanently soft on the iPad, and the picture came back
      // only when the fan happened to stop, which is the "few dozen seconds"
      // that was reported. Sharpness is a property of the CAMERA, so it is
      // computed once here and every branch obeys it.
      //
      // ⚠️ MOTION IS SPENT HERE, INSIDE rAF — NEVER IN A POINTER HANDLER.
      // 2.322.0 called unsharpen() straight from the pointer observable, and it
      // changes the hardware scaling level, i.e. it resizes the drawing buffer
      // synchronously during input dispatch on the very element that has just
      // taken setPointerCapture. Reported on iPad as a badge tap doing nothing
      // followed by a one-finger drag tilting the camera — both faces of one
      // lost pointerup (see OverviewController's dropLostPointers).
      if (this.motionPending) {
        this.motionPending = false;
        this.lastMotionAt = now;
        this.unsharpen();
      }
      // The same tail requestRender() uses by default, so a plain orbit
      // sharpens at exactly the moment it always has.
      const still = now - this.lastMotionAt >= SHARPEN_STILL_MS;

      // Interaction, transitions and real state changes always render at the
      // display's own rate — responsiveness is never throttled.
      if (
        this.forceContinuous > 0 ||
        now < this.keepRenderingUntil ||
        !this.config.renderOnDemand
      ) {
        if (still) this.sharpen();
        // ── A frame drawn while the image is SHARP is a repaint ─────────────
        // The camera is still, so this frame is an HA state push, a sun tick, a
        // floor swap, a return from background. Those need the picture
        // REDRAWN, not down-rezzed — until 2.322.0 they got the full
        // interactive treatment, so every state change on a live villa dropped
        // the settled image back to motion resolution for 350ms and let it
        // re-sharpen afterwards, reported as the glyphs "updating again" a
        // second or two after the camera had already settled.
        //
        // Never sampled: the sharp frame is deliberately the expensive one and
        // feeding it to the valve would have the device ease itself down for
        // having drawn a better picture. Rate-capped for that same expense,
        // exactly as the animation branch is.
        if (this.sharpened) {
          if (now - this.lastAnimFrameAt >= ANIMATION_FRAME_MS) {
            this.lastAnimFrameAt = now;
            this.scene.render();
          }
          return;
        }
        this.sampleFrame(now);
        this.lastAnimFrameAt = now;
        // Timed, because the split between "the frame cost is inside this call"
        // and "the frame cost is somewhere else entirely" is the open question.
        const t0 = performance.now();
        this.scene.render();
        // Bounded here rather than in flushFrameSamples: sampleFrame drops the
        // first frame of a burst and any gap over FRAME_GAP_MAX_MS, so this
        // array runs slightly ahead of frameSamples and cannot rely on that
        // cap firing. Both are percentiles over the same burst either way.
        if (this.renderSamples.length < FRAME_SAMPLE_MAX) {
          this.renderSamples.push(performance.now() - t0);
        }
        return;
      }
      // The interaction burst just ended — that's the natural boundary to
      // summarise it on, and the only one an always-continuous kiosk never
      // reaches (sampleFrame flushes on its own sample cap for that case).
      this.flushFrameSamples();
      // Everything else is a frame asked for purely by a continuous animation
      // (see requestAnimationRender), and is rate-capped.
      if (now < this.animateUntil) {
        // A continuous animation is running (a fan, a pulsing alert). It obeys
        // the SAME rule: a turning fan is not a moving camera, and a villa with
        // one fan on is not a villa whose badges may be unreadable. The frame
        // costs more at native resolution — on the slowest device the capped
        // 30fps becomes nearer 10 — and that is the honest trade, because a
        // decorative animation being choppier while nobody is touching the
        // screen is worth less than every glyph on the screen being legible.
        // The instant a finger lands, motionPending un-sharpens and the
        // animation is back at full rate.
        if (still) this.sharpen();
        if (now - this.lastAnimFrameAt >= ANIMATION_FRAME_MS) {
          this.lastAnimFrameAt = now;
          this.scene.render();
        }
        return;
      }
      // Nothing is moving and nothing has asked for a frame. `sharpen` reports
      // whether it actually changed anything, so the one extra frame is drawn
      // exactly when there is a sharper picture to draw and never on the idle
      // ticks that follow.
      if (this.sharpen()) this.scene.render();
    });
  }

  /**
   * Measure how long INTERACTIVE frames actually take, and report a summary.
   *
   * ── Why this exists (2.221.0) ────────────────────────────────────────────
   * "Safari on the MacBook is very laggy, I can barely orbit or walk" was
   * unanswerable from the telemetry, because nothing in this app has ever
   * measured a frame. The load record covers getting TO the first frame and
   * stops there; `freeze` covers a main thread blocked long enough to notice
   * as a hang. A steady low frame rate is neither — it is every frame costing
   * 40ms instead of 8 — and it was invisible.
   *
   * That gap is worst exactly where it hurts. The long-task observer behind
   * `freeze` is Chromium-only; Safari falls back to a timer watchdog
   * (bootTimeline.installFreezeWatchdog) which detects blocks but not slow
   * frames. Safari duly reported no freezes at all in the field dump — which
   * is not "Safari is fine", it is "Safari is slow in the one way we cannot
   * see". Guessing a cause from there is the failure mode this codebase has
   * already paid for repeatedly, so: measure first.
   *
   * Only INTERACTIVE frames are sampled — the branch above that renders at
   * the display's rate. Animation-only frames are deliberately rate-capped to
   * ANIMATION_FRAME_MS, so including them would report the cap as if it were
   * a performance ceiling. A gap longer than FRAME_GAP_MAX_MS is the loop
   * resuming after idle rather than one slow frame, and is dropped.
   *
   * The record carries what a frame's cost is a function of — active meshes,
   * active indices, backbuffer size, hardware scaling, and whether the two
   * optional render passes are on — so the next question can be answered from
   * the data instead of from another hypothesis.
   *
   * ── What renderMs / drawCalls / evalMs are for, and what they answered ───
   * Three numbers, each falsifying a different family of cause. All three have
   * reported, and between them plus the ablation probe (babylon/perfProbe.ts)
   * the question is CLOSED — do not re-derive any of this from scratch:
   *
   *   evalMs is ~2ms on every engine        -> culling is not the cost
   *   drawCalls/activeMeshes has been 1.00
   *     since 2.265.0                       -> multi-pass lighting is not it
   *   identical triangle counts either side  -> geometry is not the gap
   *   an EMPTY scene costs the iPad 67ms at
   *     3.4Mpx and 19ms at a quarter of that,
   *     while both Chrome engines pay the
   *     same at either                       -> on WebKit it is PIXELS, and
   *                                             almost nothing else
   *
   * Two readings that look like answers and are not. "us per draw call" is
   * renderMs/drawCalls — an average that divides a large fixed cost by the
   * draw count, so it falls as draws rise whether or not draws cost anything;
   * it is what made "the only lever is fewer draw calls" look true for a
   * release. And merging meshes to reduce draws would save nothing here
   * anyway: the villa's 204 mergeable meshes carry 204 distinct materials.
   *
   * Keep these three fields. They are how any future change gets checked, and
   * they are what calibrateResolution's decision is visible in.
   */
  private sampleFrame(now: number): void {
    const prev = this.lastFrameAt;
    this.lastFrameAt = now;
    if (prev === 0) return;
    const dt = now - prev;
    if (dt > FRAME_GAP_MAX_MS) return;
    this.frameSamples.push(dt);
    if (this.frameSamples.length >= FRAME_SAMPLE_MAX) this.flushFrameSamples();
  }

  private flushFrameSamples(): void {
    const s = this.frameSamples;
    if (s.length === 0) {
      // Stops the two arrays drifting apart in the case sampleFrame kept none
      // of the burst's gaps. The length check keeps the idle path (this runs on
      // every non-interactive tick) down to a comparison.
      if (this.renderSamples.length > 0) this.renderSamples = [];
      return;
    }
    this.frameSamples = [];
    const r = this.renderSamples;
    this.renderSamples = [];
    // Not enough of a burst to say anything (a tap, a one-frame nudge). Reset
    // the clock too, so the next burst never measures across the gap.
    this.lastFrameAt = 0;

    s.sort((a, b) => a - b);
    const at = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))];

    // ── THE RESOLUTION VALVE RUNS FIRST, AND ON ITS OWN TERMS ──────────────
    // It used to sit below the telemetry gate, which meant a *reporting* rule
    // decided whether the device was allowed to protect its own frame rate:
    // FRAME_REPORT_MAX caps the dump at 8 records per session, so after eight
    // bursts the valve stopped working for the rest of the session, and the
    // 45-frame minimum meant a device running at 13fps had to be dragged
    // CONTINUOUSLY for three and a half seconds before it could react at all.
    //
    // The iPad is the case that exposed it: not one `frames` record in any
    // field dump, so the valve had never opened on it — and the frame-cost
    // probe then measured that same iPad at 76ms a frame, of which 67ms was an
    // EMPTY scene at 3.4 megapixels. On WebKit that floor is per-pixel (a
    // quarter of the pixels took it 67ms -> 19ms), so resolution is exactly
    // the lever, and the thing holding it shut was a telemetry counter.
    //
    // Its own minimum is lower because it is answering an easier question than
    // the telemetry is: "is this device comfortably missing frame budget",
    // not "characterise this burst". Still monotonic, still floored at 1x CSS.
    if (s.length >= VALVE_SAMPLE_MIN) {
      // Down first, then up. Their guards are mutually exclusive (one needs a
      // slow p50, the other a fast one), so the order is documentation rather
      // than logic — but stating it means a future edit to either guard cannot
      // quietly make both fire on one sample.
      this.easeResolution(at(0.5));
      // ⚠️ The UPWARD step reads RENDER time, not the frame gap. `at(0.5)` is
      // the median gap BETWEEN frames, and on any device holding vsync that is
      // the refresh period and nothing else: this phone reports p50 16.7ms at
      // 60Hz and 8.4ms at 120Hz while its render cost is 4-9ms either way. A
      // gate fed that number would refuse to sharpen an idle GPU because its
      // display happened to be running at 60Hz, and would read a 120Hz panel
      // as twice as capable as the same silicon behind a 60Hz one.
      // `renderSamples` is the work actually done per frame, which is the only
      // thing that scales with pixel count.
      if (r.length >= VALVE_SAMPLE_MIN) {
        // Sorted in place: the telemetry block below sorts it again anyway, so
        // this costs a nearly-sorted re-sort and no allocation.
        r.sort((a, b) => a - b);
        this.raiseResolution(r[Math.floor(r.length * 0.5)]);
      }
    }

    if (s.length < FRAME_SAMPLE_MIN || this.frameReportsSent >= FRAME_REPORT_MAX) return;
    this.frameReportsSent += 1;

    const ms = (x: number) => Math.round(x * 10) / 10;
    r.sort((a, b) => a - b);
    const render = this.deviceRenderConfig(this.config.render);
    reportTelemetry("frames", {
      n: s.length,
      p50: ms(at(0.5)),
      p95: ms(at(0.95)),
      worst: ms(s[s.length - 1]),
      // The headline number, so a dump can be read without doing the division.
      fps: Math.round(1000 / at(0.5)),
      // How much of p50 is spent INSIDE scene.render(). Near p50 means the
      // frame is our own synchronous work (or the driver blocking us on a
      // backed-up GPU); far below p50 means the time is somewhere else
      // entirely — rAF scheduling, compositing, another main-thread task.
      renderMs: r.length > 0 ? ms(r[Math.floor(r.length * 0.5)]) : undefined,
      // Submissions for the last rendered frame. 108 lights against
      // MAX_SIMULTANEOUS_LIGHTS means a mesh lit by more than 8 costs several
      // passes, so this can be many times the active mesh count — and if it
      // is, that is the cost, not the pixels.
      drawCalls: this.instrumentation?.drawCallsCounter.current,
      // Frustum culling and render-list building, which walks ALL meshes (874)
      // rather than the active ones (as few as 48). Fixed per-frame CPU cost
      // that does not scale with what is on screen is exactly its signature.
      evalMs: this.instrumentation
        ? ms(this.instrumentation.activeMeshesEvaluationTimeCounter.current)
        : undefined,
      mode: this.viewMode,
      activeMeshes: this.scene.getActiveMeshes().length,
      activeKTris: Math.round(this.scene.getActiveIndices() / 3000),
      meshes: this.scene.meshes.length,
      materials: this.scene.materials.length,
      rw: this.engine.getRenderWidth(),
      rh: this.engine.getRenderHeight(),
      hw: Math.round(this.engine.getHardwareScalingLevel() * 100) / 100,
      // The OTHER per-pixel cost besides fill. Every material runs up to
      // MAX_SIMULTANEOUS_LIGHTS (8) lights per fragment, and which lights are
      // in range is a function of where the camera stands — so this varies
      // exactly the way the measured frame time does, and mesh count does not.
      lights: this.scene.lights.length,
      litOn: this.scene.lights.reduce((n, l) => n + (l.isEnabled() ? 1 : 0), 0),
      // Same string the load record carries, so a frames record read on its
      // own still says which renderer produced it — the whole point here is
      // comparing Safari's "Apple GPU" against Chrome's ANGLE/Metal path.
      gpu: String(this.engine.getGlInfo()?.renderer ?? "").slice(0, 96),
      ibl: render.ibl,
      ssao: render.ssao && !this.renderFx.isBaked(),
    });
  }

  /**
   * Give back supersampling when the measured frame rate cannot afford it.
   *
   * ── The measurement this exists because of (2.222.0) ──────────────────────
   * Safari on a MacBook reported 7-19 fps in first person (p50 54-136ms). The
   * frames records ruled out geometry outright: the FASTEST burst had the MOST
   * on screen (428 meshes / 1.9M triangles at 54ms) and the slowest had half
   * that (209 / 1.2M at 136ms). Cost that does not track object count is
   * per-PIXEL, and the two per-pixel costs here are fill — 2880x1476, i.e.
   * 4.25 megapixels of 2x supersampling with MSAA — and up to
   * MAX_SIMULTANEOUS_LIGHTS lights per fragment.
   *
   * This addresses the first and DISCRIMINATES them. Frame cost is linear in
   * pixels and pixels go as 1/scale², so the scale that would hit the target
   * is a closed form — one step, not a slow crawl. If the next frames records
   * show hw at 1.0 with fps up roughly 4x, it was fill. If fps barely moves,
   * fill is eliminated and the lights are the remaining candidate (`lights`
   * and `litOn` are in the record for exactly that reading).
   *
   * Deliberate limits:
   * - **Never below 1x CSS.** The old iOS tier rendered under CSS resolution
   *   and its single-sample minification of tile textures showed as rainbow
   *   speckle around lit floors — reported, and removed. 1.0 is the floor.
   * - **Monotonic.** Scaling only ever gets coarser, never finer again. A
   *   controller that could go both ways would hunt around the threshold and
   *   the resolution would visibly pulse; giving up supersampling once, on a
   *   device that has demonstrated it cannot pay for it, does not.
   * - **Only on a device that measured slow.** A machine holding 60fps never
   *   reaches this and keeps the full 2x. Nothing to configure: the setting
   *   the user asked for ("as nice as possible by default") is still the
   *   default, and 7fps is not "nice" by any reading of it.
   */
  /**
   * The one chance a device gets to render at its panel's real resolution.
   *
   * The engine starts at HW_START_CAP (2x CSS), which is native on a DPR-2
   * screen and two thirds of native on a DPR-3 one. Every modern phone is
   * DPR 3, so the default ships a 1.5x upscale to every one of them.
   *
   * ── Why this is safe to attempt, and why it is measured rather than
   *    detected ────────────────────────────────────────────────────────────
   * Resolution is free on ANGLE and IS the frame cost on WebKit: measured with
   * an empty scene and one draw call, Android Chrome paid 2.8ms at full
   * resolution and 2.8ms at a quarter of it, while the iPad paid 67ms and
   * 19ms. Sniffing which of those a device is would be a heuristic, and this
   * file has no business owning one.
   *
   * So the gate is a WORST-CASE PREDICTION instead: assume the frame is
   * entirely per-pixel — the WebKit case — and require that the measured
   * RENDER time, multiplied by the exact pixel-count increase the change would
   * cause, still lands inside FRAME_TARGET_MS. A device where resolution is
   * actually free clears that easily and gets sharpened; one where it is not
   * cannot clear it even in principle. No device string is read.
   *
   * Against the four devices in the field dump, at their measured render times
   * and a DPR-3 phone's 2.25x pixel increase:
   *
   *   Android Chrome  ~7ms  -> 15.8  UPGRADES   (ANGLE: resolution is free)
   *   iPhone Safari  ~11.5ms -> 25.9  refused
   *   iPad (HA app)    ~28ms -> 63    refused
   *   Mac (DPR 1.6/2)               never reaches the test — already native
   *
   * ── And why it cannot hunt ───────────────────────────────────────────────
   * easeResolution is deliberately monotonic ("never finer again") because a
   * two-way controller oscillates around its threshold and the resolution
   * visibly pulses. This is not a controller: it is ONE step, taken at most
   * once per session, guarded by a flag. Afterwards the ordinary downward
   * valve keeps sampling and can back the device off again if the prediction
   * was wrong — so a bad guess costs a few seconds, not the session, and the
   * monotonic invariant holds from that point on exactly as before.
   */
  private resolutionRaised = false;
  private raiseResolution(p50: number): void {
    if (this.resolutionRaised) return;
    // Never decide from the sharp idle frame's scaling — that is a temporary
    // override, not this device's measured operating point.
    if (this.sharpened) return;
    const cur = this.engine.getHardwareScalingLevel();
    const native = 1 / Math.max(1, window.devicePixelRatio || 1);
    // Already at (or finer than) the panel — nothing to win. This is every
    // DPR<=2 device, so they never reach the prediction below at all.
    if (cur <= native + 1e-6) return;
    // Pixel count scales with the SQUARE of the linear scaling change.
    const costRatio = (cur / native) ** 2;
    if (p50 * costRatio > FRAME_TARGET_MS) return;
    this.resolutionRaised = true;
    this.engine.setHardwareScalingLevel(native);
    // Same obligation easeResolution has: badge geometry is authored in CSS px
    // and converted through this exact value, so the layer has to be told or
    // every badge keeps the size it had for a resolution that no longer
    // exists — and its collision boxes keep measuring it at that size too.
    this.visuals.notifyRenderScaleChanged();
    this.requestRender();
  }

  private easeResolution(p50: number): void {
    if (p50 <= FRAME_SLOW_MS) return;
    if (this.sharpened) return;   // see raiseResolution
    const cur = this.engine.getHardwareScalingLevel();
    if (cur >= HW_SCALE_FLOOR) return;
    const next = Math.min(HW_SCALE_FLOOR, cur * Math.sqrt(p50 / FRAME_TARGET_MS));
    if (next <= cur) return;
    this.engine.setHardwareScalingLevel(next);
    // Badge geometry is authored in CSS px and converted through this exact
    // value (EntityVisuals.cssToGui), so changing it here silently resizes
    // every badge. Tell the layer, or badges keep the size they had for a
    // resolution the engine has stopped rendering at — and the collision
    // boxes keep measuring them at it too.
    this.visuals.notifyRenderScaleChanged();
    this.requestRender();
  }

  /**
   * Measure this device once, just after the villa becomes visible, and let the
   * resolution valve act on the result.
   *
   * ── Why this exists, and why it is not a setting ────────────────────────
   * Render resolution is the entire frame cost on WebKit and free on ANGLE.
   * Measured on four devices with an empty scene and one draw call: the iPad
   * pays 67ms at 3.4 megapixels and 19ms at a quarter of that, Mac Safari 21ms
   * and 10ms — while Mac Chrome and Android Chrome pay the same whatever the
   * resolution. Dropping the iPad to CSS resolution took a frame from 77ms to
   * 27ms, 13fps to 37fps.
   *
   * That is a big enough difference to be worth acting on and far too
   * device-specific to hardcode. A blanket "WebKit renders at CSS resolution"
   * rule would be wrong for the iPhone, which measured 10-14ms and does not
   * need the help — it would just make its picture softer for nothing.
   *
   * easeResolution already decides this correctly, from measured frame time,
   * per device. Its only problem was never getting to run: it feeds on frame
   * samples, and those only exist during a burst of continuous interaction. A
   * wall-mounted kiosk that nobody touches never produces one, which is why no
   * field dump has ever contained a `frames` record from the iPad and why that
   * iPad sat at 13fps indefinitely.
   *
   * So: produce one burst deliberately. Pinning continuous rendering for a
   * couple of seconds is all it takes — sampleFrame collects, the unpin ends
   * the burst, flushFrameSamples runs the valve. No new mechanism, no user
   * decision, and a device that is comfortably fast is left alone because the
   * valve's own threshold says so.
   *
   * AFTER the reveal, deliberately: the villa is already on screen, so this
   * costs a couple of seconds of rendering nobody is waiting on.
   *
   * ── IT WAITS FOR SAMPLES, NOT FOR A CLOCK ────────────────────────────────
   * The first version pinned for a flat two seconds and did nothing at all.
   * The reason is in the load record next to it: `paintMs` is 8.6 SECONDS on
   * the iPad — the frames immediately after the reveal are compiling shaders
   * for 855 materials, and their gaps run to whole seconds. sampleFrame drops
   * anything over FRAME_GAP_MAX_MS as a resume rather than a slow frame, and
   * rightly so. So a two-second window opened and closed entirely inside the
   * compile storm, collected almost nothing it was allowed to keep, never
   * reached VALVE_SAMPLE_MIN, and the valve never ran.
   *
   * Waiting on the sample count instead makes the compile storm irrelevant:
   * frames that get dropped simply do not count toward the total, so this ends
   * when the valve actually has what it needs. The timeout is a backstop for a
   * device that never produces steady frames at all, not the mechanism.
   */
  calibrateResolution(maxWaitMs = 20_000): void {
    if (this.disposed) return;
    const unpin = this.pinContinuous();
    const started = performance.now();
    const finish = () => {
      unpin();
      // Flush EXPLICITLY rather than waiting for the render loop to notice the
      // burst ended. With `renderOnDemand` off the loop never takes the branch
      // that flushes, so the samples would sit in the array until they hit
      // FRAME_SAMPLE_MAX — a minute away on a slow device, and never at all if
      // the villa is torn down first.
      this.flushFrameSamples();
      this.requestRender();
    };
    const check = () => {
      if (this.disposed) { unpin(); return; }
      if (this.frameSamples.length >= VALVE_SAMPLE_MIN) { finish(); return; }
      if (performance.now() - started > maxWaitMs) { finish(); return; }
      setTimeout(check, 250);
    };
    setTimeout(check, 250);
  }

  /**
   * Draw the settled image once at the device's NATIVE resolution.
   *
   * ── Why this is worth a frame ────────────────────────────────────────────
   * The resolution valve holds a slow device below its panel's real pixel
   * density because it cannot shade that many fragments at an interactive
   * rate — measured, and true: the iPad renders 1180px wide on a 2360px panel
   * and still only manages 22fps, and Safari on the MacBook is 4-8x Chrome's
   * render cost on identical hardware. That is the right call WHILE THE CAMERA
   * IS MOVING, and it is the wrong one the instant it stops, which is when
   * someone is actually reading a badge. Reported as the entity glyphs looking
   * low-resolution on iPad, correctly, and chased through the bake twice
   * before the canvas turned out to be the thing that was short of pixels.
   *
   * This scene renders ON DEMAND, so "nothing is moving" is not a guess — it
   * is the branch the loop already takes when the interaction burst has ended
   * and no animation is pending. One expensive frame lands there, with nothing
   * animating to judge it against, and every frame after it is free because
   * nothing asks for one.
   *
   * ⚠️ NOT SAMPLED, and it must never be. The sharp frame is deliberately
   * more expensive than an interactive one; feeding it to the valve would have
   * the device conclude it is slow and ease itself down — a loop where making
   * the picture better makes the picture worse. It is drawn from the idle
   * branch, which does not sample, and `unsharpen` runs before the interactive
   * branch measures anything.
   *
   * Cheap to leave and cheap to undo: since 2.321.0 the badge bake targets the
   * best-case resolution, so both directions cost a container re-scale and no
   * re-bake.
   */
  private sharpMotionHw = 0;
  private sharpened = false;
  /** Set by the motion entry points, spent by the render loop — see unsharpen. */
  private motionPending = false;
  /** When the camera last moved. THE input to the sharpness rule. */
  private lastMotionAt = 0;
  /**
   * Raise to the panel's own resolution. Draws NOTHING — every caller is about
   * to render anyway, and the idle branch renders on the `true` return.
   *
   * ⚠️ `sharpened` means "we are currently OVERRIDING the scaling", and only
   * that. Until 2.329.0 it latched even when the device was already at native
   * and there was nothing to override, which quietly disabled the whole
   * resolution valve on every DPR<=2 machine: `easeResolution` and
   * `raiseResolution` both bail while sharpened, so a flag set on the first
   * idle tick and never cleared meant the valve could not act for the rest of
   * the session. Latching only on a real change keeps the flag honest and costs
   * two float comparisons per idle tick.
   */
  private sharpen(): boolean {
    if (this.sharpened) return false;
    const cur = this.engine.getHardwareScalingLevel();
    const native = 1 / Math.max(1, window.devicePixelRatio || 1);
    if (cur <= native + 1e-6) return false;
    this.sharpMotionHw = cur;
    this.sharpened = true;
    this.engine.setHardwareScalingLevel(native);
    // Quiet: the caller's render IS the redraw, and asking for another would
    // re-arm the interactive branch for no reason.
    this.visuals.notifyRenderScaleChanged(false);
    return true;
  }

  /**
   * Put the motion resolution back. Idempotent; safe to call every frame — the
   * flag check is the whole cost when there is nothing to undo.
   *
   * ⚠️ ONE CALLER, AT THE TOP OF THE RENDER LOOP, AND THAT IS THE DESIGN.
   * Since 2.329.0 the only thing that un-sharpens is the camera moving, so
   * this is called in exactly one place — where `motionPending` is spent —
   * and never again. Two independent reasons it must stay there:
   *
   *   * `sharpened` means "the scaling is currently overridden", and the
   *     interactive branch reads it to tell a repaint from motion. Widen the
   *     caller list and every HA state push starts dropping the settled
   *     picture back to motion resolution (2.322.0's fix), and
   *   * this RESIZES THE DRAWING BUFFER, so calling it from an event handler
   *     mutates the canvas during input dispatch (2.322.0's regression).
   *
   * Motion signals intent by setting `motionPending`; the loop spends it.
   */
  private unsharpen(): void {
    if (!this.sharpened) return;
    this.sharpened = false;
    if (this.sharpMotionHw <= 0) return;
    const back = this.sharpMotionHw;
    this.sharpMotionHw = 0;
    if (this.engine.getHardwareScalingLevel() === back) return;
    this.engine.setHardwareScalingLevel(back);
    // Quiet for the same reason: both callers run immediately before a render.
    this.visuals.notifyRenderScaleChanged(false);
  }

  /** Keep rendering for a short window (covers input latency + transitions). */
  requestRender(durationMs = 350): void {
    this.keepRenderingUntil = Math.max(this.keepRenderingUntil, performance.now() + durationMs);
  }

  /**
   * Re-arm the loop for a continuous ANIMATION rather than for interaction.
   *
   * A spinning fan and a pulsing alert re-arm the render loop on every frame
   * they run (they run FROM a rendered frame, so they cannot re-arm any other
   * way), which is why a villa with one fan left on renders continuously for
   * as long as it is on — the single most common state a kiosk is in. 2.113.0
   * already stopped that from recomputing the badge layout every frame; this
   * caps what remains, the frames themselves.
   *
   * Kept separate from requestRender() precisely so the cap can never reach a
   * frame the user is waiting on.
   *
   * ⚠️ Anything animating across these frames MUST measure its own elapsed
   * time (`performance.now()` between steps) and must NOT use
   * `engine.getDeltaTime()`. Babylon sets that in `beginFrame()`, which its
   * render loop calls on every requestAnimationFrame tick *before* the loop
   * body decides whether to render — so it reports tick-to-tick, not
   * render-to-render. 2.124.0 shipped this cap while every animation still
   * trusted it, and each was told 16.7ms had passed when 33ms really had:
   * fans ran at half speed while idle and snapped back to full speed during
   * interaction, reported as the blades surging. See EntityVisuals'
   * registerBeforeRender and RoomHighlight.animate.
   */
  requestAnimationRender(durationMs = 350): void {
    this.animateUntil = Math.max(this.animateUntil, performance.now() + durationMs);
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
   * theme selected but the canvas stays pitch black" report).
   *
   * Read from the RESOLVED theme on <html>, not from `config.theme`. Those are
   * different questions: config.theme can be "auto", and ConfigContext resolves
   * that against the real sun position (utils/themeTime) into light/dark/NIGHT.
   * Re-deriving it here from `prefers-color-scheme` gave a second, disagreeing
   * answer that has no idea night exists — so an auto kiosk at dusk could sit
   * on the night palette everywhere except this backdrop.
   */
  private overviewBackdropColor(): Color4 {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    return isLight
      ? new Color4(0.90, 0.93, 0.97, 1) // matches --bg-base light
      : new Color4(0.055, 0.062, 0.078, 1); // matches --bg-base dark
  }

  /**
   * The theme actually changed on screen. ONE signal for all three ways that
   * can happen — Settings, an "auto" kiosk crossing into night at dusk, and
   * the OS light/dark switch — because all three end at the same place:
   * ConfigContext writing `data-theme` on <html>. Watching the attribute
   * therefore catches every path by construction, where watching
   * `config.theme` catches only the first (it never changes for the other two,
   * which is exactly why they were broken).
   *
   * Badges have to be REBUILT, not just re-tinted: a classic badge's fill,
   * ring and glyph are baked into a PNG (badgeIcons), and while that cache is
   * keyed by theme — so a fresh bake is correct — nothing was asking for one.
   * Each badge kept its old-theme image until its entity's state happened to
   * change, which is why a camera (state changes constantly) re-themed itself
   * and a fan sitting at "off" did not: reported as light-theme badges
   * scattered across a dark-theme map.
   */
  private handleThemeChange = () => {
    // Nothing to do for the backdrop any more: overview shows the real sky
    // (see setViewMode), which is driven by the SUN rather than by the UI
    // theme. Re-pinning the themed colour here would silently undo that the
    // first time an auto kiosk crossed into night.
    this.visuals.repaintBadges();
  };

  /**
   * The world point the villa's own geometry shows at these client coords, or
   * null if the ray leaves the model entirely (the sky, the sea beyond the
   * plot). Markers are excluded — a badge floating between the camera and the
   * floor is not the place the user pointed at, it is the thing they pointed
   * THROUGH, and double-tap zoom only reaches this function once it has
   * established nothing interactive was hit anyway.
   */
  private groundPointAt(clientX: number, clientY: number): Vector3 | null {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    const rect = canvas?.getBoundingClientRect();
    const pick = this.scene.pick(
      clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0),
      (m) => m.isPickable && m.isVisible && !m.metadata?.isMarker,
    );
    return pick?.hit && pick.pickedPoint ? pick.pickedPoint : null;
  }

  /**
   * Swap between first-person walking and the bird's-eye overview camera. Only
   * one controller owns canvas pointer input at a time (no capture race), and
   * picking always follows scene.activeCamera so tapping entities works in both.
   */
  setViewMode(mode: "first-person" | "overview"): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    // Both of these are pure view-mode questions and are answered here, once,
    // for both directions: the ceiling is a lid the overview must not have and
    // the walker must, and badge wall-occlusion only makes sense from inside
    // the villa (see EntityVisuals.setFirstPerson).
    this.applyCeilingVisibility();
    this.visuals.setFirstPerson(mode === "first-person");
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
      // The real sky, in overview too (2.223.0). This used to hide the dome and
      // pin a flat themed backdrop, on the reasoning that a bird's-eye plan
      // reads best on something calm and that daytime sky blue "crashes the
      // eyes". What that traded away only became obvious once the sky earned
      // its keep: at dawn and dusk the dome is a graded sunrise/sunset, and
      // cutting to flat black or flat grey at the exact moment the villa looks
      // its best is a worse trade than the glare it was avoiding.
      //
      // Free to do because the dome is `infiniteDistance` (SkyDome) — it is
      // re-centred on whichever camera is active every frame, so it wraps the
      // pulled-back overview camera with no resizing and no extra cost. Passing
      // null hands clearColor back to the day/night value, which now only shows
      // where the dome does not cover.
      //
      // If the glare complaint returns, this is the revert: re-disable the dome
      // and re-pin overviewBackdropColor() here (the loading path still uses it,
      // deliberately — a neutral wait screen is a different question).
      this.sky.setEnabled(true);
      this.sun.setBackgroundOverride(null);
      // Overview looks DOWN at the villa, so the horizon — which sits at the
      // camera's own eye level — leaves the frame as soon as the tilt steepens,
      // and everything below it clamps to one flat slab of colour. Dropping the
      // horizon keeps the graded band and the sun in shot at the tilt people
      // actually use, instead of only at the near-horizontal one that had to be
      // dialled in deliberately. See SkyDome.setHorizonDrop for why this is the
      // only lever that exists (moving or scaling the dome provably cannot).
      this.sky.setHorizonDrop(OVERVIEW_HORIZON_DROP);
      // The moon rides the same drop as the sun and the gradient — one number,
      // three bodies, so they cannot end up in skies tilted differently.
      this.nightSky?.setHorizonDrop(OVERVIEW_HORIZON_DROP);
    } else {
      this.overview.disable();
      this.scene.activeCamera = this.camera.camera;
      this.camera.attachInput();
      // The eye is about to be placed somewhere the floor follower has never
      // stood; any anchor it holds is from a previous visit to this camera.
      this.camera.invalidateFloorProbe();
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
      // No horizon drop when walking: standing in the villa, the horizon
      // belongs at eye level, which is what 0 means. Applying the overview's
      // drop here would put the sea's edge below the terrace floor.
      this.sky.setHorizonDrop(0);
      this.nightSky?.setHorizonDrop(0);
      this.visuals.setIconZoomFit(0); // 0 = no zoom shrink: fixed size when walking
    }
    this.requestRender(600);
  }

  /**
   * The entity under this screen point, or null — for the hover tooltip.
   *
   * Reuses the SAME hit-tests a TAP goes through, in the same order, because
   * the promise this method makes is that what a pointer names and what a tap
   * opens can never be two different devices.
   *
   * ── WHY THE GROUP CARD IS ASKED FIRST (2.293.0) ─────────────────────────
   * It used to ask `pickBadgeAt` alone, which knows individual badges and
   * nothing about a summary's cells — so hovering a card named nothing at all.
   * That was survivable while a summary drew a count, and stopped being so the
   * moment it started drawing its members' pictograms: a card of two lights is
   * two identical icons, and identical icons with no name are not two devices,
   * they are one device drawn twice. The tap path has resolved a cell to its
   * own device since the card gained cells; only the pointer was left guessing.
   *
   * Order mirrors `handleTap` exactly — the card's cell first, then the
   * badges — including the fallback: a point on the card but in NO cell (a
   * count, the empty corner of a three-member grid, the gap between two cards
   * of a split) asks the badges, because a card can be drawn over a badge from
   * another pile entirely and a pointer over something visible belongs to that
   * thing.
   *
   * Room chips are deliberately NOT asked. A chip already prints its own room
   * name and stands for a whole room rather than a device, so there is no
   * label a tooltip could add that the chip is not already showing.
   */
  hoverBadgeAt(clientX: number, clientY: number): string | null {
    const eGroup = this.visuals.pickEntityGroupAt(clientX, clientY);
    if (eGroup?.entityId) return eGroup.entityId;
    return this.visuals.pickBadgeAt(clientX, clientY);
  }

  getViewMode(): "first-person" | "overview" {
    return this.viewMode;
  }

  /** The default first-person landing pose. Always on the GROUND FLOOR: the foot
   *  of the staircase if we can locate it, else a ground-floor living/entry room,
   *  else the first ground-floor room, else the origin. Never a 2F room.
   *
   *  NOT precomputed at load any more (removed 2.112.0's `ensureFirstPersonSpawn`,
   *  which teleported the inactive walker camera to this pose right after the
   *  reveal, costing 16+ `pickWithRay` probes — 700-790ms typical, up to 5.9s
   *  field-observed — on every single load, for every user, whether or not
   *  first-person is ever used). `setViewMode("first-person")` below already
   *  computes this fresh on every actual switch and never reused the
   *  precomputed value, so the eager pass was pure waste — worse, its
   *  raycasts ran from a callback registered on the same `onAfterRenderObservable`
   *  notification as the load-telemetry timestamp, ahead of it in registration
   *  order, so they very likely inflated the `paintMs` figure reported for
   *  years of load telemetry. */
  private firstPersonSpawn(): TeleportPoint {
    const eye = this.config.eyeHeight ?? 1.7;
    const ground = (p: TeleportPoint) => p.floor === 1;
    // ⚠️ EVERY CANDIDATE IS VALIDATED, AND THE CHAIN FALLS THROUGH ON FAILURE
    // (2.459.0). The staircase spawn has now put the walker somewhere unstandable
    // twice — mid-flight, then in the crawlspace under the steps — and both times
    // it was the ONLY candidate consulted, because the chain took the first
    // non-null answer rather than the first WORKABLE one. A spawn that cannot be
    // stood in is not an answer, so it no longer counts as one.
    const ok = (p: TeleportPoint): boolean =>
      this.standable(p.position.x, p.position.z, p.floor);
    const named = this.calibratedPoints?.find(
      (p) => ground(p) && /main|living|salon|séjour|sejour|hall|entr/i.test(p.name));
    const stairs = this.staircaseSpawn();
    // ⚠️ THE STAIRCASE IS LAST NOW, AND THAT IS THE OWNER'S CALL (2.460.0).
    // It was first for years, on the reasoning that a stairwell is a legible
    // place to arrive. Four consecutive releases could not make it produce a
    // spot a person can stand in — mid-flight, then the crawlspace beneath,
    // then between the open risers — because a staircase is, definitionally,
    // the one part of a villa that is neither one storey nor the next. The
    // owner has asked three times to arrive on the ground floor.
    //
    // A ROOM's centroid is open floor by construction, which is the property
    // that was being approximated the hard way. `standable` still validates
    // whichever wins, so this is a change of preference, not of guarantee.
    const candidates: Array<[string, TeleportPoint | null | undefined]> = [
      ["namedRoom", named],
      ["groundRoom", this.calibratedPoints?.find(ground)],
      ["stairFoot", stairs],
      ["anyPoint", this.calibratedPoints?.[0]],
    ];
    for (const [why, p] of candidates) {
      if (!p) continue;
      if (!ok(p)) {
        tapDebug(`spawn: REJECTED ${why} "${p.name}" — ${this.lastStandableWhy || "not standable"}`);
        continue;
      }
      // Place the eye on the surface `standable` actually validated. The point's
      // own `position.y` was built from `estimateFloorY`, which on a split level
      // reports the slab UNDER a raised room — spawning from it drops the walker
      // through the floor that was just approved.
      const eyeY = this.lastStandY + eye;
      const probed = this.estimateFloorY(p.position.x, p.position.z, p.floor);
      tapDebug(
        `spawn: ${why} "${p.name}" floor=${p.floor}`
        + ` at=${p.position.x.toFixed(1)},${p.position.z.toFixed(1)}`
        + ` floorY=${probed.toFixed(2)} standY=${this.lastStandY.toFixed(2)}`,
      );
      return { ...p, position: { ...p.position, y: eyeY } };
    }
    // Nothing validated. Say so — silently falling back to the origin is how a
    // spawn bug reads as "the villa loaded somewhere strange".
    const fallback = this.calibratedPoints?.find(ground) ?? this.calibratedPoints?.[0];
    tapDebug(`spawn: NO standable candidate — using ${fallback ? `"${fallback.name}"` : "origin"}`);
    return fallback ?? {
      name: "Start", floor: 1, position: { x: 0, y: eye, z: 0 }, target: { x: 0, y: 1.6, z: 2 },
    };
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
   * Can a PERSON STAND HERE? Floor at the storey's own level, and headroom above
   * it.
   *
   * ⚠️ HEADROOM IS THE HALF THAT WAS MISSING, AND IT IS WHY 2.458.0'S SPAWN FIX
   * MADE THINGS WORSE (2.459.0). "On the ground floor" was tested as a floor
   * height alone — and the floor UNDER A STAIRCASE is at ground level, so the
   * search happily returned the crawlspace beneath the stairs. The walker
   * spawned inside the stair structure, with its collision capsule jammed under
   * the treads: reported as landing "across the wall asset" and walking being
   * "very buggy, like something was blocking the path", with a screenshot
   * looking at the underside of the steps.
   *
   * ⚠️ The headroom ray must test STRUCTURE, not collidables. Stairs are
   * deliberately `checkCollisions = false` (a collidable staircase is how you
   * get wedged mid-flight — see CameraController's ellipsoid note), so a
   * collision-based test is blind to exactly the obstruction that caused this.
   * Structure geometry contains the baked stairs, which is what floorProbe uses
   * and for the same reason.
   */
  private standable(x: number, z: number, floor: 1 | 2): boolean {
    const floorY = this.estimateFloorY(x, z, floor);
    // ⚠️ NO GLOBAL "IS THIS THE LOWEST FLOOR IN THE VILLA" TEST HERE (2.463.0).
    // It was here, and it rejected the Living Room and Bedroom 1 outright, which
    // sent the spawn back to the staircase this whole exercise exists to leave:
    //
    //   spawn: REJECTED namedRoom "Living Room" — not standable
    //   spawn: REJECTED groundRoom "Bedroom 1" — not standable
    //   spawn: stairFoot "Staircase" ...
    //
    // This villa has THREE distinct room floor heights (see roomStorey.ts, where
    // the same fact blanked the walk-in room banner), so "within 30 cm of the
    // LOWEST floor in the model" is false for most of a split-level ground
    // storey. The test was never about the villa's lowest floor anyway — it was
    // about not landing on a stair tread, and the stairwell polygon test below
    // answers that directly and exactly. `stairFoot` keeps the ground-level
    // requirement, because THERE it means "come down off the stairs", which is
    // a different question from "can a person stand here".
    //
    // ⚠️ NEVER INSIDE A STAIRWELL, and this is the test that actually holds
    // (2.460.0). The headroom ray below was defeated by the geometry it exists
    // to detect: this villa's staircase is OPEN-RISER, so a single vertical ray
    // between two treads reaches the sky and reports 1.85 m of clear headroom
    // while a person standing there is inside the stairs. The plan already
    // knows where the staircase is — asking it is exact, free, and cannot be
    // threaded. `onGround` in stairFoot excludes stair rooms from the list of
    // places to LAND; this excludes them as places to STAND, which is not the
    // same thing, because another room's polygon routinely overlaps a stairwell.
    const inStairwell = this.worldRoomPolys.find(
      (r) => STAIR_ROOM_RE.test(r.name) && pointInPolygon(x, z, r.pts));
    if (inStairwell) { this.lastStandableWhy = `inside stairwell "${inStairwell.name}"`; return false; }
    const need = (this.config.eyeHeight ?? 1.7) + 0.15;
    const R = 0.3;
    const blocks = (m: AbstractMesh) =>
      m.isPickable && m.isEnabled() && m.metadata?.isStructure === true
      && !isResolvedCeiling(m);

    // ⚠️ THE PROBED FLOOR IS NOT ALWAYS THE SURFACE YOU STAND ON (2.464.0).
    // `estimateFloorY` -> `floorProbe.storeyFloorY` deliberately takes the
    // LOWEST hit in the column, so an overhead beam can never be mistaken for
    // the floor. On a SPLIT-LEVEL villa — this one has three ground-storey
    // floor heights — the lowest hit under a raised room is the slab BENEATH
    // it, and the headroom ray then started below the real floor and hit it
    // from underneath. That is what the named blockers were:
    //
    //   REJECTED "Bedroom 1"   — blocked 0.08m up by "Structure_primitive72"
    //   REJECTED "Living Room" — blocked 0.55m up by "Structure_primitive21"
    //
    // 8 cm and 55 cm are floors, not obstructions. So walk UP: a structure
    // surface within one step of the probe IS the walking surface here, and
    // standing on it is the whole point. Bounded, because each pass is a ray.
    let standY = floorY;
    for (let i = 0; i < 4; i++) {
      const step = this.scene.pickWithRay(
        new Ray(new Vector3(x, standY + 0.02, z), new Vector3(0, 1, 0), STAND_STEP_MAX),
        blocks);
      if (!step?.hit || step.pickedPoint === null) break;
      standY = step.pickedPoint.y;
    }

    // Head-and-torso room only: anything under one step of the surface you are
    // standing on is a step, a threshold or a plinth, and none of those stop a
    // person. SAMPLED ACROSS THE BODY'S WIDTH rather than down one line, for the
    // open-riser reason above — a ray is a measure-zero object and real
    // obstructions have gaps in them. The offsets are the collision capsule's
    // own radius, so this asks about the volume that will actually be moved
    // through.
    for (const [dx, dz] of [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]] as const) {
      const hit = this.scene.pickWithRay(
        new Ray(new Vector3(x + dx, standY + STAND_STEP_MAX, z + dz),
          new Vector3(0, 1, 0), need - STAND_STEP_MAX),
        blocks);
      if (hit?.hit) {
        // ⚠️ NAME THE BLOCKER. Three releases were spent on a spawn that
        // reported only pass/fail, and "not standable" is not a diagnosis — it
        // is the same silence that made `undrawable=0` mean "not measured".
        this.lastStandableWhy =
          `blocked ${(standY + STAND_STEP_MAX + (hit.distance ?? 0) - floorY).toFixed(2)}m`
          + ` above floor by "${hit.pickedMesh?.name ?? "?"}"`
          + (standY !== floorY ? ` (stood up to ${(standY - floorY).toFixed(2)}m)` : "");
        return false;
      }
    }
    this.lastStandableWhy = "";
    this.lastStandY = standY;
    return true;
  }

  /** Why the last `standable()` said no — see its blocker note. */
  private lastStandableWhy = "";
  /** The surface the last successful `standable()` resolved as the one you
   *  actually stand on, which is NOT `estimateFloorY` on a split level — see
   *  the walk-up note there. The spawn places the eye from this, or it drops
   *  the walker below the floor it just validated. */
  private lastStandY = 0;

  /**
   * The nearest spot to (x, z) that stands on a GROUND-LEVEL room floor.
   *
   * ⚠️ THIS IS WHAT "AT THE FOOT OF THE STAIRCASE" ACTUALLY REQUIRES, and the
   * method below promised it for many releases without delivering it (2.457.0).
   * It grounded at the stair room's CENTROID, and the centroid of a stairwell is
   * mid-flight — so `estimateFloorY` there returns the height of a TREAD, and
   * entering first-person dropped the walker halfway up the stairs, between
   * storeys, which is exactly where a villa has neither a floor to stand on nor
   * a ceiling overhead. Reported by the owner from a screenshot.
   *
   * Everything here is derived from the plan, so it holds for any villa:
   * "ground level" is the LOWEST room floor in the model rather than any fixed
   * elevation (a villa may sit at any height and may be split-level), and the
   * search is a spiral outward from the stairwell for the first point inside a
   * room whose own floor sits at that level. Stair-named rooms are excluded for
   * the same reason they are special-cased at the polygon build above: their
   * `floorY` is a tread, not a floor.
   *
   * Falls through unchanged when there are no polygons yet (calibration has not
   * run), so a pre-calibration spawn behaves exactly as it did.
   */
  private stairFoot(x: number, z: number): { x: number; z: number } {
    if (!this.worldRoomPolys.length) return { x, z };
    let groundY = Infinity;
    for (const r of this.worldRoomPolys) groundY = Math.min(groundY, r.floorY);
    const onGround = this.worldRoomPolys.filter(
      (r) => r.floorY <= groundY + STAIR_FOOT_TOLERANCE
        && !STAIR_ROOM_RE.test(r.name));
    if (!onGround.length) return { x, z };
    // ⚠️ THE TEST IS THE SURFACE HEIGHT, NOT POLYGON CONTAINMENT (2.458.0).
    // The first cut asked "is this point inside a ground-level room outline",
    // and a stairwell's XZ sits inside the outline of whatever room surrounds
    // it — so the answer was yes at the very first sample, the search returned
    // immediately, and the walker still landed mid-flight. Containment says
    // WHICH ROOM you are over; it says nothing about what you would be standing
    // ON, which is the entire question when the obstruction is a staircase
    // inside a room. Probe the floor instead: a tread reads a riser or more
    // above the storey's own level, and a floor does not.
    const atGroundLevel = (px: number, pz: number): boolean =>
      // `standable` carries the floor-height test AND the headroom one. The
      // headroom half is not optional: the floor beneath a staircase is at
      // ground level, so height alone accepts the crawlspace under the stairs.
      this.standable(px, pz, 1)
      && onGround.some((r) => pointInPolygon(px, pz, r.pts));
    if (atGroundLevel(x, z)) return { x, z };
    // Outward in rings. The first hit is the nearest spot that is both indoors
    // and genuinely at floor level — the foot of the stairs by construction
    // rather than by an offset that would be particular to one villa. Bounded
    // at 8 m and 12 directions because each sample is a floor probe; the probes
    // are memoised (floorProbe) and this runs once per view switch.
    for (let radius = 1; radius <= 8; radius += 1) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const px = x + Math.cos(a) * radius;
        const pz = z + Math.sin(a) * radius;
        if (atGroundLevel(px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z };
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
      STAIR_ROOM_RE.test(p.name));
    if (namedRoom) {
      // stairFoot, NOT the centroid — the centroid of a stairwell is mid-flight.
      const foot = this.stairFoot(namedRoom.position.x, namedRoom.position.z);
      return groundAt(foot.x, foot.z);
    }

    // 2. A stair-named entity/structure mesh marks the stairwell's plan XZ.
    const stairMesh =
      this.loadedMeshes.find((m) => /staircase|escalier/i.test(m.name)) ??
      this.loadedMeshes.find((m) => /\bstairs?\b|_stair/i.test(m.name));
    if (stairMesh) {
      stairMesh.computeWorldMatrix(true);
      const c = stairMesh.getBoundingInfo().boundingBox.centerWorld;
      const foot = this.stairFoot(c.x, c.z);
      return groundAt(foot.x, foot.z);
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
   * Navigate to a teleport point: first-person → animated camera teleport;
   * overview → EXACTLY what tapping the room's badge does, via focusRooms.
   *
   * The two used to share only half the work. Both framed the shot through
   * `computeRoomOverviewPose`, so the camera agreed — but only the badge tap
   * called `setFocusedRooms`, and that is the half that exempts the room's
   * badges from grouping. Same camera, different picture: the menu arrived to
   * chips and summary cards where the badge tap arrived to individual devices.
   * Reported as the two showing different views of the same room, which they
   * were, because "show me this room" was written twice and only one copy was
   * finished.
   */
  navigateTo(point: TeleportPoint): void {
    // Remember the target so a later overview → first-person switch lands here.
    this.lastNavigatedRoom = point;
    if (this.viewMode === "overview") this.focusRooms([point.name], point.position);
    else this.camera.teleport(point);
  }

  /**
   * Show a room: frame it, and guarantee every one of its badges is drawn
   * individually. The whole of "tap a room, see its devices".
   *
   * ── Why this cannot fail ─────────────────────────────────────────────────
   * Four earlier versions treated the guarantee as something the camera had to
   * earn — find a zoom at which the room's badges happen not to collide — and
   * every one of them could come back "I still see the chip", because for a
   * room with two devices at ONE 3D point no such zoom exists. Reported four
   * times.
   *
   * So the two halves are now separate, and only one of them can fail:
   *   * the EXEMPTION (EntityVisuals.setFocusedRoom) makes that room's badges
   *     take no part in grouping at all. This is unconditional — it needs no
   *     geometry, no camera and no solve — so the room's badges are individual
   *     the moment this returns, whatever else happens;
   *   * the FRAMING picks the tightest shot that fits them all, separating
   *     them too where a distance exists. If the room cannot be located, or we
   *     are in first-person where there is no orbit radius, the framing is
   *     simply skipped — and the exemption still stands.
   *
   * Deliberately returns nothing. There is no outcome for a caller to branch
   * on any more: it never falls back to a modal, and it never leaves the room
   * summarised. Callers that used to choose between those paths were the
   * reason one gesture had three results.
   */
  focusRooms(roomNames: readonly string[], fallback?: { x: number; z: number }): void {
    if (roomNames.length === 0) return;
    // First, and unconditionally: the part that is a guarantee.
    this.visuals.setFocusedRooms(roomNames);
    if (this.viewMode !== "overview") return;
    const framed = this.computeRoomOverviewPose(roomNames);
    // ── THE SAME NUMBERS, ON THE DEBUG LINE (2.426.0) ─────────────────────
    // Every field above already existed and every one of them went ONLY to
    // telemetry, so four screenshots of a bad room shot arrived with no way to
    // tell whether the wall fit itself was too tight or something had tightened
    // it — the one question that decides where the fix goes. A `?debug` capture
    // is the instrument the owner actually has to hand; this is the same row,
    // in it. `radius` equal to `wallFit` means the framing IS the fit, so the
    // fraction is the dial; smaller means something is still pulling in.
    if (framed) {
      tapDebug(
        `focus [${roomNames.join("+")}] rooms=${roomNames.length}`
        + ` radius=${framed.radius.toFixed(2)} wallFit=${framed.wallFit.toFixed(2)}`
        + ` tightenedBy=${(framed.wallFit > 0
          ? framed.radius / framed.wallFit : 1).toFixed(3)}x`
        + ` solved=${framed.solved} declutters=${framed.declutters}`
        + ` real=${framed.real} halfW=${framed.halfW.toFixed(2)}`
        + ` halfH=${framed.halfH.toFixed(2)}`
        + ` minRadius=${(this.overview.camera.lowerRadiusLimit ?? 0).toFixed(2)}`,
        "seat",
      );
    }
    // `declutters` is now advisory, not a veto: it says whether the shot also
    // separates the badges or merely frames them. Either way they are drawn.
    if (framed) this.overview.applyPose(framed);
    // A room with neither a polygon nor a registered entity cannot be measured,
    // so there is nothing to frame — a caller that knows where it is anyway (the
    // teleport menu carries a position) can still be taken there.
    else if (fallback) this.overview.panTo(fallback.x, fallback.z);
  }

  private computeRoomOverviewPose(
    roomNames: readonly string[],
  ): {
    alpha: number; beta: number; radius: number;
    /** The WALL fit before anything else could narrow it, and whether the rung
     *  solver returned at all. `radius / wallFit` is the whole verdict on a
     *  room shot that reads wrong: 1.0 means the framing IS the fit, so
     *  ROOM_FIT_VIEWPORT_FRACTION is the dial; below it, something is pulling
     *  in. Guessing between those two is what three releases did wrong before
     *  2.361.0 measured it, and 2.426.0 is the fourth — it read 0.53x for a
     *  long thin room and ~1.0 after. NOT temporary: focusRooms prints these on
     *  the debug channel, which is the instrument the owner actually has. */
    wallFit: number; solved: boolean;
    /** The fit's INPUTS, so a shot that still reads wrong is attributable
     *  without another measurement round: whether every room had a real wall
     *  polygon (false ⇒ the wider entity-anchor fraction), and the footprint's
     *  half-extents on the view plane. Those two say which SCREEN AXIS bound
     *  the fit — recompute halfW/tan(hFov/2) against halfH/tan(vFov/2) and the
     *  larger one won — which is how the same one number is checked on a
     *  portrait phone and a landscape laptop. */
    real: boolean; halfW: number; halfH: number;
    target: { x: number; y: number; z: number };
    /** False when NO zoom this camera allows can separate the room's badges —
     *  two devices on one 3D point, or a pair that only clears past the zoom
     *  limit. The caller shows the device list instead. */
    declutters: boolean;
  } | null {
    // The UNION of every room asked for. A merged chip ("Master Bedroom +1")
    // stands for several rooms at once, and a short tap on it frames all of
    // them — so the box to fit is their union, not whichever room happened to
    // win the chip's label.
    let bounds: { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number } | null = null;
    // Real wall polygons where every room has one; the entity-anchor fallback
    // is per room, so one room without a polygon only loosens ITS contribution.
    let allReal = true;
    for (const name of roomNames) {
      const real = this.camera.getRoomBounds(name);
      if (!real) allReal = false;
      const b = real ?? this.visuals.getRoomEntityBounds(name);
      if (!b) continue;
      bounds = bounds ? {
        minX: Math.min(bounds.minX, b.minX), maxX: Math.max(bounds.maxX, b.maxX),
        minZ: Math.min(bounds.minZ, b.minZ), maxZ: Math.max(bounds.maxZ, b.maxZ),
        // The lower floor of the two: framing has to clear the deeper one.
        floorY: Math.min(bounds.floorY, b.floorY),
      } : { ...b };
    }
    if (!bounds) return null;
    // Entity anchors mark devices, not walls, so their box under-states the
    // room — give that fallback more headroom than a true polygon needs.
    const fitFrac = allReal
      ? ROOM_FIT_VIEWPORT_FRACTION
      : ROOM_FIT_VIEWPORT_FRACTION_ENTITIES;

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;

    const cam = this.overview.camera;
    // Which of the two angles `fov` actually is belongs to cameraFrame.ts —
    // this file used to assume it was the vertical one, as three other readers
    // separately did.
    const { vHalf, hHalf } = cameraFrame(this.scene, cam);
    const vFov = 2 * vHalf;
    const hFov = 2 * hHalf;

    // ── The shot is ZENITHAL, whatever the camera was doing before ──────────
    // A floor plan seen from straight above is the view that shows a room's
    // devices best, and it is the same view every time — tapping two rooms in
    // a row used to give two different pictures purely because of where the
    // tilt happened to be left. Only the TILT is forced: alpha is kept, so the
    // room does not also spin under the user, and the villa keeps the
    // orientation they built their sense of it from.
    //
    // The camera's OWN limit rather than a constant of ours (`lowerBetaLimit`
    // is written from OverviewController.BETA_MIN), so "as far over as this
    // camera goes" cannot drift from what the camera actually allows.
    //
    // It is computed HERE, above the fit, because the fit is measured through
    // it — see the anisotropy note below.
    const destBeta = this.overview.camera.lowerBetaLimit ?? 0.05;
    // Babylon puts an ArcRotateCamera at target + r(cos α sin β, cos β,
    // sin α sin β), so the direction it LOOKS is the negated unit offset. At
    // destBeta this is very nearly straight down, which is the whole point —
    // and it is what the badge ladder below has to measure through.
    const sb = Math.sin(destBeta);
    const destDir = {
      x: -Math.cos(cam.alpha) * sb,
      y: -Math.cos(destBeta),
      z: -Math.sin(cam.alpha) * sb,
    };

    // ── Fit the room's footprint AS PROJECTED, per screen axis ─────────────
    // This used to fit a bounding SPHERE (half the footprint diagonal) inside
    // the TIGHTER of the two field-of-view angles. Both halves of that are
    // rotation-invariant, and on a portrait phone they compound into a shot
    // that is dramatically too far out: the horizontal FOV is the tight one, so
    // the room was pushed back until its DIAGONAL fitted the screen's SHORT
    // axis, and the tall axis — most of the glass — was left empty.
    //
    // Measured, not argued (v2.362.0 telemetry): the same Living Room reports a
    // bounding sphere of 7.157 m on a 704x845 tablet, 7.151 m on a 932x616
    // tablet and 7.157 m on a 475x661 phone — the room is identical, and every
    // difference in the resulting shot was the formula. Swimming Pool wanted
    // radius 36.05 at aspect 0.719 and 51.13 at aspect 0.495: 42% further out
    // on the iPhone for the same room, which is the "zoom level is too low"
    // that was reported from it.
    //
    // The destination pose is known exactly by this point, so there is nothing
    // to be invariant to. Project the footprint's four corners onto the view
    // plane and fit each screen axis against its OWN half-angle. `tan`, not
    // `sin`: a floor seen from above is a plane facing the camera, and the
    // distance at which a plane's half-extent subtends a half-angle is
    // extent/tan. `sin` is the tangent-sphere form, and is the more
    // conservative of the two by 1/cos — small next to the anisotropy, but it
    // was wrong in the same direction.
    const frame = exactViewBasis(destDir.x, destDir.y, destDir.z, "plane");
    let halfW = 0;
    let halfH = 0;
    for (const px of [bounds.minX, bounds.maxX]) {
      for (const pz of [bounds.minZ, bounds.maxZ]) {
        // Relative to the orbit centre, which is what the frame is centred on.
        // The projection is linear, so the projected corners bound the whole
        // footprint exactly — no corner can escape a frame that holds all four.
        const p = projectToView(frame, px - cx, 0, pz - cz, this.fitScratch);
        halfW = Math.max(halfW, Math.abs(p.px));
        halfH = Math.max(halfH, Math.abs(p.py));
      }
    }
    // Per axis against its OWN half-angle, THEN the context fraction — see
    // ROOM_FIT_VIEWPORT_FRACTION for why that order is what makes one number
    // correct on every aspect ratio.
    let radius = Math.max(
      halfW / Math.tan(hFov / 2),
      halfH / Math.tan(vFov / 2),
      MIN_ROOM_FIT_RADIUS,
    ) / fitFrac;

    // ── Now ask the badges, by TESTING rather than deriving ───────────────
    // The wall fit above frames the ROOM. It says nothing about whether the
    // room's badges will be legible once the camera arrives, and those are
    // different distances: an elongated or multi-device room can need to back
    // off further for its footprint than its tightest badge pair can tolerate,
    // which is "tapped the chip and it stayed a chip" even though the camera
    // visibly moved.
    //
    // Three releases tried to close that gap with a formula, and all three
    // were exact arithmetic on a wrong input (see solveRoomZoomRadius's
    // docstring for the list). The derivation is gone: the solver walks the
    // renderer's own quantised zoom ladder and asks, at each rung, the two
    // questions literally — does anything group here, and is every badge
    // inside the frame — returning the closest rung where both hold.
    //
    // Bounded BELOW by the camera's own zoom-in limit rather than by any
    // constant of ours, because that limit is the real one: a room whose
    // badges only separate at maximum zoom should be taken to maximum zoom,
    // not to whatever floor a heuristic thought was reasonable.
    //
    // ONE room only. With several, the wall fit IS the answer: any tighter rung
    // the badge solver could return is by definition a shot that no longer
    // frames every room, and "show me all of these rooms" is the whole of what
    // a merged chip's tap asked for. The badges are not left to chance either —
    // the EXEMPTION above is unconditional and is what guarantees they are
    // drawn individually, at whatever distance the framing lands on.
    const vpH = this.engine.getRenderHeight();
    const solved = roomNames.length === 1 ? this.visuals.solveRoomZoomRadius(roomNames[0], {
      vpH,
      vpW: this.engine.getRenderWidth(),
      vFov,
      frame,
      cx, cy: bounds.floorY, cz,
      dir: destDir,
      minRadius: this.overview.camera.lowerRadiusLimit ?? 2,
      // The wall fit is the widest shot worth considering: past it the room no
      // longer fills the frame, and nothing about badges improves by backing
      // further away.
      maxRadius: Math.max(radius, this.overview.camera.lowerRadiusLimit ?? 2),
    }) : null;
    const wallFit = radius;
    let declutters = true;
    if (solved) {
      radius = solved.radius;
      declutters = solved.declutters;
    }
    radius = Math.max(radius, MIN_ROOM_FIT_RADIUS);

    return {
      alpha: cam.alpha,
      beta: destBeta,
      radius,
      wallFit,
      solved: !!solved,
      declutters,
      real: allReal,
      halfW,
      halfH,
      // Orbit about the room's own CENTRE, at the height the room's floor
      // actually sits at — a teleport point stores the first-person EYE
      // position, so reusing its y tilted the framing up by eye height.
      target: { x: cx, y: bounds.floorY, z: cz },
    };
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
   * Cast a ray straight DOWN at the room's centre through only that storey's
   * structure meshes and take the LOWEST hit — the floor slab's top surface is
   * always the lowest solid thing a downward ray finds within its own storey's
   * mesh group; anything else in that group (a beam, a duct run, an overhang,
   * or — for a room sitting under a tight ceiling section — the underside of
   * the storey above, if it got tagged into this storey's group) sits ABOVE
   * it. An earlier version took the FIRST (nearest-to-1000, i.e. highest) hit
   * instead, reasoning that a room centroid sits in open floor and so never
   * hits the walls/ceiling ringing it — true for most rooms, but not
   * guaranteed: one room (a bathroom under structure) had its centroid line
   * up with an overhead beam, so the "first hit" put its glow at ceiling
   * height instead of the floor. Picking the lowest hit removes that
   * assumption entirely rather than patching around one more special case.
   * FloorManager hides every storey except the one being viewed, and picking
   * skips disabled meshes, so the target storey's meshes are momentarily
   * force-enabled for the probe and restored after. Falls back to 0 (ground)
   * when nothing is hit.
   */
  private estimateFloorY(x: number, z: number, floor: number): number {
    // Delegated to the one module that owns floor probing since 2.300.0 —
    // including the enable/restore dance FloorManager's hidden storeys force,
    // which is the part of this that is genuinely different from the fixture
    // probe and therefore the part worth keeping named (see floorProbe.ts).
    return this.visuals.floorProbe.storeyFloorY(this.floors.getFloorMeshes(floor), x, z, floor);
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
   * trick estimateFloorY uses, including taking the LOWEST hit per column
   * (not the first/highest) so a beam or overhead structure above a tread
   * can't be mistaken for the tread itself.
   */
  private async buildRoomConform(
    pts: Pt2[], floor: number,
    /** Called between grid ROWS so a stair room is many short tasks instead of
     *  one ~400ms block. Safe only because the enable/restore dance is gone —
     *  see the note by the probe below. */
    breathe: () => Promise<void>,
    stale: () => boolean,
  ): Promise<ConformData | null> {
    const meshes = this.floors.getFloorMeshes(floor);
    if (meshes.length === 0) return null;

    // Cached from a previous load of THIS model — see conformCache. `null` is
    // a real cached answer ("flat, use the patch"), so test presence, not
    // truthiness.
    const cacheKey = polygonKey(pts, floor);
    if (this.conformCache.has(cacheKey)) return this.conformCache.get(cacheKey) ?? null;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const STEP = 0.25;
    const nx = Math.max(2, Math.ceil((maxX - minX) / STEP) + 1);
    const nz = Math.max(2, Math.ceil((maxZ - minZ) / STEP) + 1);
    if (nx * nz > 6000) return null; // safety cap → fall back to flat patch

    // NO enable/restore dance — see floorProbe.storeyFloorY. A custom pick
    // predicate REPLACES Babylon's enabled/visible/pickable filter (it is an
    // `else if` in InternalMultiPick), so force-showing the storey never
    // affected the result and only ever risked a frame drawing it.
    const xAt = (c: number) => Math.min(minX + c * STEP, maxX);
    const zAt = (r: number) => Math.min(minZ + r * STEP, maxZ);
    // A SET, for the reason spelled out in floorProbe.storeyFloorY: the
    // predicate runs once per mesh in the scene, so an array scan inside it is
    // quadratic — and here that is paid once per GRID CELL, hundreds of times
    // per stair room. Identical semantics; only the cost changes.
    const wanted = new Set(meshes);
    const probe = (x: number, z: number): number | null => {
      // A ceiling in `wanted` cannot corrupt this the way it corrupts a
      // first-hit probe: the loop below keeps the LOWEST hit per column, and a
      // ceiling is never below its own floor. Stated because /dry-audit had to
      // re-derive it, and the next reader should not have to.
      const hits = this.scene.multiPickWithRay(
        new Ray(new Vector3(x, 1000, z), Vector3.Down(), 2000), (m) => wanted.has(m));
      if (!hits?.length) return null;
      let lowestY: number | null = null;
      for (const h of hits) if (h.pickedPoint && (lowestY === null || h.pickedPoint.y < lowestY)) lowestY = h.pickedPoint.y;
      return lowestY;
    };

    // Cheap steppedness pre-check (~10 interior probes) so a big FLAT room never
    // pays for a full-grid raycast just to discover it isn't stepped.
    const quick: number[] = [];
    for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) {
      const y = probe(minX + (maxX - minX) * i / 4, minZ + (maxZ - minZ) * j / 4);
      if (y !== null) quick.push(y);
    }
    if (quick.length < 3 || Math.max(...quick) - Math.min(...quick) < 0.35) {
      this.conformCache.set(cacheKey, null);
      return null;
    }

    // Stepped → sample the full grid at the real surface height, ONE ROW PER
    // TASK. A row is a few dozen rays, which keeps each task in the tens of
    // milliseconds instead of the ~400ms the whole grid took.
    const H = new Array<number | null>(nx * nz).fill(null);
    for (let r = 0; r < nz; r++) {
      if (r > 0) {
        await breathe();
        // A newer calibration (or a teardown) while we were yielding: this
        // geometry describes a fit that no longer applies.
        if (stale()) return null;
      }
      for (let c = 0; c < nx; c++) {
        const x = xAt(c), z = zAt(r);
        if (pointInPolygon(x, z, pts)) H[r * nx + c] = probe(x, z);
      }
    }

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
    // Rounded to a tenth of a millimetre before storing: this is a glow draped
    // over stair treads, and full double precision would triple the size of
    // something that has to fit in localStorage next to the probe cache.
    const built = indices.length
      ? { positions: positions.map((n) => Math.round(n * 10000) / 10000), indices }
      : null;
    this.conformCache.set(cacheKey, built);
    return built;
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
    // Races the animation frame against a timer, and that is not belt-and-
    // braces — it is the whole point. Browsers do NOT fire rAF in a hidden
    // tab, so an rAF-only yield does not "give the browser a frame", it STOPS
    // the load until someone looks at the tab again. A villa preloading in a
    // background tab would sit unfinished indefinitely; field telemetry caught
    // one at post = 51533ms against a normal ~1600ms, which is not slow work,
    // it is ~50s of nobody watching. When visible, rAF still wins the race and
    // the paint-before-the-next-step behaviour is unchanged; when hidden there
    // is no paint to wait for anyway, so the timer is the correct answer.
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(finish);
      setTimeout(finish, 32);
    });
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
  async loadModel(data: ArrayBuffer, modelKey?: string): Promise<{
    importMs: number; postMs: number; phases?: Record<string, number>;
    /** String-valued diagnostics (material names) — see LoadResult.importNotes. */
    notes?: Record<string, string>;
  }> {
    // Lets indexMeshes reuse the previous load's floor probes when the model
    // is byte-identical — see EntityVisuals.setProbeCacheKey.
    this.visuals.setProbeCacheKey(modelKey ?? null);
    // Same premise, same key, for the stair rooms' surface-hugging glow.
    this.conformStore.setModel(modelKey ?? null);
    this.conformCache = this.conformStore.load();
    const result = await loadModelInto(this.scene, data, this.config.extraGlassHints ?? []);
    if (this.disposed) return { importMs: result.importMs, postMs: 0 }; // unmounted mid-load
    const tPostStart = performance.now();
    // Per-step timings for the post phase. "post" was measured at ~3.4s on a
    // desktop — bigger than Babylon's own import — so attributing it to a
    // specific step is the difference between fixing it and guessing at it.
    // Seeded with the glTF loader's own import milestones (see LoadResult's
    // importPhases) so ONE flat set of keys explains the whole parse — both
    // Babylon's half and ours — rather than splitting the story across two
    // places that have to be cross-referenced by hand.
    const phases: Record<string, number> = { ...result.importPhases };
    let tStep = tPostStart;
    let yieldMs = 0;
    const mark = (name: string) => {
      const now = performance.now();
      phases[name] = Math.round(now - tStep);
      tStep = now;
    };
    // Waiting is not working. Without this the time parked in a yield was
    // billed to whichever step came next, so a backgrounded tab read as
    // "indexMeshes took 50 seconds" and sent us hunting a phantom.
    const yieldAndDiscount = async () => {
      const t0 = performance.now();
      // MUST be this.yieldFrame(). Calling yieldAndDiscount() here recurses
      // forever and blows the stack before the villa can load — shipped as
      // v2.35.79, caught in the field as MODEL_LOAD_FAILED / "Maximum call
      // stack size exceeded" at the import-mesh phase, on a tab using only
      // 256MB of a 4.4GB heap. It was never memory pressure.
      await this.yieldFrame();
      const waited = performance.now() - t0;
      yieldMs += waited;
      tStep += waited;
    };
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
    // BEFORE indexFloors, which applies visibility as its last act: a model can
    // load in either view (the first-run boot walks; a reload from the overview
    // does not) and only setViewMode was telling FloorManager which, so a boot
    // straight into first-person got no storey-above ceiling until the user
    // toggled views and came back.
    this.floors.setFirstPerson(this.viewMode === "first-person");
    this.floors.indexFloors(result.meshes);
    this.pick.indexInteractiveMeshes(result.meshes); // taps work immediately
    mark("pickIndex");

    await yieldAndDiscount();
    if (this.disposed) return { importMs: result.importMs, postMs: performance.now() - tPostStart };
    this.visuals.indexMeshes(result.meshes); // entity badges/lights/state visuals — the single heaviest step
    mark("indexMeshes");
    // Split the heaviest step so the next field report says WHICH part of it
    // is slow, instead of only that it is.
    Object.assign(phases, this.visuals.indexStats());

    // NO yield before this one: applyStructure measures 2-19ms in the field
    // (see the `applyStructure` phase in load telemetry), so parking ~110ms on
    // MacBook / ~300ms on Android in a yieldFrame ahead of it cost an order of
    // magnitude more than the step it was protecting. The yield above, ahead of
    // the genuinely heavy indexMeshes, is kept.
    if (this.disposed) return { importMs: result.importMs, postMs: performance.now() - tPostStart };
    this.applyStructure(result.meshes); // solid walls + collisions + view-scoped ceilings
    // AFTER applyStructure, which is what stamps `isStair`/`isMarker` — the
    // floor follower resolves its candidate set once here instead of walking
    // every mesh on every ray (see CameraController.floorCandidates).
    this.camera.setFloorCandidates(result.meshes);
    // A model can load in either view (the first-run boot walks, a reload from
    // the overview does not), so the badge occluder pass is told which one it
    // landed in rather than waiting for a toggle that may never come.
    this.visuals.setFirstPerson(this.viewMode === "first-person");
    mark("applyStructure");

    // The villa is correct and interactive now — reveal it. The first-person
    // spawn pose is NOT computed here, or anywhere on the load path any more
    // (2.112.0 removed the eager `ensureFirstPersonSpawn` precompute entirely):
    // it cost 16+ un-octree'd raycasts — 700-790ms typical, 5.9s worst-case —
    // for a camera that is not even rendering at this point (the reveal runs
    // through the OVERVIEW camera), and `setViewMode("first-person")` below
    // computes its own spawn fresh on every real switch without ever reusing
    // the precomputed one, so the eager pass paid a real cost on every load
    // for a result nothing ever read.
    this.markReady();
    this.requestRender(1000);
    mark("spawn");
    phases.yield = Math.round(yieldMs);
    const postMs = performance.now() - tPostStart;
    devLog("[SceneManager] post-processing breakdown (ms):", phases);

    // --- Deferred: raycast-heavy / cosmetic passes that need not block the first
    // paint. Running them AFTER the first rendered frame is what stops "Loading
    // the villa" (and, on a wall tablet, several seconds of blocked main thread)
    // from waiting on the per-room floor raycasts + the stair-glow conform. The
    // Dashboard adopts the rooms/teleport grid via onCalibrated when it lands.
    // (2.112.0: this used to also eagerly place the first-person walker here —
    // removed, see firstPersonSpawn's docstring.)
    this.scene.onAfterRenderObservable.addOnce(() => {
      this.camera.indexTeleportAnchors(result.meshes);
      this.applyHighlight(result.meshes); // blue glow on bound meshes (if enabled)
      this.calibrateRooms(result.meshes); // plan→world fit + room glow (fires onCalibrated)
      this.requestRender();
    });

    return { importMs: result.importMs, postMs, phases, notes: result.importNotes };
  }

  /**
   * Fit the SweetHome plan -> model world transform using entity-named meshes at
   * known plan positions, then build correctly-placed room anchors + teleport
   * points. Falls back silently (keeps defaults) if too few meshes match — e.g.
   * for a different villa with no calibration entities.
   */
  private calibrateRooms(meshes: AbstractMesh[]): void {
    const endSpan = beginSpan("calibrateRooms");
    try {
      this.calibrateRoomsInner(meshes);
    } finally {
      endSpan();
    }
  }

  private calibrateRoomsInner(meshes: AbstractMesh[]): void {
    // Supersedes any cosmetic tail still in flight from an earlier call.
    const gen = ++this.calibGeneration;
    // Prefer plan data parsed from an uploaded .sh3d (works for ANY villa);
    // otherwise fall back to the built-in reference data.
    const entityCalib: Record<string, { x: number; y: number }> = this.config.sh3dEntities?.length
      ? Object.fromEntries(this.config.sh3dEntities.map((e) => [e.entityId, { x: e.x, y: e.y }]))
      : ENTITY_CALIBRATION_CM;
    const rooms = this.config.sh3dRooms?.length ? this.config.sh3dRooms : ROOM_POLYGONS_CM;

    // ⚠️ READ the index, do not rebuild it. This loop used to resolve every one
    // of the ~856 meshes through `resolveMeshToMapping` — a second full pass
    // moments after `indexMeshes` had just done exactly that and kept the
    // answer. Attribution of the worst load stall found it: 2412ms on an
    // Adreno 750 and 2660ms on an M1, in ONE unyielding task. Near-identical on
    // hardware three years and a category apart, which is the signature of
    // single-threaded work that no device can help with — and it ran AFTER first
    // paint, so the villa appeared and then sat frozen, which reads worse than a
    // spinner because it looks ready and ignores a tap.
    //
    // Only the calibration entities matter, and only their meshes need a world
    // matrix, so both the resolve and the recompute now touch a hundred-odd
    // meshes rather than all of them.
    const world = new Map<string, { x: number; z: number; n: number }>();
    for (const [entityId, list] of this.visuals.meshesByEntity()) {
      if (!(entityId in entityCalib)) continue;
      const acc = { x: 0, z: 0, n: 0 };
      for (const m of list) {
        // Bounding-box centre (same reason as in normalizeScale above).
        m.computeWorldMatrix(true);
        const c = m.getBoundingInfo().boundingBox.centerWorld;
        acc.x += c.x;
        acc.z += c.z;
        acc.n += 1;
      }
      if (acc.n > 0) world.set(entityId, acc);
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
            // ⚠️ A CEILING IS THIN TOO (2.478.0, /dry-audit). This ray starts at
            // y=20 and the thinness test alone happily accepts a 2.44 m ceiling
            // slab on the way down, answering "there is floor here" from the
            // lid rather than the floor. Harmless where a floor is directly
            // beneath, wrong wherever a ceiling overhangs past one — and it
            // feeds CALIBRATION, so a wrong answer moves the whole plan fit.
            if (isResolvedCeiling(m)) return false;
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
    /** Stair rooms whose surface-hugging glow is built after the block ends. */
    const stairJobs: Array<{ index: number; pts: Pt2[]; floor: number }> = [];
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
      //
      // DEFERRED since 2.350.0. It was measured at 736-834ms for this villa's
      // TWO stair rooms — a third of a block that runs after first paint, for a
      // glow that is only ever seen once a stair room is highlighted. The room
      // ships with its flat patch now and is upgraded a few frames later.
      const isStairRoom = STAIR_ROOM_RE.test(room.name);
      if (isStairRoom) stairJobs.push({ index: worldPolys.length, pts, floor });
      worldPolys.push({ name: room.name, pts, floorY });
      // QUANTISED TO MILLIMETRES, and that is not cosmetic — it is what stops
      // this data pushing itself to the server on every single boot.
      //
      // These points are DERIVED: `planToWorld` is an affine fit re-solved on
      // each load and `floorY` comes off a raycast, so both land on full
      // double precision. Dashboard adopts them into `config.teleportPoints`,
      // which is a SHARED key — and the sync layer diffs shared items with
      // JSON.stringify (keyedSync's diffKeyed), so a single differing ULP in
      // one coordinate makes the whole room read as an edit worth sending.
      // Field telemetry showed a config push on essentially every boot with no
      // user edit behind it, ~15/day, against a rule the sync layer's own
      // docstring calls load-bearing ("push only real changes").
      //
      // A millimetre is far below anything the camera can express (these feed
      // an eye position and a look-at target in metres) and far above the noise
      // floor of a re-solved fit, so equal geometry now serialises equal.
      points.push({
        name: room.name,
        floor,
        position: { x: mm(wc.x), y: mm(floorY + 1.7), z: mm(wc.z) },
        target: { x: mm(wc.x), y: mm(floorY + 1.6), z: mm(wc.z + 1.5) },
        // DERIVED — never synced. See TeleportPoint.fitted.
        fitted: true,
      });
    }

    this.calibratedPoints = points;
    this.camera.setTeleportPoints(points);
    this.camera.setRoomPolygons(worldPolys);
    // Synchronously runs roomHighlight.setRooms AND reshapeLightPools — the
    // top suspect for the residual, since the latter re-probes every light
    // pool's floor. reshapeLightPools reports itself as `calibPools`.
    this.visuals.setRoomPolygons(worldPolys);
    devLog(`[Villa] ${worldPolys.length} room polygons registered`);

    // Point-only "rooms" (named TeleportMenu viewpoints with no real polygon,
    // e.g. a staircase landing) — best-effort now from whatever
    // config.teleportPoints currently holds; re-synced properly a moment
    // later once Dashboard's onCalibrated handler adopts the freshly-fitted
    // points (see updateConfig's teleportPoints diff below).
    this.lastRoomPolyNames = new Set(worldPolys.map((r) => roomKey(r.name)));
    this.worldRoomPolys = worldPolys;
    // ⚠️ HERE, NOT IN applyStructure (2.461.0). The coverage report was called
    // from the ceiling block at load, and `worldRoomPolys` is not filled until
    // calibration — which runs AFTER applyStructure — so it hit its own
    // early-return on every boot and never printed once. Four captures were
    // read waiting for a line that could not exist. The instrument has to live
    // where its inputs do, which is the same mistake in a new place: measuring
    // at the point that was convenient rather than the point that has the data.
    this.reportCeilingCoverage();
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
    //
    // The heading offset and the default tilt are CONFIGURATION, not constants
    // — see AppConfig.cameraBeamOffsetDeg / cameraBeamPitchDeg for the full
    // reasoning. In short: a plan's `angle` is measured against the furniture
    // MODEL's own front axis, and which way a model faces at angle 0 depends
    // on how that model was authored. That is not derivable from the angle
    // number, and it differs between camera models — so hardcoding it here
    // would bake one specific catalog asset into the engine and silently
    // mis-aim every beam for any other villa. Being settings means a wrong
    // heading is a value to change, not a code change.
    const DEG = Math.PI / 180;
    const beamOffsetRad = (this.config.cameraBeamOffsetDeg ?? 180) * DEG;
    const defaultPitchRad = (this.config.cameraBeamPitchDeg ?? 30) * DEG;
    const cameraDirections = new Map<string, { x: number; y: number; z: number }>();
    if (this.config.sh3dEntities?.length) {
      for (const e of this.config.sh3dEntities) {
        // A camera by CONFIG (an entityMap entry typed "camera") or by its
        // entity_id's own domain. The domain fallback matters: a mesh literally
        // named after its entity_id resolves to a working camera badge/panel
        // through resolveMeshToMapping's name inference WITHOUT ever getting a
        // saved entityMap entry — so requiring that entry here silently denied
        // those cameras a direction, hence no beam, hence the room-glow
        // fallback instead. That looked like "the beam works sometimes",
        // because it depended on whether a device had happened to be edited in
        // Advanced Settings (which is what creates the entry).
        const map = this.config.entityMap[e.entityId];
        const isCamera = map ? map.type === "camera" : e.entityId.startsWith("camera.");
        if (!isCamera) continue;
        const d = planAngleToDir(e.angle + beamOffsetRad);
        const p0 = planToWorld(e.x, e.y);
        const p1 = planToWorld(e.x + d.px, e.y + d.py);
        const wx = p1.x - p0.x, wz = p1.z - p0.z;
        const len = Math.hypot(wx, wz);
        if (len <= 1e-6) continue;
        const pitch = e.pitch ?? defaultPitchRad;
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
    // The direction MATHS above is microseconds; `setCameraDirections` is what
    // costs, because it rebuilds every beam and each beam clips itself with 9
    // raycasts against the fused structure (measured at 1000-1051ms for this
    // villa's cameras). DEFERRED for the same reason as the stair conform: a
    // camera's FOV cone is decoration on a villa that should already be
    // answering taps. See finishCalibrationCosmetics.

    // Notify listeners (Dashboard) so the teleport grid + room labels re-adopt
    // these freshly-fitted points — e.g. right after a manual mirror toggle.
    this.calibrateCallbacks.forEach((cb) => cb());

    // Everything COSMETIC, off the block. Not awaited: the villa is already
    // correct and interactive without any of it.
    void this.finishCalibrationCosmetics(gen, worldPolys, stairJobs, cameraDirections);
  }

  /**
   * The two decorative passes calibrateRooms used to run inline: the stair
   * rooms' surface-hugging glow, and the camera FOV beams.
   *
   * Both are raycast-bound against the fused structure mesh at ~21ms a ray, and
   * between them they were ~80% of a 2.2-2.3s block that runs AFTER first paint
   * — the villa appearing and then ignoring taps, which reads worse than a
   * spinner because it looks ready. Neither affects navigation, room framing,
   * teleport points or badges, so neither belongs on that block.
   *
   * Yields a frame between pieces so each stair room is its own short task
   * rather than one long one. `gen` guards against a newer calibration having
   * started meanwhile — this can be in flight across several frames, and
   * publishing an older fit's geometry over a newer one is exactly the class of
   * bug the config sync's baseline rules exist to prevent.
   */
  private async finishCalibrationCosmetics(
    gen: number,
    worldPolys: Array<{ name: string; pts: Pt2[]; floorY: number; conform?: { positions: number[]; indices: number[] } }>,
    stairJobs: Array<{ index: number; pts: Pt2[]; floor: number }>,
    cameraDirections: Map<string, { x: number; y: number; z: number }>,
  ): Promise<void> {
    const stale = () => this.disposed || gen !== this.calibGeneration;

    if (stairJobs.length) {
      let built = 0;
      for (const job of stairJobs) {
        await this.yieldFrame();
        if (stale()) return;
        // A real span, and it has to be: 2.350.0 reported a `freeze` of 1025ms
        // with `cover: 0` — "not in any instrumented code" — when this was
        // almost certainly it, invisible only because the counter used at the
        // time bypassed the ring. There are only ever a handful of stair rooms,
        // so this cannot thrash it.
        //
        // CHUNKED internally since 2.355.0, one grid row per task. It used to
        // be atomic because it force-enabled every hidden storey for the
        // duration, making a mid-grid yield a frame that could draw the wrong
        // storeys — but that dance turned out to be unnecessary (a custom pick
        // predicate replaces Babylon's enabled/visible filter), so the reason
        // not to chunk went away with it.
        //
        // The span therefore covers several tasks and the waiting between them.
        // That is the right shape HERE and wrong for `lateBeam`: what matters
        // for this one is the total cost of a room, and no single task inside
        // it is long enough to be a freeze worth attributing.
        const end = beginSpan("lateConform");
        try {
          const conform = await this.buildRoomConform(
            job.pts, job.floor, () => this.yieldFrame(), stale,
          ) ?? undefined;
          if (conform) { worldPolys[job.index].conform = conform; built += 1; }
        } catch (err) {
          console.warn("[Villa] stair glow conform failed; keeping flat patch", err);
        } finally {
          end();
        }
        if (stale()) return;
      }
      // Persist what this load computed (including the `null`s), so the next
      // one costs nothing. A handful of entries; the store evicts other models.
      this.conformStore.save(this.conformCache);
      // Re-publish so RoomHighlight picks the hugging geometry up. Cheap now
      // that the pools it also triggers hit a warm probe memo (`calibPools`
      // measured 6ms for 108 pools once 2.349.0 stopped discarding it).
      if (built) {
        await this.yieldFrame();
        if (stale()) return;
        this.camera.setRoomPolygons(worldPolys);
        this.visuals.setRoomPolygons(worldPolys);
      }
    }

    // One camera per frame. Nothing here toggles visibility, so unlike the
    // conform above it is safe to yield between beams — see addBeam.
    this.visuals.setCameraDirectionsOnly(cameraDirections);
    await this.visuals.buildCameraBeamsChunked(() => this.yieldFrame(), stale);
    if (stale()) return;
    this.requestRender();
  }

  /** Push RoomHighlight's point-only "rooms": named TeleportMenu viewpoints
   *  (config.teleportPoints) that aren't covered by a real room polygon.
   *  Called after every recalibration AND live whenever config.teleportPoints
   *  changes on its own (e.g. the user just added "Staircase") — adding a
   *  named room shouldn't need a full model reload to start glowing. */
  private syncRoomPoints(): void {
    // teleportPoints store the CAMERA's eye position (see TeleportMenu's
    // addRoomHere), not the floor — same relation CameraController.groundCamera
    // uses in reverse (floorY = eyeY - eyeHeight). A room like "Staircase" is
    // anchored well above the recentred floor's y≈0, so the glow patch must
    // use ITS OWN local floor height, not the flat offset real room polygons
    // use, or it renders buried inside the stairs/slab below and never shows.
    const eyeHeight = this.config.eyeHeight ?? 1.7;
    const extras = this.config.teleportPoints
      .filter((p) => !this.lastRoomPolyNames.has(roomKey(p.name)))
      .map((p) => ({ name: p.name, x: p.position.x, z: p.position.z, floorY: p.position.y - eyeHeight }));
    this.visuals.setRoomPoints(extras);
  }

  /** Model-space teleport points fitted on load, or null (use config defaults). */
  getCalibratedTeleportPoints(): TeleportPoint[] | null {
    return this.calibratedPoints;
  }

  /** The model's meshes, for read-only inspection. A readonly view so a caller
   *  cannot reorder the array the floor index and highlight passes walk. */
  getLoadedMeshes(): readonly AbstractMesh[] {
    return this.loadedMeshes;
  }

  /**
   * What this device was actually rendering, for a measurement to be read
   * against.
   *
   * A probe row is meaningless on its own — 18ms means one thing at 4.3
   * megapixels and another at 1.0, and "the iPhone is faster than the Mac" is
   * not a finding until you know the iPhone had IBL off. These are the fields
   * that make one run comparable with another, and they ride on the probe
   * record so a single telemetry export is self-sufficient: no console, no
   * screenshot, no asking which device it came from.
   *
   * The same quantities the `frames` record carries, deliberately — two
   * measurements of one scene should not describe it differently.
   */
  renderContext(): Record<string, unknown> {
    if (this.disposed) return {};
    const render = this.deviceRenderConfig(this.config.render);
    return {
      mode: this.viewMode,
      rw: this.engine.getRenderWidth(),
      rh: this.engine.getRenderHeight(),
      hw: Math.round(this.engine.getHardwareScalingLevel() * 100) / 100,
      // THE field that separates "Apple GPU" (WebKit's own path) from ANGLE.
      gpu: String(this.engine.getGlInfo()?.renderer ?? "").slice(0, 96),
      activeMeshes: this.scene.getActiveMeshes().length,
      meshes: this.scene.meshes.length,
      materials: this.scene.materials.length,
      lights: this.scene.lights.length,
      litOn: this.scene.lights.reduce((n, l) => n + (l.isEnabled() ? 1 : 0), 0),
      // Render tier — an iPhone runs with IBL off, which is exactly the kind
      // of difference that turns a comparison into a wrong conclusion.
      ibl: render.ibl,
      ssao: render.ssao && !this.renderFx.isBaked(),
      ...this.msaaState(),
    };
  }

  /**
   * What anti-aliasing the framebuffer ACTUALLY got, not what was asked for.
   *
   * This exists because of a null result that could not be trusted without it.
   * An attempt to measure MSAA's cost changed the frame by nothing — which
   * reads exactly like "MSAA is not the cost", and was in fact the request
   * never reaching the context at all (see the constructor's warning). A
   * measurement that cannot tell those two apart is not a measurement.
   *
   * `aaGot` is what the browser granted, which it is free to ignore in either
   * direction. `aaSamples` is the ground truth from the driver: 0 or 1 means
   * no multisampling is happening whatever anyone asked for.
   *
   * Read from the canvas rather than a Babylon internal — getContext() with
   * the same type returns the context that already exists, so this is the
   * real one, through a public API.
   */
  private msaaState(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    try {
      const gl = (this.canvas.getContext("webgl2") ?? this.canvas.getContext("webgl")) as
        | WebGL2RenderingContext | WebGLRenderingContext | null;
      if (!gl) return out;
      out.aaGot = gl.getContextAttributes()?.antialias ?? null;
      // SAMPLES on the default framebuffer. The number the hardware is really
      // resolving, and the only one of the three that cannot be wishful.
      out.aaSamples = gl.getParameter(gl.SAMPLES) as number;
    } catch { /* diagnostic only */ }
    return out;
  }

  /**
   * Run the frame-cost A/B experiment (babylon/perfProbe.ts) and return its
   * rows. Owns the render-loop handover, which is why it lives here: the probe
   * calls `scene.render()` itself, so this loop must be stopped for the whole
   * run or every frame is rendered twice and every number is doubled.
   *
   * The loop is restored in a `finally` — a probe that threw halfway must not
   * leave a kiosk with a frozen villa.
   */
  async runRenderProbe(): Promise<ProbeRow[]> {
    if (this.disposed) return [];
    this.engine.stopRenderLoop();
    try {
      return await runPerfProbe(this.scene, this.visuals.guiLayers());
    } finally {
      if (!this.disposed) {
        this.startRenderLoop();
        this.requestRender();
      }
    }
  }

  /** Entities that resolved to real geometry in the loaded model — the devices
   *  actually visible on the 3D map (see EntityVisuals.mappedEntityIds). */
  mappedEntityIds(): string[] {
    return this.visuals.mappedEntityIds();
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
    const endSpan = beginSpan("applyStructure");
    try {
      this.applyStructureInner(meshes);
    } finally {
      endSpan();
    }
  }

  private applyStructureInner(meshes: AbstractMesh[]): void {
    // Rebuilt from scratch on every load — these are meshes of the model being
    // replaced, and a stale entry is a disposed mesh the view toggle would
    // still try to write to.
    this.ceilingMeshes = [];
    // Name patterns that are explicitly collidable (walls, railings, glass
    // barriers). Still NAME-based, and deliberately so for now: unlike the
    // pipeline's own structure groups, these are individual SweetHome catalog
    // pieces the pipeline never classified, so there is no metadata to read —
    // this is a best-effort heuristic over whatever the plan's author named
    // them, and it degrades gracefully (a miss just means that piece is not
    // force-opaqued / not collidable, never a broken load). See meshRoles.ts
    // for the parts that DO have real metadata, and the note in that file
    // about not adding new behaviour to word lists like this one.
    const structuralByName =
      /wall|partition|cloison|railing|balustrade|banister|newel|column|pillar|fence|window|glass|slid|baie|vitr/i;
    // Stairs/steps in several languages — these must NEVER collide (you walk up
    // them via floor-following) and are tagged so the camera can climb them.
    const stairPat = /stair|step|escalier|marche|scala|treppe|stufe|trap\b/i;
    // Never block movement through these (floors, outdoor terrain, helpers, stairs).
    const neverCollide =
      /ground|floor|room_|terrain|grass|lawn|water|pool|sky|__root__|ceiling|plafond|toit|ramp|slope/i;


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
      // Classified from the mesh's own pipeline metadata, not its name —
      // see meshRoles.ts (name matching survives only as a legacy fallback).
      const role = structureRole(m);
      const isPipelineStructure = role.isStructure;
      // Tag the load-bearing shell (floor slabs + walls + baked stairs) so the
      // camera can ground on the real FLOOR and never on furniture: these fused
      // meshes contain no furniture, so a downward ray against them alone finds
      // the walking surface even when a table/bed sits directly overhead.
      m.metadata = { ...(m.metadata ?? {}), isStructure: isPipelineStructure };
      // `role.isCeiling` FIRST, because it is the only one of the three that is
      // a FACT rather than a guess: pipeline ≥2.23.0 ships each non-top storey's
      // ceiling as its own object stamped `vk_role: "ceiling"` (before that the
      // app borrowed the storey-above's floor slab, which is why the 1F ceiling
      // wore the 2F floor's texture). The name pattern and the height heuristic
      // stay for every GLB built before that — see meshRoles.ts on why a new
      // structural fact becomes a `vk_*` key and never another word list.
      // `isCeilingMesh` owns the stamp AND the name list (see meshRoles) — the
      // same predicate ModelLoader lights them by, which is the disagreement
      // 2.448.0 closed. The HEIGHT heuristic stays here because it needs a
      // computed world bounding box.
      // ⚠️ A DEGENERATE MESH IS NOT A CEILING (2.456.0). The per-mesh dump
      // caught the height heuristic classifying `BAKED_LightmapCarrier` and
      // `BAKED_LightmapCarrier_Night` — 4-vertex, 0.0 x 0.0 m holders for the
      // day/night lightmap textures, which sit at 2.79 m and are flat, so they
      // satisfy every term of it. They were then counted in `ceilings: 11`, had
      // their `isVisible` driven by the view toggle, and made a fifth of the
      // ceiling census meaningless. A ceiling has AREA; these have none, and
      // `BAKED_` is the pipeline's own prefix for its carriers.
      const degenerate = footMax < 0.01 || m.name.startsWith("BAKED_");
      const byHeight = !isPipelineStructure && !degenerate
        && meshMinY > 2.5 && meshH < 0.35;
      if (!degenerate && (isCeilingMesh(m) || byHeight)) {
        // HIDDEN IN OVERVIEW, SHOWN WHILE WALKING (2.434.0). A ceiling exists to
        // be under, and the two cameras want opposite things from it: the
        // bird's-eye view is a cut-away and a lid over it shows nothing but the
        // lid, while standing inside a room with open sky overhead is the one
        // thing that never reads as "indoors". So the decision moves from load
        // time to the view toggle — `applyCeilingVisibility`, driven by
        // setViewMode, which is also the only thing that may write `isVisible`
        // on these meshes from here on.
        //
        // Collisions stay OFF regardless: the walker climbs stairs by
        // floor-following and CameraController deliberately keeps the space
        // overhead clear (see its ellipsoid note) — a collidable ceiling is how
        // you get wedged mid-staircase.
        m.metadata = { ...(m.metadata ?? {}), isCeiling: true };
        this.ceilingMeshes.push(m);
        m.isVisible = this.viewMode === "first-person";
        m.checkCollisions = false;
        // ⚠️ THIS `continue` SKIPS THE REST OF THE LOOP, AND THE OPACITY
        // NORMALISATION AT THE BOTTOM OF IT IS ONE OF THE THINGS IT SKIPPED
        // (2.454.0). Exactly the shape of 2.450.0, where the same early exit
        // put the ceiling ahead of the UV2 gate: a decision made here is made
        // BEFORE every later rule, so each later rule has to be asked for
        // explicitly or it silently does not apply.
        //
        // SweetHome bleeds alpha onto flat slabs, and a ceiling is the one
        // surface where that is not cosmetic: you look straight up through it
        // at the sky, which is precisely the "no ceiling in first-person"
        // report that four fixes chased. Everything else in the villa got
        // forced opaque at the bottom of this loop and the ceiling did not.
        forceOpaque(m);
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

      // --- Raycast/collision acceleration ---
      // CameraController.followFloor() raycasts straight down against this
      // same structural geometry on EVERY frame while walking (plus a second
      // fallback raycast when the first misses), and Babylon's own built-in
      // moveWithCollisions does an equivalent ray/triangle test for every
      // collidable mesh — both against exactly the geometry
      // EntityVisuals.surfaceBelowCache's own docstring measured as "a linear
      // scan over a 1.4-million-triangle structure mesh with no picking
      // octree", ~950ms worth at load time. That path gets away with it by
      // caching each answer (a light fixture's position never moves); a
      // walking camera can't cache a raycast whose answer changes every
      // step, so the fix has to be the mesh's own acceleration structure
      // instead — this is what was actually freezing the UI the instant
      // first-person movement started (pure look-around never raycasts at
      // all, which is why only walking hung). A submesh octree only helps a
      // mesh with enough submeshes to spatially partition; on one with too
      // few it is a no-op octree build at load and changes nothing at
      // runtime, so it's safe to request unconditionally on every
      // structural/collidable mesh above a trivial size rather than trying
      // to guess which ones actually benefit.
      if ((isPipelineStructure || m.checkCollisions) && m.getTotalVertices() > 1500) {
        m.useOctreeForPicking = true;
        m.useOctreeForCollisions = true;
        m.createOrUpdateSubmeshesOctree();
      }

      // --- Opacity --- (see forceOpaque; the ceiling branch above calls it too)
      forceOpaque(m);
    }
    // The one field that separates "this villa has no ceiling geometry" from
    // "the ceiling feature is broken". A pipeline ≥2.6.0 DROPS the top
    // ceiling/roof in Blender, so zero here is the expected answer on a
    // freshly-baked villa and means the GLB, not this code, is what has to
    // change. Reported once per load rather than per mesh.
    // ⚠️ A LOW NUMBER HERE IS NOT "the rest is covered by something else" any
    // more. The storey-above slab stood in for a missing ceiling from 2.435.0
    // to 2.443.0 and is GONE (2.444.0) — it wore the 2F floor's texture, and it
    // could never roof the TOP storey, the one storey whose ceiling the pipeline
    // deliberately drops. So this count is now the whole of what roofs a walker.
    // `stamped` separates the two eras: a pipeline ≥2.23.0 GLB reports real
    // ceiling OBJECTS, so a low number is now a finding rather than the norm.
    // ⚠️ DELIBERATELY NOT `isResolvedCeiling` — /dry-audit will re-flag these
    // otherwise. Every other consumer asks "IS this a ceiling"; these two ask
    // "which ROUTE classified it", which is the entire purpose of the line: a
    // capture reading `11 shown` beside an invisible ceiling was a true
    // statement that hid the fault, and splitting stamped / by-name / by-height
    // is what made "this GLB ships none" distinguishable from "the feature is
    // broken". Collapsing them onto the resolved answer would delete the
    // distinction and put that blind spot back.
    const stamped = this.ceilingMeshes.filter((m) => structureRole(m).isCeiling).length;
    const named = this.ceilingMeshes.filter(
      (m) => !structureRole(m).isCeiling && isCeilingMesh(m)).length;
    // `enabled=` is the field that separates the two ways a "shown" ceiling can
    // still be absent: the floor filter disabled it (FloorManager runs BEFORE
    // this), or it is drawn and you cannot see it (orientation, lighting). The
    // line said "11 shown" for two releases while they were back-face culled —
    // true, and useless, which is the failure mode this project keeps paying for.
    const enabled = this.ceilingMeshes.filter((m) => m.isEnabled(false)).length;
    tapDebug(
      `ceilings: ${this.ceilingMeshes.length} mesh(es) shown in first-person`
      + ` (${enabled} enabled on the active floor)`
      + ` (${stamped} stamped vk_role=ceiling, ${named} by name,`
      + ` ${this.ceilingMeshes.length - stamped - named} by height)`
      + (stamped + named === 0 && this.ceilingMeshes.length === 0
        ? " — NONE: this GLB ships no ceiling geometry"
        : ""),
    );
    this.reportCeilingGeometry();
    this.reportUnpeeledCeiling(meshes);
    this.requestRender();
  }

  /**
   * WHERE the ceilings are, in world units — the diagnostic that four fixes
   * were shipped without.
   *
   * Every previous ceiling report answered a question about the CODE ("is it
   * enabled", "is it visible", "did it get a lightmap", "is it double-sided")
   * and all four came back healthy while nothing was on screen. Each of those
   * fixes was real, and none of them could ever have answered the remaining
   * possibility, which is about the GEOMETRY: that these meshes are not over
   * anywhere a person stands. The pipeline peel found a 1.79 m lintel and zero
   * stamped objects, which is the shape of "SweetHome emitted a few strays" —
   * so the two hypotheses left are "nothing is above the walker" and "it is
   * drawn and unseen", and they are separated by three numbers.
   *
   *   `y=` the world Y band the ceilings occupy. Under ~2 m and this is trim,
   *         a lintel or a soffit, not a lid — no lighting fix can help it.
   *   `foot=` their combined XZ footprint as a FRACTION of the villa's own.
   *         A few percent is "some rooms only"; near zero is "strays".
   *   `eye=` the walker's eye height, so the band can be read against the head
   *         it is meant to be above without a second lookup.
   *
   * On `tapDebug`, never `devLog`, for the reason the lighting line is: three
   * rounds of this were diagnosed from owner-pasted kiosk logs, where anything
   * stripped outside DEV is invisible.
   */
  private reportCeilingGeometry(): void {
    if (!this.ceilingMeshes.length) return;
    // ⚠️ THE GATE SKIPS THE WORK, NOT JUST THE LINE (2.480.0, /dry-audit).
    // `projectedAreaXZ` walks every triangle of every ceiling mesh, twice —
    // once for the total and once per mesh — and that is pure waste on a boot
    // nobody is debugging. Same rule the placement tier already follows.
    if (!debugFlagEnabled()) return;
    let minY = Infinity; let maxY = -Infinity; let foot = 0; let area = 0;
    for (const m of this.ceilingMeshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      minY = Math.min(minY, bb.minimumWorld.y);
      maxY = Math.max(maxY, bb.maximumWorld.y);
      // Bounding-box footprint, summed per mesh rather than unioned: it
      // over-counts overlap and that is the safe direction here — the finding
      // this is looking for is a number far too SMALL to be a villa's ceiling.
      foot += (bb.maximumWorld.x - bb.minimumWorld.x)
        * (bb.maximumWorld.z - bb.minimumWorld.z);
      area += projectedAreaXZ(m);
    }
    const ext = this.worldExtends(this.loadedMeshes);
    const villaFoot = Math.max(1e-6, (ext.max.x - ext.min.x) * (ext.max.z - ext.min.z));
    // ⚠️ `alpha=` is the field the first geometry line was missing, and the one
    // that turned "drawn but unseen" from a category into a mechanism: an owner
    // screenshot looking up from the ground floor showed SKY through translucent
    // planes overhead. A ceiling you can see through is not a lighting bug and
    // not a visibility bug, which is why four fixes aimed at those missed it.
    // `see-through=` counts the ones still under 1 AFTER forceOpaque has run,
    // so a non-zero value means a ceiling is deliberately transparent in the
    // GLB (alpha ≤ 0.5) rather than bleeding — a different finding, and one
    // this app must not silently paper over.
    let minAlpha = 1;
    let seeThrough = 0;
    for (const m of this.ceilingMeshes) {
      const a = m.material?.alpha ?? 1;
      minAlpha = Math.min(minAlpha, a);
      if (a < 1) seeThrough += 1;
    }
    tapDebug(
      `ceiling geometry: y=${minY.toFixed(2)}..${maxY.toFixed(2)}m`
      + ` bbox=${foot.toFixed(1)}m2`
      // ⚠️ READ `area=`, NOT `bbox=`. See projectedAreaXZ: the box figure is the
      // size of the SCATTER between panels, not of the panels, and reading it as
      // coverage is what made "half the villa is covered" look like a fact.
      + ` area=${area.toFixed(1)}m2 (${(100 * area / villaFoot).toFixed(1)}% of villa)`
      + ` eye=${(this.config.eyeHeight ?? 1.7).toFixed(2)}m`
      + ` alpha=${minAlpha.toFixed(2)} see-through=${seeThrough}/${this.ceilingMeshes.length}`
      + (maxY < (this.config.eyeHeight ?? 1.7)
        ? " — ENTIRELY BELOW EYE LEVEL: this is trim, not a lid"
        : ""),
    );
    // ⚠️ PER MESH, because every aggregate so far has been a true statement that
    // hid the fault. `foot=` is a SUM of bounding boxes and deliberately
    // over-counts overlap, so 51% of the villa is consistent with two big
    // overlapping slabs covering one wing and nothing over the room the walker
    // is standing in. Names and centres are what separate those, and a name is
    // also the only thing that can be taken back to the pipeline: `0 stamped
    // vk_role=ceiling` means SweetHome emitted these as ordinary objects, so
    // which objects they are is the question the GLB has to answer.
    for (const m of this.ceilingMeshes) {
      const bb = m.getBoundingInfo().boundingBox;
      tapDebug(
        `  ceiling "${m.name}"`
        + ` y=${bb.minimumWorld.y.toFixed(2)}..${bb.maximumWorld.y.toFixed(2)}`
        + ` xz=${bb.centerWorld.x.toFixed(1)},${bb.centerWorld.z.toFixed(1)}`
        + ` bbox=${(bb.maximumWorld.x - bb.minimumWorld.x).toFixed(1)}x`
        + `${(bb.maximumWorld.z - bb.minimumWorld.z).toFixed(1)}m`
        + ` area=${projectedAreaXZ(m).toFixed(1)}m2`
        + ` floor=${(m.metadata as { floorIndex?: number } | null)?.floorIndex ?? "-"}`
        + ` verts=${m.getTotalVertices()}`
        // ⚠️ `visibility` is NOT `isVisible`. Babylon has both: the boolean gates
        // submission, this is a 0..1 alpha multiplier applied when drawing. A
        // mesh at visibility 0 is enabled, isVisible, in the active list and
        // draws nothing — every counter this feature has would read healthy.
        // Never checked in six rounds, so it is printed rather than assumed.
        + ` vis=${m.visibility.toFixed(2)}`,
      );
    }
  }

  /**
   * Is there ceiling geometry still FUSED INTO `Structure` that the pipeline's
   * peel did not take? See `horizontalAreaInBand` for the full reasoning and
   * for how to read the two numbers.
   *
   * Reported against what WAS peeled, so the line is self-contained: if the
   * unpeeled down-facing area dwarfs `Structure_Ceiling_L0`'s, the peel's band
   * or threshold is wrong; if the UP-facing area dwarfs both, SweetHome's
   * ceiling faces are inverted and the peel's down-facing filter is skipping
   * them; if both are ~0, the export genuinely contains no more ceiling.
   */
  private reportUnpeeledCeiling(meshes: AbstractMesh[]): void {
    if (!debugFlagEnabled() || !this.ceilingMeshes.length) return;
    // The band the pipeline searches, in world metres: 80% of the storey up to
    // 15% past its boundary. Taken from the drawn ceilings rather than assumed,
    // so this holds for a villa with any storey height.
    let loY = Infinity; let hiY = -Infinity;
    for (const m of this.ceilingMeshes) {
      const bb = m.getBoundingInfo().boundingBox;
      loY = Math.min(loY, bb.minimumWorld.y);
      hiY = Math.max(hiY, bb.maximumWorld.y);
    }
    loY -= 0.5; hiY += 0.5;
    const ceilingSet = new Set(this.ceilingMeshes);
    let down = 0; let up = 0; let scanned = 0;
    /** The down-facing subset in meshes actually enabled on this storey. */
    let downHere = 0;
    const byHeight = new Map<number, number>();
    const byMesh = new Map<string, number>();
    const byMeshHeight = new Map<string, Map<number, number>>();
    for (const m of meshes) {
      if (ceilingSet.has(m) || m.getTotalVertices() === 0) continue;
      if (m.metadata?.isStructure !== true) continue;
      const r = horizontalAreaInBand(m, loY, hiY);
      if (r.down || r.up) scanned += 1;
      down += r.down; up += r.up;
      // ⚠️ ONLY WHAT IS DRAWABLE HERE CAN BE "LEFT BEHIND" (2.482.0). `down`
      // counts every structure mesh, including the storey ABOVE — which is
      // disabled while you walk below it and whose floor slab the peel is right
      // to leave alone. Judging the verdict on the raw total made it shout
      // "PEEL TOO NARROW" at 339 m² of upper-storey slab while the line
      // directly beneath it correctly called that "a floor slab". An instrument
      // that keeps printing after its question closes does not go neutral, it
      // starts lying — so the verdict now reads the enabled subset and the raw
      // total stays visible beside it.
      if (m.isEnabled()) downHere += r.down;
      for (const [k, v] of r.byHeight) byHeight.set(k, (byHeight.get(k) ?? 0) + v);
      // ⚠️ WHICH OBJECT the area belongs to, and whether that object is even
      // DRAWN on this storey. Without this the previous verdict ("PEEL TOO
      // NARROW — fix the pipeline") could not be told from its opposite: the
      // scan accepts every `isStructure` mesh, which includes `Structure_L1`,
      // and the upper storey is DISABLED while you walk the lower one. Area
      // sitting in a hidden mesh is the storey-above SLAB — the thing the lid
      // fallback exists to show — not ceiling the peel forgot. Same number,
      // opposite owner, and I nearly sent the owner to edit their pipeline on
      // the strength of it.
      const stem = m.name.replace(/_primitive\d+$/, "");
      const key = `${stem}${m.isEnabled() ? "" : " [DISABLED here]"}`;
      byMesh.set(key, (byMesh.get(key) ?? 0) + r.down);
      // ⚠️ PER OBJECT **AND** PER HEIGHT, because the aggregate is ambiguous in
      // exactly the way that made me retract a correct finding (2.468.0). Seeing
      // 473 m2 sitting in `Structure_L1` I concluded "that is the upper storey's
      // floor slab" and called the pipeline correct. The owner then said they
      // had set "Display ceiling" on the INTERIOR rooms and NOT on the patio or
      // onsen — the exact inverse of what the app reports as covered — which
      // means the 9 peeled objects are the patio/onsen ROOFS, and their real
      // ceilings are somewhere else.
      //
      // A floor slab sits at ONE height, the storey boundary. Room ceilings sit
      // at the two or three heights the rooms were drawn with. So the SHAPE of
      // this histogram, per object, tells them apart — and blender_pipeline's
      // own v2.24.0 note records this precise failure ("Structure_L1 reached
      // DOWN to 2.25 m while Structure topped out at 2.51 m"), which it believed
      // it had fixed by peeling before the level split.
      let hm = byMeshHeight.get(key);
      if (!hm) { hm = new Map(); byMeshHeight.set(key, hm); }
      for (const [k, v] of r.byHeight) hm.set(k, (hm.get(k) ?? 0) + v);
    }
    let peeled = 0;
    for (const m of this.ceilingMeshes) peeled += projectedAreaXZ(m);
    tapDebug(
      `unpeeled ceiling: down=${down.toFixed(1)}m2 up=${up.toFixed(1)}m2`
      + ` still fused in ${scanned} structure mesh(es), band ${loY.toFixed(2)}..${hiY.toFixed(2)}m`
      + ` (peeled=${peeled.toFixed(1)}m2)`
      + ` here=${downHere.toFixed(1)}m2`
      + (downHere > peeled
        ? " — PEEL TOO NARROW: down-facing ceiling was left behind on THIS storey"
        : up > 4 * Math.max(down, peeled)
          ? " — INVERTED NORMALS: faces exist but point UP, so the peel's"
            + " down-facing filter skips them (pipeline fix)"
          : " — the remainder is the storey above's slab, correctly left"),
    );
    // Descending by area: the top few buckets are the heights the pipeline's
    // band must cover, and comparing them against the peeled ceilings' own
    // 2.44-2.74 m says whether the band is too high, too low, or too thin.
    const top = [...byHeight].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (top.length) {
      tapDebug(`  unpeeled down-facing by height: `
        + top.map(([k, v]) => `${k.toFixed(1)}m=${v.toFixed(0)}m2`).join(" "));
    }
    const tops = [...byMesh].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (tops.length) {
      tapDebug(`  unpeeled down-facing by object: `
        + tops.map(([k, v]) => `${k}=${v.toFixed(0)}m2`).join(" "));
    }
    for (const [k] of tops.slice(0, 3)) {
      const hm = byMeshHeight.get(k);
      if (!hm) continue;
      const hs = [...hm].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 6);
      if (hs.length) {
        tapDebug(`    ${k}: `
          + hs.map(([h, v]) => `${h.toFixed(1)}m=${v.toFixed(0)}m2`).join(" ")
          // ONE height means a slab; several means room lids.
          + (hs.length >= 2 && hs[1][1] > 0.25 * hs[0][1]
            ? " — SEVERAL HEIGHTS: room ceilings, not one floor slab"
            : " — single height: a floor slab"));
      }
    }
    // Where each structure group actually SITS. The pipeline's own v2.24.0 note
    // diagnosed this bug from exactly these two numbers.
    const groups = new Map<string, { lo: number; hi: number }>();
    for (const m of meshes) {
      if (m.metadata?.isStructure !== true || m.getTotalVertices() === 0) continue;
      const stem = m.name.replace(/_primitive\d+$/, "");
      const bb = m.getBoundingInfo().boundingBox;
      const g = groups.get(stem) ?? { lo: Infinity, hi: -Infinity };
      g.lo = Math.min(g.lo, bb.minimumWorld.y);
      g.hi = Math.max(g.hi, bb.maximumWorld.y);
      groups.set(stem, g);
    }
    tapDebug(`  structure groups: `
      + [...groups].map(([k, g]) => `${k}=${g.lo.toFixed(2)}..${g.hi.toFixed(2)}m`).join(" "));
  }

  /**
   * WHICH ROOMS HAVE A CEILING OVER THEM, BY NAME — the instrument every
   * previous ceiling report was missing (2.458.0).
   *
   * Six rounds measured the ceiling as a SET (how many exist, are enabled,
   * visible, lit, opaque, submitted) and one round measured its total area. Not
   * one of them could answer the question the owner keeps actually asking,
   * which is about a PLACE: "I am standing here and there is no ceiling above
   * me." `above=` answers it for one point; this answers it for the whole plan,
   * and names the rooms, which is the only form of the answer that is
   * ACTIONABLE — an uncovered room is a room to switch "Display ceiling" on for
   * in SweetHome, and the app cannot fix it at all.
   *
   * ⚠️ It also replaces a denominator that was wrong. `ceiling geometry`'s
   * percentage divides by the world extents, which include the terrain and the
   * palm trees, so it understates coverage of the HOUSE by however much garden
   * the model ships. Room polygons are the honest denominator: they are the
   * floor area a person can stand on.
   *
   * Samples a grid inside each ground-level room rather than its centroid,
   * because a room with a ceiling over half of it is a different finding from
   * one with none, and a centroid cannot tell them apart.
   */
  private reportCeilingCoverage(): void {
    if (!this.ceilingMeshes.length || !this.worldRoomPolys.length) return;
    // ⚠️ THE MOST EXPENSIVE DIAGNOSTIC IN THE APP, AND IT WAS UNGATED
    // (2.480.0, /dry-audit). Up to 14 ground rooms x 25 grid samples x 16
    // ceiling meshes is ~5,600 ray/mesh intersections, run on EVERY boot to
    // print a line only a debugging session reads.
    if (!debugFlagEnabled()) return;
    let groundY = Infinity;
    for (const r of this.worldRoomPolys) groundY = Math.min(groundY, r.floorY);
    const rooms = this.worldRoomPolys.filter(
      (r) => r.floorY <= groundY + STAIR_FOOT_TOLERANCE);
    if (!rooms.length) return;

    const ray = new Ray(Vector3.Zero(), new Vector3(0, 1, 0), 12);
    const covered: string[] = [];
    const bare: string[] = [];
    let totalArea = 0;
    let coveredArea = 0;
    for (const r of rooms) {
      let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
      for (const p of r.pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      const N = 5;
      let inside = 0; let hit = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const px = minX + ((i + 0.5) / N) * (maxX - minX);
          const pz = minZ + ((j + 0.5) / N) * (maxZ - minZ);
          if (!pointInPolygon(px, pz, r.pts)) continue;
          inside += 1;
          ray.origin.set(px, r.floorY + 1.0, pz);
          ray.direction.set(0, 1, 0);
          ray.length = 12;
          if (this.ceilingMeshes.some((m) => ray.intersectsMesh(m, true).hit)) hit += 1;
        }
      }
      if (!inside) continue;
      // The polygon's own area, so a big bare room outweighs a small covered one
      // in the summary rather than counting once each.
      let a2 = 0;
      for (let i = 0; i < r.pts.length; i++) {
        const p = r.pts[i]; const q = r.pts[(i + 1) % r.pts.length];
        a2 += p.x * q.z - q.x * p.z;
      }
      const area = Math.abs(a2) / 2;
      totalArea += area;
      coveredArea += area * (hit / inside);
      (hit / inside >= 0.5 ? covered : bare).push(
        `${r.name}${hit ? ` (${Math.round(100 * hit / inside)}%)` : ""}`);
    }
    tapDebug(
      `ceiling coverage: ${covered.length}/${covered.length + bare.length} ground rooms`
      + ` — ${(100 * coveredArea / Math.max(1e-6, totalArea)).toFixed(0)}% of ${totalArea.toFixed(0)}m2 floor area`,
    );
    if (bare.length) tapDebug(`  NO ceiling over: ${bare.join(", ")}`);
    if (covered.length) tapDebug(`  ceiling over: ${covered.join(", ")}`);
  }

  /**
   * Show ceiling/roof meshes while walking, hide them in the bird's-eye view.
   *
   * The overview is a CUT-AWAY: it looks down into rooms, and a lid over them
   * hides everything the view exists to show — which is why these meshes were
   * hidden unconditionally at load until 2.434.0. First-person has the opposite
   * requirement: standing in a room with open sky overhead never reads as being
   * indoors. Same meshes, opposite answers, so the answer belongs to the view
   * toggle rather than to the load path.
   *
   * ⚠️ `isVisible`, never `setEnabled` — FloorManager owns setEnabled for the
   * per-storey cut and the two must not stomp each other (see its header). That
   * also means this cannot resurrect a ceiling belonging to a hidden storey:
   * FloorManager has already disabled it, and a disabled mesh does not render
   * however visible it claims to be. Walking on 1F therefore gets 1F's ceiling
   * and not 2F's, with no storey logic here at all.
   */
  private applyCeilingVisibility(): void {
    const show = this.viewMode === "first-person";
    for (const m of this.ceilingMeshes) {
      if (m.isVisible !== show) m.isVisible = show;
    }
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
      // Reuses EntityVisuals.categoryOf — the SAME resolution the badge
      // itself uses (including live device_class) — rather than a second,
      // independent effectiveCategory() call: that used to omit
      // device_class, so an enum sensor (e.g. a UniFi AP's "State") could
      // glow under a different category than its own badge showed.
      const category = this.visuals.categoryOf(mapping.entityId, mapping.type);
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
   *  visuals were torn down and need repainting from their last known state.
   *
   *  ASYNC for the same reason loadModel() is: indexMeshes()/applyStructure()
   *  are each one long uninterrupted synchronous pass over every mesh in the
   *  GLB (see loadModel's docstring — genuinely chunking either one needs
   *  Web Worker offload, a separate undertaking). Every Advanced Settings /
   *  Bindings edit — a single checkbox, one label keystroke's debounced
   *  commit — used to run BOTH of those back-to-back on the main thread with
   *  no gap, which is what made the *next* click feel like it "didn't
   *  register": it was queued behind a multi-second block. Debouncing the
   *  COMMIT (ConfigEditor/BindingsTable/SettingsModal's draft-state pattern)
   *  only reduces how OFTEN this runs, not how long any single run blocks.
   *  yieldFrame() between the two heavy calls — the exact technique already
   *  proven at initial load — turns one long freeze into two shorter ones
   *  with a real animation-frame gap where the browser can paint the click
   *  that triggered this and drain any input queued during the first half. */
  async updateConfig(config: AppConfig): Promise<boolean> {
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

    // A COSMETIC per-entity edit (label, room, category, badge colour, linked/
    // motion entity, light intensity) changes entityMap by reference like any
    // other edit, but needs only a cheap glyph repaint — NOT the full
    // indexMeshes re-clone/relight pass, whose multi-second hitch is what made
    // both the colour modal and every Advanced Settings device card feel
    // laggy. Detect that case and route it to repaintBadges() below instead of
    // the structural branch. See COSMETIC_MAPPING_FIELDS for why these
    // specific fields are safe to skip re-indexing for.
    // Three outcomes, not two — see entityMapDelta. A same-content replacement
    // ("identical") must be neither cosmetic NOR structural, or every
    // DeviceConfigSync focus-pull buys a full multi-second re-index for a
    // config that did not change.
    const mapDelta = prev.entityMap === config.entityMap
      ? "identical"
      : entityMapDelta(prev.entityMap, config.entityMap);
    // meshBindings needs the SAME same-content-different-reference guard as
    // entityMap just above, for the identical reason: DeviceConfigSync's
    // pull() hands both fields a freshly JSON-parsed (so never `===` the
    // existing one) object on every call, including a no-op pull that ran
    // purely because the tab regained focus/visibility. Missed when
    // entityMapDelta was introduced — meshBindings sat right next to it,
    // still comparing by bare reference, so a config that hadn't changed at
    // all still tripped `structuralChanged` (a full indexMeshes/
    // applyStructure pass) on every single focus regain. Unlike entityMap
    // there's no cosmetic/structural split to make here — any REAL change to
    // which mesh is which entity is inherently structural — so this only
    // needs a same-content check, not a delta classifier.
    const meshBindingsChanged =
      prev.meshBindings !== config.meshBindings &&
      JSON.stringify(prev.meshBindings) !== JSON.stringify(config.meshBindings);
    const cosmeticOnly =
      mapDelta === "cosmetic" &&
      !meshBindingsChanged &&
      !sh3dChanged;

    // indexMeshes()/applyStructure() only read entity↔mesh bindings; everything
    // else (glass hints, grass, model transform) takes effect on the next
    // model load, not here.
    const structuralChanged =
      mapDelta === "structural" ||
      meshBindingsChanged ||
      sh3dChanged;

    // renderFx first (sets base IBL + builds/clears the env texture), THEN the
    // sun pass so SunController has the final word on the fill light + day/night
    // IBL scaling it owns. Same ordering as setRenderConfig() — keeping the two
    // call sites consistent is what stops the night fill from flickering.
    if (renderChanged) {
      this.renderFx.apply(this.deviceRenderConfig(config.render));
      this.sun.updateConfig(config);
    }
    // A theme flip is NOT handled here any more — see handleThemeChange. This
    // watched `config.theme`, which only moves when someone picks a theme in
    // Settings; an "auto" kiosk crossing into night, or the OS switching to
    // dark, leave it untouched while the whole UI re-themes around it.
    this.camera.updateConfig(config);
    this.overview.setNaturalScrolling(config.naturalScrolling ?? true);
    this.pick.setMaps(config.entityMap, config.meshBindings, config.deniedTypes, config.hiddenCategories);
    this.visuals.updateConfig(config); // internally cheap; rebuilds labels only on its own diff
    if (cosmeticOnly) this.visuals.repaintBadges(); // cheap glyph-only refresh

    // A room added/renamed/removed via the Rooms menu ("Add room here") should
    // start glowing (or stop) immediately — no model reload needed, unlike the
    // real room polygons which only change on a full recalibration.
    //
    // ⚠️ CONTENT, NOT REFERENCE — the FOURTH shared key to need this, and the
    // last one that lacked it (/dry-audit). entityMap, meshBindings and
    // deviceGroups each got the guard after the same bug was reported in the
    // field; teleportPoints is a SHARED_CONFIG_KEY too, so DeviceConfigSync's
    // pull() hands back a freshly JSON-parsed (never `===`) array on every
    // window focus and visibilitychange. What that bought on each one was not
    // cheap: syncRoomPoints → setPointRooms disposes EVERY point-room glow and
    // rebuilds it, and each rebuild casts a floor probe and either builds a
    // decal against real geometry or triangulates a clipped polygon into a
    // fresh Mesh + material. Focus the tab, rebuild the lot, for a config that
    // did not change.
    //
    // `eyeHeight` is in the predicate because syncRoomPoints READS it (a point
    // stores the eye position, so the patch's floorY is `y - eyeHeight`) —
    // moving the slider in Settings used to leave every point-room glow at its
    // old height until a reload. Same class of defect from the other side: a
    // consumer that does not re-run when one of its inputs moves.
    const roomPointsChanged =
      (prev.teleportPoints !== config.teleportPoints
        && JSON.stringify(prev.teleportPoints) !== JSON.stringify(config.teleportPoints))
      || prev.eyeHeight !== config.eyeHeight;
    if (roomPointsChanged) {
      this.syncRoomPoints();
    }

    if (this.loadedMeshes.length && structuralChanged) {
      // Yield BEFORE the first heavy call too, not just between the two —
      // the click/keystroke that triggered this edit only just committed via
      // React's state update; giving the browser a frame here is what lets
      // it actually paint that commit before the freeze starts, instead of
      // the paint and the freeze racing on the same tick.
      await this.yieldFrame();
      // Bail if a NEWER config has since superseded this call (another edit
      // landed while we were yielding) — this.config is only ever written by
      // this method, so a mismatch here means a later invocation already
      // took over; let ITS rebuild cover this change too instead of paying
      // for indexMeshes twice back-to-back. The caller discards this stale
      // call's result on its own (React effect cleanup), so returning early
      // is safe either way.
      if (this.disposed || this.config !== config) return structuralChanged;
      this.visuals.indexMeshes(this.loadedMeshes);

      await this.yieldFrame();
      if (this.disposed || this.config !== config) return structuralChanged;
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

  /** Which real drawn room polygon this entity's own mesh anchor sits
   *  inside, or null (no anchor yet, or it sits outside every polygon) — the
   *  geometric room fallback Dashboard.tsx's room-resolution effect uses for
   *  whatever HA hasn't organised into an Area (see setResolvedRooms). */
  roomForEntity(entityId: string): string | null {
    return this.visuals.roomForEntity(entityId);
  }

  setResolvedRooms(rooms: Record<string, string>): void {
    this.visuals.setResolvedRooms(rooms);
  }

  private disposed = false;
  /** One-shot guard so handlePageShow's reload can never loop. */
  private reloadedAfterDispose = false;

  /**
   * The heading the camera is currently looking along, as a MODEL bearing in
   * degrees — 0 = +Z, increasing toward +X, matching the convention
   * SunController builds its direction vectors with.
   *
   * Exists so "north is the way I am facing" can be one tap instead of a number
   * the operator has to guess. The villa's own orientation is the one fact they
   * reliably know ("the pool is on the south side"); the offset in degrees is
   * not. Returns null when there is no camera to ask, or when it is looking
   * straight down and has no heading to report.
   */
  viewHeadingDeg(): number | null {
    const cam = this.scene.activeCamera;
    if (!cam) return null;
    const fwd = cam.getForwardRay().direction;
    if (Math.hypot(fwd.x, fwd.z) < 1e-4) return null;
    const deg = (Math.atan2(fwd.x, fwd.z) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  dispose(): void {
    // Idempotent: both React unmount AND the pagehide safety net can call
    // this, and pagehide can even fire mid-unmount — a double dispose()
    // otherwise double-frees Babylon resources (throws) or, worse, tears down
    // a freshly-created NEXT scene if calls interleave.
    if (this.disposed) return;
    this.disposed = true;
    this.sun.dispose();   // stops the ?skySpeed timer, if one is running

    window.removeEventListener("resize", this.handleResize);
    this.resizeObserver?.disconnect();
    // Observes <html>, which outlives this scene — an undisconnected observer
    // would keep a disposed SceneManager (and its whole scene graph) alive.
    this.themeObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("pagehide", this.handlePageHide);
    window.removeEventListener("pageshow", this.handlePageShow);
    this.engine.stopRenderLoop(); // stop first — no frames render during teardown

    // Subsystems own DOM listeners / timers / GUI textures that scene.dispose()
    // does not necessarily reclaim — dispose each explicitly. (visuals holds a
    // fullscreen GUI AdvancedDynamicTexture + per-entity lights/shadow maps;
    // camera/overview hold canvas pointer/key listeners.)
    this.renderFx.dispose();
    this.sky.dispose();
    this.nightSky.dispose();
    this.camera.dispose();
    this.overview.dispose();
    this.visuals.dispose();

    // Drop the module-level LightPools gradient cache so it can't hand the
    // NEXT scene a texture belonging to this now-disposed one (the getScene()
    // guard already regenerates, but this also frees the reference for GC).
    resetLightPoolTextureCache();

    // Holds observers on the scene's own observables — released before the
    // scene goes, so nothing keeps a disposed scene reachable.
    this.instrumentation?.dispose();
    this.instrumentation = null;

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

    // Everything above is a correct teardown, and the heap still does not come
    // back: a remount (each model upload changes Dashboard's `modelKey`) costs
    // ~95MB that is never returned, six of them reach ~950MB, and the iPad this
    // targets would be killed well before that. leakWatch is now measuring
    // WHICH object graph survives; this is the half that does not need to know.
    //
    // A reference we failed to find retains this manager, not the villa — the
    // villa hangs off these fields. So drop them all, and a retained manager
    // becomes an empty shell instead of the anchor for the whole scene.
    this.loadedMeshes = [];
    this.highlightedMeshes = [];
    this.calibratedPoints = null;
    this.lastNavigatedRoom = null;
    this.lastRoomPolyNames.clear();
    this.frameSamples = [];
    this.renderSamples = [];
    // Callbacks registered by React components — a ready/calibrate handler
    // closes over the component that registered it, so an uncleared set keeps
    // that component's whole closure scope alive too.
    this.readyCallbacks.clear();
    this.calibrateCallbacks.clear();

    // ── AND THE SUBSYSTEMS, THE SCENE AND THE ENGINE ────────────────────
    // 2.231.0 stopped at the arrays above and claimed the result was "a few
    // hundred bytes". It is not: a field heap snapshot priced three retained
    // managers at 36.8 / 35.1 / 35.0 MB — about 107 MB of a 454 MB heap, which
    // is the ~95 MB-per-reload floor that has never come back. The arrays were
    // never where the weight was. `scene` is, and every subsystem below holds
    // it too, so all of them have to go or the shell is not a shell.
    //
    // ── The cost, stated plainly ────────────────────────────────────────
    // `readonly` is a compile-time contract for CALLERS; it does not stop the
    // owner writing the field, and the cast below is what says so out loud.
    // After this, calling ANY method on a disposed manager throws a TypeError
    // instead of quietly half-working. That is the accepted risk, and it is
    // not covered by a blanket guard: only eight sites test `this.disposed`,
    // so "every public method guards on it" — as an earlier version of this
    // comment claimed — is FALSE. What makes it survivable is that nothing
    // holds a live handle to a disposed manager by design: BabylonCanvas nulls
    // both its ref and React's state in the same teardown, the window and
    // document listeners are gone, the render loop is stopped, and
    // `scene.dispose()` has already cleared onPointerObservable (scene.js:4310)
    // so no input can arrive either. A call reaching here was already a bug;
    // it will now be a loud one rather than a silent one.
    //
    // Mapped over `keyof SceneManager` rather than a list of strings, so
    // renaming a field is a compile error here instead of a silently missed
    // reference that quietly restores the leak.
    const shell = this as unknown as {
      -readonly [K in keyof SceneManager]: SceneManager[K] | null;
    };
    shell.engine = null;
    shell.scene = null;
    shell.camera = null;
    shell.overview = null;
    shell.lighting = null;
    shell.sun = null;
    shell.sky = null;
    shell.floors = null;
    shell.pick = null;
    shell.visuals = null;
    shell.renderFx = null;
    // Private, and mutable already — no cast needed, but the same reasoning.
    // `canvas` is a DOM element React has just detached: holding it here is a
    // detached-DOM leak on top of the scene one.
    this.nightSky = null as unknown as NightSky;
    this.hemi = null as unknown as HemisphericLight;
    this.config = null as unknown as AppConfig;
    (this as unknown as { canvas: HTMLCanvasElement | null }).canvas = null;
    this.resizeObserver = null;
    this.themeObserver = null;
  }
}
