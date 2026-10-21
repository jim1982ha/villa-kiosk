// src/components/panels/LockPanel.tsx
import { Lock, Unlock } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { usePendingAck } from "@/hooks/usePendingAck";
import { lockBolt, lockButtons, lockPill, lostPillTone } from "@/config/reading";
import { usePanelActions } from "./PanelActionsContext";
import { tapFeedback, successFeedback } from "@/utils/haptics";
import ControlFrame from "./ControlFrame";
import InlineConfirm from "@/components/common/InlineConfirm";
import { useAskFirst } from "@/hooks/useAskFirst";
import { switchAsk } from "@/utils/devicePower";

export default function LockPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  // where its bolt is — the one reading (stateColors.lockBolt): the header's icon, the pill's and the button agree
  const bolt = lockBolt(entity?.state);
  const buttons = lockButtons(bolt);
  const PadIcon = bolt === "open" ? Unlock : Lock;
  // The pill reads the lock's ACTUAL state rather than `locked ? … : …`.
  // The old ternary had only two answers for a domain with five real ones, so
  // every state that wasn't literally "locked" — the "locking"/"unlocking" the
  // motor reports for a second or two, and "jammed" — was announced as a red
  // "UNLOCKED": an alarming claim about a door that was in fact busy securing
  // itself. Reporting the state HA actually sent is both truer and shorter.
  const own = lockPill(mapping.entityId, entity?.state);
  // a critical lock that lost contact: red, as the Cockpit paints it (the header's look decides — reading.lostPillTone)
  const pill = { ...own, tone: lostPillTone(own.tone, usePanelActions().badge?.critical ?? false) };
  // A deadbolt is the SLOWEST device class in the villa — a Z-Wave/Zigbee
  // lock routinely takes seconds to report back, and unlike a light there is
  // usually no way to see the result from where you're standing. This panel
  // was nonetheless the one with no in-flight feedback at all (the shared
  // PowerToggle already gave lights/switches/fans a pulse), so a tap looked
  // like it did nothing and invited a second tap on a physical lock. Watches
  // the raw state string, not just `locked`, so an intermediate "locking"/
  // "unlocking" report clears the pulse as soon as the motor actually moves.
  const { pending, markPending } = usePendingAck(entity?.state);

  // Both buttons ask what every switch asks (devicePower.switchAsk): an
  // unlock always, a lock only when the owner set "ask before switching".
  // They name their direction rather than flipping, so a re-lock stays a lock.
  const lock = useAskFirst(switchAsk({ domain: "lock", service: "lock" }, mapping), () => {
    tapFeedback();
    markPending(HAServices.lockDoor(ws, mapping.entityId));
  });
  const unlock = useAskFirst(switchAsk({ domain: "lock", service: "unlock" }, mapping), () => {
    // successFeedback, not tapFeedback: unlocking is the consequential,
    // deliberately-confirmed action of the two — the haptic should feel
    // different from an ordinary acknowledgment.
    successFeedback();
    markPending(HAServices.unlockDoor(ws, mapping.entityId));
  });

  return (
    <BasePanel
      title={mapping.label}
      entityId={mapping.entityId}
      icon={<PadIcon size={22} />}
      onClose={onClose}
    >
      {/* The shared frame: its notice when HA has lost the lock, the state
          pill and the buttons otherwise (ControlFrame). */}
      <ControlFrame entity={entity} mapping={mapping} device="lock">
      <div className="center" style={{ margin: "8px 0 20px" }}>
        <span className={`status-pill ${pill.tone}`}>
          {/* The open padlock is reserved for a lock that is genuinely NOT
              secured. Mid-motion, jammed and unavailable all keep the closed
              icon, for the same reason meshVariants falls an unauthored state
              back to the closed pose: never imply a door is open on anything
              short of the device saying so. */}
          <PadIcon size={16} />
          {pill.text}
        </span>
      </div>
      {/* the action its bolt calls for, large; both only while the lock cannot say (panelRules.lockButtons) */}
      {buttons.map((b, n) => {
        const ask = b === "lock" ? lock : unlock;
        if (ask.asking) {
          return <div key={b} className={n ? "mt" : undefined}><InlineConfirm flush={false} question={ask.asking.question}
            confirmLabel={ask.asking.confirmLabel} onConfirm={ask.confirm} onCancel={ask.cancel} /></div>;
        }
        const Icon = b === "lock" ? Lock : Unlock;
        return n === 0 ? (
          <button key={b}
            // `cta`, not `on`: emphasis for the action to take, never a report of the device's state
            className={`big-toggle cta${pending ? " pending" : ""}`}
            onClick={ask.request}
            aria-busy={pending}
          >
            <Icon size={22} /> {b === "lock" ? "Lock door" : "Unlock door…"}
          </button>
        ) : (
          <div key={b} className="mt">
            <button className="btn ghost" style={{ width: "100%" }} onClick={ask.request}>
              <Icon size={18} /> {b === "lock" ? "Lock door" : "Unlock door…"}
            </button>
          </div>
        );
      })}

      </ControlFrame>
    </BasePanel>
  );
}
