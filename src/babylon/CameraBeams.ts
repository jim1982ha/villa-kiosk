// src/babylon/CameraBeams.ts
// Camera motion-detection beams, extracted from EntityVisuals so beam mesh
// lifecycle lives in one place (same pattern as RoomHighlight).
//
// A simulated "diffused red light beam" pointing the way a camera prop was
// rotated AND tilted in SweetHome 3D (see sh3dParser's `angle` for yaw and
// `pitch` for tilt), toggled by that camera's linked motion binary_sensor
// (EntityMapping.linkedEntityId). It is a translucent unlit cone, not a real
// light — no shadow map, no surface interaction.

import {
  Color3, MeshBuilder, Quaternion, Ray, StandardMaterial, Vector3,
  type AbstractMesh, type Mesh, type Scene,
} from "@babylonjs/core";

const BEAM_COLOR = new Color3(0.95, 0.15, 0.12);
// A short, wide "spotlight" cone — user feedback (2026-07-03) was that the
// original 6m/1.6m combo read as a long thin streak reaching across multiple
// rooms, not a beam coming OUT of the camera. Roughly halving the length and
// nearly doubling the end diameter makes the cone's spread angle much wider
// for a given reach (before: (1.6/2)/6 ≈ 7.6° half-angle; now: (3.0/2)/3 = 30°
// half-angle) — reads as a stubby wide-angle spotlight instead of a laser.
// These two constants define the beam's fixed SPREAD ANGLE (see BEAM_HALF_ANGLE
// below); actual on-screen length/width both scale down together in a small
// room so the cone always looks proportional, never a fixed-size wedge jammed
// into whatever space is available.
const BEAM_END_DIAMETER = 3.0;
const BEAM_MAX_LENGTH = 3;
const BEAM_HALF_ANGLE = Math.atan((BEAM_END_DIAMETER / 2) / BEAM_MAX_LENGTH);
const BEAM_BASE_ALPHA = 0.16;
const BEAM_PULSE_ALPHA = 0.4;
// Edge rays sampled around the cone's surface (see clippedLength below) —
// more samples catch corner walls more reliably, at a small one-time raycast
// cost per beam rebuild (rebuilds only happen on room re-calibration, not
// every frame).
const EDGE_RAY_SAMPLES = 8;
// Where along the profile the cone finishes widening and starts rounding
// into a soft dome instead of a hard flat disc (see roundedProfile below).
const ROUND_CAP_FRACTION = 0.88;
const PROFILE_POINTS = 14;

export interface BeamSource {
  entityId: string;
  /** World-space beam origin (the camera asset's centre). */
  origin: Vector3;
  /** World-space unit facing direction — may include a vertical component
   *  from the camera's authored tilt (pitch), not just horizontal yaw. */
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

  /** How far this beam can reach before its WIDENING SURFACE (not just its
   *  centreline) would poke through a nearby wall. A single centreline
   *  raycast (the old approach) only ever clipped the beam's LENGTH — in a
   *  narrow room the cone's far end is often wider than the room itself, so
   *  its sides visibly poked through the side walls into the next room even
   *  though the tip-to-far-end axis correctly stopped short of the far wall.
   *  Fix: cast several rays from the SAME origin (the cone's apex) at exactly
   *  BEAM_HALF_ANGLE off-axis, evenly spaced around the cone — a ray from a
   *  cone's apex at its half-angle traces exactly along the cone's outer
   *  surface, so this is a correct (not approximate) test of where that
   *  surface first meets a wall in each sampled direction, not a fudge. The
   *  shortest hit across the centreline + all edge samples is the reach the
   *  WHOLE cone can safely have without any part crossing a wall. */
  private clippedLength(origin: Vector3, direction: Vector3, occluders: ReadonlySet<AbstractMesh>): number {
    const predicate = (m: AbstractMesh) => occluders.has(m);
    const centreHit = this.scene.pickWithRay(
      new Ray(origin.add(direction.scale(0.15)), direction, BEAM_MAX_LENGTH), predicate);
    let axialLen = centreHit?.hit && centreHit.distance > 0.3 ? centreHit.distance : BEAM_MAX_LENGTH;

    // Orthonormal basis perpendicular to `direction`, for sampling directions
    // spaced around the cone's circumference.
    const helper = Math.abs(Vector3.Dot(direction, Vector3.Up())) > 0.99 ? Vector3.Right() : Vector3.Up();
    const right = Vector3.Cross(direction, helper).normalize();
    const up = Vector3.Cross(right, direction).normalize();

    const cosHalf = Math.cos(BEAM_HALF_ANGLE);
    const sinHalf = Math.sin(BEAM_HALF_ANGLE);
    const edgeMaxDist = BEAM_MAX_LENGTH / cosHalf; // ray length for a full-reach edge ray
    for (let i = 0; i < EDGE_RAY_SAMPLES; i++) {
      const theta = (i / EDGE_RAY_SAMPLES) * Math.PI * 2;
      const edgeDir = direction.scale(cosHalf)
        .add(right.scale(sinHalf * Math.cos(theta)))
        .add(up.scale(sinHalf * Math.sin(theta)))
        .normalize();
      const hit = this.scene.pickWithRay(
        new Ray(origin.add(edgeDir.scale(0.15)), edgeDir, edgeMaxDist), predicate);
      if (hit?.hit && hit.distance > 0.3) {
        // Convert this edge ray's hit distance back to an AXIAL equivalent
        // (the edge ray travels further than the axis for the same axial
        // depth, by 1/cosHalf), so it's comparable to the centreline hit.
        axialLen = Math.min(axialLen, hit.distance * cosHalf);
      }
    }
    return Math.max(0.3, axialLen * 0.95);
  }

  /** A smooth "rounded spotlight" radius profile along the beam's length: a
   *  quarter-sine ease-out from the apex (radius 0) up to the full radius at
   *  ROUND_CAP_FRACTION of the length, then a quarter-cosine ease back down
   *  to 0 at the very end — a soft dome instead of an abrupt flat disc, and
   *  no straight-edged wedge silhouette (user feedback: "a bit more rounded
   *  shaped" after seeing the plain cone). Returns Vector3 points (x=radius,
   *  y=distance along the beam, z=0) for MeshBuilder.CreateLathe, which
   *  revolves this profile around the Y axis. */
  private roundedProfile(length: number, maxRadius: number): Vector3[] {
    const pts: Vector3[] = [];
    for (let i = 0; i <= PROFILE_POINTS; i++) {
      const u = i / PROFILE_POINTS;
      const y = u * length;
      let r: number;
      if (u <= ROUND_CAP_FRACTION) {
        r = maxRadius * Math.sin((u / ROUND_CAP_FRACTION) * (Math.PI / 2));
      } else {
        const t = (u - ROUND_CAP_FRACTION) / (1 - ROUND_CAP_FRACTION);
        r = maxRadius * Math.cos(t * (Math.PI / 2));
      }
      pts.push(new Vector3(Math.max(r, 0), y, 0));
    }
    return pts;
  }

  /** Rebuild one rounded cone per source, sized to the given SPREAD ANGLE
   *  (BEAM_HALF_ANGLE) so a beam clipped short by a nearby wall narrows
   *  proportionally too, instead of cramming a fixed-size wide end into a
   *  small room. */
  rebuild(sources: BeamSource[], occluders: ReadonlySet<AbstractMesh>): void {
    this.dispose();

    for (const { entityId, origin, direction } of sources) {
      const length = this.clippedLength(origin, direction, occluders);
      const maxRadius = length * Math.tan(BEAM_HALF_ANGLE);

      const mesh = MeshBuilder.CreateLathe(`beam_${entityId}`, {
        shape: this.roundedProfile(length, maxRadius),
        tessellation: 24,
      }, this.scene);
      // The lathe profile is built directly with y=0 at the apex (see
      // roundedProfile), so — unlike the old cylinder-based cone — the mesh
      // origin is ALREADY at the tip; no re-pivot translation needed.
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
