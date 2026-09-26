// src/hooks/useLiveDraft.ts
// A control's value that FOLLOWS the device until the person takes hold of it
// — a slider, a stepper. While held, live updates are ignored (a state event
// mid-drag would snap it back and the release would send the stale number);
// once let go it follows again.
//
// ⚠️ THREE VARIANTS BEFORE THIS (round 11, 2.496.165): the cover's (a drag
// ref + a sync effect), the thermostat's (a sync effect, no drag guard) and
// the light's — a useState initialised once and never re-synced, so brightness
// and colour temperature started every drag from a stale value after the
// light changed elsewhere.

import { useCallback, useEffect, useRef, useState } from "react";

export function useLiveDraft<T>(live: T | undefined, fallback: T) {
  const [value, setValue] = useState<T>(live ?? fallback);
  const held = useRef(false);
  useEffect(() => {
    if (!held.current && live !== undefined) setValue(live);
  }, [live]);
  /** Take hold (pointer down): live updates stop moving the control. */
  const hold = useCallback(() => { held.current = true; }, []);
  /** Let go (pointer up): the control follows the device again. */
  const release = useCallback(() => { held.current = false; }, []);
  return { value, set: setValue, hold, release };
}
