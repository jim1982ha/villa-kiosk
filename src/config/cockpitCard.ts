// src/config/cockpitCard.ts
// ONE COCKPIT CARD, AS IT IS DRAWN (architecture review scan 1, 2026-10-19): its title and room, the icons before its
// name, its "Next check" and the date and time behind it, its buttons, and each problem's line — words, icons, what
// last happened on Telegram, its own Close. Pure; CockpitOverview draws exactly this, a check reads it by value.
//
// ⚠️ FIVE CALLS, ONE CARD: the page asked attention for a line's words (twice: once for its hover text), its icons,
// its buttons and the card's, and faultTiming for its next check, and worked out a line's latest Telegram note itself
// (`item.latest ?? item.fault?.latest`) — each reading the shape the grouping leaves behind (`fault`, `twins`). The
// "one line per problem" bugs of the week (10-13 a repeated icon, 10-17 "(6 times)", 10-18 "UNLOCKED — … UNLOCKED")
// were each fixed in one of those calls; the page now knows none of them.

import type { AgentCadence } from "@/agent/agentApi";
import { nextCheck, nextCheckAt } from "@/fm/faultTiming";
import type { WorkAction } from "@/fm/deviceWork";
import { momentText } from "@/utils/dateText";
import {
  attentionLineIn, cardActions, itemActions, lineIcon, lineSources, type AttentionGroup, type AttentionItem, type LineSources,
} from "./attention";

/** One problem's line inside the card. */
export interface CardLine {
  key: string;
  /** Its words ("Unlocked", "In progress: Back door stiff"); whole on hover. */
  text: string;
  /** Its source icons, only where the card's own do not say them already; null: none. */
  icons: LineSources | null;
  /** What last happened about it on Telegram — a reminder, an escalation, a button pressed. */
  latest: { note: string; at: string } | null;
  /** Its own Close, on a card holding several problems; [] otherwise. */
  actions: WorkAction[];
}

export interface CardView {
  key: string;
  title: string;
  room?: string;
  /** What a tap on the card opens; undefined: the card is the problem itself (no device). */
  entityId?: string;
  /** The icons before its name: where its first problem comes from. */
  lead: LineSources | null;
  /** "Next check: 02:00", and its moment ("20/10/2026 02:00") — null when it has none (live, by hand). */
  nextCheck: { text: string; at: string | null };
  /** Open Ticket / Edit Ticket / Close / Close all — on its records; [] for a card only the villa's system reports. */
  actions: WorkAction[];
  lines: CardLine[];
}

/** The card of `group`, as drawn. `cadence`: the VESTA Agent's own timing (null: it did not say). */
export function cockpitCard(group: AttentionGroup, cadence: AgentCadence | null, now: Date = new Date()): CardView {
  const at = nextCheckAt(group.items, cadence, now);
  const line = (item: AttentionItem): CardLine => ({
    key: item.id,
    text: attentionLineIn(group, item),
    icons: lineIcon(group, item),
    latest: item.latest ?? item.fault?.latest ?? null,
    actions: itemActions(group, item),
  });
  return {
    key: group.key, title: group.title, room: group.room, entityId: group.entityId,
    lead: group.items[0] ? lineSources(group.items[0]) : null,
    nextCheck: { text: nextCheck(group.items, cadence), at: at ? momentText(at) : null },
    actions: cardActions(group),
    lines: group.items.map(line),
  };
}
