// src/messages/noticeModel.ts
// What the villa's announcements and VESTA's messages put on the screen as they arrive: the one taking the whole screen,
// and the notices passing, each for its own time. How each shows is noticeFor's (messages/announcements: one time for
// every notice); this keeps them together. Pure: tests/oracles/announcements.mjs drives it event by event;
// components/hud/AnnouncementNotice holds the state and each notice's timer.
//
// ⚠️ EACH NOTICE ITS OWN TIME, NONE REPLACING ANOTHER (owner, 2026-10-29: an approval's notice "replaced by the other
// notifications about a sensor being triggered"; then: every notice "shall remain few seconds … the user will find the
// same card in the Cockpit"): a notice arriving is added beside the ones still showing, never in their place — only its
// own rewrite takes its place. A ring's notice no longer stays until answered: its card in the Inbox keeps the Unlock.

import { noticeFor, type Announcement, type ShowSettings } from "./announcements";
import { idOf, supersedes } from "./messagesModel";

/** The most notices on screen at once: the newest (a burst of sensors never covers the map). */
export const NOTICES_SHOWN = 3;

export interface NoticeState {
  /** The one holding the whole screen, for `ms`. */
  full: { announcement: Announcement; ms: number } | null;
  /** The notices showing, oldest first, each for its own `ms` (noticeFor: one time for all). */
  shown: { announcement: Announcement; ms: number }[];
  /** The ones on screen that arrived as a rewrite (messagesModel.idOf): their notice says what changed (its step). */
  steps: readonly string[];
}

export const NO_NOTICE: NoticeState = { full: null, shown: [], steps: [] };

export type NoticeEvent =
  /** One announcement arrived (each of a read, oldest first); `rewrite`: it rewrites one the page held. */
  | { type: "arrived"; announcement: Announcement; rewrite: boolean; settings: ShowSettings }
  /** The full screen's time ran out, Close, or this tablet's switch turned off. */
  | { type: "fullEnded" }
  /** A notice's own time ran out (`id`: which — messagesModel.idOf). */
  | { type: "noticeEnded"; id: string }
  /** Its ✕. */
  | { type: "dismissed"; id: string }
  /** Everything the add-on keeps now (both feeds), after any read. */
  | { type: "kept"; kept: readonly Announcement[] };


export function noticeStep(s: NoticeState, e: NoticeEvent): NoticeState {
  switch (e.type) {
    case "arrived": {
      const a = e.announcement;
      // a rewrite takes its first's place wherever it is (the ring answered: its Unlock is withdrawn)
      const shown = s.shown.filter((x) => !supersedes(a, x.announcement));
      const full = s.full && supersedes(a, s.full.announcement) ? null : s.full;
      const steps = e.rewrite ? [...s.steps, idOf(a)] : s.steps;
      const how = noticeFor(a, e.settings, { rewrite: e.rewrite });
      if (how.fullScreenMs !== null) return { full: { announcement: a, ms: how.fullScreenMs }, shown, steps };
      return { full, shown: [...shown, { announcement: a, ms: how.noticeMs }].slice(-NOTICES_SHOWN), steps };
    }
    case "fullEnded":
      return s.full ? { ...s, full: null } : s;
    case "noticeEnded":
    case "dismissed": {
      const shown = s.shown.filter((x) => idOf(x.announcement) !== e.id);
      return shown.length === s.shown.length ? s : { ...s, shown };
    }
    case "kept": {
      // ⚠️ A RING THAT ENDED GOES, EVEN UNSEEN (owner, 2026-10-28: "it's not disappearing"): its end replaces it only as
      // it ARRIVES; a tablet asleep, offline or reloaded at that moment reads it in a whole read, which announces nothing.
      // One the add-on no longer keeps as it was, or that a kept one stands in place of (supersedes: its end, VESTA's
      // card of it), leaves the screen — by the same rule as on arrival.
      const ids = new Set(e.kept.map(idOf));
      const still = (a: Announcement) => ids.has(idOf(a)) && !e.kept.some((k) => supersedes(k, a));
      const shown = s.shown.filter((x) => still(x.announcement));
      const full = s.full && !still(s.full.announcement) ? null : s.full;
      // a step remembered only while its notice may still be on screen
      const steps = s.steps.filter((id) => ids.has(id));
      return shown.length === s.shown.length && full === s.full && steps.length === s.steps.length ? s
        : { ...s, shown, full, steps };
    }
  }
}
