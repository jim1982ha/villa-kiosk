// src/components/panels/MediaPanel.tsx
import { Tv, Play } from "lucide-react";
import BasePanel from "./BasePanel";
import ControlFrame from "./ControlFrame";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";

export default function MediaPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const title = entity?.attributes.media_title as string | undefined;

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Tv size={22} />} onClose={onClose}>
      {/* POWER, not activity: a paused or idle TV is on (devicePower, in the frame). */}
      <ControlFrame entity={entity} mapping={mapping} device="media player" power>

          {title && <p className="body-text center mt">Now playing: {title}</p>}

          <div className="row-buttons mt">
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => HAServices.mediaPlayPause(ws, mapping.entityId)}>
              <Play size={18} /> Play / Pause
            </button>
          </div>
      </ControlFrame>
    </BasePanel>
  );
}
