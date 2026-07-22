// src/components/panels/LockPanel.tsx
import { useEffect, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import BasePanel from "./BasePanel";
import StateTimeline from "./StateTimeline";
import type { PanelProps } from "@/types/panel.types";
import type { StateHistoryPoint } from "@/types/ha.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";
import { lockColor, isUnavailable } from "@/utils/stateColors";

export default function LockPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const unavailable = isUnavailable(entity);
  const locked = entity?.state === "locked";
  const [confirming, setConfirming] = useState(false);
  const [history, setHistory] = useState<StateHistoryPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchStateHistory(mapping.entityId, 24).then((h) => !cancelled && setHistory(h)).catch(() => {});
    return () => { cancelled = true; };
  }, [mapping.entityId]);

  const doUnlock = () => {
    HAServices.unlockDoor(ws, mapping.entityId);
    setConfirming(false);
  };

  return (
    <BasePanel
      title={mapping.label}
      room={mapping.room}
      icon={locked ? <Lock size={22} /> : <Unlock size={22} />}
      onClose={onClose}
    >
      <div className="center" style={{ margin: "8px 0 20px" }}>
        <span className={`status-pill ${unavailable ? "unavailable" : locked ? "on" : "danger"}`}>
          {unavailable ? <Lock size={16} /> : locked ? <Lock size={16} /> : <Unlock size={16} />}
          {unavailable ? "UNAVAILABLE" : locked ? "LOCKED" : "UNLOCKED"}
        </span>
      </div>

      {unavailable ? (
        <p className="muted body-text center">
          Home Assistant has lost contact with this lock — its real state isn't
          known, so lock/unlock controls are disabled until it reports in again.
        </p>
      ) : locked ? (
        <button className="big-toggle" onClick={() => HAServices.lockDoor(ws, mapping.entityId)}>
          <Lock size={22} /> Already locked — re-lock
        </button>
      ) : (
        <button className="big-toggle on" onClick={() => HAServices.lockDoor(ws, mapping.entityId)}>
          <Lock size={22} /> Lock door
        </button>
      )}

      {!unavailable && (
        <div className="mt">
          {!confirming ? (
            <button className="btn ghost" style={{ width: "100%" }} onClick={() => setConfirming(true)}>
              <Unlock size={18} /> Unlock door…
            </button>
          ) : (
            <div className="modal-actions">
              <span className="body-text" style={{ marginRight: "auto" }}>Unlock {mapping.label}?</span>
              <button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn danger" onClick={doUnlock}>Confirm unlock</button>
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label className="entity-label">Last 24 hours</label>
        <StateTimeline data={history} colorFor={lockColor} />
      </div>

      {!unavailable && !locked && (
        <p className="muted body-text mt">
          ⏱ Auto-lock reminder: check the door in 5 minutes.
        </p>
      )}
    </BasePanel>
  );
}
