// src/babylon/FloorManager.ts
// Show/hide floors and handle staircase trigger zones.
//
// Floors are inferred from mesh elevation (centre Y): everything below
// FLOOR_SPLIT_Y is floor 1, above is floor 2. When the GLB only contains floor
// 1 (current state of TheLysHouse), floor 2 is simply empty and the UI shows
// "Coming soon". Invisible `trigger_stair_up/down` meshes (if present) switch
// floors when the camera walks into them.

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { CameraController } from "./CameraController";

const FLOOR_SPLIT_Y = 2.8; // metres; ground floor wall height is ~2.5 m

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
      const bb = m.getBoundingInfo().boundingBox;
      const centreY = bb.centerWorld.y;
      const floor = centreY > FLOOR_SPLIT_Y ? 2 : 1;
      const list = this.floorMeshes.get(floor) ?? [];
      list.push(m);
      this.floorMeshes.set(floor, list);
    }
    this.floorsDetected = [...this.floorMeshes.keys()].sort();
    if (this.floorsDetected.length === 0) this.floorsDetected = [1];
  }

  getFloorsDetected(): number[] {
    return this.floorsDetected;
  }

  hasFloor(floor: number): boolean {
    return (this.floorMeshes.get(floor)?.length ?? 0) > 0;
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
   * Switch active floor. We keep lower floors visible from above (so the
   * staircase reads correctly) but you can hide the *other* floor to declutter.
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
    this.onFloorChange(floor);
  }

  getCurrentFloor(): number {
    return this.currentFloor;
  }
}
