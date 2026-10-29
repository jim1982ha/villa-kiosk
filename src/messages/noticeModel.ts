// src/messages/noticeModel.ts
// What the villa's announcements put on the screen as they arrive (review Q round 2, 2026-10-28): the one taking the
// whole screen, the rings still waiting for an answer, and the one passing. ⚠️ A RING THAT STAYS, STAYS: the notice had
// ONE place, so the next announcement (another gate, a power alert) replaced a ring still offering its Unlock, which
// was then gone from the screen while the villa waited; and a second one ended a ring's full screen early. How each
// shows is noticeFor's (messages/announcements); this keeps them together. Pure: tests/oracles/announcements.mjs drives
// it event by event; components/hud/AnnouncementNotice holds the state and its timers.

import { noticeFor, type Announcement, type ShowSettings } from "./announcements";
import { idOf, supersedes } from "./messagesModel";

export interface NoticeState {
  /** The one holding the whole screen, for `ms`; `stays`: its notice carries on after (it offers a button). */
  full: { announcement: Announcement; ms: number; stays: boolean } | null;
  /** The ones staying until answered (a ring offering its button) or closed, oldest first. */
  staying: Announcement[];
  /** The one passing, for `ms` (every other announcement: 10s). */
  passing: { announcement: Announcement; ms: number } | null;
  /** The ones on screen that arrived as a rewrite (messagesModel.idOf): their notice says what changed (its step). */
  steps: readonly string[];
}

export const NO_NOTICE: NoticeState = { full: null, staying: [], passing: null, steps: [] };

export type NoticeEvent =
  /** One announcement arrived (each of a read, oldest first); `rewrite`: it rewrites one the page held. */
  | { type: "arrived"; announcement: Announcement; rewrite: boolean; settings: ShowSettings }
  /** The full screen's time ran out, Close, or this tablet's switch turned off. */
  | { type: "fullEnded" }
  /** The passing one's time ran out (`id`: which — messagesModel.idOf —, a later one never ended by an earlier timer). */
  | { type: "passingEnded"; id: string }
  /** Its ✕ (a staying one). */
  | { type: "dismissed"; id: string }
  /** Everything the add-on keeps now (both feeds), after any read. */
  | { type: "kept"; kept: readonly Announcement[] };


export function noticeStep(s: NoticeState, e: NoticeEvent): NoticeState {
  switch (e.type) {
    case "arrived": {
      const a = e.announcement;
      // a rewrite takes its first's place wherever it is (the ring answered: its Unlock is withdrawn)
      const staying = s.staying.filter((x) => !supersedes(a, x));
      const passing = s.passing && supersedes(a, s.passing.announcement) ? null : s.passing;
      const full = s.full && supersedes(a, s.full.announcement) ? null : s.full;
      const how = noticeFor(a, e.settings, { rewrite: e.rewrite });
      const steps = e.rewrite ? [...s.steps, idOf(a)] : s.steps;
      if (how.fullScreenMs !== null) {
        // the screen goes to the newest picked one; one it took it from keeps its notice when that one stays
        const left = full?.stays ? [full.announcement] : [];
        return { full: { announcement: a, ms: how.fullScreenMs, stays: how.noticeMs === null }, staying: [...staying, ...left],
          passing, steps };
      }
      if (how.noticeMs === null) return { full, staying: [...staying, a], passing, steps };
      return { full, staying, passing: { announcement: a, ms: how.noticeMs }, steps };
    }
    case "fullEnded":
      if (!s.full) return s;
      return { ...s, full: null, staying: s.full.stays ? [...s.staying, s.full.announcement] : s.staying };
    case "passingEnded":
      return s.passing && idOf(s.passing.announcement) === e.id ? { ...s, passing: null } : s;
    case "kept": {
      // ⚠️ A RING THAT ENDED GOES, EVEN UNSEEN (owner, 2026-10-28: "it's not disappearing"): its end ("Not opened…",
      // "Opened at…") replaces it only as it ARRIVES; a tablet asleep, offline or reloaded at that moment reads it in a
      // whole read, which announces nothing, and the ring stayed with its Unlock until its ✕. One the add-on no longer
      // keeps as it was (tidied away), or that a kept one stands in place of (supersedes: its end, VESTA's card of it),
      // leaves the screen — by the same rule as on arrival.
      const ids = new Set(e.kept.map(idOf));
      const still = (a: Announcement) => ids.has(idOf(a)) && !e.kept.some((k) => supersedes(k, a));
      const staying = s.staying.filter(still);
      const full = s.full && !still(s.full.announcement) ? null : s.full;
      // a step remembered only while its notice may still be on screen
      const steps = s.steps.filter((id) => ids.has(id));
      return staying.length === s.staying.length && full === s.full && steps.length === s.steps.length ? s
        : { ...s, staying, full, steps };
    }
    case "dismissed":
      return { ...s, staying: s.staying.filter((x) => idOf(x) !== e.id),
        passing: s.passing && idOf(s.passing.announcement) === e.id ? null : s.passing };
  }
}
