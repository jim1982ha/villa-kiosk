// src/pages/sceneMirror.ts
// What React shows of the 3D scene's own state, read FROM the scene whenever a
// scene appears — never carried over from the previous one.
//
// ⚠️ THE FLOOR WAS NOT RE-READ (round 13, 2.496.186). Dashboard mirrored the
// view mode and the saved-default flag from each new SceneManager, each in its
// own effect, and forgot the floor. A model upload remounts the scene, whose
// FloorManager starts on floor 1 and announces nothing, so the HUD kept
// showing the old floor (2F) over a scene on 1F — and a teleport compared its
// room's floor against that stale copy and skipped the floor switch. One
// reader, every mirrored field; tests/oracles/scene_mirror.mjs.

export interface SceneMirror {
  viewMode: "first-person" | "overview";
  hasOverviewDefault: boolean;
  floor: number;
}

export interface MirroredScene {
  getViewMode(): "first-person" | "overview";
  hasOverviewDefault(): boolean;
  floors: { getCurrentFloor(): number };
}

export function readSceneMirror(m: MirroredScene): SceneMirror {
  return { viewMode: m.getViewMode(), hasOverviewDefault: m.hasOverviewDefault(), floor: m.floors.getCurrentFloor() };
}
