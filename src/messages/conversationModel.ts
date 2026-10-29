// src/messages/conversationModel.ts
// VESTA's conversation (ticket 21 of "One inbox", owner 2026-10-28): what a read of it changes on the page, and what its
// window shows. Pure: tests/oracles/conversation_model.mjs.

import type { Turn } from "./conversation";
import AGENT_CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };

/** How long the add-on keeps a question for VESTA to collect (agent-contract.json conversation.askKeptSeconds). */
const ASK_KEPT_MS = AGENT_CONTRACT.conversation.askKeptSeconds * 1000;

/** What the page holds after a read: each key once (a rewrite, a newer number, in place of what it rewrites), what the
 *  add-on no longer keeps dropped (below `first`, or not among `kept`), oldest first. `full`: the read is everything the
 *  add-on keeps, so nothing held before stays. */
export function mergeTurns(held: readonly Turn[], incoming: readonly Turn[], full: boolean, first = 0,
  kept: readonly number[] | null = null): Turn[] {
  const still = (t: Turn) => t.seq >= first && (kept === null || kept.includes(t.seq));
  const byKey = new Map<string, Turn>();
  for (const t of [...(full ? [] : held.filter(still)), ...incoming]) {
    const was = byKey.get(t.key);
    if (!was || was.seq < t.seq) byKey.set(t.key, t);
  }
  return [...byKey.values()].sort((x, y) => x.seq - y.seq);
}

export interface ThreadView {
  /** The top bar's VESTA button and the menu's "Ask VESTA" are offered: only while VESTA runs (owner: nothing dead on
   *  screen). */
  shown: boolean;
  /** Its lines, oldest first: what VESTA withdrew is not among them. */
  lines: Turn[];
}

/** What the conversation shows, from this profile's turns and whether VESTA runs. */
export function threadView(turns: readonly Turn[], online: boolean): ThreadView {
  return { shown: online, lines: turns.filter((t) => !t.gone && t.answers === null) };
}

/** VESTA's short answers to this profile's presses, by the press's number (shown under the button pressed). Pure. */
export function answersOf(turns: readonly Turn[]): ReadonlyMap<number, string> {
  return new Map(turns.flatMap((t) => (t.answers !== null && t.text ? [[t.answers, t.text] as const] : [])));
}

/** Whether the last question had no answer and never will: nothing from VESTA after it, and older than the add-on keeps
 *  a question for VESTA to collect (VESTA stopped before it read it). The thread then says so, never a question left
 *  hanging. Pure. */
export function unanswered(lines: readonly Turn[], now: number): boolean {
  const last = lines[lines.length - 1];
  return !!last && last.from === "person" && now - (Date.parse(last.at) || now) > ASK_KEPT_MS;
}
