// src/hooks/useHAEntities.ts
import { useMemo } from "react";
import { useHA } from "@/ha/HAStateStore";
import type { HassEntity } from "@/types/ha.types";

/** Subscribe to several entities at once. */
export function useHAEntities(entityIds: string[]): Record<string, HassEntity | undefined> {
  const { entities } = useHA();
  return useMemo(() => {
    const out: Record<string, HassEntity | undefined> = {};
    for (const id of entityIds) out[id] = entities[id];
    return out;
  }, [entities, entityIds]);
}
