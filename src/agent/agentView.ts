// src/agent/agentView.ts
// The decisions the agent UI makes, as pure functions — so an oracle can drive
// them by value (tests/oracles/agent_view.mjs) instead of reading components.

import type { AgentStatus } from "./agentApi";
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
