// src/components/panels/MediaPanel.tsx
import { Tv, Play } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";

export default function MediaPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const on = entity?.state === "on" || entity?.state === "playing" || entity?.state === "paused";
  const title = entity?.attributes.media_title as string | undefined;

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<Tv size={22} />} onClose={onClose}>
      <PowerToggle on={on} onClick={() => HAServices.toggleMedia(ws, mapping.entityId)} />

      {title && <p className="body-text center mt">Now playing: {title}</p>}

      <div className="row-buttons mt">
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => HAServices.mediaPlayPause(ws, mapping.entityId)}>
          <Play size={18} /> Play / Pause
        </button>
      </div>
    </BasePanel>
  );
}
