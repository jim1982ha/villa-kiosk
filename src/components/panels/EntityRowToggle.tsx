// src/components/panels/EntityRowToggle.tsx
// The inline on/off switch on a device row (the group/room/category modal's
// list, where most bulk toggling actually happens).
//
// Its own component purely so it can hold a hook: the rows are produced by a
// render FUNCTION inside SummaryGroupPanel, and a hook can't be called per
// iteration there. Extracting the switch gives each row its own optimistic
// state without restructuring the list.
//
// WHY OPTIMISTIC HERE, when the project reverted an optimistic experiment
// before (CHANGELOG ~v2.32.7-20): that revert was about predicting the 3D
// SCENE's appearance — mesh/material state with no bounded correction, where
// a mispredicted value strands the villa looking wrong until something else
// happens to repaint it. This is the opposite case on every axis that
// mattered there, which is the same reasoning useOptimisticToggle's own
// docstring sets out:
//   * it moves a discrete DOM switch with exactly two unambiguous positions;
//   * it self-corrects the instant HA's real state matches the intent;
//   * it self-corrects anyway on a timeout if the call silently fails;
//   * it resets when the row's entity changes.
// Nothing in the Babylon layer reads this state — the map badge continues to
// render from confirmed HA state only, deliberately, so a prediction here can
// never disagree with the 3D view for more than the moment before truth
// arrives.

import { useCallback } from "react";
import { useOptimisticToggle } from "@/hooks/useOptimisticToggle";
import { tapFeedback } from "@/utils/haptics";
import { useAskFirst } from "@/hooks/useAskFirst";
import type { SwitchAsk } from "@/utils/devicePower";
import InlineConfirm from "@/components/common/InlineConfirm";

interface Props {
  entityId: string;
  /** Live, HA-confirmed "is this on" for this row's domain (a lock is "on"
   *  when unlocked — devicePower owns that rule). */
  actualOn: boolean;
  /** Accessible name for the switch, already resolved by the caller. */
  label: string;
  /** Fire the real service call, returning its outcome so a refused one
   *  reverts at once (see useOptimisticToggle). */
  onToggle: () => unknown;
  /** devicePower.deviceSwitch's `ask`: unlocking, or a device the owner set
   *  to "ask before switching". The question opens under the row, and the
   *  switch moves only on Confirm (2.496.259 — one tap here unlocked a door). */
  ask?: SwitchAsk | null;
}

export default function EntityRowToggle({ entityId, actualOn, label, onToggle, ask = null }: Props) {
  const send = useCallback(() => onToggle(), [onToggle]);
  const { isOn, toggle } = useOptimisticToggle(entityId, actualOn, send);
  const { asking, request, confirm, cancel } = useAskFirst(ask, () => { tapFeedback(); toggle(); });

  return (
    <>
    <button
      className={`summary-entity-toggle${isOn ? " on" : ""}`}
      onClick={request}
      role="switch"
      aria-checked={isOn}
      aria-label={`${label}: ${isOn ? "on" : "off"}`}
      title={isOn ? "Turn off" : "Turn on"}
    >
      <span className="knob" />
    </button>
    {asking && (
      <div className="summary-entity-confirm">
        <InlineConfirm question={asking.question} confirmLabel={asking.confirmLabel} onConfirm={confirm} onCancel={cancel} />
      </div>
    )}
    </>
  );
}
