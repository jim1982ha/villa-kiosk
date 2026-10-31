// src/hooks/useLastSeen.ts
// "When did it leave the villa's system?" for a device the villa's system no longer has (a Missing device's
// window): one read of its recorded history, through the history source the charts use (historySource.lastRecorded).
// Asked only while such a window is open, so it adds one read per window, never one per device.

import { useMemo } from "react";
import type { MissingSeen } from "@/utils/stateColors";
import { useHistorySource } from "./useHistorySource";

/** `entityId` null: nothing to ask. "loading" until the history answers; "unknown" when it could not be read. */
export function useLastSeen(entityId: string | null): MissingSeen | "loading" {
  const requests = useMemo(() => (entityId ? { seen: { kind: "lastSeen" as const, ids: [entityId] } } : null), [entityId]);
  const { data, status } = useHistorySource(requests);
  if (!entityId || status === "failed") return "unknown";
  const seen = data?.seen[entityId];
  return seen === undefined ? "loading" : seen;
}
