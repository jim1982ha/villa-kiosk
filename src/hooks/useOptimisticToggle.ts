// src/hooks/useOptimisticToggle.ts
// Panel-friendly wrapper around utils/optimisticToggle — every device panel's
// PowerToggle uses this instead of calling HAServices directly, so a tap in
// the panel feels exactly as instant as a tap on the map badge.

import { useCallback } from "react";
import { useHA } from "@/ha/HAStateStore";
import { optimisticToggle } from "@/utils/optimisticToggle";

/** Returns a zero-arg toggle function for `entityId`: flips its state
 *  optimistically, then fires `sendCommand` (any HAServices.toggleX call) and
 *  reverts if it fails. */
export function useOptimisticToggle(entityId: string, sendCommand: () => Promise<void>): () => void {
  const { getEntitiesSnapshot, optimistic } = useHA();
  return useCallback(
    () => optimisticToggle(entityId, getEntitiesSnapshot, optimistic, sendCommand),
    [entityId, sendCommand, getEntitiesSnapshot, optimistic],
  );
}
