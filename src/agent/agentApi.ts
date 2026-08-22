/**
 * The SPA's client for `/agent-config`.
 *
 * ⚠️ THE ENVELOPE KEY IS `config`, AND GETTING IT WRONG FAILS SILENTLY ON READ.
 * `_json_store_handlers` takes the key as an ARGUMENT — `/device-config` and
 * `/reports-config` wrap in `config`, `/fm-data` in `data`, `/reports-history`
 * in `history` — so a client written by copying a sibling inherits the wrong
 * one. `reportsApi.ts` was copied from `fmApi.ts` and used `data` at THREE
 * sites; only the PUT was visible, because a config store that parses to
 * nothing renders exactly like a property nobody has configured.
 * `tests/py/test_store_envelope.py` derives the key from the proxy and checks
 * every client that fetches the route.
 *
 * ⚠️ AND THE KEYS INSIDE THE ENVELOPE ARE THE SAME BUG ONE LEVEL DOWN. The
 * store speaks snake_case and this app speaks camelCase, and a key that differs
 * is ACCEPTED AND IGNORED rather than refused — a save returns 200 and the
 * setting is never read. `AGENT_WIRE_KEYS` states the mapping once, for both
 * directions.
 */

import { ingressPath } from "@/ha/ingress";

/** Wire name (what the store stores) → client name (what this app calls it). */
const AGENT_WIRE_KEYS = {
  enabled: "enabled",
  act_enabled: "actEnabled",
  triggers: "triggers",
  triage_minutes: "triageMinutes",
  brief_cadence: "briefCadence",
  monthly_limit: "monthlyLimit",
  chat_monthly_limit: "chatMonthlyLimit",
  max_turns: "maxTurns",
  max_tool_calls: "maxToolCalls",
  model_triage: "modelTriage",
  model_reason: "modelReason",
  model_brief: "modelBrief",
  allowed_senders: "allowedSenders",
  actuable_refs: "actuableRefs",
  suppressed_subjects: "suppressedSubjects",
} as const;

export type AgentTrigger = "scheduled" | "event" | "chat";

export interface AgentConfig {
  enabled: boolean;
  actEnabled: boolean;
  triggers: Record<AgentTrigger, boolean>;
  triageMinutes: number;
  briefCadence: string;
  monthlyLimit: number;
  chatMonthlyLimit: number;
  maxTurns: number;
  maxToolCalls: number;
  modelTriage: string;
  modelReason: string;
  modelBrief: string;
  /** ⚠️ EMPTY MEANS NOBODY MAY TALK TO THE BOT. Never seed this. */
  allowedSenders: Record<string, "owner" | "facility" | "ops">;
  /** ⚠️ EMPTY MEANS THE AGENT MAY ACT ON NOTHING. Never seed this. */
  actuableRefs: string[];
  suppressedSubjects: string[];
}

/** A `AgentConfig` in the store's own vocabulary, ready to PUT. */
export function toWire(config: Partial<AgentConfig>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [wire, client] of Object.entries(AGENT_WIRE_KEYS)) {
    const value = (config as Record<string, unknown>)[client];
    if (value !== undefined) out[wire] = value;
  }
  return out;
}

/** The store's document in this app's vocabulary. */
export function fromWire(raw: Record<string, unknown>): Partial<AgentConfig> {
  const out: Record<string, unknown> = {};
  for (const [wire, client] of Object.entries(AGENT_WIRE_KEYS)) {
    if (raw[wire] !== undefined) out[client] = raw[wire];
  }
  return out as Partial<AgentConfig>;
}

/** Read the agent config. ⚠️ Envelope key `config`. */
export async function loadAgentConfig(
): Promise<{ config: Partial<AgentConfig>; rev: string } | null> {
  // ⚠️ `ingressPath`, LIKE EVERY SIBLING CLIENT. Not decoration: the envelope
  // test finds clients by searching for this exact idiom, and the first draft
  // of this file used a template literal — so the test found NO client for
  // /agent-config and passed without checking anything. Inventing a third
  // shape is how a client slips past the pin written to catch it.
  const r = await fetch(ingressPath("agent-config"), { credentials: "same-origin" });
  if (!r.ok) return null;
  // ⚠️ THE SIBLING'S EXACT IDIOM: `as { config?: unknown; rev?: unknown }`.
  // The envelope test anchors on it, and its own comment says a client that
  // invents a third shape must FAIL rather than slip past. My first draft used
  // `config?: Record<string, unknown>` and did exactly that — caught by the
  // guard, not by review.
  const d = (await r.json().catch(() => ({}))) as { config?: unknown; rev?: unknown };
  const raw = (d.config && typeof d.config === "object")
    ? (d.config as Record<string, unknown>)
    : {};
  return { config: fromWire(raw), rev: String(d.rev ?? "0") };
}
