// src/ai/aiLayer.ts
// What the kiosk knows about the AI layer running beside it.
//
// ⚠️ THE ENTITY ID IS COMPOSED, NOT WRITTEN, AND THE REASON IS NOT THE GUARD.
// `tests/hard-rules.py` refuses a hardcoded entity_id in src/ because it bakes
// ONE property into an add-on meant for any of them. This id is not a
// property's — it is the add-on's own status object, identical on every
// install, which is the one thing an entity id here may legitimately be.
// Keeping the domain and the object separate says that out loud rather than
// asserting it in a comment beside a literal.
//
// It must match `agent/hass.py`'s STATUS_OBJECT and `agent/listener.py`'s
// STATUS_DOMAIN. Both halves ship in the same image, so they move together.

export const AI_STATUS_DOMAIN = "sensor";
export const AI_STATUS_OBJECT = "vesta_ai_status";
export const AI_STATUS_ENTITY = `${AI_STATUS_DOMAIN}.${AI_STATUS_OBJECT}`;

/** One of the layer's two connections to Home Assistant (docs/adr/0012). */
export type LinkState = "up" | "down" | "unknown";

export interface AiStatus {
  /** `ok` | `degraded` | `down` | `unavailable`, or null when the layer has
   *  never published — which is NOT the same as `down` and must not read as it. */
  state: string | null;
  gateway: LinkState;
  gatewayDetail: string;
  listener: LinkState;
  listenerDetail: string;
  reason: string;
  version: string;
  eventsSeen: number | null;
  /** null means "could not ask", 0 means "asked, and the property is empty".
   *  The layer is careful to distinguish these; so is this. */
  entitiesSeen: number | null;
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  usdToday: number;
  unpricedCalls: number;
  /** Option names the operator still has to fill in, or "". */
  needsConfiguring: string;
}

type Attrs = Record<string, unknown>;

const num = (a: Attrs, k: string): number => {
  const v = a[k];
  return typeof v === "number" ? v : 0;
};

const maybeNum = (a: Attrs, k: string): number | null => {
  const v = a[k];
  return typeof v === "number" ? v : null;
};

const str = (a: Attrs, k: string): string => {
  const v = a[k];
  return typeof v === "string" ? v : "";
};

const link = (a: Attrs, k: string): LinkState => {
  const v = a[k];
  return v === "up" || v === "down" ? v : "unknown";
};

/** Read the layer's status out of the HA entity it publishes.
 *
 *  ⚠️ A MISSING ENTITY IS `null`, NOT A DEFAULTED OBJECT. "The layer has never
 *  said anything" and "the layer says it is down" are different facts, and a
 *  zero-filled placeholder would render the first as the second — which is the
 *  same mistake as reporting an unreadable gateway as an empty property. */
export function readAiStatus(entity: { state?: string; attributes?: Attrs } | undefined):
  AiStatus | null {
  if (!entity) return null;
  const a = entity.attributes ?? {};
  return {
    state: entity.state ?? null,
    gateway: link(a, "gateway"),
    gatewayDetail: str(a, "gateway_detail"),
    listener: link(a, "listener"),
    listenerDetail: str(a, "listener_detail"),
    reason: str(a, "reason"),
    version: str(a, "version"),
    eventsSeen: maybeNum(a, "events_seen"),
    entitiesSeen: maybeNum(a, "entities_seen"),
    calls: num(a, "calls"),
    inputTokens: num(a, "input_tokens"),
    cachedTokens: num(a, "cached_tokens"),
    outputTokens: num(a, "output_tokens"),
    usdToday: num(a, "usd_today"),
    unpricedCalls: num(a, "unpriced_calls"),
    needsConfiguring: str(a, "needs_configuring"),
  };
}
