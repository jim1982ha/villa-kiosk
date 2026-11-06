// src/messages/recipients.ts
// Who gets the villa's messages, by role: the villa's own two lists (owner, 2026-11-03: "a single file on the villa,
// which VESTA also reads, so there's one place for both and alerts still work without VESTA").
//
// Each list is one of the villa's text helpers, holding the villa's notify entities (Telegram chats, phone apps) apart
// by ",". Every VESTA blueprint sends to them by priority (P1 both, P2 the facility manager; a notice, its "Who gets
// the message") with no VESTA Agent at all, and the Agent reads the same two (vesta_shared/villa_recipients.py). This
// tablet only edits them: Settings › Messages › Who gets the messages (components/settings/WhoGetsMessages).
// The helpers are defined in the Agent's message package (agent-src/homeassistant/packages/vesta_message.yaml).
//
// ⚠️ THE LISTS' HELPERS, THEIR SIZE AND HOW A LIST IS READ ARE THE AGREEMENT'S (agent-contract.json `recipients`,
// architecture review round 17): the Kiosk and the Agent each wrote their own copy, and a list one side read
// differently from the other would send an alert to someone the tablet does not show. Both drive their reading
// through the agreement's examples.

import AGENT_CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };

const AGREED = AGENT_CONTRACT.recipients;

/** Each role's list on the villa: the helper's entity id (the agreement's), and the profile whose words name it on
 *  screen (the facility manager is the Kiosk's `ops` profile: the Kiosk's own mapping). */
export const ROLE_LISTS = [
  { role: "owner", entityId: AGREED.lists.owner, profile: "owner" },
  { role: "fm", entityId: AGREED.lists.fm, profile: "ops" },
] as const;

/** What the villa's text helper holds at most (its `max`): a longer list is refused, never cut. */
export const LIST_MAX_CHARS: number = AGREED.maxChars;

/** Where a person edits the lists, in the menus' words (the agreement's `where`). */
export const LISTS_WHERE: string = AGREED.where;

/** The section's title in Settings › Messages: the last step of `where`, so the place the Agent sends a person to is
 *  the one the tablet shows. */
export const LISTS_TITLE: string = LISTS_WHERE.split(" › ").pop() ?? LISTS_WHERE;

/** The languages a chat can read VESTA's messages in, code → name, in the menu's order (the agreement's `languages`:
 *  the Agent writes in exactly these). */
export const CHAT_LANGUAGES: Readonly<Record<string, string>> = AGREED.languages;

/** Each chat's language as the villa's settings keep it (owner, 2026-11-03: set here beside the chat, never on the
 *  VESTA Agent's page): a notify entity id → a code of CHAT_LANGUAGES. Any other entry is left out; a chat it does not
 *  name reads English. undefined for a value that is no object (the tablet keeps its own). Pure: the add-on's server
 *  reads it by the same rule (supervisor-proxy.py _chat_languages), and tells the Agent in its heartbeat answer. */
export function parseChatLanguages(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(
    (e): e is [string, string] => e[0].startsWith(`${AGREED.domain}.`) && typeof e[1] === "string" && e[1] in CHAT_LANGUAGES));
}

/** What choosing `code` for chat `entity` writes: that chat's language, English (the default) kept as no entry. */
export function withChatLanguage(map: Readonly<Record<string, string>>, entity: string, code: string): Record<string, string> {
  const { [entity]: _old, ...rest } = map;
  return code === "en" ? rest : { ...rest, [entity]: code };
}

/** The chats of `before` that no list names now (`lists`: each list's chats after a change): their language goes with
 *  them. Pure. */
export function droppedChats(lists: readonly (readonly string[])[], before: readonly string[]): string[] {
  const kept = new Set(lists.flat());
  return before.filter((id) => !kept.has(id));
}

/** The notify entities a list's text names, once each, in its order ("unknown" and the like name none). */
export function targetsOf(text: string | undefined | null): string[] {
  const out: string[] = [];
  const prefix = `${AGREED.domain}.`;
  for (const part of (text ?? "").split(AGREED.separator)) {
    const id = part.trim().toLowerCase();
    if (id.startsWith(prefix) && id.length > prefix.length && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The text a list of notify entities is kept as; null when it does not fit the helper. */
export function textOf(ids: readonly string[]): string | null {
  const text = targetsOf(ids.join(AGREED.separator)).join(`${AGREED.separator} `);
  return text.length <= LIST_MAX_CHARS ? text : null;
}

/** One change to a list made in Settings and held until its Save (config/pendingEdits `hold`): a chat added (`on`) or
 *  taken off. */
export interface ListChange { id: string; on: boolean }

/** A list with the held changes laid over it, in their order: what the card shows, and what Save sends, over the
 *  villa's list as it is THEN (another tablet's change meanwhile is kept). Pure. */
export function withChanges(ids: readonly string[], changes: readonly ListChange[]): string[] {
  let out = [...ids];
  for (const c of changes) out = c.on ? (out.includes(c.id) ? out : [...out, c.id]) : out.filter((x) => x !== c.id);
  return out;
}

/** The held changes after one more over the villa's list `villa`: each chat's last change only, and none that the
 *  villa already holds (a chat taken off then added back is no change: Save greys again). Pure. */
export function heldChanges(villa: readonly string[], held: readonly ListChange[], next: ListChange): ListChange[] {
  return [...held.filter((c) => c.id !== next.id), next].filter((c) => villa.includes(c.id) !== c.on);
}
