// src/babylon/RoomHighlight.ts
// A translucent floor-glow overlay per room, toggled on while a physical
// motion/presence sensor whose Config Editor "Room" field matches that room is
// triggered. Unlike a camera (which watches a direction, not a room — see
// CameraBeam-equivalent logic in EntityVisuals), a PIR/occupancy sensor has no
// meaningful facing direction of its own, so "highlight the room it's in" is
// the natural signal instead of a directional beam.
//
// Two sources feed the same glow, because "room" means two different things
// in this app:
//   - setRooms(): real sh3d ROOM POLYGONS (SceneManager.calibrateRooms) — an
//     actual drawn shape, so the glow traces its real outline.
//   - setPointRooms(): named TeleportMenu "Rooms" (config.teleportPoints) that
//     a user added by walking somewhere and tapping "Add room here" — e.g. a
//     staircase landing that was never drawn as an enclosed room polygon in
//     SweetHome. These are a single point + facing direction, no area, so we
//     draw a small synthetic circular patch there instead. A name covered by
//     a real polygon always wins — no redundant circle on top of a real room.

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { clipPolygonToConvex, earClipTriangulate, pointInPolygon, regularPolygon, type Pt2 } from "@/utils/geometry";
import type { FloorProbe } from "./floorProbe";
import { roomKey } from "@/config/roomKey";
import { onStorey, storeyFloorYAt } from "./roomStorey";
import { ALERT_RED } from "./colors";

// Same red as a running climate device's mesh outline / the badge alert ring
// — see colors.ts. Was its own slightly-off Color3 before.
const GLOW_COLOR = ALERT_RED;
// The alert ring on a badge is a flat, fully-opaque 2D stroke — it always
// reads as a vivid, saturated red. This glow is a translucent 3D overlay
// blended with the floor beneath it, so it can never look pixel-identical,
// but it should still clearly read as RED rather than a pale wash. 0.28/0.5
// (still used further below) made the glow visibly duller than intended.
const BASE_ALPHA = 0.5;
const PULSE_ALPHA = 0.75;
/** Glow pulse speed (rad/s). Was a fixed +0.05 per FRAME, which silently tied
 *  the pulse rate to the display's refresh rate and to whatever cadence the
 *  render loop happened to be running at — so the same highlight breathed at
 *  half speed the moment continuous animation became rate-capped (and at
 *  double on a 120Hz panel). 3.0 rad/s reproduces the original 60fps look. */
const PULSE_RAD_PER_SEC = 3.0;
// Sits just above the recentred floor (y≈0 after SceneManager.recenterModel)
// so it doesn't z-fight with the actual floor mesh underneath it.
const FLOOR_Y_OFFSET = 0.02;
// Radius of the synthetic patch drawn for a point-only "room" (no real
// polygon) — a small landing/nook-sized area, not a whole room's worth. Used
// both as the flat-circle fallback's radius and the decal footprint's size.
const POINT_ROOM_RADIUS = 1.1;
const POINT_ROOM_SEGMENTS = 16;
// How far above the anchor's estimated floor level to start looking for real
// geometry to drape the glow over, and how far down to look for it. Generous
// enough to clear a single flight of stairs (whose treads sit above the
// landing the anchor was probably set from) without reaching into the floor
// below on a multi-storey villa.
const DECAL_PROBE_ABOVE = 3;
const DECAL_PROBE_DEPTH = 8;
// Depth of the decal's clipping box along the hit surface's normal — needs to
// be deep enough to also catch a staircase's riser/tread steps near the
// anchor, not just the single triangle directly under it.
const DECAL_DEPTH = 2.5;
/** A point-room anchor's floorY IS a floor, and storeyFloorYAt asks for a floor
 *  a usable distance BELOW the point it is given — so testing with the raw
 *  value would step down a storey. Lifted by an eye's worth, which is what that
 *  clearance is built around (see roomStorey.ts). */
const STOREY_TEST_LIFT = 1.6;

interface RoomEntry {
  mesh: Mesh;
  material: StandardMaterial;
}

export class RoomHighlight {
  private scene: Scene;
  private requestRender: () => void;
  private requestAnimationRender: () => void;
  /** Keyed by normalised (trimmed, lowercased) room name. Two separate maps
   *  so a full re-poly (rare: load + mirror toggle) and a point-rooms refresh
   *  (whenever config.teleportPoints changes — much more frequent) don't
   *  dispose each other's meshes. */
  private polyRooms = new Map<string, RoomEntry>();
  private pointRooms = new Map<string, RoomEntry>();
  private active = new Set<string>();
  private pulseT = 0;
  /** performance.now() of the last glow step — see animate(). */
  private lastTickAt = 0;

  /** The room polygons `setRooms` last received, kept ONLY so a point-room's
   *  synthetic circle can be clipped to whichever room contains it — same fix,
   *  same reason, as the light pool's (see setPointRooms). Not a second source
   *  of truth: it is overwritten wholesale on every re-fit, from the same
   *  argument the meshes are built from. */
  private roomShapes: { pts: Pt2[]; floorY: number }[] = [];

  constructor(
    scene: Scene,
    requestRender: () => void,
    /** Shared with EntityVisuals and SceneManager — see floorProbe.ts. Was
     *  three private raycasts with three predicates before 2.300.0. */
    private probe: FloorProbe,
    /** Rate-capped re-arm for the glow PULSE specifically — a highlight can
     *  stay up indefinitely (a room flagged for overdue maintenance is the
     *  normal case), so its pulse is a permanent animation, not a transition.
     *  Falls back to requestRender when not supplied. */
    requestAnimationRender?: () => void,
  ) {
    this.scene = scene;
    this.requestRender = requestRender;
    this.requestAnimationRender = requestAnimationRender ?? requestRender;
    scene.registerBeforeRender(() => this.animate());
  }

  private static normalise(name: string): string {
    return roomKey(name);
  }

  /** Shared "glowing glass" material every glow mesh (flat polygon, flat
   *  circle, or decal) is painted with. `zOffset` only matters for a decal —
   *  it hugs a real surface, so without a small pull toward the camera it
   *  z-fights with the mesh it's projected onto. */
  private makeGlowMaterial(key: string, isDecal: boolean): StandardMaterial {
    const material = new StandardMaterial(`roomGlowMat_${key}`, this.scene);
    material.disableLighting = true;
    // Full-intensity emissive colour — translucency comes ONLY from
    // material.alpha (animate()), not from also dimming the colour itself.
    // Scaling emissiveColor by BASE_ALPHA on top of the alpha blend was a
    // double dilution that made the glow read as a dull, washed-out red
    // instead of the same red as the climate outline / badge alert ring.
    material.emissiveColor = GLOW_COLOR;
    material.alpha = 0;
    material.backFaceCulling = false;
    if (isDecal) material.zOffset = -2;
    return material;
  }

  private buildMesh(key: string, pts: Pt2[], y: number): RoomEntry | null {
    if (pts.length < 3) return null;
    const tris = earClipTriangulate(pts);
    if (tris.length === 0) return null;

    const positions: number[] = [];
    for (const p of pts) positions.push(p.x, y, p.z);
    const indices: number[] = [];
    for (const [a, b, c] of tris) indices.push(a, b, c);
    // Both winding directions so the glow reads from any camera angle
    // (overview looks straight down, first-person can graze it at an angle).
    for (const [a, b, c] of tris) indices.push(c, b, a);

    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);

    const mesh = new Mesh(`roomGlow_${key}`, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.applyToMesh(mesh);

    const material = this.makeGlowMaterial(key, false);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.metadata = { isMarker: true }; // exclude from shadow casters/IBL surfaces, same as markers

    return { mesh, material };
  }

  /**
   * A point-room's glow projected onto whatever real geometry is actually
   * there (Babylon decal — conforms to the target mesh's surface instead of
   * sitting at one flat height), so it drapes over a sloped/stepped asset
   * like a staircase instead of floating at a single Y and poking out from
   * underneath it. Probes straight down from above the anchor's estimated
   * floor level; returns null (caller falls back to the flat circle) if
   * nothing sensible is hit or the decal comes out empty (e.g. the hit
   * surface is too thin/oddly-shaped for a clean projection).
   */
  private buildDecal(key: string, x: number, z: number, floorY: number): RoomEntry | null {
    const hit = this.probe.surfaceUnder(
      x, z, floorY + DECAL_PROBE_ABOVE, DECAL_PROBE_ABOVE + DECAL_PROBE_DEPTH);
    if (!hit?.pickedMesh || !hit.pickedPoint) return null;

    try {
      const mesh = MeshBuilder.CreateDecal(`roomGlowDecal_${key}`, hit.pickedMesh, {
        position: hit.pickedPoint,
        normal: hit.getNormal(true) ?? Vector3.Up(),
        size: new Vector3(POINT_ROOM_RADIUS * 2.2, POINT_ROOM_RADIUS * 2.2, DECAL_DEPTH),
      });
      if (mesh.getTotalVertices() === 0) {
        mesh.dispose();
        return null;
      }
      const material = this.makeGlowMaterial(key, true);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.metadata = { isMarker: true };
      return { mesh, material };
    } catch {
      // Decals have real limitations (e.g. no morph-target meshes) — fall
      // back to the flat circle rather than let a rare bad case crash setup.
      return null;
    }
  }

  /** (Re)build one floor mesh per REAL room polygon. Called every time
   *  SceneManager re-fits the plan→world transform (load + mirror toggles).
   *  `floorY` is resolved by the caller (SceneManager, via FloorManager's
   *  per-storey mesh list) rather than probed here with a scene raycast:
   *  Babylon's picking skips `setEnabled(false)` meshes, and FloorManager
   *  hides every storey except the one currently being viewed — a raycast
   *  run here could miss the very floor a room lives on, depending on
   *  whatever floor happened to be active at calibration time. Defaults to
   *  ground level (FLOOR_Y_OFFSET) when the caller has nothing better —
   *  single-storey models, or a model too old for FloorManager's per-mesh
   *  floorIndex stamp. This is also what fixed "a 2F room's red highlight
   *  shows on the ground floor": every room used to render at this same
   *  fixed ground-level Y regardless of its real storey.
   */
  setRooms(polys: { name: string; pts: Pt2[]; floorY?: number; conform?: { positions: number[]; indices: number[] } }[]): void {
    this.disposeMap(this.polyRooms);
    this.roomShapes = polys.filter((p) => p.pts.length >= 3)
      .map((p) => ({ pts: p.pts, floorY: p.floorY ?? 0 }));
    for (const room of polys) {
      const key = RoomHighlight.normalise(room.name);
      // A stepped room (staircase) ships a surface-hugging vertex mesh from
      // SceneManager.buildRoomConform; a flat room just gets its polygon patch.
      const entry = room.conform
        ? this.buildConformMesh(key, room.conform.positions, room.conform.indices)
        : this.buildMesh(key, room.pts, (room.floorY ?? 0) + FLOOR_Y_OFFSET);
      if (entry) this.polyRooms.set(key, entry);
    }
  }

  /** Build a glow mesh directly from pre-sampled vertex data that already
   *  follows the real surface (stair treads) — see SceneManager.buildRoomConform.
   *  Same "glowing glass" material and marker exclusion as the flat polygon. */
  private buildConformMesh(key: string, positions: number[], indices: number[]): RoomEntry | null {
    if (positions.length < 9 || indices.length < 3) return null;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const mesh = new Mesh(`roomGlow_${key}`, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.applyToMesh(mesh);
    const material = this.makeGlowMaterial(key, false);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.metadata = { isMarker: true };
    return { mesh, material };
  }

  /** (Re)build a synthetic glow for each named TeleportMenu point that ISN'T
   *  already covered by a real room polygon — e.g. a staircase landing added
   *  via "Add room here" that was never drawn as an enclosed room in
   *  SweetHome. Called on load/recalibration AND live whenever
   *  config.teleportPoints changes (adding a room shouldn't need a full
   *  model reload to start glowing).
   *
   *  Prefers draping a decal over whatever's really there (see buildDecal);
   *  falls back to a flat circle at the anchor's estimated local floor
   *  height (SceneManager derives it from the anchor's stored camera Y minus
   *  eye height — a staircase landing sits well above the global recentred
   *  floor, so this can't use the flat 0-height real room polygons use) when
   *  the probe finds nothing to project onto. */
  setPointRooms(points: { name: string; x: number; z: number; floorY: number }[]): void {
    this.disposeMap(this.pointRooms);
    for (const p of points) {
      const key = RoomHighlight.normalise(p.name);
      if (this.polyRooms.has(key)) continue; // a real room polygon always wins
      const entry =
        this.buildDecal(key, p.x, p.z, p.floorY) ??
        this.buildMesh(key, this.pointRoomShape(p.x, p.z, p.floorY), p.floorY + FLOOR_Y_OFFSET);
      if (entry) this.pointRooms.set(key, entry);
    }
  }

  /**
   * The flat-circle fallback's outline, clipped to whichever real room contains
   * it. A horizontal circle passes straight through the base of a vertical
   * wall, so a landing sitting within POINT_ROOM_RADIUS of one painted its glow
   * on BOTH sides — the identical defect the light pool had, in the second
   * place a flat floor marker is drawn (see EntityVisuals.reshapeLightPools).
   *
   * Circle = the convex CLIP, room = the possibly-L-shaped SUBJECT; that order
   * is what makes the clip correct (see clipPolygonToConvex). Unclipped when
   * the point belongs to no room polygon at all, which is the common case for a
   * landing added via "Add room here" precisely because nothing was drawn there
   * — there is then no wall known to cross.
   */
  private pointRoomShape(x: number, z: number, floorY: number): Pt2[] {
    const circle = regularPolygon(x, z, POINT_ROOM_RADIUS, POINT_ROOM_SEGMENTS);
    // ON THE LANDING'S OWN STOREY (2.437.0). Room outlines are flat and the
    // upper storey's lie over the lower one's, so a bare containment test
    // clipped a 2F landing's glow to the outline of a ground-floor room — the
    // third reader of this rule, found by rolling it out across what it APPLIES
    // to rather than where it was reported. A point-room anchor is a CAMERA
    // pose's floor height, already a floor rather than an eye, so it is offered
    // an eye's worth of clearance to be tested at.
    const storeyY = storeyFloorYAt(this.roomShapes, floorY + STOREY_TEST_LIFT);
    const room = this.roomShapes.find(
      (r) => onStorey(r.floorY, storeyY) && pointInPolygon(x, z, r.pts));
    if (!room) return circle;
    const clipped = clipPolygonToConvex(room.pts, circle);
    return clipped.length >= 3 ? clipped : circle;
  }

  /** Turn a room's glow on/off by name (matched against the entity's "Room"
   *  Config Editor field — case/whitespace-insensitive). No-op if the name
   *  doesn't match any calibrated room or named viewpoint (e.g. an outdoor
   *  sensor with no Room set). */
  setActive(roomName: string, on: boolean): void {
    const key = RoomHighlight.normalise(roomName);
    const entry = this.polyRooms.get(key) ?? this.pointRooms.get(key);
    if (!entry) return;
    if (on) this.active.add(key);
    else this.active.delete(key);
    if (!on) entry.material.alpha = 0;
    this.requestRender();
  }

  /** Whether a name matches a calibrated room or named viewpoint (lets
   *  callers skip work for sensors whose room doesn't correspond to either). */
  hasRoom(roomName: string): boolean {
    const key = RoomHighlight.normalise(roomName);
    return this.polyRooms.has(key) || this.pointRooms.has(key);
  }

  private animate(): void {
    if (this.active.size === 0) return;
    // Real elapsed time between glow steps, NOT engine.getDeltaTime(): that
    // is set once per requestAnimationFrame tick regardless of whether the
    // frame rendered, so under the continuous-animation frame cap it reports
    // half the time that actually passed and the glow breathes at half speed.
    // Clamped because the on-demand loop can idle for seconds, and a raw delta
    // after such a gap would make the glow jump.
    const now = performance.now();
    const dtMs = this.lastTickAt ? Math.min(now - this.lastTickAt, 100) : 16;
    this.lastTickAt = now;
    this.pulseT += (dtMs / 1000) * PULSE_RAD_PER_SEC;
    const t = (Math.sin(this.pulseT) + 1) / 2; // 0..1
    const alpha = BASE_ALPHA + (PULSE_ALPHA - BASE_ALPHA) * t;
    for (const key of this.active) {
      const entry = this.polyRooms.get(key) ?? this.pointRooms.get(key);
      if (entry) entry.material.alpha = alpha;
    }
    this.requestAnimationRender();
  }

  private disposeMap(map: Map<string, RoomEntry>): void {
    for (const key of [...map.keys()]) {
      const { mesh, material } = map.get(key)!;
      mesh.dispose();
      material.dispose();
      map.delete(key);
      this.active.delete(key);
    }
  }

  dispose(): void {
    this.disposeMap(this.polyRooms);
    this.disposeMap(this.pointRooms);
  }
}
