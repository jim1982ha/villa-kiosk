// src/messages/AnnouncementsContext.tsx
// The page's ONE watch on the add-on's announcements (ticket 17 of "One inbox"): what it keeps, for the Cockpit's
// Notifications, and what just came, for the notice (components/hud/AnnouncementNotice). They were the notice's own
// watch, which threw the list away; two watches would read the add-on twice and could disagree. It also holds what
// this tablet has shown in Messages (ticket 18), for the unread mark on the robot, the gear and the menu's Cockpit row,
// and what became of each button pressed (review Q 2), whichever screen it was pressed on.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore,
  type ReactNode } from "react";
import { backendFetch } from "@/auth/sessionLost";
import { readJson, writeJson } from "@/utils/storedJson";
import { fetchAnnouncements, pressButton, type Announcement } from "./announcements";
import { pauseFor, watchFeed } from "./feed";
import { afterRead, markShown, unreadOf } from "./messagesModel";
import { pressesOf, type PressState, type Presses } from "./presses";

/** What this tablet has shown in Messages (messagesModel.markShown): per tablet, so in this browser's storage. Private
 *  mode or a full store keeps it for the page only: storedJson never throws. */
const READ_KEY = "villa-kiosk:messages-read";
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

interface Announcements {
  /** Everything the add-on keeps, a ring and its rewrite one (messagesModel.mergeAnnouncements), oldest first. */
  kept: Announcement[];
  /** What came since the page opened, the latest (messagesModel.afterRead): whether it rewrites one the page held, and
   *  `n` counting arrivals, so the same one is shown once. */
  fresh: { announcement: Announcement; rewrite: boolean; n: number } | null;
}

interface AnnouncementsAndUnread extends Announcements {
  /** How many kept announcements this tablet has not shown in Messages yet (messagesModel.unreadOf). */
  unread: number;
  /** Messages showed these: read on this tablet from now on. */
  shown: (items: readonly Announcement[]) => void;
  /** The page's one record of presses (messages/presses). */
  presses: Presses;
}

const NONE: Announcements = { kept: [], fresh: null };
const NO_PRESSES = pressesOf(async () => "failed");
const AnnouncementsContext = createContext<AnnouncementsAndUnread>({ ...NONE, unread: 0, shown: () => {}, presses: NO_PRESSES });

export function AnnouncementsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Announcements>(NONE);
  useEffect(() => {
    const stop = new AbortController();
    void watchFeed(fetchAnnouncements, (items, full) => setState((s) => {
      const { kept, arrived } = afterRead(s.kept, items, full);
      return { kept, fresh: arrived ? { ...arrived, n: (s.fresh?.n ?? 0) + 1 } : s.fresh };
    }), stop.signal, pauseFor);
    return () => stop.abort();
  }, []);
  const [read, setRead] = useState<string[]>(() => readJson(READ_KEY, isIds) ?? []);
  const { kept } = state;
  const shown = useCallback((items: readonly Announcement[]) => setRead((r) => {
    const next = markShown(r, items, kept);
    // the same list again (Messages re-drawn, nothing new shown) changes nothing, so nothing re-draws
    return next.length === r.length && next.every((id, i) => id === r[i]) ? r : next;
  }), [kept]);
  useEffect(() => { writeJson(READ_KEY, read); }, [read]);
  const presses = useMemo(() => pressesOf((key, command) => pressButton(key, command, backendFetch)), []);
  const value = useMemo(() => ({ ...state, unread: unreadOf(kept, read), shown, presses }),
    [state, kept, read, shown, presses]);
  return <AnnouncementsContext.Provider value={value}>{children}</AnnouncementsContext.Provider>;
}

export const useAnnouncements = (): AnnouncementsAndUnread => useContext(AnnouncementsContext);

const NOTHING_PRESSED: PressState = Object.freeze({}) as PressState;

/** Pressing `a`'s buttons, from any screen: what became of each press (the page's one record), and a press. */
export function useAnnouncementPress(a: Announcement | null): { presses: PressState; press: (command: string) => void } {
  const { presses } = useAnnouncements();
  const state = useSyncExternalStore(presses.subscribe, () => (a ? presses.get(a) : NOTHING_PRESSED));
  return { presses: state, press: (command) => { if (a) presses.press(a, command); } };
}
