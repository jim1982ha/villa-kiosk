// src/messages/recipients.ts
// Who gets the villa's messages, by role: the villa's own two lists (owner, 2026-11-03: "a single file on the villa,
// which VESTA also reads, so there's one place for both and alerts still work without VESTA").
//
// Each list is one of the villa's text helpers, holding the villa's notify entities (Telegram chats, phone apps) apart
// by ",". Every VESTA blueprint sends to them by priority (P1 both, P2 the facility manager; a notice, its "Who gets
// the message") with no VESTA Agent at all, and the Agent reads the same two (vesta_shared/villa_recipients.py). This
// tablet only edits them: Settings › Messages › Who gets the messages (components/settings/WhoGetsMessages).
// The helpers are defined in the Agent's message package (agent-src/homeassistant/packages/vesta_message.yaml).

/** Each role's list on the villa: the helper's entity id, and the profile whose words name it on screen (the
 *  facility manager is the Kiosk's `ops` profile). */
export const ROLE_LISTS = [
  { role: "owner", entityId: "input_text.vesta_owner_targets", profile: "owner" },
  { role: "fm", entityId: "input_text.vesta_fm_targets", profile: "ops" },
] as const;

/** What the villa's text helper holds at most (its `max`): a longer list is refused, never cut. */
export const LIST_MAX_CHARS = 255;

/** The notify entities a list's text names, once each, in its order ("unknown" and the like name none). */
export function targetsOf(text: string | undefined | null): string[] {
  const out: string[] = [];
  for (const part of (text ?? "").split(",")) {
    const id = part.trim().toLowerCase();
    if (id.startsWith("notify.") && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The text a list of notify entities is kept as; null when it does not fit the helper. */
export function textOf(ids: readonly string[]): string | null {
  const text = targetsOf(ids.join(",")).join(", ");
  return text.length <= LIST_MAX_CHARS ? text : null;
}
