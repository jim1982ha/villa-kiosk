// src/messages/messagesModel.ts
// The Cockpit's Messages tab (ticket 17 of "One inbox", owner 2026-10-28): what it lists, its filters' counts and the
// item open on the right, from the open issues (config/cockpitIssues), the watched faults and the villa's
// announcements (messages/announcements), and what this tablet has not seen yet (ticket 18). One pure model every
// Messages screen reads; the later tickets add the reports and VESTA's conversation to it. Pure:
// tests/oracles/messages_model.mjs.

import type { CardView } from "@/config/cockpitCard";
import { alertStage, incidentKey, type Announcement } from "./announcements";

export type MessagesFilter = "all" | "issues" | "notifications" | "reports";

/** The filters, in their order on their one line. */
export const FILTERS: readonly { id: MessagesFilter; label: string }[] = [
  { id: "all", label: "All" },
  // ⚠️ "ISSUES", NOT "OPEN ISSUES" (owner, 2026-10-28): it lists a problem's whole life — open, watched, closed —
  // its count the open ones only
  { id: "issues", label: "Issues" },
  { id: "notifications", label: "Notifications" },
  // ticket 20 of "One inbox": the facility manager's daily, weekly and monthly reports, the night check's message
  { id: "reports", label: "Reports" },
];

export type MessageItem =
  | { kind: "issue"; key: string; card: CardView }
  | { kind: "notification"; key: string; announcement: Announcement }
  | { kind: "report"; key: string; announcement: Announcement };

export interface MessagesView {
  /** Each filter with its count (Open issues: the open issues; the others none). */
  filters: { id: MessagesFilter; label: string; count: number | null }[];
  /** The open issues, in their order; then the watched faults and VESTA's cards of alerts that cleared (placeOf
   *  "watch"), folded after them, never counted. */
  issues: MessageItem[];
  watched: MessageItem[];
  /** The announcements, newest first. */
  notifications: MessageItem[];
  /** Alerts that are closed — VESTA's card "#90-P2 (closed)", the villa's own ✅ message — newest first: their own
   *  folded section, after Watch (owner, 2026-10-28), never among the notifications (announcements.alertStage). */
  closed: MessageItem[];
  /** VESTA's reports, newest first: their own filter and section, never among the notifications. */
  reports: MessageItem[];
  /** The item open on the right: the one asked for when listed, else the issue a device window's warning asked
   *  for, else the first listed; null when nothing is listed. */
  selected: MessageItem | null;
  /** Why it is open: asked for, a warning's, or only the first listed — a phone shows an item someone chose (asked,
   *  a warning) and the list otherwise, so an item that went never leaves another one open by itself. */
  openedBy: "asked" | "focus" | "first" | null;
  /** Which parts the filter shows: the issues' (Open issues, Watch, Closed), the notifications', the reports'. */
  shows: { issues: boolean; notifications: boolean; reports: boolean };
}

/** A notification's key: VESTA's card its thread's (one card per alert, replaced as VESTA rewrites it); an
 *  announcement's own key (a ring and its rewrite are one line, kept while it is rewritten), else its number in the
 *  add-on's store. */
const noteKey = (a: Announcement) => (a.feed === "vesta" ? `v:${a.key}` : a.key ? `k:${a.key}` : `n${a.seq}`);

/** VESTA's report (the job that sent it is named): listed under Reports, never as a notification. */
export const isReport = (a: Announcement): boolean => !!a.report;

/** Where a record no issue holds is listed. */
export type Place = "notification" | "report" | "watch" | "closed";

/** ⚠️ THE ONE RULE OF WHERE A RECORD IS LISTED (architecture review 2026-10-29, round 2: the list and the unread mark
 *  each had their own, and they drifted three times — the mark lit for what the list put elsewhere, or not for what it
 *  showed): a report under Reports; an alert by its stage — over in Watch (cleared, still watched) or Closed, "parked in
 *  Watch or Closed" (owner, 2026-10-28), else a notification —; any other record that asked and is answered or over
 *  (isFinished) in Closed; anything else a notification. ⚠️ NOTIFICATIONS HOLD WHAT STILL WAITS FOR SOMEONE (owner,
 *  2026-10-29: "anything finished goes to Closed … in a generic and consistent way"): answered approvals and every ring
 *  sat there for ever. messagesView lists by it, unreadOf counts by it. VESTA's card of an alert with an issue is the
 *  issue's (cardsOfIssue), before this. */
export function placeOf(a: Announcement): Place {
  if (isReport(a)) return "report";
  const s = alertStage(a);
  if (s === "watch" || s === "closed") return s;
  return s === null && isFinished(a) ? "closed" : "notification";
}

/** A record whose question is answered or over: it offered buttons (the add-on's `asked`, agent-contract.json `_asked`)
 *  and offers none now — whoever asked (VESTA's approval, the villa's ring, any later one). Pure. */
export const isFinished = (a: Announcement): boolean => a.asked === true && a.buttons.length === 0;

/** One record's identity on the page: two feeds number apart, so VESTA's numbers are marked. */
export const idOf = (a: Announcement): string => `${a.feed === "vesta" ? "v" : ""}${a.seq}`;

/** VESTA's card of each alert an open issue carries, in the order of its lines (its thread `incident:<n>`, the Agent's
 *  kiosk_messages.thread_key): what the issue shows above its own buttons, as Telegram shows it. Pure. */
export function cardsOfIssue(card: CardView, kept: readonly Announcement[]): Announcement[] {
  return card.lines.flatMap((l) => { const a = messageOfLine(l, kept); return a ? [a] : []; });
}

/** VESTA's card of one line's alert (its thread `incident:<n>`), or null: the line's message inside the issue's one card
 *  (cockpit/IssueCard AlertIssueCard). Pure. */
export function messageOfLine(line: CardView["lines"][number], kept: readonly Announcement[]): Announcement | null {
  return line.alertNumber === undefined ? null
    : kept.find((a) => a.feed === "vesta" && a.key === incidentKey(line.alertNumber!)) ?? null;
}

/** When a record came, for the order of the list (two feeds: their numbers do not compare). */
const timeOf = (a: Announcement) => Date.parse(a.at) || 0;
/** The list's one order: by time, oldest first, then by number. */
const byTime = (x: Announcement, y: Announcement) => timeOf(x) - timeOf(y) || x.seq - y.seq;

/**
 * What the tablet lists as notifications (tickets 26-27 of "One inbox", owner 2026-10-28: "update the existing card,
 * the same way it is done on Telegram"): VESTA's cards, and the villa's own announcements EXCEPT those a card took over —
 * an alert VESTA took over is ONE card, whatever the villa sent for it (the alert, its repeat, its all-clear), as on
 * Telegram. Without VESTA (stopped, not installed) nothing is taken over and the villa's own show, so the list never
 * goes blank. Oldest first. Pure: tests/oracles/messages_model.mjs.
 */
export function shownTogether(villa: readonly Announcement[], vesta: readonly Announcement[]): Announcement[] {
  return [...villa.filter((a) => !vesta.some((c) => supersedes(c, a))), ...vesta].sort(byTime);
}

/**
 * Whether `newer` stands in place of `older` — ⚠️ THE ONE RULE (owner, 2026-10-28: "the same code … consistently used"),
 * read by the Messages list (shownTogether) and by the notice (noticeModel), on arrival and against what is kept: its
 * rewrite (the same key, the same feed: a ring answered, VESTA's card at its next step), or VESTA's card that took the
 * villa's own message over (its run among the card's `takes`). Pure.
 */
export const supersedes = (newer: Announcement, older: Announcement): boolean => newer !== older
  && ((newer.key !== null && newer.key === older.key && newer.feed === older.feed && newer.seq > older.seq)
    || (!!older.run && (newer.takes ?? []).includes(older.run)));

/** What the page holds after `incoming`: each one added once, a rewrite (same key, a newer number) in place of what
 *  it rewrites, an older copy never over a newer. Ordered by number, oldest first, as the add-on keeps them. */
export function mergeAnnouncements(held: readonly Announcement[], incoming: readonly Announcement[]): Announcement[] {
  // each record once (a re-read brings the same number again), then none another stands in place of (supersedes)
  const all = [...new Map([...held, ...incoming].map((a) => [idOf(a), a] as const)).values()];
  return all.filter((a) => !all.some((b) => supersedes(b, a))).sort((x, y) => x.seq - y.seq);
}

/** What a read of the add-on's feed (messages/feed watchFeed) changes on the page: what it holds now, and what just
 *  ARRIVED for the notice — every one of a read that is not a baseline, oldest first, each saying whether it rewrites
 *  one the page already held (the ring answered, timed out: it never takes the screen again). ⚠️ DECIDED FROM WHAT THE
 *  PAGE HELD (review Q 1, 2026-10-28): the notice kept its own memory of the rings it had shown, empty after a reload or
 *  a wake-up, so the rewrite of a ring the page had read in its baseline took the whole screen for "Ring shown for".
 *  ⚠️ EVERY ONE, not the newest alone (review Q round 2): a ring arriving with another in one read was never shown. */
export function afterRead(held: readonly Announcement[], items: readonly Announcement[], full: boolean, first = 0,
  kept: readonly number[] | null = null):
  { kept: Announcement[]; arrived: { announcement: Announcement; rewrite: boolean }[] } {
  // ⚠️ WHAT THE ADD-ON NO LONGER KEEPS GOES (review Q round 2): a tablet left on kept every announcement it ever read —
  // past the records-kept days, their photos refused — while one opened later listed what the add-on keeps
  // ...and one erased (held, then the superadmin code: owner, 2026-10-29), named no longer in what it keeps
  const still = (h: Announcement) => h.seq >= first && (kept === null || kept.includes(h.seq));
  const merged = mergeAnnouncements(full ? [] : held.filter(still), items);
  if (full) return { kept: merged, arrived: [] };
  const arrived = [...items].sort((x, y) => x.seq - y.seq)
    .map((a) => ({ announcement: a, was: a.key !== null ? held.find((h) => h.key === a.key && h.seq < a.seq) : undefined }))
    // ⚠️ A QUIET REWRITE IS NO NEWS (ticket 27): VESTA redraws a card whose bottom line stays (a title retouched, its
    // words translated) — on Telegram a quiet edit, never a ping; a new step (reminder, escalation, cleared) changes it
    .filter(({ announcement: a, was }) => !(a.feed === "vesta" && was && was.status === a.status))
    .map(({ announcement, was }) => ({ announcement, rewrite: was !== undefined }));
  return { kept: merged, arrived };
}

/** An announcement in words, the same on every screen (review Q 5): its title, the line under it — the first of
 *  what it says, else its bottom line ("✅ Done at 10:00") — and when it came. The notice draws "title · line", the
 *  Messages list the two lines. */
export function announcementWords(a: Announcement, { step = false }: { step?: boolean } = {}):
  { title: string; line: string; at: string } {
  // ⚠️ A REWRITE SAYS WHAT CHANGED (owner, 2026-10-29: refused, its notice still read "Approval request · Turn on Indoor
  // Top?" as if it waited): the notice of a rewrite (`step`: a reminder, a decision, a ring answered) says its bottom line
  return { title: a.title, line: (step && a.status) || a.text.split("\n")[0] || a.status, at: a.at };
}

/** The announcements the Messages tab shows as read on this tablet (ticket 18; review Q 5: decided here, not in the
 *  tab): the page shown of the Notifications or the Reports filter (`pages`: each section's page on screen), and the
 *  one open on the right. On All they sit under the open issues, maybe below the fold: drawn there is not seen. */
export function readOnScreen(filter: MessagesFilter,
  pages: { notifications?: readonly MessageItem[]; reports?: readonly MessageItem[] }, open: MessageItem | null,
  kept: readonly Announcement[] = []): Announcement[] {
  const page = (filter === "notifications" ? pages.notifications : filter === "reports" ? pages.reports : undefined) ?? [];
  // an issue open on the right shows VESTA's card of its alert: read too (its line is the card's only line)
  return [...page, ...(open ? [open] : [])]
    .flatMap((i) => (i.kind === "issue" ? cardsOfIssue(i.card, kept) : [i.announcement]));
}

/** What this tablet remembers it has shown: one announcement as the add-on stored it, its number and when it came. A
 *  rewrite (a new number) is news again; so is the first of a store that started again (an old number, a new time). */
// ⚠️ VESTA'S CARD BY ITS STEP, NOT ITS NUMBER (spec review, 2026-10-29): a quiet rewrite (its bottom line unchanged)
// comes under a new number and lit the unread mark again; a new step (reminder, escalation) changes the bottom line
const readId = (a: Announcement) => (a.feed === "vesta" ? `v:${a.key}@${a.status}` : `${idOf(a)}@${a.at}`);

/** How many of the kept announcements this tablet has not shown in Messages yet: the light mark on the robot, the
 *  phone's gear and the menu's Cockpit row. The open issues are not in it: they have their own count — nor VESTA's card
 *  of an alert listed with its issue (`issues`: the open and watched cards, messagesView's own rule, cardsOfIssue). */
export function unreadOf(kept: readonly Announcement[], read: readonly string[],
  issues: readonly CardView[] = []): number {
  const seen = new Set(read);
  // ⚠️ LISTED WITH ITS ISSUE, NO UNREAD (architecture review 2026-10-29 #2): counted, the mark opened Messages on an
  // empty Notifications and stayed lit until someone opened that issue's line
  const withIssue = new Set(issues.flatMap((c) => cardsOfIssue(c, kept)));
  // what Notifications and Reports list (placeOf), not yet shown: an alert that is over is parked in Watch or Closed,
  // folded (owner, 2026-10-28) — counted, it would keep the mark lit with nothing to read there
  return kept.filter((a) => !withIssue.has(a) && (placeOf(a) === "notification" || placeOf(a) === "report")
    && !seen.has(readId(a))).length;
}

/** What this tablet has shown once Messages showed `shown`: added to what it had, kept only while the add-on still
 *  keeps it, so the list never outgrows the add-on's. */
export function markShown(read: readonly string[], shown: readonly Announcement[], kept: readonly Announcement[]): string[] {
  const still = new Set(kept.map(readId));
  return [...new Set([...read, ...shown.map(readId)])].filter((id) => still.has(id));
}

/** The filter Messages opens on: a device window's warning on Open issues, its issue open; the wrench's "Open a ticket"
 *  on All; else Notifications while something is unread (the robot opens on what was not seen) — Reports when the
 *  unread are reports only (`unreadReports` of `unread`) —, else All. Decided before the first draw: a first draw on
 *  Notifications would mark its page read before anyone saw it. */
export function openingFilter(unread: number, opening: { warning?: boolean; form?: boolean } = {}, unreadReports = 0):
  MessagesFilter {
  if (opening.warning) return "issues";
  if (opening.form || unread <= 0) return "all";
  return unread > unreadReports ? "notifications" : "reports";
}

export function messagesView({ open, watched, announcements, filter, selected, focus }: {
  open: readonly CardView[];
  watched: readonly CardView[];
  announcements: readonly Announcement[];
  filter: MessagesFilter;
  /** The item asked for (its key); null: none. */
  selected: string | null;
  /** The issue a device window's warning opened the Cockpit for. */
  focus?: (card: CardView) => boolean;
}): MessagesView {
  const issueItem = (card: CardView): MessageItem => ({ kind: "issue", key: card.key, card });
  const showIssues = filter === "all" || filter === "issues";
  const showNotes = filter === "all" || filter === "notifications";
  const showReports = filter === "all" || filter === "reports";
  const issues = showIssues ? open.map(issueItem) : [];
  const watchedItems = showIssues ? watched.map(issueItem) : [];
  // ⚠️ A WATCHED ALERT IS LISTED ONCE, IN WATCH (owner, 2026-10-28): its card is open on its Watch line, never also a
  // notification
  // ⚠️ AN ALERT WITH A TICKET IS LISTED ONCE, WITH ITS ISSUE (owner, 2026-10-29, as Telegram shows one message): its
  // card opens on its Open issues or Watch line, never also a notification line
  const inWatch = new Set([...open, ...watched].flatMap((c) => cardsOfIssue(c, announcements)));
  // newest first, by time (two feeds: their numbers do not compare)
  const asNotes = (shown: boolean, keep: (a: Announcement) => boolean, kind: "notification" | "report" = "notification"):
    MessageItem[] => (shown
    ? announcements.filter((a) => !inWatch.has(a) && keep(a)).sort((x, y) => byTime(y, x))
      .map((a) => ({ kind, key: noteKey(a), announcement: a }))
    : []);
  // ⚠️ A PROBLEM'S LIFE IS ONE PLACE (owner, 2026-10-28): open, then watched once it cleared, then closed — Watch and
  // Closed are shown with the issues, never with the notifications
  // each record in ONE place (placeOf): a report under Reports, an alert that is over in Watch or Closed
  const closed = asNotes(showIssues, (a) => placeOf(a) === "closed");
  const watchedCards = asNotes(showIssues, (a) => placeOf(a) === "watch");
  const notifications = asNotes(showNotes, (a) => placeOf(a) === "notification");
  const reports = asNotes(showReports, (a) => placeOf(a) === "report", "report");
  const watchedAll = [...watchedItems, ...watchedCards];
  const listed = [...issues, ...notifications, ...reports, ...watchedAll, ...closed];
  const asked = listed.find((i) => i.key === selected);
  const focused = focus ? issues.find((i) => i.kind === "issue" && focus(i.card)) : undefined;
  const first = listed[0];
  return {
    filters: FILTERS.map((f) => ({ ...f, count: f.id === "issues" ? open.length : null })),
    issues,
    watched: watchedAll,
    notifications,
    closed,
    reports,
    selected: asked ?? focused ?? first ?? null,
    openedBy: asked ? "asked" : focused ? "focus" : first ? "first" : null,
    shows: { issues: showIssues, notifications: showNotes, reports: showReports },
  };
}
