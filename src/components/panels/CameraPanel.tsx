// src/components/panels/CameraPanel.tsx
// Full-screen MJPEG takeover (not a bottom sheet).

import { useEffect, useState } from "react";
import { X, VideoOff } from "lucide-react";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { cameraStreamUrl } from "@/ha/HACameraProxy";

interface Props extends PanelProps {
  /** Lets the camera pin continuous rendering while the stream is open. */
  pinContinuous?: () => () => void;
}

export default function CameraPanel({ entity, mapping, onClose, pinContinuous }: Props) {
  const { connected } = useHA();
  const { config } = useConfig();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const unpin = pinContinuous?.();
    return () => unpin?.();
  }, [pinContinuous]);

  const url =
    config.haUrl && config.haToken
      ? cameraStreamUrl(config.haUrl, config.haToken, mapping.entityId)
      : "";

  const lastMotion = entity?.attributes.last_motion ?? entity?.last_changed;

  return (
    <div className="camera-fullscreen">
      <div className="label">
        {mapping.label}
        {lastMotion && (
          <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
            updated {new Date(lastMotion as string).toLocaleTimeString()}
          </span>
        )}
      </div>
      <button className="icon-btn close" onClick={onClose}>
        <X size={24} />
      </button>

      {url && connected && !failed ? (
        <img src={url} alt={mapping.label} onError={() => setFailed(true)} />
      ) : (
        <div className="center" style={{ color: "var(--text-secondary)" }}>
          <VideoOff size={48} />
          <p>{!connected ? "Not connected to Home Assistant." : "Camera stream unavailable."}</p>
        </div>
      )}
    </div>
  );
}
