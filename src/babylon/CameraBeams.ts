// src/babylon/CameraBeams.ts
// Camera motion-detection beams, extracted from EntityVisuals so beam mesh
// lifecycle lives in one place (same pattern as RoomHighlight).
//
// A simulated "diffused red light beam" pointing the way a camera prop was
// rotated in SweetHome 3D (see sh3dParser's `angle`), toggled by that
// camera's linked motion binary_sensor (EntityMapping.motionEntityId). It is
// a translucent unlit cone, not a real light — no shadow map, no surface
// interaction — matching how MarkerManager's marker orbs are built. A camera
// only has a flat plan-rotation (no elevation/tilt data), so the beam is
// always horizontal; that's an honest simplification, not a bug.

import {
  Color3, Matrix, MeshBuilder, Quaternion, Ray, StandardMaterial, Vector3,
  type AbstractMesh, type Mesh, type Scene,
} from "@babylonjs/core";

const BEAM_COLOR = new Color3(0.95, 0.15, 0.12);
const BEAM_TIP_DIAMETER = 0.08;
const BEAM_END_DIAMETER = 1.6;
// How far the beam reaches before being clipped by a single raycast against
// the villa's structural meshes at build time (walls, furniture — anything
// that isn't a bound entity). Cameras aimed at open outdoor space use the
// full length; ones aimed into a room stop at the wall.
const BEAM_MAX_LENGTH = 6;
const BEAM_BASE_ALPHA = 0.16;
const BEAM_PULSE_ALPHA = 0.4;

export interface BeamSource {
  entityId: string;
  /** World-space beam origin (the camera asset's centre). */
  origin: Vector3;
  /** Horizontal unit facing direction. */
  direction: Vector3;
}

export class CameraBeams {
  private scene: Scene;
  private beams = new Map<string, { mesh: Mesh; material: StandardMaterial }>();
  /** Camera entity_ids whose beam is currently pulsing (motion detected). */
  private active = new Set<string>();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Rebuild one cone per source. Length is clipped by a single raycast
   *  against the given structural meshes so it stops at the near wall
   *  instead of poking through it forever. */
  rebuild(sources: BeamSource[], occluders: ReadonlySet<AbstractMesh>): void {
    this.dispose();

    for (const { entityId, origin, direction } of sources) {
      const ray = new Ray(origin.add(direction.scale(0.15)), direction, BEAM_MAX_LENGTH);
      const hit = this.scene.pickWithRay(ray, (m) => occluders.has(m));
      const length = hit?.hit && hit.distance > 0.3 ? hit.distance * 0.95 : BEAM_MAX_LENGTH;

      const mesh = MeshBuilder.CreateCylinder(`beam_${entityId}`, {
        diameterTop: BEAM_END_DIAMETER, diameterBottom: BEAM_TIP_DIAMETER,
        height: length, tessellation: 14,
      }, this.scene);
      // Re-pivot from "centred on Y" (Babylon's default) to "narrow tip at the
      // origin", so positioning the mesh at the camera puts the TIP there,
      // not the middle of the cone.
      mesh.bakeTransformIntoVertices(Matrix.Translation(0, length / 2, 0));
      const rot = new Quaternion();
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction, rot);
      mesh.rotationQuaternion = rot;
      mesh.position = origin.clone();

      const material = new StandardMaterial(`beamMat_${entityId}`, this.scene);
      material.disableLighting = true;
      material.emissiveColor = BEAM_COLOR;
      material.alpha = 0;
      material.backFaceCulling = false;
      mesh.material = material;
      mesh.isPickable = false;
      mesh.metadata = { isMarker: true }; // exclude from shadow casters/IBL, like markers

      this.beams.set(entityId, { mesh, material });
    }
  }

  has(entityId: string): boolean {
    return this.beams.has(entityId);
  }

  /** Turn a camera's beam on/off (driven by its linked motion sensor state). */
  setActive(entityId: string, on: boolean): void {
    if (!this.beams.has(entityId)) return;
    if (on) {
      this.active.add(entityId);
    } else {
      this.active.delete(entityId);
      const b = this.beams.get(entityId);
      if (b) b.material.alpha = 0;
    }
  }

  hasActive(): boolean {
    return this.active.size > 0;
  }

  /** Drive the active beams' pulse from a 0..1 intensity (shared with the
   *  binary_sensor emissive pulse so the two breathe in sync). */
  applyPulse(intensity: number): void {
    if (this.active.size === 0) return;
    const alpha = BEAM_BASE_ALPHA + (BEAM_PULSE_ALPHA - BEAM_BASE_ALPHA) * intensity;
    for (const id of this.active) {
      const b = this.beams.get(id);
      if (b) b.material.alpha = alpha;
    }
  }

  dispose(): void {
    for (const { mesh, material } of this.beams.values()) { mesh.dispose(); material.dispose(); }
    this.beams.clear();
    this.active.clear();
  }
}
