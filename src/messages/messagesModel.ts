// src/messages/messagesModel.ts
// The Cockpit's Messages tab (ticket 17 of "One inbox", owner 2026-10-28): what it lists, its filters' counts and the
// item open on the right, from the open issues (config/cockpitIssues), the watched faults and the villa's
// announcements (messages/announcements). One pure model every Messages screen reads; the later tickets add the
// reports, VESTA's conversation and the unread marks to it. Pure: tests/oracles/messages_model.mjs.

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

/** A notification's key: its announcement's own (a ring and its rewrite are one line, kept while it is rewritten),
 *  else its number in the add-on's store. */
const noteKey = (a: Announcement) => (a.key ? `k:${a.key}` : `n${a.seq}`);

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
    ? [...announcements].sort((x, y) => y.seq - x.seq).map((a) => ({ kind: "notification", key: noteKey(a), announcement: a }))
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
