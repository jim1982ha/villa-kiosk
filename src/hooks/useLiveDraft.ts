// src/hooks/useLiveDraft.ts
// A control's value that FOLLOWS the device until the person takes hold of it
// — a slider, a stepper — AND the sending of it: on release by any means
// (pointer, keyboard, a cancelled touch goes back instead), and back to the
// device's value when Home Assistant refuses. The rules are the pure
// utils/liveDraft.draftStep; this only runs its effects.
//
// ⚠️ THREE VARIANTS BEFORE round 11 (2.496.165), and until 2.496.231 each
// panel still wired its own `onPointerUp` send — see utils/liveDraft.

import { useCallback, useEffect, useRef, useState } from "react";
import { draftStep, type DraftEvent, type DraftState } from "@/utils/liveDraft";
import { onFailure } from "@/ha/serviceOutcome";

/** How long the keyboard must be quiet before its value is sent. */
const KEY_SETTLE_MS = 400;

export interface LiveDraft<T> {
  value: T;
  /** Spread onto an <input type="range">. */
  rangeProps: {
    value: T;
    onPointerDown: () => void;
    onChange: (e: { target: { value: string } }) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
  /** Send one value now (a stepper press). */
  commit: (value: T) => void;
}

export function useLiveDraft<T>(
  live: T | undefined, fallback: T,
  /** Send a value — return the command's outcome so a refusal reverts. */
  send: (value: T) => unknown,
  parse: (raw: string) => T = (raw) => Number(raw) as T,
): LiveDraft<T> {
  const [state, setState] = useState<DraftState<T>>(() => ({ value: live ?? fallback, live: live ?? fallback, held: false }));
  const stateRef = useRef(state);
  const sendRef = useRef(send);
  sendRef.current = send;
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const dispatch = useCallback((e: DraftEvent<T>) => {
    const { state: next, effect } = draftStep(stateRef.current, e);
    stateRef.current = next;
    setState(next);
    const fire = () => onFailure(sendRef.current(stateRef.current.value), () => dispatch({ type: "refused" }));
    clearTimeout(timer.current);
    if (effect === "send-now") fire();
    else if (effect === "send-soon") timer.current = setTimeout(fire, KEY_SETTLE_MS);
  }, []);

  useEffect(() => { if (live !== undefined) dispatch({ type: "live", value: live }); }, [live, dispatch]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    value: state.value,
    rangeProps: {
      value: state.value,
      onPointerDown: () => dispatch({ type: "press" }),
      onChange: (e) => dispatch({ type: "move", value: parse(e.target.value) }),
      onPointerUp: () => dispatch({ type: "release" }),
      onPointerCancel: () => dispatch({ type: "cancel" }),
    },
    commit: (value) => dispatch({ type: "set", value }),
  };
}
