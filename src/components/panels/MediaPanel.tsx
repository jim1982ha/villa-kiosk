// src/components/panels/MediaPanel.tsx
import { Tv, Play } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import UnavailableNotice from "./UnavailableNotice";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { isUnavailable } from "@/utils/stateColors";
import { devicePower } from "@/utils/devicePower";

export default function MediaPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const unavailable = isUnavailable(entity);
  // POWER, not activity: a paused or idle TV is on (devicePower).
  const on = devicePower(entity, mapping.entityId).position === "on";
  const title = entity?.attributes.media_title as string | undefined;

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Tv size={22} />} onClose={onClose}>
      {unavailable ? <UnavailableNotice device="media player" /> : (
        <>
          <PowerToggle
            on={on} onClick={() => HAServices.power(ws, entity, mapping.entityId)}
            label={mapping.label} requireConfirm={mapping.requireConfirm}
          />

          {title && <p className="body-text center mt">Now playing: {title}</p>}

          <div className="row-buttons mt">
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => HAServices.mediaPlayPause(ws, mapping.entityId)}>
              <Play size={18} /> Play / Pause
            </button>
          </div>
        </>
      )}
    </BasePanel>
  );
}
