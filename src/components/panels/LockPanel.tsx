// src/components/panels/LockPanel.tsx
import { useState } from "react";
import { Lock, Unlock } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { usePendingAck } from "@/hooks/usePendingAck";
import { isUnavailable, statusKeyFor, STATUS_PILL_CLASS } from "@/utils/stateColors";
import { tapFeedback, successFeedback } from "@/utils/haptics";

export default function LockPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const unavailable = isUnavailable(entity);
  const locked = entity?.state === "locked";
  // The pill reads the lock's ACTUAL state rather than `locked ? … : …`.
  // The old ternary had only two answers for a domain with five real ones, so
  // every state that wasn't literally "locked" — the "locking"/"unlocking" the
  // motor reports for a second or two, and "jammed" — was announced as a red
  // "UNLOCKED": an alarming claim about a door that was in fact busy securing
  // itself. Reporting the state HA actually sent is both truer and shorter.
  const lockStatus = statusKeyFor(entity?.state ?? "", mapping.entityId);
  const [confirming, setConfirming] = useState(false);
  // A deadbolt is the SLOWEST device class in the villa — a Z-Wave/Zigbee
  // lock routinely takes seconds to report back, and unlike a light there is
  // usually no way to see the result from where you're standing. This panel
  // was nonetheless the one with no in-flight feedback at all (the shared
  // PowerToggle already gave lights/switches/fans a pulse), so a tap looked
  // like it did nothing and invited a second tap on a physical lock. Watches
  // the raw state string, not just `locked`, so an intermediate "locking"/
  // "unlocking" report clears the pulse as soon as the motor actually moves.
  const { pending, markPending } = usePendingAck(entity?.state);

  const doLock = () => {
    tapFeedback();
    markPending();
    HAServices.lockDoor(ws, mapping.entityId);
  };

  const doUnlock = () => {
    // successFeedback, not tapFeedback: unlocking is the consequential,
    // deliberately-confirmed action of the two — the haptic should feel
    // different from an ordinary acknowledgment.
    successFeedback();
    markPending();
    HAServices.unlockDoor(ws, mapping.entityId);
    setConfirming(false);
  };

  return (
    <BasePanel
      title={mapping.label}
      entityId={mapping.entityId}
      icon={locked ? <Lock size={22} /> : <Unlock size={22} />}
      onClose={onClose}
    >
      <div className="center" style={{ margin: "8px 0 20px" }}>
        <span className={`status-pill ${STATUS_PILL_CLASS[lockStatus]}`}>
          {/* The open padlock is reserved for a lock that is genuinely NOT
              secured. Mid-motion, jammed and unavailable all keep the closed
              icon, for the same reason meshVariants falls an unauthored state
              back to the closed pose: never imply a door is open on anything
              short of the device saying so. */}
          {entity?.state === "unlocked" || entity?.state === "open"
            ? <Unlock size={16} /> : <Lock size={16} />}
          {(entity?.state ?? "unknown").replace(/_/g, " ").toUpperCase()}
        </span>
      </div>

      {/* The UNAVAILABLE pill above says it; the explanatory paragraph that
          used to sit here is now the pill's hover/assistive text, so every
          panel presents an offline device identically (UnavailableNotice). */}
      {unavailable ? null : locked ? (
        <button
          className={`big-toggle${pending ? " pending" : ""}`}
          onClick={doLock}
          aria-busy={pending}
        >
          <Lock size={22} /> Already locked — re-lock
        </button>
      ) : (
        <button
          // `cta`, not `on`: this button appears precisely when the lock is
          // NOT locked, and it borrowed `on` purely for emphasis. Now that
          // `on` carries the device's category colour and means "this device
          // is active", that borrowing would have read as a state report of
          // the opposite of the truth.
          className={`big-toggle cta${pending ? " pending" : ""}`}
          onClick={doLock}
          aria-busy={pending}
        >
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


      {!unavailable && !locked && (
        <p className="muted body-text mt">
          ⏱ Auto-lock reminder: check the door in 5 minutes.
        </p>
      )}
    </BasePanel>
  );
}
