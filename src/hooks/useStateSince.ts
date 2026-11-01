// src/hooks/useStateSince.ts
// "Since when?" for a line on screen: when each entity's CURRENT state began, read from its recorded history (the
// history source the charts use — historySource.stateSince), never from `last_changed`, which a restart rewrites
// (owner, 2026-10-20). Read again when one of their states really changes; meanwhile the last answer stands, with the
// live state over it (stateSinceNow).

import { useMemo } from "react";
import { useHA } from "@/ha/HAStateStore";
import { stateSinceAnswer, stateSinceRequests } from "@/ha/historySource";
import type { Since } from "@/config/presence";
import { useHistorySource } from "./useHistorySource";

/** For each of `ids`: when its current state began — "loading" until the history is read, null when it cannot say.
 *  A device the villa's system no longer has: when it left it (historySource.lastRecorded, the time its window and
 *  VESTA say), its "state" being its absence. */
export function useStateSince(ids: readonly string[]): (id: string) => Since {
  const { entities } = useHA();
  const key = ids.join(",");
  const goneKey = ids.filter((id) => !entities[id]).join(",");
  const requests = useMemo(() => (key ? stateSinceRequests(key.split(","), goneKey ? goneKey.split(",") : []) : null), [key, goneKey]);
  // a real change of state reads again; a restart rewriting the same state does not need to
  const refresh = ids.map((id) => entities[id]?.state ?? "").join(",");
  const { data, status } = useHistorySource(requests, refresh);
  return (id) => {
    const s = stateSinceAnswer(data, id, entities[id]);
    if (s !== undefined) return s && { at: s.at, before: s.before };
    return status === "failed" ? null : "loading";
  };
}
