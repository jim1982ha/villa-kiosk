// src/messages/noticeModel.ts
// What the villa's announcements put on the screen as they arrive (review Q round 2, 2026-10-28): the one taking the
// whole screen, the rings still waiting for an answer, and the one passing. ⚠️ A RING THAT STAYS, STAYS: the notice had
// ONE place, so the next announcement (another gate, a power alert) replaced a ring still offering its Unlock, which
// was then gone from the screen while the villa waited; and a second one ended a ring's full screen early. How each
// shows is noticeFor's (messages/announcements); this keeps them together. Pure: tests/oracles/announcements.mjs drives
// it event by event; components/hud/AnnouncementNotice holds the state and its timers.

import { noticeFor, type Announcement, type ShowSettings } from "./announcements";

export interface NoticeState {
  /** The one holding the whole screen, for `ms`; `stays`: its notice carries on after (it offers a button). */
  full: { announcement: Announcement; ms: number; stays: boolean } | null;
  /** The ones staying until answered (a ring offering its button) or closed, oldest first. */
  staying: Announcement[];
  /** The one passing, for `ms` (every other announcement: 10s). */
  passing: { announcement: Announcement; ms: number } | null;
}

export const NO_NOTICE: NoticeState = { full: null, staying: [], passing: null };

export type NoticeEvent =
  /** One announcement arrived (each of a read, oldest first); `rewrite`: it rewrites one the page held. */
  | { type: "arrived"; announcement: Announcement; rewrite: boolean; settings: ShowSettings }
  /** The full screen's time ran out, Close, or this tablet's switch turned off. */
  | { type: "fullEnded" }
  /** The passing one's time ran out (`seq`: which, a later one never ended by an earlier timer). */
  | { type: "passingEnded"; seq: number }
  /** Its ✕ (a staying one). */
  | { type: "dismissed"; seq: number };

const sameKey = (a: Announcement, b: Announcement) => a.key !== null && a.key === b.key;

export function noticeStep(s: NoticeState, e: NoticeEvent): NoticeState {
  switch (e.type) {
    case "arrived": {
      const a = e.announcement;
      // a rewrite takes its first's place wherever it is (the ring answered: its Unlock is withdrawn)
      const staying = s.staying.filter((x) => !sameKey(x, a));
      const passing = s.passing && sameKey(s.passing.announcement, a) ? null : s.passing;
      const full = s.full && sameKey(s.full.announcement, a) ? null : s.full;
      const how = noticeFor(a, e.settings, { rewrite: e.rewrite });
      if (how.fullScreenMs !== null) {
        // the screen goes to the newest picked one; one it took it from keeps its notice when that one stays
        const left = full?.stays ? [full.announcement] : [];
        return { full: { announcement: a, ms: how.fullScreenMs, stays: how.noticeMs === null }, staying: [...staying, ...left], passing };
      }
      if (how.noticeMs === null) return { full, staying: [...staying, a], passing };
      return { full, staying, passing: { announcement: a, ms: how.noticeMs } };
    }
    case "fullEnded":
      if (!s.full) return s;
      return { ...s, full: null, staying: s.full.stays ? [...s.staying, s.full.announcement] : s.staying };
    case "passingEnded":
      return s.passing?.announcement.seq === e.seq ? { ...s, passing: null } : s;
    case "dismissed":
      return { ...s, staying: s.staying.filter((x) => x.seq !== e.seq),
        passing: s.passing?.announcement.seq === e.seq ? null : s.passing };
  }
}
