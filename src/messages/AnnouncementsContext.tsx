// src/messages/AnnouncementsContext.tsx
// The page's ONE watch on the add-on's announcements (ticket 17 of "One inbox"): what it keeps, for the Cockpit's
// Notifications, and what just came, for the notice (components/hud/AnnouncementNotice). They were the notice's own
// watch, which threw the list away; two watches would read the add-on twice and could disagree.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchAnnouncements, pauseFor, watchAnnouncements, type Announcement } from "./announcements";
import { mergeAnnouncements } from "./messagesModel";

interface Announcements {
  /** Everything the add-on keeps, a ring and its rewrite one (messagesModel.mergeAnnouncements), oldest first. */
  kept: Announcement[];
  /** What came since the page opened, the latest batch: `n` counts the batches, so the same one is shown once. */
  fresh: { items: Announcement[]; n: number } | null;
}

const NONE: Announcements = { kept: [], fresh: null };
const AnnouncementsContext = createContext<Announcements>(NONE);

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
  return <AnnouncementsContext.Provider value={state}>{children}</AnnouncementsContext.Provider>;
}

export const useAnnouncements = (): Announcements => useContext(AnnouncementsContext);
