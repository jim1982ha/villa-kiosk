// src/messages/presses.ts
// What became of each button pressed on an announcement (the doorbell's Unlock), ONE record for the page (review Q 2,
// 2026-10-28): the notice, its full screen and Messages each kept their own, so "Unlock" pressed on the notice was
// pressable again in Messages, a second open of the gate while the villa still waited. Kept per announcement as
// stored (its key and number): a rewrite starts afresh. The add-on refuses a press only once the villa withdrew the
// button, so a press already sent (or being sent) is refused here. Pure of React: tests/oracles/announcements.mjs
// drives it; messages/AnnouncementsContext holds the page's one.

import type { Announcement, PressOutcome } from "./announcements";
import { idOf as versionOf } from "./messagesModel";

/** What became of each button pressed, by command ("sending" until the add-on answers). */
export type PressState = Record<string, PressOutcome | "sending">;

const NONE: PressState = Object.freeze({}) as PressState;
// one stored version (messagesModel.idOf: two feeds number apart), never its number alone
const idOf = (a: Announcement) => `${a.key}@${versionOf(a)}`;

export interface Presses {
  /** The presses of `a` (the same object until one changes: a screen re-draws only then). */
  get(a: Announcement): PressState;
  /** Press `a`'s button `command`: sent once — again only after it failed. */
  press(a: Announcement, command: string): void;
  subscribe(listener: () => void): () => void;
}

/** The page's record of presses; `send` sends one (announcements.pressButton with the page's fetch). */
export function pressesOf(send: (key: string, command: string) => Promise<PressOutcome>): Presses {
  let all: Record<string, PressState> = {};
  const listeners = new Set<() => void>();
  const set = (id: string, command: string, to: PressOutcome | "sending") => {
    all = { ...all, [id]: { ...(all[id] ?? NONE), [command]: to } };
    listeners.forEach((l) => l());
  };
  return {
    get: (a) => all[idOf(a)] ?? NONE,
    press(a, command) {
      const key = a.key;
      if (!key) return;
      const id = idOf(a);
      const was = all[id]?.[command];
      if (was !== undefined && was !== "failed") return;
      set(id, command, "sending");
      void send(key, command).then((outcome) => set(id, command, outcome));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
