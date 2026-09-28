// src/agent/agentApi.ts
// The Kiosk's side of the VESTA Agent (docs/agent-integration/PLAN.md A6-A8):
// its presence, its messages, and the button presses people make. The agent
// itself never talks to this code — it uses /agent/v1 with its own token; this
// is what an owner or facility manager's session reads from the add-on.
//
// Every read narrows what the server sent to the shapes below and drops the
// rest, as fmApi does: a newer add-on must not be able to inject shapes this
// build does not render, and an older one must not crash it.

import { ingressPath } from "@/ha/ingress";
import { backendFetch } from "@/auth/sessionLost";

export type AgentState = "not_configured" | "offline" | "online";

export interface AgentStatus {
  state: AgentState;
  /** ISO time of the last heartbeat, or null if none was ever received. */
  lastSeen: string | null;
  /** The agent's own one-line status, if it sent one. */
  statusText: string | null;
  offlineAfterMinutes: number;
}

export type AgentMessageKind = "message" | "report" | "recommendation";
export type AgentSeverity = "info" | "warning" | "critical";
export type AgentMessageState = "open" | "answered" | "expired";

export interface AgentButton { id: string; label: string }

export interface AgentAnswer { buttonId: string; profile: string; at: string }

export interface AgentMessage {
  id: string;
  kind: AgentMessageKind;
  title: string;
  /** Markdown. */
  body: string;
  severity: AgentSeverity;
  entities: string[];
  buttons: AgentButton[];
  state: AgentMessageState;
  answer: AgentAnswer | null;
  /** THIS profile may press this message's buttons now (the server's answer:
   *  open, has buttons, and this profile is in its allowed_profiles). The
   *  client additionally hides buttons while the agent is offline (A8). */
  canAnswer: boolean;
  createdAt: string;
  expiresAt: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

export function parseAgentStatus(raw: unknown): AgentStatus {
  const b = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    state: oneOf(b.state, ["not_configured", "offline", "online"] as const, "not_configured"),
    lastSeen: typeof b.last_seen === "string" ? b.last_seen : null,
    statusText: typeof b.status === "string" && b.status ? b.status : null,
    offlineAfterMinutes: typeof b.offline_after_minutes === "number" ? b.offline_after_minutes : 5,
  };
}

export function parseAgentMessages(raw: unknown): AgentMessage[] {
  const doc = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(doc.messages) ? doc.messages : [];
  const out: AgentMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (!str(m.id) || !str(m.title)) continue;
    const answer = m.answer && typeof m.answer === "object" ? (m.answer as Record<string, unknown>) : null;
    out.push({
      id: str(m.id),
      kind: oneOf(m.kind, ["message", "report", "recommendation"] as const, "message"),
      title: str(m.title),
      body: str(m.body),
      severity: oneOf(m.severity, ["info", "warning", "critical"] as const, "info"),
      entities: Array.isArray(m.entities) ? m.entities.filter((e): e is string => typeof e === "string") : [],
      buttons: Array.isArray(m.buttons)
        ? m.buttons.flatMap((b) => (b && typeof b === "object" && str((b as Record<string, unknown>).id)
          ? [{ id: str((b as Record<string, unknown>).id), label: str((b as Record<string, unknown>).label) }]
          : []))
        : [],
      state: oneOf(m.state, ["open", "answered", "expired"] as const, "open"),
      answer: answer ? { buttonId: str(answer.button_id), profile: str(answer.profile), at: str(answer.at) } : null,
      canAnswer: m.can_answer === true,
      createdAt: str(m.created_at),
      expiresAt: typeof m.expires_at === "string" ? m.expires_at : null,
    });
  }
  return out;
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

export async function fetchAgentMessages(): Promise<AgentMessage[] | null> {
  try {
    const r = await backendFetch(ingressPath("agent-messages"), { credentials: "same-origin" });
    if (!r.ok) return null;
    const d = (await r.json()) as { data?: unknown };
    return parseAgentMessages(d.data);
  } catch {
    return null;
  }
}

export type AnswerResult =
  | { ok: true }
  | { ok: false; alreadyAnswered: AgentAnswer | null; message: string };

/** Press one button. The server takes the profile from the session and the
 *  time from its own clock; the first press wins and a later one is refused
 *  (409) with who answered. */
export async function answerAgentMessage(messageId: string, buttonId: string): Promise<AnswerResult> {
  try {
    const r = await backendFetch(ingressPath("agent-choices"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { choices: [{ message_id: messageId, button_id: buttonId }] } }),
    });
    if (r.ok) return { ok: true };
    const d = (await r.json().catch(() => ({}))) as { error?: unknown; answer?: unknown };
    const a = d.answer && typeof d.answer === "object" ? (d.answer as Record<string, unknown>) : null;
    return {
      ok: false,
      alreadyAnswered: r.status === 409 && a
        ? { buttonId: str(a.button_id), profile: str(a.profile), at: str(a.at) } : null,
      message: str(d.error) || `The kiosk refused the answer (HTTP ${r.status}).`,
    };
  } catch {
    return { ok: false, alreadyAnswered: null, message: "The kiosk could not be reached." };
  }
}

/** Share the rooms THIS device resolved for the villa's devices, so the
 *  agent's villa model can place a device Home Assistant has no area for
 *  exactly where the Kiosk shows it (see RoomShare). */
export async function shareKioskRooms(rooms: Record<string, string>): Promise<boolean> {
  try {
    const r = await backendFetch(ingressPath("kiosk-rooms"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { rooms } }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
