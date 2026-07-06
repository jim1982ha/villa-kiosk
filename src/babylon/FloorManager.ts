// src/babylon/FloorManager.ts
// Floor visibility and staircase trigger zones.
//
// Classification, in priority order:
//  1. Pipeline-split structure meshes (blender_pipeline ≥ 2.3.0): a
//     multi-level GLB ships `Structure` (ground level) plus `Structure_L1`
//     (`_L2`, …) sharing one baked atlas. Name decides the floor:
//     `Structure` → 1, `Structure_L1` → 2, and so on.
//  2. Everything else — entity meshes, and the single fused Structure of
//     older GLBs (which rule 1 pins to floor 1 so it can never vanish) — by
//     elevation: bounding-box centre Y below FLOOR_SPLIT_Y is floor 1.
//
// Switching floors is pure visibility: meshes above the active floor are
// setEnabled(false), lower floors stay visible from above so the staircase
// reads correctly. setEnabled is deliberately NOT isVisible — applyStructure
// hides ceilings with isVisible, and the two must not stomp each other.
// Invisible `trigger_stair_up/down` meshes (if present) switch floors when
// the camera walks into them.

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { CameraController } from "./CameraController";

const FLOOR_SPLIT_Y = 2.8; // metres; ground floor wall height is ~2.5 m
const STRUCTURE_LEVEL = /^Structure(?:_L(\d+))?$/i;

export class FloorManager {
  private camera: CameraController | null = null;
  private onFloorChange: (floor: number) => void;

  private floorMeshes = new Map<number, AbstractMesh[]>();
  private triggerUp: AbstractMesh | null = null;
  private triggerDown: AbstractMesh | null = null;
  private currentFloor = 1;
  private floorsDetected: number[] = [1];
  private cooldownUntil = 0;

  constructor(scene: Scene, onFloorChange: (floor: number) => void) {
    this.onFloorChange = onFloorChange;
    scene.registerBeforeRender(() => this.checkTriggers());
  }

  setCamera(camera: CameraController): void {
    this.camera = camera;
  }

  indexFloors(meshes: AbstractMesh[]): void {
    this.floorMeshes.clear();
    for (const m of meshes) {
      if (/^trigger_stair_up/i.test(m.name)) {
        this.triggerUp = m;
        m.isVisible = false;
        m.isPickable = false;
        continue;
      }
      if (/^trigger_stair_down/i.test(m.name)) {
        this.triggerDown = m;
        m.isVisible = false;
        m.isPickable = false;
        continue;
      }
      // Container/root nodes carry no geometry but parent everything else —
      // disabling one would take the whole model down with it. The night
      // carrier is managed by the day/night crossfade, not by floors.
      if (m.getTotalVertices() === 0) continue;
      if (m.name === "BAKED_NightCarrier") continue;
      const lvl = STRUCTURE_LEVEL.exec(m.name);
      const floor = lvl
        ? (lvl[1] ? Number(lvl[1]) + 1 : 1)
        : m.getBoundingInfo().boundingBox.centerWorld.y > FLOOR_SPLIT_Y
          ? 2
          : 1;
      const list = this.floorMeshes.get(floor) ?? [];
      list.push(m);
      this.floorMeshes.set(floor, list);
    }
    this.floorsDetected = [...this.floorMeshes.keys()].sort();
    if (this.floorsDetected.length === 0) this.floorsDetected = [1];
    this.applyVisibility();
  }

  getFloorsDetected(): number[] {
    return this.floorsDetected;
  }

  hasFloor(floor: number): boolean {
    return (this.floorMeshes.get(floor)?.length ?? 0) > 0;
  }

  getCurrentFloor(): number {
    return this.currentFloor;
  }

  /** Hide every mesh above the active floor; keep lower floors visible. */
  private applyVisibility(): void {
    for (const [floor, list] of this.floorMeshes) {
      const on = floor <= this.currentFloor;
      for (const m of list) {
        if (m.isEnabled(false) !== on) m.setEnabled(on);
      }
    }
  }

  private checkTriggers(): void {
    if (!this.camera) return;
    if (performance.now() < this.cooldownUntil) return;
    const pos = this.camera.getPosition();

    if (this.triggerUp && this.currentFloor === 1 && this.triggerUp.intersectsPoint(pos)) {
      this.switchToFloor(2);
    } else if (this.triggerDown && this.currentFloor === 2 && this.triggerDown.intersectsPoint(pos)) {
      this.switchToFloor(1);
    }
  }

  /**
   * Switch active floor: floors above it are hidden, lower floors stay
   * visible from above (so the staircase reads correctly).
   */
  switchToFloor(floor: number): void {
    if (floor === this.currentFloor) return;
    if (!this.hasFloor(floor)) {
      // Floor not modelled yet — report so the UI can show "coming soon".
      this.onFloorChange(floor);
      return;
    }
    this.currentFloor = floor;
    this.cooldownUntil = performance.now() + 1500;
    this.applyVisibility();
    this.onFloorChange(floor);
  }
}
