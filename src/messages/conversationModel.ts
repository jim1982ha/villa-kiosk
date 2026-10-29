// src/messages/conversationModel.ts
// VESTA's conversation (ticket 21 of "One inbox", owner 2026-10-28): what a read of it changes on the page, and what its
// window shows. Pure: tests/oracles/conversation_model.mjs.

import { NEW_CONVERSATION, type Turn } from "./conversation";
import AGENT_CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };

/** How long the add-on keeps a question for VESTA to collect (agent-contract.json conversation.askKeptSeconds). */
const ASK_KEPT_MS = AGENT_CONTRACT.conversation.askKeptSeconds * 1000;
/** How long VESTA's "I am answering" is believed after it last said it (it says it again every minute while it works). */
const TYPING_MS = AGENT_CONTRACT.conversation.typingSeconds * 1000;

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
  /** When VESTA last said it is answering (ISO), while it says so; null otherwise. */
  typingAt: string | null;
}

/** What the conversation shows, from this profile's turns and whether VESTA runs. ⚠️ "NEW CONVERSATION" EMPTIES IT
 *  (owner, 2026-10-29: "the expectation is to see the modal to clear"): only what came after the person's last "/new"
 *  shows, as on Telegram's own fresh chat, VESTA's "New conversation." first. Pure. */
export function threadView(turns: readonly Turn[], online: boolean): ThreadView {
  const typing = turns.find((t) => t.typing && !t.gone);
  const fresh = turns.reduce((at, t) => (t.from === "person" && t.text === NEW_CONVERSATION ? t.seq : at), -1);
  return { shown: online, lines: turns.filter((t) => !t.gone && t.answers === null && !t.typing && t.seq > fresh),
    typingAt: typing?.at ?? null };
}

/** The sound of VESTA's answer that has just arrived (ticket 24, VESTA answers aloud): the newest of VESTA's turns naming
 *  a sound the page did not hold before (a turn comes first in words, then rewritten with its sound), or null. Pure. */
export function arrivedSpeech(before: readonly Turn[], after: readonly Turn[]): string | null {
  const had = new Set(before.map((t) => t.speech));
  const t = [...after].reverse().find((x) => x.from === "vesta" && !x.gone && x.speech !== null && !had.has(x.speech));
  return t?.speech ?? null;
}

/** ⚠️ ONLY THE TABLET THAT ASKED SPEAKS (ticket 24): every tablet signed in as the profile reads the answer, but its sound
 *  plays as it comes only where the person held the button (`spokenAt`, when that page sent its spoken question; null
 *  on every other) and while the add-on would still keep that question. Pure. */
export function playsAloud(spokenAt: number | null, now: number): boolean {
  return spokenAt !== null && 0 <= now - spokenAt && now - spokenAt <= ASK_KEPT_MS;
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

/** ⚠️ "VESTA IS ANSWERING" (owner, 2026-10-29: "a running indicator in the chat response bubble while VESTA is thinking
 *  or waiting for an answer … consistent with standard used in the market"): the dots in VESTA's bubble, as every chat
 *  app shows them — while VESTA says it is working (Telegram's "typing…", said again every minute: believed TYPING_MS
 *  after), and from the moment a question is sent until its answer comes (before VESTA has even read it), never past
 *  the time the add-on keeps a question (unanswered says so then). Pure. */
export function vestaWorking(view: ThreadView, now: number): boolean {
  if (view.typingAt && now - (Date.parse(view.typingAt) || 0) < TYPING_MS) return true;
  const last = view.lines[view.lines.length - 1];
  return !!last && last.from === "person" && now - (Date.parse(last.at) || now) <= ASK_KEPT_MS;
}
