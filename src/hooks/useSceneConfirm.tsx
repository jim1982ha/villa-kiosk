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
// ⚠️ ONE HOOK BECAUSE THERE ARE TWO SURFACES AND ADR-0003. Scenes can be run
// from the summary bar's popover and from a room panel's "Scenes for this
// room" row, and those two must not answer the same question differently. The
// hook owns the question, the haptic and the call, so a third surface gets all
// three by using it and cannot get two of them by copying.
//
// ⚠️ `AskDialog`, NOT AN INLINE Cancel/Confirm PAIR. The inline pattern
// (`PowerToggle`, the bulk toggle) works where the control can be replaced in
// place; a scene lives inside `role="menu"`, where swapping a `menuitem` for
// two buttons breaks the menu's own contract. AskDialog is this app's
// `confirm()` and already carries the focus trap, Escape and phone-Back.

import { useState } from "react";
import { Sparkles, X } from "lucide-react";

import AskDialog from "@/components/common/AskDialog";
import { useHA } from "@/ha/HAStateStore";
import { successFeedback } from "@/utils/haptics";
import { sceneMessage, type HaSceneInfo } from "@/config/haScenes";

interface SceneConfirm {
  /** Ask about this scene. Nothing is sent until the person confirms. */
  ask: (chosen: HaSceneInfo) => void;
  /** Render this somewhere in the surface's tree. `null` when nothing is asked. */
  dialog: React.ReactNode;
}

export function useSceneConfirm(): SceneConfirm {
  const { callService } = useHA();
  const [pending, setPending] = useState<HaSceneInfo | null>(null);

  const run = (chosen: HaSceneInfo) => {
    // ⚠️ THE HAPTIC FIRES ON THE CONFIRM, NOT ON THE FIRST TAP. It is the
    // acknowledgement that something irreversible was actually sent; on the
    // opening tap it would say "done" about a question.
    successFeedback();
    void callService("scene", "turn_on", {}, { entity_id: chosen.entityId });
    setPending(null);
  };

  return {
    ask: setPending,
    dialog: pending && (
      <AskDialog
        title={`Run “${pending.name}”?`}
        // ⚠️ THE COUNT IS THE WHOLE REASON TO ASK, so it is the message rather
        // than a detail under one. "This changes 14 devices" is what makes a
        // person read the title again; "Are you sure?" is not.
        message={sceneMessage(pending)}
        confirmLabel="Run scene"
        confirmIcon={Sparkles}
        cancelLabel="Cancel"
        cancelIcon={X}
        onConfirm={() => { run(pending); }}
        onCancel={() => setPending(null)}
      />
    ),
  };
}
