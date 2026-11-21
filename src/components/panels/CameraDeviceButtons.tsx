// src/components/panels/CameraDeviceButtons.tsx
// A camera's own controls on its video, among its other buttons (owner, 2026-10-21: "when there is PTZ control and
// siren entity available for a camera … show them as clickable icons, the same way other buttons appear"): its move
// buttons (up, down, left, right) and its siren, an on/off like the linked switch beside them. Which entities those
// are is panelRules.cameraControlsOf (the camera's device in the villa's registry); who may press them, the profile's
// `controlCameras` (the owner's: the add-on refuses a button or a siren to every other profile).
// ⚠️ SOUNDING THE SIREN ASKS FIRST (owner, 2026-10-25: "show a confirmation message, the same way there is a
// confirmation message to act on Scene"), through the scenes' own useConfirmDialog. Stopping it never asks.
// Once sent (the yes given, or a stop), it shows the in-flight look every command button shows (usePendingAck) until
// the siren reports its new state or the villa refuses the command.

import type { CSSProperties } from "react";
import { MoveDown, MoveLeft, MoveRight, MoveUp, Siren } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import { cameraControlsOf } from "@/utils/panelRules";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { usePendingAck } from "@/hooks/usePendingAck";
import CommandButton from "./CommandButton";
import Button from "@/components/common/Button";
import type { Question } from "@/hooks/useConfirmDialog";

/** What a press on the siren's button does (sounding: whether it sounds now): stopping it at once, never asked;
 *  sounding it only once the person confirms, the question naming the camera (CLAUDE.md: the siren needs a person's own
 *  press made for that sounding). `sent` receives each command actually sent (its outcome), never the question alone:
 *  the in-flight look starts with a command, not with a press. Pure: tests/oracles/panel_rules.mjs presses it. */
export function pressSiren({ sounding, siren, name, ask, callService, sent }: {
  sounding: boolean; siren: string; name: string;
  ask: (q: Question) => void;
  callService: (domain: string, service: string, data: Record<string, unknown>, target: { entity_id: string }) => unknown;
  sent: (outcome: unknown) => void;
}): void {
  if (sounding) { sent(callService("siren", "turn_off", {}, { entity_id: siren })); return; }
  ask({
    title: "Sound the siren?",
    message: `The siren of “${name}” sounds out loud where the camera is.`,
    confirmLabel: "Sound siren",
    run: () => sent(callService("siren", "turn_on", {}, { entity_id: siren })),
  });
}

/** The moves in the order drawn, each with its icon and words. */
const MOVES = [
  { dir: "left", Icon: MoveLeft, words: "Turn left" },
  { dir: "up", Icon: MoveUp, words: "Turn up" },
  { dir: "down", Icon: MoveDown, words: "Turn down" },
  { dir: "right", Icon: MoveRight, words: "Turn right" },
] as const;

export default function CameraDeviceButtons({ cameraId, order }: {
  cameraId: string;
  /** The vertical rail's order for the n-th button (CameraPanel's vOrder). */
  order: (n: number) => CSSProperties | undefined;
}) {
  const { entities, entityDeviceIds, callService } = useHA();
  const { role } = useProfile();
  const { ask, dialog } = useConfirmDialog();
  const labelOf = useEntityLabel();
  const controls = roleCan(role, "controlCameras") ? cameraControlsOf(cameraId, entityDeviceIds) : null;
  const siren = controls?.siren ?? null;
  // the siren's own report ends the waiting: any change of its state
  const { pending: sirenPending, markPending: sirenSent } = usePendingAck(siren ? entities[siren]?.state : undefined);
  if (!controls) return null;
  const sounding = !!siren && entities[siren]?.state === "on";
  return (
    <>
      {MOVES.map(({ dir, Icon, words }, i) => {
        const id = controls.moves[dir];
        return id ? (
          // a button of the villa's system reports the moment of its last press: the press arriving ends the waiting
          <CommandButton key={dir} on="photo" icon={<Icon />} label={words} style={order(6 + i)}
            watch={entities[id]?.state} send={() => callService("button", "press", {}, { entity_id: id })} />
        ) : null;
      })}
      {siren && (
        <Button on="photo" lit={sounding} busy={sirenPending} icon={<Siren />}
          className={`camera-linked-btn camera-siren-btn${sounding ? " alarm" : ""}`}
          label={sounding ? "Stop the siren" : "Sound the siren"} aria-pressed={sounding} style={order(10)}
          // the camera named as every screen names it, its title above included
          onClick={() => pressSiren({ sounding, siren, name: labelOf(cameraId), ask, callService, sent: sirenSent })} />
      )}
      {dialog}
    </>
  );
}
