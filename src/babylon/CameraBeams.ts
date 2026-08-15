// src/babylon/CameraBeams.ts
// Camera motion-detection beams, extracted from EntityVisuals so beam mesh
// lifecycle lives in one place (same pattern as RoomHighlight).
//
// A simulated "diffused red light beam" pointing the way a camera prop was
// rotated AND tilted in SweetHome 3D (see sh3dParser's `angle` for yaw and
// `pitch` for tilt), toggled by that camera's linked motion binary_sensor
// (EntityMapping.motionEntityId). It is a translucent unlit cone, not a real
// light — no shadow map, no surface interaction.

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

const BEAM_COLOR = new Color3(0.95, 0.15, 0.12);
// A wide "spotlight" cone at ROOM scale. Two rounds of feedback shaped this:
// the original 6m/1.6m combo (2026-07-03, before) read as a long thin streak
// reaching across multiple rooms, not a beam coming out of the camera — fixed
// by roughly halving the length and nearly doubling the diameter, which
// widened the spread angle a lot (≈7.6° half-angle -> ≈26.6°) but also left
// it too SMALL to read as "this camera watches this area" (2026-07-29 report:
// "very small", wanting "a glow of light that gracefully covers the area in
// front of the camera"). This round doubles both dimensions again, which —
// critically — keeps that SAME ≈26.6° spread angle (the ratio is unchanged,
// only the scale is), so it stays the wide stubby spotlight shape that fixed
// the original complaint; it does not regress toward a laser. Frontal
// coverage area scales with the SQUARE of this, so doubling both reach and
// width quadruples how much of a room the cone visibly covers. These two
// constants define the beam's fixed SPREAD ANGLE (see BEAM_HALF_ANGLE below);
// actual on-screen length/width both scale down together in a small room (via
// clippedLength's wall raycasts) so the cone always looks proportional, never
// a fixed-size wedge jammed into whatever space is available or poking
// through the far wall of a small room.
const BEAM_END_DIAMETER = 6.0;
const BEAM_MAX_LENGTH = 6;
const BEAM_HALF_ANGLE = Math.atan((BEAM_END_DIAMETER / 2) / BEAM_MAX_LENGTH);
const BEAM_BASE_ALPHA = 0.16;
const BEAM_PULSE_ALPHA = 0.4;
// Edge rays sampled around the cone's surface (see clippedLength below) —
// more samples catch corner walls more reliably, at a small one-time raycast
// cost per beam rebuild (rebuilds only happen on room re-calibration, not
// every frame).
const EDGE_RAY_SAMPLES = 8;
// How close to the apex an EDGE ray's hit is treated as the camera's own
// mounting structure rather than something it is looking at. A camera is
// fixed to a wall/ceiling, so the cone's apex is always within centimetres of
// a large occluder and some edge rays necessarily point back into it — see
// clippedLength. Generous enough to clear a mount, a soffit and a curtain
// pelmet; well under the beam's own reach, so a genuinely enclosed camera
// still gets a short beam via the CENTRELINE ray, which is not subject to
// this and keeps its original tight 0.3m threshold.
const MOUNT_CLEARANCE = 1.2;
// |cos| between an edge ray and the surface normal it hits, below which the
// hit is "grazing" — the beam is running alongside that surface (a wall it is
// aimed parallel to), not into it. cos 75° ≈ 0.259.
const GRAZING_MIN_COS = 0.259;
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
    // The CENTRELINE keeps the original tight threshold: a surface directly
    // ahead genuinely does stop the beam, however close it is.
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
      if (!hit?.hit) continue;

      // A camera is MOUNTED ON structure — a wall, a ceiling, or the corner
      // where they meet. The cone's apex therefore sits within centimetres of
      // a large occluding surface BY CONSTRUCTION, and edge rays fan out in
      // every direction around the axis, so some of them necessarily point
      // back into that mounting surface. With a flat `Math.min` over all
      // hits, those rays defined the whole cone's reach: the beam collapsed to
      // a stub the moment it was widened enough for its own mount to enter the
      // sampled cone (field report 2026-07-29, a ceiling/wall-corner camera
      // whose beam ended in mid-air with nothing in front of it). Anything an
      // edge ray meets within MOUNT_CLEARANCE is the camera's own mounting
      // structure, not the scene it is watching.
      if (hit.distance < MOUNT_CLEARANCE) continue;

      // A surface the beam runs ALONGSIDE (a wall the camera is aimed parallel
      // to, the ceiling just above a level-ish beam) is not blocking it — the
      // ray only meets it because the cone is wide, at a glancing angle. Skip
      // grazing hits: keep only those where the surface genuinely faces the
      // ray. Falls through to counting the hit when Babylon can't supply a
      // normal, so an unknown case still errs toward clipping (the safe side —
      // that is what stops a beam poking through a real wall).
      const n = hit.getNormal(true);
      if (n && Math.abs(Vector3.Dot(n, edgeDir)) < GRAZING_MIN_COS) continue;

      // Convert this edge ray's hit distance back to an AXIAL equivalent
      // (the edge ray travels further than the axis for the same axial
      // depth, by 1/cosHalf), so it's comparable to the centreline hit.
      axialLen = Math.min(axialLen, hit.distance * cosHalf);
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
    for (const source of sources) this.addBeam(source, occluders);
  }

  /**
   * Build ONE beam, so a caller can spread the set across frames.
   *
   * Each beam costs 9 raycasts against the fused structure mesh (~1000ms for
   * this villa's 13 cameras, measured), and doing them in one task is a
   * second-long freeze on a villa that is already on screen. Unlike the floor
   * probes and the stair conform, nothing here toggles mesh visibility, so
   * there is no enable/restore window that a yield could expose to a render —
   * which is exactly why THIS is the one safe to chunk.
   */
  addBeam({ entityId, origin, direction }: BeamSource, occluders: ReadonlySet<AbstractMesh>): void {
    {
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
