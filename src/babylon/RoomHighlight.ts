// src/babylon/RoomHighlight.ts
// A translucent floor-glow overlay per room, toggled on while a physical
// motion/presence sensor whose Config Editor "Room" field matches that room is
// triggered. Unlike a camera (which watches a direction, not a room — see
// CameraBeam-equivalent logic in EntityVisuals), a PIR/occupancy sensor has no
// meaningful facing direction of its own, so "highlight the room it's in" is
// the natural signal instead of a directional beam.
//
// Built from the SAME world-space room polygons SceneManager already fits for
// the teleport grid / room labels (see SceneManager.calibrateRooms), so no new
// calibration step is needed — just a mesh per polygon instead of a label.

import {
  Mesh, VertexData, StandardMaterial, Color3,
  type Scene,
} from "@babylonjs/core";
import { earClipTriangulate, type Pt2 } from "@/utils/geometry";

const GLOW_COLOR = new Color3(0.95, 0.25, 0.2);
const BASE_ALPHA = 0.28;
const PULSE_ALPHA = 0.5;
// Sits just above the recentred floor (y≈0 after SceneManager.recenterModel)
// so it doesn't z-fight with the actual floor mesh underneath it.
const FLOOR_Y_OFFSET = 0.02;

interface RoomEntry {
  mesh: Mesh;
  material: StandardMaterial;
}

export class RoomHighlight {
  private scene: Scene;
  private requestRender: () => void;
  /** Keyed by normalised (trimmed, lowercased) room name. */
  private rooms = new Map<string, RoomEntry>();
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

  /** (Re)build one floor mesh per room polygon. Called every time
   *  SceneManager re-fits the plan→world transform (load + mirror toggles). */
  setRooms(polys: { name: string; pts: Pt2[] }[]): void {
    this.dispose();
    for (const room of polys) {
      if (room.pts.length < 3) continue;
      const tris = earClipTriangulate(room.pts);
      if (tris.length === 0) continue;

      const positions: number[] = [];
      for (const p of room.pts) positions.push(p.x, FLOOR_Y_OFFSET, p.z);
      const indices: number[] = [];
      for (const [a, b, c] of tris) indices.push(a, b, c);
      // Both winding directions so the glow reads from any camera angle
      // (overview looks straight down, first-person can graze it at an angle).
      for (const [a, b, c] of tris) indices.push(c, b, a);

      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);

      const mesh = new Mesh(`roomGlow_${room.name}`, this.scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.indices = indices;
      vd.normals = normals;
      vd.applyToMesh(mesh);

      const material = new StandardMaterial(`roomGlowMat_${room.name}`, this.scene);
      material.disableLighting = true;
      material.emissiveColor = GLOW_COLOR.scale(BASE_ALPHA);
      material.alpha = 0;
      material.backFaceCulling = false;
      mesh.material = material;
      mesh.isPickable = false;
      mesh.metadata = { isMarker: true }; // exclude from shadow casters/IBL surfaces, same as markers

      this.rooms.set(RoomHighlight.normalise(room.name), { mesh, material });
    }
  }

  /** Turn a room's glow on/off by name (matched against the entity's "Room"
   *  Config Editor field — case/whitespace-insensitive). No-op if the name
   *  doesn't match any calibrated room (e.g. an outdoor sensor). */
  setActive(roomName: string, on: boolean): void {
    const key = RoomHighlight.normalise(roomName);
    if (!this.rooms.has(key)) return;
    if (on) this.active.add(key);
    else this.active.delete(key);
    if (!on) {
      const entry = this.rooms.get(key);
      if (entry) entry.material.alpha = 0;
    }
    this.requestRender();
  }

  /** Whether a name matches a calibrated room (lets callers skip work for
   *  sensors whose room doesn't correspond to any known polygon). */
  hasRoom(roomName: string): boolean {
    return this.rooms.has(RoomHighlight.normalise(roomName));
  }

  private animate(): void {
    if (this.active.size === 0) return;
    this.pulseT += 0.05;
    const t = (Math.sin(this.pulseT) + 1) / 2; // 0..1
    const alpha = BASE_ALPHA + (PULSE_ALPHA - BASE_ALPHA) * t;
    for (const key of this.active) {
      const entry = this.rooms.get(key);
      if (entry) entry.material.alpha = alpha;
    }
    this.requestRender();
  }

  dispose(): void {
    for (const { mesh, material } of this.rooms.values()) {
      mesh.dispose();
      material.dispose();
    }
    this.rooms.clear();
    this.active.clear();
  }
}
