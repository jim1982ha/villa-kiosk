// src/babylon/ModelLoader.ts
// Load a GLB into the scene from an ArrayBuffer (IndexedDB) or an uploaded File,
// and persist uploads to IndexedDB so a refresh doesn't re-upload.

import { SceneLoader, type AbstractMesh, type Scene } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { saveModelToIndexedDB } from "@/utils/storage";

export interface LoadResult {
  meshes: AbstractMesh[];
}

/** Append a GLB (given as ArrayBuffer) into an existing scene. */
export async function loadModelInto(scene: Scene, data: ArrayBuffer): Promise<LoadResult> {
  const blob = new Blob([data], { type: "model/gltf-binary" });
  const url = URL.createObjectURL(blob);
  try {
    const result = await SceneLoader.ImportMeshAsync("", "", url, scene, undefined, ".glb");
    return { meshes: result.meshes };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Read an uploaded File, persist it, and return its bytes. */
export async function ingestUploadedModel(file: File): Promise<ArrayBuffer> {
  const buf = await file.arrayBuffer();
  await saveModelToIndexedDB(buf, file.name);
  return buf;
}
