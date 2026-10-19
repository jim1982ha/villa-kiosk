// src/agent/agentView.ts
// The decisions the agent UI makes, as pure functions — so an oracle can drive
// them by value (tests/oracles/agent_view.mjs) instead of reading components.

import type { AgentMessage, AgentStatus } from "./agentApi";
import { displayLabelFor } from "@/config/EntityMap";
import { effectiveCategory, subjectOf } from "@/config/EntityCategories";
import type { Category, EntityType } from "@/types/scene.types";

/** Show anything about the agent at all? Everything is absent while the add-on
 *  has no agent token (PLAN A8: "Everything absent when not_configured"), and
 *  while the status is not known yet — a flash of "offline" on every page load
 *  would be a false statement. */
export function agentVisible(status: AgentStatus | null): boolean {
  return status != null && status.state !== "not_configured";
}

/** Are the VESTA Agent's sources listed (the (i)'s "From the VESTA Agent" rows)? An Agent that answers, or one of its
 *  faults still open — the cards wear its icons, so the table says what they mean even while it is not answering
 *  (2.496.360: its rows vanished from the (i) while its icons stayed on the cards). `openAgentFault`: one is open. */
export function agentSourcesShown(status: AgentStatus | null, openAgentFault: boolean): boolean {
  return agentVisible(status) || openAgentFault;
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
  views: Readonly<Record<string, { name: string; category: string }>> = {},
): { rooms: Record<string, string>; names: Record<string, string>; categories: Record<string, string>; key: string } | null {
  const sorted = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const rooms = sorted(Object.fromEntries(Object.entries(resolved).filter((e): e is [string, string] => !!e[1])));
  const names = sorted(Object.fromEntries(Object.entries(views).map(([id, v]) => [id, v.name])));
  const categories = sorted(Object.fromEntries(Object.entries(views).map(([id, v]) => [id, v.category])));
  const key = JSON.stringify({ rooms, names, categories });
  return key === JSON.stringify({ rooms: {}, names: {}, categories: {} }) || key === lastSent ? null
    : { rooms, names, categories, key };
}

/** Each mapped device as every Kiosk screen names and files it — its name (EntityMap.displayLabelFor: a stored
 *  id-fallback label is no name, Home Assistant's friendly name is) and its category (effectiveCategory, device_class
 *  included). Shared with the add-on beside its rooms (RoomShare), so the VESTA Agent's villa model — and its Telegram
 *  messages — call a device what the Kiosk calls it.
 *
 *  ⚠️ THE ADD-ON HAD ITS OWN RULE (architecture review scan 3, 2026-10-19): it read the stored label (often the
 *  id-fallback every auto-bound device stores) and the stored category (often empty, or a legacy default): a device
 *  the Kiosk named "Pool pump" could be "pool_pump_switch" to the Agent. As with rooms, it is told the answer. */
export function deviceViews(
  entityMap: Readonly<Record<string, { label?: string; type: EntityType; category?: Category; categoryPicked?: true }>>,
  entities: Readonly<Record<string, { attributes?: { friendly_name?: unknown; device_class?: unknown } }>>,
): Record<string, { name: string; category: string }> {
  return Object.fromEntries(Object.entries(entityMap).map(([id, m]) => {
    const e = entities[id];
    const friendly = typeof e?.attributes?.friendly_name === "string" ? e.attributes.friendly_name : undefined;
    return [id, { name: displayLabelFor(id, m.label, friendly), category: effectiveCategory(subjectOf(id, m, e)) }];
  }));
}
