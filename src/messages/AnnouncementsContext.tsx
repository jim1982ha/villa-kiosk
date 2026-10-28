// src/messages/AnnouncementsContext.tsx
// The page's ONE watch on the add-on's announcements (ticket 17 of "One inbox"): what it keeps, for the Cockpit's
// Notifications, and what just came, for the notice (components/hud/AnnouncementNotice). They were the notice's own
// watch, which threw the list away; two watches would read the add-on twice and could disagree. It also holds what
// this tablet has shown in Messages (ticket 18), for the unread mark on the robot, the gear and the menu's Cockpit row,
// and what became of each button pressed (review Q 2), whichever screen it was pressed on.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode } from "react";
import { backendFetch } from "@/auth/sessionLost";
import { readJson, writeJson } from "@/utils/storedJson";
import { fetchAnnouncements, fetchVestaMessages, pressButton, type Announcement } from "./announcements";
import { pauseFor, watchFeed, type FeedRead } from "./feed";
import { afterRead, isReport, markShown, shownTogether, unreadOf } from "./messagesModel";
import { pressesOf, type PressState, type Presses } from "./presses";
import { useCockpitIssues } from "@/components/cockpit/useVillaAttention";

/** What this tablet has shown in Messages (messagesModel.markShown): per tablet, so in this browser's storage. Private
 *  mode or a full store keeps it for the page only: storedJson never throws. */
const READ_KEY = "villa-kiosk:messages-read";
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

interface Announcements {
  /** What the tablet lists (messagesModel.shownTogether): VESTA's cards and the villa's announcements none of them
   *  took over, a ring and its rewrite one, oldest first. */
  kept: Announcement[];
  /** The villa's own announcements only, everything the add-on keeps ("Full screen for" offers their titles). */
  villa: Announcement[];
  /** Whether the add-on has answered once: until then `kept` is empty because nothing was read yet. */
  loaded: boolean;
  /** What came since the page opened, the latest read's (messagesModel.afterRead), each saying whether it rewrites one
   *  the page held; `n` counts the reads, so the same ones are shown once. */
  fresh: { arrived: { announcement: Announcement; rewrite: boolean }[]; n: number } | null;
}

interface AnnouncementsAndUnread extends Announcements {
  /** How many kept announcements this tablet has not shown in Messages yet (messagesModel.unreadOf). */
  unread: number;
  /** How many of them are VESTA's reports (Messages opens on Reports when they are all the unread). */
  unreadReports: number;
  /** Messages showed these: read on this tablet from now on. */
  shown: (items: readonly Announcement[]) => void;
  /** The page's one record of presses (messages/presses). */
  presses: Presses;
}

const NONE: Announcements = { kept: [], villa: [], loaded: false, fresh: null };

/** One feed's records on the page and the latest read's arrivals (messagesModel.afterRead). */
interface FeedState { kept: Announcement[]; loaded: boolean; fresh: Announcements["fresh"] }
const NO_FEED: FeedState = { kept: [], loaded: false, fresh: null };

/** The page's one watch on one of the add-on's feeds. */
function useFeed(read: (after: number | null, stop: AbortSignal) => Promise<FeedRead<Announcement> | null>): FeedState {
  const [state, setState] = useState<FeedState>(NO_FEED);
  useEffect(() => {
    const stop = new AbortController();
    void watchFeed(read, (items, full, first) => setState((s) => {
      const { kept, arrived } = afterRead(s.kept, items, full, first);
      return { kept, loaded: true, fresh: arrived.length ? { arrived, n: (s.fresh?.n ?? 0) + 1 } : s.fresh };
    }), stop.signal, pauseFor);
    return () => stop.abort();
  }, [read]);
  return state;
}
const NO_PRESSES = pressesOf(async () => "failed");
const AnnouncementsContext = createContext<AnnouncementsAndUnread>({ ...NONE, unread: 0, unreadReports: 0, shown: () => {}, presses: NO_PRESSES });

export function AnnouncementsProvider({ children }: { children: ReactNode }) {
  // ⚠️ TWO FEEDS, ONE LIST (tickets 26-27 of "One inbox"): the villa's announcements and VESTA's cards are read apart
  // (each its own numbers) and shown together, a card in place of the villa's messages it took over
  const villa = useFeed(fetchAnnouncements);
  const vesta = useFeed(fetchVestaMessages);
  // what just came: the arrivals of the feed whose read is new only — the other feed's last read was shown already
  const seen = useRef({ villa: 0, vesta: 0, fresh: null as Announcements["fresh"] });
  const state = useMemo<Announcements>(() => {
    const was = seen.current;
    const nv = villa.fresh?.n ?? 0, nm = vesta.fresh?.n ?? 0;
    const arrived = [...(nv > was.villa ? villa.fresh?.arrived ?? [] : []), ...(nm > was.vesta ? vesta.fresh?.arrived ?? [] : [])];
    const fresh = arrived.length ? { arrived, n: (was.fresh?.n ?? 0) + 1 } : was.fresh;
    seen.current = { villa: nv, vesta: nm, fresh };
    return { kept: shownTogether(villa.kept, vesta.kept), villa: villa.kept, loaded: villa.loaded, fresh };
  }, [villa, vesta]);
  const [read, setRead] = useState<string[]>(() => readJson(READ_KEY, isIds) ?? []);
  const { kept } = state;
  const shown = useCallback((items: readonly Announcement[]) => setRead((r) => {
    const next = markShown(r, items, kept);
    // the same list again (Messages re-drawn, nothing new shown) changes nothing, so nothing re-draws
    return next.length === r.length && next.every((id, i) => id === r[i]) ? r : next;
  }), [kept]);
  useEffect(() => { writeJson(READ_KEY, read); }, [read]);
  const presses = useMemo(() => pressesOf((key, command) => pressButton(key, command, backendFetch)), []);
  // the open and watched issues: VESTA's card of an alert listed with its issue is read there, never unread here
  const { open, watched } = useCockpitIssues();
  const issueCards = useMemo(() => [...open, ...watched], [open, watched]);
  const value = useMemo(() => ({ ...state, unread: unreadOf(kept, read, issueCards),
    unreadReports: unreadOf(kept.filter(isReport), read), shown, presses }),
    [state, kept, read, issueCards, shown, presses]);
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
