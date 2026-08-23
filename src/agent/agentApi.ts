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
import { ROLE_ORDER, type Role } from "@/auth/roles";

/** Wire name (what the store stores) → client name (what this app calls it). */
const AGENT_WIRE_KEYS = {
  enabled: "enabled",
  act_enabled: "actEnabled",
  /** ⚠️ ABSENT FROM THIS MAP UNTIL 2.650.0, WHICH MADE THE CUTOVER DECISION
   *  UNREACHABLE FROM THE UI. The store has always held it and the backend has
   *  always honoured it; the SPA could neither read nor write it, so "run
   *  everything, deliver nothing" could only be changed by editing JSON on the
   *  box. Pinned by `test_the_agent_wire_map_covers_every_setting`. */
  shadow: "shadow",
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
  /** ⚠️ ONE TABLE FOR BOTH DIRECTIONS — see `reports/people.py`. It supersedes
   *  `allowed_senders`, which is kept and still read when this is empty so an
   *  existing villa's bot does not go deaf on upgrade. */
  people: "people",
  actuable_refs: "actuableRefs",
  allowed_services: "allowedServices",
  suppressed_subjects: "suppressedSubjects",
} as const;

export type AgentTrigger = "scheduled" | "event" | "chat";

/** One row of the people table.
 *
 *  ⚠️ NO `name`, AND ITS ABSENCE IS THE POINT (2.655.0). The field was stored
 *  from the first version and read by nothing on either side — a text box whose
 *  value travelled to a JSON file and back. The chat picker already shows the
 *  name Telegram itself holds, which is the one nobody has to keep in step. */
export interface Person {
  /** Telegram user id, or "" for a delivery-only person. */
  telegram: string;
  /** Notify destinations — Companion app, Telegram entity, anything
   *  `discovery` found. Receive-only, always. */
  targets: string[];
  role: Role;
}

/** The people table, narrowed. ⚠️ EVERY READ NARROWS — `fromWire` is a key
 *  mapping and hands back whatever the store holds, so a hand-edited document,
 *  an older add-on's shape or a truncated write would otherwise reach the DOM
 *  as `undefined.trim()`. A row with an unknown profile is DROPPED rather than
 *  defaulted, exactly as `people._row` drops it on the backend: the profile
 *  decides both whether somebody may speak and which voice they are written
 *  in, so a default here would be a privilege decision made by a typo. */
export function peopleOf(config: Partial<AgentConfig>): Person[] {
  const rows = Array.isArray(config.people) ? config.people : [];
  const out: Person[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as unknown as Record<string, unknown>;
    if (!(ROLE_ORDER as readonly string[]).includes(String(r.role))) continue;
    out.push({
      telegram: typeof r.telegram === "string" ? r.telegram : "",
      targets: Array.isArray(r.targets)
        ? r.targets.filter((t): t is string => typeof t === "string" && !!t)
        : [],
      role: String(r.role) as Role,
    });
  }
  return out;
}

/** Where a briefing for this profile goes, de-duplicated, in table order.
 *
 * ⚠️ A RENDERING CONVENIENCE, AND THE SECOND IMPLEMENTATION OF A RULE WHOSE
 * AUTHORITY IS `reports/people.py:targets_for_role`. Delivery is decided there,
 * in the add-on, from the stored document — this exists so the Briefings dialog
 * can grey a profile nobody is configured for and refuse to save a schedule
 * naming one. It answers the same question about the same table; if the two
 * ever disagree the consequence is a dialog that offers or withholds an option
 * wrongly, never a brief delivered somewhere it should not be.
 *
 * ⚠️ A PERSON WITH NO TARGETS DOES NOT MAKE A PROFILE REACHABLE. Somebody whose
 * row carries only a Telegram chat can talk TO the villa and cannot be sent a
 * briefing, which is exactly the asymmetry the people table exists to keep
 * visible.
 */
export function targetsForRole(people: Person[], role: string): string[] {
  const out: string[] = [];
  // ⚠️ `entry`, NOT the obvious singular of `people`. That word is a real Home
  // Assistant DOMAIN, so dotting a field off it reads as an entity id to the
  // hard-rules pin that scans tracked source for villa-specific identifiers —
  // a false positive, but the whole value of that gate is that it is never
  // argued with. (Writing the offending token in this comment failed the pin a
  // second time, which is the same lesson one line further on.)
  for (const entry of people) {
    if (entry.role !== role) continue;
    for (const target of entry.targets ?? []) {
      if (target && !out.includes(target)) out.push(target);
    }
  }
  return out;
}

export interface AgentConfig {
  enabled: boolean;
  actEnabled: boolean;
  /** Run everything, deliver nothing. ⚠️ SHIPS TRUE, the opposite of every
   *  other flag here: the others are off so nothing happens, this is on so
   *  that when the agent IS switched on its first period is observed rather
   *  than delivered. Turning it off is the cutover, and it is a decision. */
  shadow: boolean;
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
  /** Who the villa knows and how to reach them. ⚠️ `telegram` is the ONLY field
   *  that grants anything inbound; `targets` are notify destinations, which can
   *  only receive. A person with a device and no chat is delivery-only, which
   *  is a normal row — and is why listing one must never be read as identity.
   *  ⚠️ EMPTY MEANS THE BOT ANSWERS NOBODY. Never seed this. */
  people: Person[];
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

/** A procedure the agent has proposed and nobody has yet judged. TASK-094. */
export interface ReviewDraft {
  slug: string;
  title: string;
  domain: string;
  description: string;
  /** What the draft was derived from — an investigation, never a tool result. */
  source: string;
  proposedAt: string;
  body: string;
}

/**
 * Playbook drafts awaiting a person. Owner and facility manager only,
 * server-side.
 *
 * ⚠️ EMPTY IS THE NORMAL STATE AND IS NOT AN ERROR. Most investigations should
 * propose nothing — `review.MIN_TOOL_CALLS` refuses a lookup, `MAX_PENDING`
 * stops the queue outgrowing the person reading it — so a surface built on this
 * must render nothing at all rather than an empty-queue placeholder.
 */
export async function loadReviewDrafts(): Promise<ReviewDraft[]> {
  const r = await fetch(ingressPath("agent-review"), { credentials: "same-origin" });
  if (!r.ok) return [];
  const d = (await r.json().catch(() => ({}))) as { drafts?: unknown };
  const rows = Array.isArray(d.drafts) ? d.drafts : [];
  return rows.filter((x): x is ReviewDraft =>
    !!x && typeof x === "object" && typeof (x as ReviewDraft).slug === "string");
}

/**
 * Approve or discard one draft.
 *
 * ⚠️ THE DECISION IS AN EXPLICIT WORD ON BOTH SIDES, never a boolean. The
 * handler refuses anything that is not `approve` or `discard`, because
 * "approve" — the direction with the permanent consequence — is exactly the
 * value a truthy check falls into on a malformed request.
 *
 * ⚠️ AND `body` IS THE REVIEWER'S EDIT, sent WITH the approval rather than as a
 * separate save. The realistic case is somebody who agrees with most of a draft
 * and wants one paragraph changed; making that a second mechanism is how they
 * approve it unchanged instead. Empty means "as proposed".
 */
export async function decideReviewDraft(
  slug: string, decision: "approve" | "discard",
  extra: { body?: string; reason?: string } = {},
): Promise<boolean> {
  const r = await fetch(ingressPath("agent-review"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, decision, ...extra }),
  });
  return r.ok;
}

/** The shadow period's diff: what each layer found, side by side. TASK-051. */
export interface ShadowDiff {
  /** The rendered document — what the checkpoint asks a person to READ. */
  report: string;
  agentTotal: number;
  rulesTotal: number;
  /** ⚠️ FALSE MEANS A SUBJECT MISSING FROM BOTH COLUMNS PROVES NOTHING. */
  coverageComplete: boolean;
  /** ⚠️ THE ROW THAT DECIDES THE CUTOVER — what the rules caught and the agent
   *  did not, i.e. the regressions retiring them would ship. */
  rulesOnly: string[];
  both: string[];
  agentOnly: string[];
}

/**
 * Read the shadow diff. Owner-only, server-side.
 *
 * ⚠️ `null` MEANS COULD NOT ASK, NOT "NOTHING FOUND". An empty diff on a villa
 * that has been running a shadow period is a real and meaningful answer; a
 * failed read that rendered as one would be the cutover decision taken on a
 * blank page.
 */
export async function loadShadowDiff(): Promise<ShadowDiff | null> {
  const r = await fetch(ingressPath("agent-shadow"), { credentials: "same-origin" });
  if (!r.ok) return null;
  const d = (await r.json().catch(() => null)) as ShadowDiff | null;
  if (!d || typeof d.report !== "string") return null;
  const strs = (v: unknown) =>
    (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string");
  return {
    report: d.report,
    agentTotal: Number(d.agentTotal) || 0,
    rulesTotal: Number(d.rulesTotal) || 0,
    coverageComplete: d.coverageComplete === true,
    rulesOnly: strs(d.rulesOnly),
    both: strs(d.both),
    agentOnly: strs(d.agentOnly),
  };
}

/** One provider request, as the ledger recorded it. */
export interface UsageRow {
  at: number; source: string; model: string; actor: string;
  run_id: string; input: number; output: number;
  cache_read: number; cache_write: number; cost: number;
}

export interface UsageBucket {
  requests: number; input: number; output: number;
  cache_read: number; cache_write: number; cost: number;
}

export interface UsageSummary {
  since: number;
  total: UsageBucket;
  by_actor: Record<string, UsageBucket>;
  by_source: Record<string, UsageBucket>;
  by_model: Record<string, UsageBucket>;
  /** ⚠️ ALWAYS TRUE, AND THE UI MUST SAY SO. The provider's bill is the
   *  authority: prices change, promotional rates lapse, and a request that
   *  failed after its tokens were read may still be billed. A figure presented
   *  as a bill that is a few cents out is worse than one presented as an
   *  estimate that is a few cents out. */
  estimated: boolean;
  /** The earliest row on record, or 0. ⚠️ THIS IS WHAT SEPARATES "nothing was
   *  spent in that window" FROM "the ledger did not exist yet" — identical in a
   *  total, opposite in meaning, and on the release that adds this every
   *  earlier request falls in the second category. */
  recording_since: number;
}

/**
 * What the API key has been spent on. Owner-only, server-side.
 *
 * ⚠️ IT COVERS EVERY REQUEST, NOT ONLY NARRATED BRIEFS. The narration toggle
 * gates who writes a brief's prose; triage, reasoning and every chat turn spend
 * the same key regardless of it, and a panel that only counted narration would
 * read zero on a bill that was climbing.
 */
export async function loadUsage(
  since = 0,
): Promise<{ summary: UsageSummary | null; rows: UsageRow[]; truncated: boolean }> {
  const q = since > 0 ? `?since=${Math.floor(since)}` : "";
  const r = await fetch(ingressPath(`agent-usage${q}`), {
    credentials: "same-origin",
  });
  if (!r.ok) return { summary: null, rows: [], truncated: false };
  const d = (await r.json().catch(() => ({}))) as {
    summary?: UsageSummary; rows?: UsageRow[]; truncated?: boolean;
  };
  return {
    summary: d.summary ?? null,
    rows: Array.isArray(d.rows) ? d.rows : [],
    truncated: d.truncated === true,
  };
}
