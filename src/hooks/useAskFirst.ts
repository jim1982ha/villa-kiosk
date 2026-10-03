// src/hooks/useAskFirst.ts
// The two-step tap for a device switch: act at once, or ask first when
// utils/devicePower's deviceSwitch says so. One hook for the power button,
// the lock panel, the device lists' row switch and a panel's linked switch,
// so none of them can forget to ask (2.496.259 — a list row unlocked a door
// in one tap).
//
// The question asked is remembered: if the device changes while the prompt
// is open (the lock locks itself, someone else unlocks it), the ask changes,
// the prompt closes, and the Confirm button can never send an action other
// than the one the person read.

import { useState } from "react";
import type { SwitchAsk } from "@/utils/devicePower";

export interface AskFirst {
  /** The open prompt, or null. */
  asking: SwitchAsk | null;
  /** The tap: acts now, or opens the prompt. */
  request: () => void;
  confirm: () => void;
  cancel: () => void;
}

export function useAskFirst(ask: SwitchAsk | null, act: () => void): AskFirst {
  const [asked, setAsked] = useState<string | null>(null);
  const asking = ask && asked === ask.question ? ask : null;
  return {
    asking,
    request: () => (ask ? setAsked(ask.question) : act()),
    confirm: () => { setAsked(null); act(); },
    cancel: () => setAsked(null),
  };
}
