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

import {
  Mesh, VertexData, StandardMaterial, Color3, Vector3, Ray, MeshBuilder,
  type Scene,
} from "@babylonjs/core";
import { earClipTriangulate, type Pt2 } from "@/utils/geometry";

const GLOW_COLOR = new Color3(0.95, 0.25, 0.2);
const BASE_ALPHA = 0.28;
const PULSE_ALPHA = 0.5;
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

interface RoomEntry {
  mesh: Mesh;
  material: StandardMaterial;
}

export class RoomHighlight {
  private scene: Scene;
  private requestRender: () => void;
  /** Keyed by normalised (trimmed, lowercased) room name. Two separate maps
   *  so a full re-poly (rare: load + mirror toggle) and a point-rooms refresh
   *  (whenever config.teleportPoints changes — much more frequent) don't
   *  dispose each other's meshes. */
  private polyRooms = new Map<string, RoomEntry>();
  private pointRooms = new Map<string, RoomEntry>();
  private active = new Set<string>();
  private pulseT = 0;

  constructor(scene: Scene, requestRender: () => void) {
    this.scene = scene;
    this.requestRender = requestRender;
    scene.registerBeforeRender(() => this.animate());
  }

  private static normalise(name: string): string {
    return name.trim().toLowerCase();
  }

  /** Shared "glowing glass" material every glow mesh (flat polygon, flat
   *  circle, or decal) is painted with. `zOffset` only matters for a decal —
   *  it hugs a real surface, so without a small pull toward the camera it
   *  z-fights with the mesh it's projected onto. */
  private makeGlowMaterial(key: string, isDecal: boolean): StandardMaterial {
    const material = new StandardMaterial(`roomGlowMat_${key}`, this.scene);
    material.disableLighting = true;
    material.emissiveColor = GLOW_COLOR.scale(BASE_ALPHA);
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
    const from = new Vector3(x, floorY + DECAL_PROBE_ABOVE, z);
    const hit = this.scene.pickWithRay(
      new Ray(from, Vector3.Down(), DECAL_PROBE_ABOVE + DECAL_PROBE_DEPTH),
      (m) => m.isPickable && m.isVisible && !m.metadata?.isMarker,
    );
    if (!hit?.hit || !hit.pickedMesh || !hit.pickedPoint) return null;

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
   *  SceneManager re-fits the plan→world transform (load + mirror toggles). */
  setRooms(polys: { name: string; pts: Pt2[] }[]): void {
    this.disposeMap(this.polyRooms);
    for (const room of polys) {
      const key = RoomHighlight.normalise(room.name);
      const entry = this.buildMesh(key, room.pts, FLOOR_Y_OFFSET);
      if (entry) this.polyRooms.set(key, entry);
    }
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
        this.buildMesh(
          key,
          Array.from({ length: POINT_ROOM_SEGMENTS }, (_, i) => {
            const a = (i / POINT_ROOM_SEGMENTS) * Math.PI * 2;
            return { x: p.x + Math.cos(a) * POINT_ROOM_RADIUS, z: p.z + Math.sin(a) * POINT_ROOM_RADIUS };
          }),
          p.floorY + FLOOR_Y_OFFSET,
        );
      if (entry) this.pointRooms.set(key, entry);
    }
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
    this.pulseT += 0.05;
    const t = (Math.sin(this.pulseT) + 1) / 2; // 0..1
    const alpha = BASE_ALPHA + (PULSE_ALPHA - BASE_ALPHA) * t;
    for (const key of this.active) {
      const entry = this.polyRooms.get(key) ?? this.pointRooms.get(key);
      if (entry) entry.material.alpha = alpha;
    }
    this.requestRender();
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
