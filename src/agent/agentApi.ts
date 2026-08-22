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
import type { Concern } from "@/agent/agentTypes";
import type { Role } from "@/auth/roles";

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
  allowed_services: "allowedServices",
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
  /** ⚠️ EMPTY MEANS NOBODY MAY TALK TO THE BOT. Never seed this.
   *
   *  ⚠️ THE VALUE IS THE APP'S OWN PROFILE ID (`@/auth/roles`), not an audience
   *  name. This was typed `"owner" | "facility" | "ops"` — `facility` and `ops`
   *  being two names for one person, with `guest` missing — which is what put a
   *  profile that does not exist in the picker. */
  allowedSenders: Record<string, Role>;
  /** ⚠️ EMPTY MEANS THE AGENT MAY ACT ON NOTHING. Never seed this. */
  actuableRefs: string[];
  /** Which SERVICES, as distinct from `actuableRefs`' which DEVICES. Both
   *  allow-lists must pass. ⚠️ Never seed this either. */
  allowedServices: string[];
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
): Promise<{ config: Partial<AgentConfig>; rev: string;
             raw: Record<string, unknown> } | null> {
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
  // ⚠️ THE RAW DOCUMENT COMES BACK TOO, AND IT IS NOT REDUNDANT. `fromWire`
  // keeps only the keys THIS version knows, so a round trip through
  // fromWire → toWire silently drops anything a NEWER add-on wrote — the
  // downgrade case `config_view` deliberately preserves on the server. The
  // caller spreads `raw` underneath its changes, exactly as `reportsApi`'s
  // `carryOver` does.
  return { config: fromWire(raw), rev: String(d.rev ?? "0"), raw };
}

/**
 * Read the agent's concerns. ⚠️ Envelope key `concerns`, not `config` —
 * `_json_store_handlers` takes the key as an ARGUMENT, so a client written by
 * copying a sibling inherits the wrong one and the GET then parses to nothing.
 * That failure is invisible: a concern store that reads as empty renders
 * exactly like a villa with nothing wrong, which is the correct display for a
 * subsystem that has never run. Pinned by `test_store_envelope`.
 */
export async function loadConcerns(): Promise<Concern[]> {
  const r = await fetch(ingressPath("agent-concerns"), { credentials: "same-origin" });
  if (!r.ok) return [];
  const d = (await r.json().catch(() => ({}))) as { concerns?: unknown };
  const inner = (d.concerns && typeof d.concerns === "object")
    ? (d.concerns as { concerns?: unknown })
    : {};
  const rows = Array.isArray(inner.concerns) ? inner.concerns : [];
  return rows.filter((c): c is Concern => !!c && typeof c === "object");
}

/**
 * Save the agent config: `carryOver` with `patch` applied over it.
 *
 * ⚠️ THE STORE REPLACES THE WHOLE DOCUMENT — IT DOES NOT MERGE — AND SENDING A
 * PATCH DESTROYED CONFIG IN THE FIELD. This function's first version PUT only
 * the changed keys, on the stated reasoning that "the store merges it". It does
 * not: `_json_store_handlers` writes `body[key]` verbatim, so ticking the agent
 * on wrote `{enabled: true}` as the ENTIRE document and DELETED the owner's
 * `allowed_senders` list. Reported the first time it was used. The confusion was
 * between two different merges — `agent.config.view` spreads DEFAULTS under
 * stored values at READ time, which is real, and has nothing to do with what a
 * write does. Every sibling client sends the whole document; `reportsApi` calls
 * its carried copy `carryOver`.
 *
 * ⚠️ AND THE REVISION FIELD IS `rev`, NOT `expected_rev`. The handler reads
 * `body.get("rev")` and treats a non-string as ABSENT — so the first version's
 * `expected_rev` was accepted, ignored, and every write went through with no
 * concurrency check at all. Silent, because a lost update looks like a save
 * that worked. Same shape as the wire-key bug in 2.545.0: Python one side, a
 * string literal the other, nothing between them.
 */
export async function saveAgentConfig(
  patch: Partial<AgentConfig>,
  carryOver: Record<string, unknown>,
  rev: string | null,
): Promise<boolean> {
  const r = await fetch(ingressPath("agent-config"), {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config: { ...carryOver, ...toWire(patch) },
      ...(rev === null ? {} : { rev }),
    }),
  });
  return r.ok;
}

/** Runs the agent has made, most recent last. Any authorised session. */
export async function loadAgentRuns(): Promise<Record<string, string>[]> {
  const r = await fetch(ingressPath("agent-runs"), { credentials: "same-origin" });
  if (!r.ok) return [];
  const d = (await r.json().catch(() => ({}))) as { runs?: unknown };
  return Array.isArray(d.runs) ? (d.runs as Record<string, string>[]) : [];
}

/** One conversation the villa's bot can be reached in, as a person names it. */
export interface BotChat { id: string; name: string }

/**
 * The bot's private chats, named. ⚠️ PRIVATE ONLY, and the backend excludes
 * groups deliberately: the sender list keys on WHO SPEAKS, a group's chat id
 * identifies the ROOM, and storing one would silently match nobody.
 */
export async function loadBotChats(): Promise<BotChat[]> {
  const r = await fetch(ingressPath("agent-chats"), { credentials: "same-origin" });
  if (!r.ok) return [];
  const d = (await r.json().catch(() => ({}))) as { chats?: unknown };
  const rows = Array.isArray(d.chats) ? d.chats : [];
  return rows.filter((c): c is BotChat =>
    !!c && typeof c === "object"
    && typeof (c as BotChat).id === "string"
    && typeof (c as BotChat).name === "string");
}

/**
 * Record a verdict on a concern. Owner and facility manager only, server-side.
 *
 * ⚠️ `useful` IS EXPLICIT, NEVER INFERRED FROM ABSENCE. "Not useful" is the
 * verdict that suppresses a whole subject after three goes, so a missing field
 * must be a 400 rather than a silent dismissal.
 */
export async function sendConcernFeedback(
  id: string, useful: boolean, reason = "",
): Promise<boolean> {
  const r = await fetch(ingressPath("agent-feedback"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, useful, reason }),
  });
  return r.ok;
}
