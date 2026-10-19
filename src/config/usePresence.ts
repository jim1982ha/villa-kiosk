// src/config/usePresence.ts
// The villa's presence as every screen shows it — the tile under the floors, its window, the Recap's line: the sensor
// picked in Settings › Villa read live, its "since" in words, and why (config/presence: the pure answers, tested by
// value). ⚠️ ONE WIRING (architecture review scan 1, 2026-10-19): each caller passed the setting, the states and the
// clock formats itself, and the tile's and the Recap's wording changed twice in 25 minutes (2.496.415, 2.496.416).

import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { clockTime, dayTime } from "@/utils/dateText";
import { presenceOf, presenceWhy, recapPresenceText, sinceText, type Presence, type PresenceWhy } from "./presence";

/** "since" in words, as every presence line says it ("14:20", "Sat 17 Oct, 21:00"). */
export const presenceSince = (at: string | null): string => sinceText(at, clockTime, dayTime);

export interface VillaPresence {
  presence: Presence;
  /** When it last changed, in words ("" when the villa's system does not say). */
  since: string;
  /** The Recap's line: "Villa occupied since 09:12". */
  recap: string;
  /** Why — the people and sensors the sensor watches (its window); read when asked. */
  why: () => PresenceWhy;
}

/** The villa's presence now; null when no sensor is picked (nothing is shown). */
export function usePresence(): VillaPresence | null {
  const { entities } = useHA();
  const { config } = useConfig();
  const presence = presenceOf(config.presenceSensor, entities);
  if (!presence) return null;
  const since = presenceSince(presence.since);
  return { presence, since, recap: recapPresenceText(presence, since), why: () => presenceWhy(config.presenceSensor, entities) };
}
