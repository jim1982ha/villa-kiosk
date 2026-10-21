// src/agent/agentApi.ts
// The Kiosk's side of the VESTA Agent (docs/agent-integration/PLAN.md A6-A8):
// its presence, and the rooms this device shares. (Its messages and their buttons were removed, 2.496.443: the agent
// sends none — people talk to it on Telegram.) The agent itself never talks to this code — it uses /agent/v1 with its own token; this
// is what an owner or facility manager's session reads from the add-on.
//
// Every read narrows what the server sent to the shapes below and drops the
// rest, as fmApi does: a newer add-on must not be able to inject shapes this
// build does not render, and an older one must not crash it.

import { ingressPath } from "@/ha/ingress";
import { backendFetch } from "@/auth/sessionLost";
import CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };

export type AgentState = "not_configured" | "offline" | "online";

export interface AgentStatus {
  state: AgentState;
  /** ISO time of the last heartbeat, or null if none was ever received. */
  lastSeen: string | null;
  /** The agent's own one-line status, if it sent one. */
  statusText: string | null;
  /** Its own timing, as its heartbeat says it (agent-contract.json `heartbeat`): how often it looks at its alerts and
   *  faults, and the villa time of its nightly check — null from an agent that does not say. */
  cadence: AgentCadence | null;
}

/** How often the Agent looks at its alerts and faults (minutes), the villa time of its nightly check ("HH:MM"), and
 *  when its look last started (an ISO moment; absent from an older Agent): the card's Next check counts from it. */
export interface AgentCadence { checkMinutes: number; nightlyAt: string; lastLookAt?: string }

// The lists are the agreement's (rootfs/usr/share/vesta/agent-contract.json),
// the ones the proxy checks against — they were typed here a second time.
const STATUS_STATES = CONTRACT.status.states as readonly AgentState[];

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

export function parseAgentStatus(raw: unknown): AgentStatus {
  const b = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    state: oneOf(b.state, STATUS_STATES, "not_configured"),
    lastSeen: typeof b.last_seen === "string" ? b.last_seen : null,
    statusText: typeof b.status === "string" && b.status ? b.status : null,
    cadence: parseCadence(b.cadence),
  };
}

function parseCadence(raw: unknown): AgentCadence | null {
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!(c && typeof c.checkMinutes === "number" && typeof c.nightlyAt === "string")) return null;
  return { checkMinutes: c.checkMinutes, nightlyAt: c.nightlyAt,
    ...(typeof c.lastLookAt === "string" && !Number.isNaN(Date.parse(c.lastLookAt)) ? { lastLookAt: c.lastLookAt } : {}) };
}

/** null = could not reach the add-on (never shown as "not configured"). */
export async function fetchAgentStatus(): Promise<AgentStatus | null> {
  try {
    const r = await backendFetch(ingressPath("agent-status"), { credentials: "same-origin" });
    if (!r.ok) return null;
    return parseAgentStatus(await r.json());
  } catch {
    return null;
  }
}

/** Share the rooms THIS device resolved for the villa's devices, so the
 *  agent's villa model can place a device Home Assistant has no area for
 *  exactly where the Kiosk shows it (see RoomShare). */
export async function shareKioskRooms(rooms: Record<string, string>, names: Record<string, string> = {},
  categories: Record<string, string> = {}): Promise<boolean> {
  try {
    const r = await backendFetch(ingressPath("kiosk-rooms"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { rooms, names, categories } }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
