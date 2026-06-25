// src/babylon/PickHandler.ts
// Turn a tap on the canvas into an entity selection. Tap *detection* lives in
// CameraController (the single owner of the canvas pointer pipeline + capture);
// it calls pickAtScreen() here, which raycasts and resolves the picked mesh (or
// its parents) to an entity / bind target / surface point. This avoids a second
// scene.onPointerObservable tap listener that touch POINTERUP events race
// against (Babylon and the camera both grab/release pointer capture). We keep a
// lightweight POINTERMOVE listener only to drive the mouse hover cursor.

import {
  PointerEventTypes, type PointerInfo, type AbstractMesh, type Scene, type Node,
} from "@babylonjs/core";
import { resolveMeshToMapping, mappingForEntityId } from "@/config/EntityMap";
import type { EntityMapping, Vec3 } from "@/types/scene.types";

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

  /** Mouse-only hover cursor: show a pointer over interactive objects. Touch has
   *  no hover, so this is a no-op there and never interferes with tapping. */
  private handlePointer(info: PointerInfo): void {
    if (info.type !== PointerEventTypes.POINTERMOVE) return;
    if (this.bindMode || this.placeMode) return;
    const evt = info.event as PointerEvent;
    if (evt.pointerType === "touch") return;
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) return;
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    const interactive = !!pick?.hit && !!pick.pickedMesh && !!this.resolveMesh(pick.pickedMesh);
    canvas.style.cursor = interactive ? "pointer" : "";
  }

  /**
   * Resolve a confirmed tap at client coordinates into the right action for the
   * current mode. Called by CameraController on a clean tap (mouse or touch).
   */
  pickAtScreen(clientX: number, clientY: number): void {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    const rect = canvas?.getBoundingClientRect();
    const pick = this.scene.pick(clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0));
    if (!pick?.hit || !pick.pickedMesh) return;

    if (this.placeMode) {
      // Report the surface point so the UI can drop a marker there.
      const p = pick.pickedPoint;
      if (p) this.onPointPicked?.({ x: p.x, y: p.y, z: p.z });
      return;
    }

    if (this.bindMode) {
      // Report the raw mesh name so the UI can bind it to an entity. Also log the
      // tapped mesh's MATERIAL name: for a structural surface that isn't a bindable
      // entity (e.g. a stubborn grey window pane), this is the exact name to add to
      // config.extraGlassHints to make it see-through — no guessing from sizes.
      const mat = pick.pickedMesh.material;
      console.info(
        `[PickHandler] tapped mesh "${pick.pickedMesh.name}" — material "${mat?.name ?? "(none)"}". ` +
        `If this is glass, add that material name to config.extraGlassHints and reload.`,
      );
      this.onMeshPicked?.(pick.pickedMesh.name);
      return;
    }

    const mapping = this.resolveMesh(pick.pickedMesh);
    if (mapping) this.onPicked(mapping.entityId);
  }
}
