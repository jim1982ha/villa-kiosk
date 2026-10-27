// src/config/usePresence.ts
// The villa's presence as every screen shows it — the tile under the floors, its window, the Recap's line: the sensor
// picked in Settings › Villa read live, its "since" in words, and why (config/presence: the pure answers, tested by
// value). ⚠️ ONE WIRING (architecture review scan 1, 2026-10-19): each caller passed the setting, the states and the
// clock formats itself, and the tile's and the Recap's wording changed twice in 25 minutes (2.496.415, 2.496.416).
// ⚠️ EVERY "since" IS WHEN THE STATE REALLY BEGAN (owner, 2026-10-20): the sensor's own `empty_since` while empty,
// else its recorded history (useStateSince) — never `last_changed`, which said the time of a restart.

import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useStateSince } from "@/hooks/useStateSince";
import { dayMonth, dayTime } from "@/utils/dateText";
import { presenceOf, presenceSince, presenceWatched, presenceWhy, recapPresenceText, sinceText, type Presence, type PresenceWhy, type Since } from "./presence";

/** "since" in words, as every presence line says it ("19 Oct, 14:20", "before 10 Oct", "…" while read). */
export const sinceWords = (s: Since): string => sinceText(s, dayTime, dayMonth);

export interface VillaPresence {
  presence: Presence;
  /** The sensor picked in Settings › Villa (its band in the window). */
  sensorId: string;
  /** When it became what it is, in words ("" when nothing can say). */
  since: string;
  /** The Recap's line: "Villa occupied since 19 Oct, 09:12". */
  recap: string;
}

/** The villa's presence now; null when no sensor is picked (nothing is shown). */
export function usePresence(): VillaPresence | null {
  const { entities } = useHA();
  const { config } = useConfig();
  const presence = presenceOf(config.presenceSensor, entities);
  // the sensor's own statement needs no history
  const history = useStateSince(presence && presence.stated === null ? [config.presenceSensor] : []);
  if (!presence) return null;
  const since = sinceWords(presenceSince(presence, history(config.presenceSensor)));
  return { presence, sensorId: config.presenceSensor, since, recap: recapPresenceText(presence, since) };
}

/** Why — the people and sensors the picked sensor watches, each with when its state really began (its window). */
export function usePresenceWhy(): PresenceWhy {
  const { entities } = useHA();
  const { config } = useConfig();
  const sinceOf = useStateSince(presenceWatched(config.presenceSensor, entities));
  return presenceWhy(config.presenceSensor, entities, sinceOf, config.entityMap);
}
