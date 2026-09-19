// src/ai/notifyTargets.ts
// Which notify services this Home Assistant actually has.
//
// ⚠️ SERVED BY THE ADD-ON'S OWN PROXY, NOT FETCHED FROM CORE HERE. Core's
// service catalogue is every service of every integration; the screen needs one
// domain's names, and the proxy already holds the token to ask.

import { ingressPath } from "@/ha/ingress";

export interface NotifyTarget {
  /** What gets stored in the setting — an entity_id or a service name. */
  id: string;
  /** What a person recognises: the friendly name, with the id to disambiguate. */
  label: string;
  /** ⚠️ HOME ASSISTANT HAS TWO NOTIFY MECHANISMS AND THEY ARE CALLED
   *  DIFFERENTLY. A `service` target is called as `notify.<name>`; an `entity`
   *  target is called through `notify.send_message` with an entity_id. They are
   *  indistinguishable as strings — both are `notify.something` — which is why
   *  the kind travels with them rather than being guessed at later. */
  kind: "service" | "entity";
}

export interface NotifyTargets {
  targets: NotifyTarget[];
  /** Why the list is empty, when it is. The screen must still let an operator
   *  type a target when this lookup could not run. */
  error?: string;
}

/** Entities first, then services: the modern entity platform is where a
 *  Telegram chat or a phone actually lives, and a person scanning this list is
 *  looking for a name they recognise rather than for `notify.notify`. */
export async function fetchNotifyTargets(): Promise<NotifyTargets> {
  try {
    const r = await fetch(ingressPath("ai-notify-targets"), { credentials: "same-origin" });
    if (!r.ok) return { targets: [], error: `HTTP ${r.status}` };
    return (await r.json()) as NotifyTargets;
  } catch (e) {
    return { targets: [], error: e instanceof Error ? e.message : String(e) };
  }
}
