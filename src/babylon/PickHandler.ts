// src/babylon/PickHandler.ts
// Turn a tap on the canvas into an entity selection. Distinguishes a genuine tap
// from a look-around drag (movement / time threshold), raycasts, then resolves
// the picked mesh (or its parents) to an entity via the EntityMap.

import {
  PointerEventTypes, type PointerInfo, type AbstractMesh, type Scene, type Node,
} from "@babylonjs/core";
import { resolveMeshToMapping, mappingForEntityId } from "@/config/EntityMap";
import type { EntityMapping, Vec3 } from "@/types/scene.types";

const TAP_MOVE_TOLERANCE = 10; // px
const TAP_TIME_MS = 350;

export class PickHandler {
  private scene: Scene;
  private onPicked: (entityId: string) => void;
  private entityMap: Record<string, EntityMapping>;
  private bindings: Record<string, string> = {};

  /** Bind mode: report the raw mesh name instead of resolving to an entity. */
  private bindMode = false;
  private onMeshPicked: ((meshName: string) => void) | null = null;

  /** Place mode: report the tapped 3D point so a marker can be dropped there. */
  private placeMode = false;
  private onPointPicked: ((point: Vec3) => void) | null = null;

  private downX = 0;
  private downY = 0;
  private downT = 0;

  constructor(
    scene: Scene,
    onPicked: (entityId: string) => void,
    entityMap: Record<string, EntityMapping> = {},
    bindings: Record<string, string> = {},
  ) {
    this.scene = scene;
    this.onPicked = onPicked;
    this.entityMap = entityMap;
    this.bindings = bindings;

    scene.onPointerObservable.add((info) => this.handlePointer(info));
  }

  setMaps(map: Record<string, EntityMapping>, bindings: Record<string, string>): void {
    this.entityMap = map;
    this.bindings = bindings;
  }

  /** Enter/exit bind mode. While on, taps return the raw mesh name. */
  setBindMode(on: boolean, cb?: (meshName: string) => void): void {
    this.bindMode = on;
    this.onMeshPicked = cb ?? null;
  }

  /** Enter/exit place mode. While on, taps return the 3D point on the surface. */
  setPlaceMode(on: boolean, cb?: (point: Vec3) => void): void {
    this.placeMode = on;
    this.onPointPicked = cb ?? null;
  }

  /** Flag interactive meshes pickable; everything else stays non-interactive. */
  indexInteractiveMeshes(meshes: AbstractMesh[]): void {
    for (const m of meshes) {
      const mapping = this.resolveMesh(m);
      m.isPickable = !!mapping || m.isPickable; // keep walls pickable for ray stop
    }
  }

  private resolveMesh(mesh: Node | null): EntityMapping | null {
    let node: Node | null = mesh;
    let depth = 0;
    while (node && depth < 4) {
      // Markers carry their entity_id directly in metadata.
      const tagged = (node.metadata as { entityId?: string } | null)?.entityId;
      if (tagged) return mappingForEntityId(tagged, this.entityMap);
      const mapping = resolveMeshToMapping(node.name, this.entityMap, this.bindings);
      if (mapping) return mapping;
      node = node.parent;
      depth++;
    }
    return null;
  }

  private handlePointer(info: PointerInfo): void {
    const evt = info.event as PointerEvent;
    if (info.type === PointerEventTypes.POINTERDOWN) {
      this.downX = evt.clientX;
      this.downY = evt.clientY;
      this.downT = performance.now();
      return;
    }
    if (info.type === PointerEventTypes.POINTERMOVE) {
      if (!this.bindMode && !this.placeMode) {
        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (canvas) {
          const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
          const interactive = !!pick?.hit && !!pick.pickedMesh && !!this.resolveMesh(pick.pickedMesh);
          canvas.style.cursor = interactive ? "pointer" : "";
        }
      }
      return;
    }
    if (info.type !== PointerEventTypes.POINTERUP) return;

    const movedFar =
      Math.abs(evt.clientX - this.downX) > TAP_MOVE_TOLERANCE ||
      Math.abs(evt.clientY - this.downY) > TAP_MOVE_TOLERANCE;
    const tooSlow = performance.now() - this.downT > TAP_TIME_MS;
    if (movedFar || tooSlow) return; // it was a look-around drag, not a tap

    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    if (!pick?.hit || !pick.pickedMesh) return;

    if (this.placeMode) {
      // Report the surface point so the UI can drop a marker there.
      const p = pick.pickedPoint;
      if (p) this.onPointPicked?.({ x: p.x, y: p.y, z: p.z });
      return;
    }

    if (this.bindMode) {
      // Report the raw mesh name so the UI can bind it to an entity.
      this.onMeshPicked?.(pick.pickedMesh.name);
      return;
    }

    const mapping = this.resolveMesh(pick.pickedMesh);
    if (mapping) this.onPicked(mapping.entityId);
  }
}
