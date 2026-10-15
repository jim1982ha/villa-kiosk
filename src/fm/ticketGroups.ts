// src/fm/ticketGroups.ts
// One TICKET per device (owner, 2026-10-14): the records someone took on together for a device show as one ticket in
// the Tickets tab. Each stays its own record underneath, so the VESTA Agent can still clear one problem by itself
// (its record closes; the ticket stays while another is in progress, and goes to Closed with its last one).
// Pure — tests/oracles/live_issues.mjs, facility_counts.mjs.

import type { FmTicket } from "./fmTypes";
import { isTicketOpen, stageOf } from "./fmEngine";

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

/** What the Cockpit counts as open, in the unit it DRAWS: devices. `faults` — the devices with a fault nobody has taken
 *  on (each an Overview card with "Open Ticket"); `tickets` — the tickets in progress (one card per device in Tickets);
 *  `total` — the devices with anything open. ⚠️ ONE UNIT (architecture review, 2026-10-15): the pump's two faults taken
 *  on together showed one ticket card under "2 in progress", and readiness said "2 open tickets". The figures that
 *  must stay per record (a repair's mean time, the closed list) are ticketStats'. */
export interface OpenCounts { faults: number; tickets: number; total: number }

export function openCounts(records: readonly FmTicket[], deviceOf: (entityId: string) => string): OpenCounts {
  const open = records.filter(isTicketOpen);
  const devices = (rs: readonly FmTicket[]) => ticketGroups(rs, deviceOf).length;
  return {
    faults: devices(open.filter((t) => stageOf(t) === "fault")),
    tickets: devices(open.filter((t) => stageOf(t) === "ticket")),
    total: devices(open),
  };
}
