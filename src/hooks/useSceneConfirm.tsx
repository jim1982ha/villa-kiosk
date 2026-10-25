// src/hooks/useSceneConfirm.tsx
// "Are you sure?" for running a scene — one owner, both surfaces.
//
// ⚠️ A SCENE IS THE LEAST REVERSIBLE TAP IN THE APP AND ASKED NOTHING. It sets
// several rooms at once, its result is usually not visible from where you
// tapped, and there is no undo: the states it overwrote are gone. Every other
// control here that reaches further than the thing under your finger already
// asks first — the group's "Turn all on/off", a door release marked
// `requireConfirm`, the lock panel's unlock — and running a scene reached
// further than all of them while being a single tap.
//
// ⚠️ ONE HOOK BECAUSE THERE ARE TWO SURFACES. Scenes can be run from the
// summary bar's popover and from a room panel's "Scenes for this room" row,
// and those two must not answer the same question differently. The dialog
// and the haptic are useConfirmDialog's, shared with the camera's siren.

import { useHA } from "@/ha/HAStateStore";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { sceneMessage, type HaSceneInfo } from "@/config/haScenes";

interface SceneConfirm {
  /** Ask about this scene. Nothing is sent until the person confirms. */
  ask: (chosen: HaSceneInfo) => void;
  /** Render this somewhere in the surface's tree. `null` when nothing is asked. */
  dialog: React.ReactNode;
}

export function useSceneConfirm(): SceneConfirm {
  const { callService } = useHA();
  const { ask, dialog } = useConfirmDialog();
  return {
    ask: (chosen) => ask({
      title: `Run “${chosen.name}”?`,
      // ⚠️ THE COUNT IS THE WHOLE REASON TO ASK, so it is the message rather
      // than a detail under one. "This changes 14 devices" is what makes a
      // person read the title again; "Are you sure?" is not.
      message: sceneMessage(chosen),
      confirmLabel: "Run scene",
      run: () => void callService("scene", "turn_on", {}, { entity_id: chosen.entityId }),
    }),
    dialog,
  };
}
