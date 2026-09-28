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

/** May THIS device offer a message's buttons right now? The server says
 *  whether the profile may (canAnswer); buttons are hidden while the agent is
 *  offline too, because nobody would act on the answer (A8). */
export function buttonsShown(message: AgentMessage, status: AgentStatus | null): boolean {
  return message.canAnswer && status?.state === "online" && message.buttons.length > 0;
}

/** The count on the top-bar button: open messages this profile can answer. */
export function awaitingAnswer(messages: readonly AgentMessage[], status: AgentStatus | null): number {
  return messages.filter((m) => buttonsShown(m, status)).length;
}

/** "Answered by Facility manager · Approve" — the button's label if it still
 *  exists on the message, else its id. */
export function answerLine(message: AgentMessage, profileLabel: (p: string) => string): string | null {
  if (!message.answer) return null;
  const button = message.buttons.find((b) => b.id === message.answer?.buttonId);
  return `Answered by ${profileLabel(message.answer.profile)} · ${button?.label || message.answer.buttonId}`;
}
