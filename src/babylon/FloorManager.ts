// src/babylon/FloorManager.ts
// Floor visibility and staircase trigger zones.
//
// Classification, in priority order:
//  0. `Structure_Exterior` (blender_pipeline ≥ 2.5.0): the always-visible
//     ground + garden + palm group. It is NEVER culled by a floor toggle, so
//     the villa keeps its plot and the palms stay whole on every floor.
//  1. Pipeline-split structure meshes (blender_pipeline ≥ 2.3.0): a
//     multi-level GLB ships `Structure` (ground level) plus `Structure_L1`
//     (`_L2`, …) sharing one baked atlas. Name decides the floor:
//     `Structure` → 1, `Structure_L1` → 2, and so on.
//  2. Everything else — entity meshes, and the single fused Structure of
//     older GLBs (which rule 1 pins to floor 1 so it can never vanish) — by
//     elevation: bounding-box centre Y below FLOOR_SPLIT_Y is floor 1.
//
// Switching floors is pure visibility and CUMULATIVE DOWNWARD (2.9.8): the
// active floor AND every floor below it are enabled; only floors ABOVE are
// setEnabled(false). Looking at 1F still cuts the upper storey away so you
// can see inside from above, but the 2F view keeps the ground floor's
// exterior walls, windows and terraces underneath — without them the upper
// storey read as a slab floating over the garden. (Pre-2.9.8 this was
// exclusive — active floor only.) The exterior group stays on throughout.
// setEnabled is deliberately NOT isVisible — applyStructure hides ceilings
// with isVisible, and the two must not stomp each other. Invisible
// `trigger_stair_up/down` meshes (if present) switch floors when the camera
// walks into them.

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { CameraController } from "./CameraController";
import { normaliseMeshName } from "../config/EntityMap";

const FLOOR_SPLIT_Y = 2.8; // metres; ground floor wall height is ~2.5 m
const STRUCTURE_LEVEL = /^Structure(?:_L(\d+))?$/i;
const STRUCTURE_EXTERIOR = /^Structure_Exterior$/i;

export class FloorManager {
  private camera: CameraController | null = null;
  private onFloorChange: (floor: number) => void;

  private floorMeshes = new Map<number, AbstractMesh[]>();
  private alwaysOnMeshes: AbstractMesh[] = [];
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
    this.alwaysOnMeshes = [];
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
      // Babylon's glTF loader splits a multi-primitive mesh (one primitive per
      // material slot — a baked Structure keeps ~150 slots all pointing at
      // BAKED_Structure) into child meshes renamed `Structure_primitive<N>`.
      // Match on the normalised base name, or every structure piece falls
      // through to the bounding-box rule: the 2F floor slab (centre ~2.5 m,
      // below FLOOR_SPLIT_Y) then lands on floor 1 — visible on 1F, missing
      // on 2F — and the garden loses its always-on status.
      const base = normaliseMeshName(m.name);
      // The exterior group (ground + garden + palms) is always visible — it
      // belongs to no floor and must survive every toggle.
      if (STRUCTURE_EXTERIOR.test(base)) {
        this.alwaysOnMeshes.push(m);
        if (!m.isEnabled(false)) m.setEnabled(true);
        continue;
      }
      const lvl = STRUCTURE_LEVEL.exec(base);
      const floor = lvl
        ? (lvl[1] ? Number(lvl[1]) + 1 : 1)
        : m.getBoundingInfo().boundingBox.centerWorld.y > FLOOR_SPLIT_Y
          ? 2
          : 1;
      // Stamp the floor on the mesh so other systems (the entity-label culler)
      // can tell which storey a mesh belongs to without re-deriving the rules.
      m.metadata = { ...(m.metadata ?? {}), floorIndex: floor };
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

  /**
   * Show the active floor and every floor BELOW it; only floors above are
   * disabled. The 1F view still cuts the upper storey away (top-down look
   * into the rooms), while the 2F view keeps the ground floor's shell —
   * exterior walls, windows, terraces — underneath so the upper storey
   * doesn't float in mid-air. The exterior group (ground + palms) stays
   * enabled regardless of floor.
   */
  private applyVisibility(): void {
    for (const [floor, list] of this.floorMeshes) {
      const on = floor <= this.currentFloor;
      for (const m of list) {
        if (m.isEnabled(false) !== on) m.setEnabled(on);
      }
    }
    for (const m of this.alwaysOnMeshes) {
      if (!m.isEnabled(false)) m.setEnabled(true);
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
   * Switch active floor: only that floor's meshes are shown (exclusive), the
   * others are hidden; the exterior group stays visible throughout.
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
