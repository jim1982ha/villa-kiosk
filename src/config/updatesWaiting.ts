// src/config/updatesWaiting.ts
// The updates the villa's system has waiting — firmware, add-ons, this app included — by name, for the Cockpit
// header's count and its tooltip (owner, 2026-10-20: "Upgrade(s) available for: …", the count still nothing to press).
// Pure: tests/oracles/updates_waiting.mjs.

import type { HassEntity } from "@/types/ha.types";
import { domainOf } from "@/utils/entityDomain";

/** The platform's own name, as an id spells it — so the screen code never writes the name it takes out. */
const PLATFORM = "home_assistant";

/** What an update is called on screen: its software's own title when it gives one, else its name without the
 *  trailing "Update" / "Firmware"; a name that starts with the platform's own reads "Villa system …" instead. */
export function updateName(e: HassEntity): string {
  const title = typeof e.attributes.title === "string" && e.attributes.title.trim() ? e.attributes.title.trim() : null;
  const name = title ?? String(e.attributes.friendly_name ?? e.entity_id).replace(/\s+(update|firmware)$/i, "").trim();
  const words = name.split(/\s+/);
  if (words.slice(0, 2).join("_").toLowerCase() !== PLATFORM) return name;
  return ["Villa system", ...words.slice(2)].join(" ");
}

/** The names of the updates waiting (an `update` entity that is "on"), sorted. */
export function updatesWaiting(entities: Readonly<Record<string, HassEntity>>): string[] {
  return Object.values(entities)
    .filter((e) => domainOf(e.entity_id) === "update" && e.state === "on")
    .map(updateName)
    .sort((a, b) => a.localeCompare(b));
}

/** The header count's tooltip. */
export function updatesTip(names: readonly string[]): string {
  return ["Upgrade(s) available for:", ...names.map((n) => `- ${n}`)].join("\n");
}
