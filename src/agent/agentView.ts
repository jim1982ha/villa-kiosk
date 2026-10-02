// src/agent/agentView.ts
// The decisions the agent UI makes, as pure functions — so an oracle can drive
// them by value (tests/oracles/agent_view.mjs) instead of reading components.

import type { AgentMessage, AgentStatus } from "./agentApi";

/** Show anything about the agent at all? Everything is absent while the add-on
 *  has no agent token (PLAN A8: "Everything absent when not_configured"), and
 *  while the status is not known yet — a flash of "offline" on every page load
 *  would be a false statement. */
export function agentVisible(status: AgentStatus | null): boolean {
  return status != null && status.state !== "not_configured";
}

/** May THIS device offer a message's buttons right now? The SERVER decides
 *  (canAnswer): open, this profile allowed, and the agent online — nobody
 *  would act on an answer while it is offline (A8).
 *
 *  ⚠️ THE PAGE USED TO ADD THE "ONLINE" HALF ITSELF (until 2.496.251), from
 *  its own status poll, and the proxy's press door never asked it: a press
 *  from a tab opened before the agent went offline was stored for nobody.
 *  One owner per predicate — the proxy's _agent_messages_view. */
export function buttonsShown(message: AgentMessage): boolean {
  return message.canAnswer && message.buttons.length > 0;
}

/** The count on the top-bar button: open messages this profile can answer. */
export function awaitingAnswer(messages: readonly AgentMessage[]): number {
  return messages.filter((m) => buttonsShown(m)).length;
}

/** "Answered by Facility manager · Approve" — the button's label if it still
 *  exists on the message, else its id. */
export function answerLine(message: AgentMessage, profileLabel: (p: string) => string): string | null {
  if (!message.answer) return null;
  const button = message.buttons.find((b) => b.id === message.answer?.buttonId);
  return `Answered by ${profileLabel(message.answer.profile)} · ${button?.label || message.answer.buttonId}`;
}

/** Does clearing this message need a "sure?" first? Only while it is still
 *  OPEN with buttons: cleared, its question is gone and the agent never gets
 *  an answer. Answered, expired or plain messages clear at once. */
export function clearNeedsConfirm(message: AgentMessage): boolean {
  return message.state === "open" && message.buttons.length > 0;
}

/** The ids "Clear answered" removes: every answered or expired message. */
export function settledIds(messages: readonly AgentMessage[]): string[] {
  return messages.filter((m) => m.state === "answered" || m.state === "expired").map((m) => m.id);
}

/** What RoomShare should send, or null when nothing needs sending: the rooms
 *  this device resolved (empty ones dropped, in a stable order), unless they
 *  are exactly what this device last sent — kept across reloads, so the list
 *  goes out when a room CHANGES, not on every page load. */
export function roomsToShare(
  resolved: Readonly<Record<string, string | null | undefined>>,
  lastSent: string | null,
): { rooms: Record<string, string>; key: string } | null {
  const rooms = Object.fromEntries(
    Object.entries(resolved)
      .filter((e): e is [string, string] => !!e[1])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const key = JSON.stringify(rooms);
  return key === "{}" || key === lastSent ? null : { rooms, key };
}
