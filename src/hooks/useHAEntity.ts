// src/hooks/useHAEntity.ts
import { useHA } from "@/ha/HAStateStore";
import type { HassEntity } from "@/types/ha.types";

/** Subscribe a React component to a single entity's state. */
export function useHAEntity(entityId: string | undefined): HassEntity | undefined {
  const { entities } = useHA();
  return entityId ? entities[entityId] : undefined;
}
