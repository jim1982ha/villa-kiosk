// src/messages/messagesModel.ts
// The Cockpit's Messages tab (ticket 17 of "One inbox", owner 2026-10-28): what it lists, its filters' counts and the
// item open on the right, from the open issues (config/cockpitIssues), the watched faults and the villa's
// announcements (messages/announcements), and what this tablet has not seen yet (ticket 18). One pure model every
// Messages screen reads; the later tickets add the reports and VESTA's conversation to it. Pure:
// tests/oracles/messages_model.mjs.

import type { CardView } from "@/config/cockpitCard";
import type { Announcement } from "./announcements";

export type MessagesFilter = "all" | "issues" | "notifications";

/** The filters, in their order on their one line. */
export const FILTERS: readonly { id: MessagesFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "issues", label: "Open issues" },
  { id: "notifications", label: "Notifications" },
];

export type MessageItem =
  | { kind: "issue"; key: string; card: CardView }
  | { kind: "notification"; key: string; announcement: Announcement };

export interface MessagesView {
  /** Each filter with its count (Open issues: the open issues; the others none). */
  filters: { id: MessagesFilter; label: string; count: number | null }[];
  /** The open issues, in their order; then the watched faults, folded after them, never counted. */
  issues: MessageItem[];
  watched: MessageItem[];
  /** The announcements, newest first. */
  notifications: MessageItem[];
  /** The item open on the right: the one asked for when listed, else the issue a device window's warning asked
   *  for, else the first listed; null when nothing is listed. */
  selected: MessageItem | null;
  /** Why it is open: asked for, a warning's, or only the first listed — a phone shows an item someone chose (asked,
   *  a warning) and the list otherwise, so an item that went never leaves another one open by itself. */
  openedBy: "asked" | "focus" | "first" | null;
  /** Which parts the filter shows. */
  shows: { issues: boolean; notifications: boolean };
}

/** A notification's key: VESTA's card its thread's (one card per alert, replaced as VESTA rewrites it); an
 *  announcement's own key (a ring and its rewrite are one line, kept while it is rewritten), else its number in the
 *  add-on's store. */
const noteKey = (a: Announcement) => (a.feed === "vesta" ? `v:${a.key}` : a.key ? `k:${a.key}` : `n${a.seq}`);

/** One record's identity on the page: two feeds number apart, so VESTA's numbers are marked. */
export const idOf = (a: Announcement): string => `${a.feed === "vesta" ? "v" : ""}${a.seq}`;

/** VESTA's card of each alert an open issue carries, in the order of its lines (its thread `incident:<n>`, the Agent's
 *  kiosk_messages.thread_key): what the issue shows above its own buttons, as Telegram shows it. Pure. */
export function cardsOfIssue(card: CardView, kept: readonly Announcement[]): Announcement[] {
  return card.lines.flatMap((l) => kept.filter((a) => a.feed === "vesta" && l.alertNumber !== undefined
    && a.key === `incident:${l.alertNumber}`));
}

/** When a record came, for the order of the list (two feeds: their numbers do not compare). */
const timeOf = (a: Announcement) => Date.parse(a.at) || 0;

/**
 * What the tablet lists as notifications (tickets 26-27 of "One inbox", owner 2026-10-28: "update the existing card,
 * the same way it is done on Telegram"): VESTA's cards, and the villa's own announcements EXCEPT those a card took over —
 * an alert VESTA took over is ONE card, whatever the villa sent for it (the alert, its repeat, its all-clear), as on
 * Telegram. Without VESTA (stopped, not installed) nothing is taken over and the villa's own show, so the list never
 * goes blank. Oldest first. Pure: tests/oracles/messages_model.mjs.
 */
export function shownTogether(villa: readonly Announcement[], vesta: readonly Announcement[]): Announcement[] {
  const taken = new Set(vesta.flatMap((c) => c.takes ?? []));
  return [...villa.filter((a) => !(a.run && taken.has(a.run))), ...vesta]
    .sort((x, y) => timeOf(x) - timeOf(y) || x.seq - y.seq);
}

/** What the page holds after `incoming`: each one added once, a rewrite (same key, a newer number) in place of what
 *  it rewrites, an older copy never over a newer. Ordered by number, oldest first, as the add-on keeps them. */
export function mergeAnnouncements(held: readonly Announcement[], incoming: readonly Announcement[]): Announcement[] {
  const byKey = new Map<string, Announcement>();
  for (const a of [...held, ...incoming]) {
    const k = noteKey(a);
    const was = byKey.get(k);
    if (!was || a.seq > was.seq) byKey.set(k, a);
  }
  return [...byKey.values()].sort((x, y) => x.seq - y.seq);
}

/** What a read of the add-on's feed (messages/feed watchFeed) changes on the page: what it holds now, and what just
 *  ARRIVED for the notice — every one of a read that is not a baseline, oldest first, each saying whether it rewrites
 *  one the page already held (the ring answered, timed out: it never takes the screen again). ⚠️ DECIDED FROM WHAT THE
 *  PAGE HELD (review Q 1, 2026-10-28): the notice kept its own memory of the rings it had shown, empty after a reload or
 *  a wake-up, so the rewrite of a ring the page had read in its baseline took the whole screen for "Ring shown for".
 *  ⚠️ EVERY ONE, not the newest alone (review Q round 2): a ring arriving with another in one read was never shown. */
export function afterRead(held: readonly Announcement[], items: readonly Announcement[], full: boolean, first = 0):
  { kept: Announcement[]; arrived: { announcement: Announcement; rewrite: boolean }[] } {
  // ⚠️ WHAT THE ADD-ON NO LONGER KEEPS GOES (review Q round 2): a tablet left on kept every announcement it ever read —
  // past the records-kept days, their photos refused — while one opened later listed what the add-on keeps
  const kept = mergeAnnouncements(full ? [] : held.filter((h) => h.seq >= first), items);
  if (full) return { kept, arrived: [] };
  const arrived = [...items].sort((x, y) => x.seq - y.seq)
    .map((a) => ({ announcement: a, was: a.key !== null ? held.find((h) => h.key === a.key && h.seq < a.seq) : undefined }))
    // ⚠️ A QUIET REWRITE IS NO NEWS (ticket 27): VESTA redraws a card whose bottom line stays (a title retouched, its
    // words translated) — on Telegram a quiet edit, never a ping; a new step (reminder, escalation, cleared) changes it
    .filter(({ announcement: a, was }) => !(a.feed === "vesta" && was && was.status === a.status))
    .map(({ announcement, was }) => ({ announcement, rewrite: was !== undefined }));
  return { kept, arrived };
}

/** An announcement in words, the same on every screen (review Q 5): its title, the line under it — the first of
 *  what it says, else its bottom line ("✅ Done at 10:00") — and when it came. The notice draws "title · line", the
 *  Messages list the two lines. */
export function announcementWords(a: Announcement): { title: string; line: string; at: string } {
  return { title: a.title, line: a.text.split("\n")[0] || a.status, at: a.at };
}

/** The announcements the Messages tab shows as read on this tablet (ticket 18; review Q 5: decided here, not in the
 *  tab): the Notifications filter's page shown, and the one open on the right. On All they sit under the open issues,
 *  maybe below the fold: drawn there is not seen. */
export function readOnScreen(filter: MessagesFilter, page: readonly MessageItem[], open: MessageItem | null): Announcement[] {
  return [...(filter === "notifications" ? page : []), ...(open ? [open] : [])]
    .flatMap((i) => (i.kind === "notification" ? [i.announcement] : []));
}

/** What this tablet remembers it has shown: one announcement as the add-on stored it, its number and when it came. A
 *  rewrite (a new number) is news again; so is the first of a store that started again (an old number, a new time). */
const readId = (a: Announcement) => `${idOf(a)}@${a.at}`;

/** How many of the kept announcements this tablet has not shown in Messages yet: the light mark on the robot, the
 *  phone's gear and the menu's Cockpit row. The open issues are not in it: they have their own count. */
export function unreadOf(kept: readonly Announcement[], read: readonly string[]): number {
  const seen = new Set(read);
  return kept.filter((a) => !seen.has(readId(a))).length;
}

/** What this tablet has shown once Messages showed `shown`: added to what it had, kept only while the add-on still
 *  keeps it, so the list never outgrows the add-on's. */
export function markShown(read: readonly string[], shown: readonly Announcement[], kept: readonly Announcement[]): string[] {
  const still = new Set(kept.map(readId));
  return [...new Set([...read, ...shown.map(readId)])].filter((id) => still.has(id));
}

/** The filter Messages opens on: a device window's warning on Open issues, its issue open; the wrench's "Open a ticket"
 *  on All; else Notifications while something is unread (the robot opens on what was not seen), else All. Decided
 *  before the first draw: a first draw on Notifications would mark its page read before anyone saw it. */
export function openingFilter(unread: number, opening: { warning?: boolean; form?: boolean } = {}): MessagesFilter {
  if (opening.warning) return "issues";
  return !opening.form && unread > 0 ? "notifications" : "all";
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
  const showIssues = filter !== "notifications";
  const showNotes = filter !== "issues";
  const issues = showIssues ? open.map(issueItem) : [];
  const watchedItems = showIssues ? watched.map(issueItem) : [];
  const notifications: MessageItem[] = showNotes
    ? [...announcements].sort((x, y) => timeOf(y) - timeOf(x) || y.seq - x.seq).map((a) => ({ kind: "notification", key: noteKey(a), announcement: a }))
    : [];
  const listed = [...issues, ...watchedItems, ...notifications];
  const asked = listed.find((i) => i.key === selected);
  const focused = focus ? issues.find((i) => i.kind === "issue" && focus(i.card)) : undefined;
  const first = listed[0];
  return {
    filters: FILTERS.map((f) => ({ ...f, count: f.id === "issues" ? open.length : null })),
    issues,
    watched: watchedItems,
    notifications,
    selected: asked ?? focused ?? first ?? null,
    openedBy: asked ? "asked" : focused ? "focus" : first ? "first" : null,
    shows: { issues: showIssues, notifications: showNotes },
  };
}
