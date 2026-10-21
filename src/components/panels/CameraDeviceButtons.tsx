// src/components/panels/CameraDeviceButtons.tsx
// A camera's own controls on its video, among its other buttons (owner, 2026-10-21: "when there is PTZ control and
// siren entity available for a camera … show them as clickable icons, the same way other buttons appear"): its move
// buttons (up, down, left, right) and its siren, an on/off like the linked switch beside them. Which entities those
// are is panelRules.cameraControlsOf (the camera's device in the villa's registry); who may press them, the profile's
// `controlCameras` (the owner's: the add-on refuses a button or a siren to every other profile).

import type { CSSProperties } from "react";
import { MoveDown, MoveLeft, MoveRight, MoveUp, Siren } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import { cameraControlsOf } from "@/utils/panelRules";

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
  const controls = roleCan(role, "controlCameras") ? cameraControlsOf(cameraId, entityDeviceIds) : null;
  if (!controls) return null;
  const siren = controls.siren;
  const sounding = !!siren && entities[siren]?.state === "on";
  return (
    <>
      {MOVES.map(({ dir, Icon, words }, i) => {
        const id = controls.moves[dir];
        return id ? (
          <button key={dir} type="button" className="icon-btn camera-move-btn" title={words} aria-label={words}
            style={order(6 + i)} onClick={() => void callService("button", "press", {}, { entity_id: id })}>
            <Icon />
          </button>
        ) : null;
      })}
      {siren && (
        <button type="button" className={`icon-btn camera-linked-btn camera-siren-btn${sounding ? " on alarm" : ""}`}
          title={sounding ? "Stop the siren" : "Sound the siren"} aria-label={sounding ? "Stop the siren" : "Sound the siren"}
          aria-pressed={sounding} style={order(10)}
          onClick={() => void callService("siren", sounding ? "turn_off" : "turn_on", {}, { entity_id: siren })}>
          <Siren />
        </button>
      )}
    </>
  );
}
