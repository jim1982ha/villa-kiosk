// src/messages/AnnouncementsContext.tsx
// The page's ONE watch on the add-on's announcements (ticket 17 of "One inbox"): what it keeps, for the Cockpit's
// Notifications, and what just came, for the notice (components/hud/AnnouncementNotice). They were the notice's own
// watch, which threw the list away; two watches would read the add-on twice and could disagree. It also holds what
// this tablet has shown in Messages (ticket 18), for the unread mark on the robot, the gear and the menu's Cockpit row.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readJson, writeJson } from "@/utils/storedJson";
import { fetchAnnouncements, pauseFor, watchAnnouncements, type Announcement } from "./announcements";
import { markShown, mergeAnnouncements, unreadOf } from "./messagesModel";

/** What this tablet has shown in Messages (messagesModel.markShown): per tablet, so in this browser's storage. Private
 *  mode or a full store keeps it for the page only: storedJson never throws. */
const READ_KEY = "villa-kiosk:messages-read";
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

interface Announcements {
  /** Everything the add-on keeps, a ring and its rewrite one (messagesModel.mergeAnnouncements), oldest first. */
  kept: Announcement[];
  /** What came since the page opened, the latest batch: `n` counts the batches, so the same one is shown once. */
  fresh: { items: Announcement[]; n: number } | null;
}

interface AnnouncementsAndUnread extends Announcements {
  /** How many kept announcements this tablet has not shown in Messages yet (messagesModel.unreadOf). */
  unread: number;
  /** Messages showed these: read on this tablet from now on. */
  shown: (items: readonly Announcement[]) => void;
}

const NONE: Announcements = { kept: [], fresh: null };
const AnnouncementsContext = createContext<AnnouncementsAndUnread>({ ...NONE, unread: 0, shown: () => {} });

export function AnnouncementsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Announcements>(NONE);
  useEffect(() => {
    const stop = new AbortController();
    void watchAnnouncements(fetchAnnouncements,
      (items) => setState((s) => ({ ...s, fresh: { items, n: (s.fresh?.n ?? 0) + 1 } })),
      stop.signal, pauseFor,
      (items, full) => setState((s) => ({ ...s, kept: mergeAnnouncements(full ? [] : s.kept, items) })));
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
  const value = useMemo(() => ({ ...state, unread: unreadOf(kept, read), shown }), [state, kept, read, shown]);
  return <AnnouncementsContext.Provider value={value}>{children}</AnnouncementsContext.Provider>;
}

export const useAnnouncements = (): AnnouncementsAndUnread => useContext(AnnouncementsContext);
