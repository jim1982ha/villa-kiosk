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

interface Props {
  entityId: string;
  /** Live, HA-confirmed "is this on" for this row's domain (a lock reads
   *  inverted — see SummaryGroupPanel, which owns that rule). */
  actualOn: boolean;
  /** Accessible name for the switch, already resolved by the caller. */
  label: string;
  /** Fire the real service call. */
  onToggle: () => void;
}

export default function EntityRowToggle({ entityId, actualOn, label, onToggle }: Props) {
  const send = useCallback(() => { onToggle(); }, [onToggle]);
  const { isOn, toggle } = useOptimisticToggle(entityId, actualOn, send);

  return (
    <button
      className={`summary-entity-toggle${isOn ? " on" : ""}`}
      onClick={() => { tapFeedback(); toggle(); }}
      role="switch"
      aria-checked={isOn}
      aria-label={`${label}: ${isOn ? "on" : "off"}`}
      title={isOn ? "Turn off" : "Turn on"}
    >
      <span className="knob" />
    </button>
  );
}
