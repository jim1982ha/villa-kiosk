// src/hooks/useScenePreview.ts
// While Settings is open, the 3D view follows what the dialog SHOWS (its draft's `view`: the config with the values
// being dragged laid over it) for the values it previews before they are written: the look, the eye height, the walk
// speed. A slider drag is felt at once; Cancel puts the view back by the same path, because the dialog then shows the
// stored values again (2.496.500).
//
// ⚠️ ONE SEAM, NOT A CALL PER SLIDER. Each slider used to move the camera itself (manager.camera.setEyeHeight) and
// Cancel re-applied only the look: Cancel within the half-second the write waits left the camera at the cancelled
// eye height (nothing had been written, so the scene's own path, on a config change, had nothing to undo) while
// Settings showed the old one.

import { useEffect, useRef } from "react";
import { eyeHeightOf } from "@/babylon/walkerSpawn";
import type { AppConfig, RenderConfig } from "@/config/AppConfig";

/** What the preview drives (SceneManager). */
export interface PreviewTarget {
  setRenderConfig: (render: RenderConfig) => void;
  camera: { setEyeHeight: (h: number) => void; setWalkSpeed: (v: number) => void };
}

export type PreviewedValues = Pick<AppConfig, "render" | "eyeHeight" | "walkSpeed">;

/** Each value the dialog shows that changed since the last one is applied to the scene. Nothing on opening: the
 *  scene already shows the stored config. */
export function useScenePreview(target: PreviewTarget | null, view: PreviewedValues): void {
  const { render, eyeHeight, walkSpeed } = view;
  const last = useRef<PreviewedValues | null>(null);
  useEffect(() => {
    const was = last.current;
    last.current = { render, eyeHeight, walkSpeed };
    if (!target || was === null) return;
    if (render !== was.render) target.setRenderConfig(render);
    if (eyeHeight !== was.eyeHeight) target.camera.setEyeHeight(eyeHeightOf(eyeHeight));
    if (walkSpeed !== was.walkSpeed) target.camera.setWalkSpeed(walkSpeed);
  }, [target, render, eyeHeight, walkSpeed]);
}
