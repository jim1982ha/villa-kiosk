// src/fm/ticketGroups.ts
// One TICKET per device (owner, 2026-10-14): the records someone took on together for a device show as one ticket in
// the Tickets tab. Each stays its own record underneath, so the VESTA Agent can still clear one problem by itself
// (its record closes; the ticket stays while another is in progress, and goes to Closed with its last one).
// Pure — tests/oracles/live_issues.mjs.

import type { FmTicket } from "./fmTypes";

export interface TicketGroup {
  /** The device's key (deviceGroups.deviceOf), else the record's own id — a fault on no device is a ticket alone. */
  key: string;
  records: FmTicket[];
}

/** `records` grouped by device, in the order each device first appears. */
export function ticketGroups(records: readonly FmTicket[], deviceOf: (entityId: string) => string): TicketGroup[] {
  const out = new Map<string, TicketGroup>();
  for (const t of records) {
    const key = t.entityId ? deviceOf(t.entityId) : `ticket:${t.id}`;
    const g = out.get(key) ?? { key, records: [] };
    g.records.push(t);
    out.set(key, g);
  }
  return [...out.values()];
}
