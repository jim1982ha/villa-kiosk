// src/hooks/useDeviceSearch.ts
// What every device search reads (config/deviceRecord.deviceSearchTexts): the stored devices, the villa's system's
// entities and the rooms, as one value. Stable across renders unless one of them changes, so it is safe in a
// dependency array.

import { useMemo } from "react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import type { SearchSource } from "@/config/deviceRecord";

export function useDeviceSearch(): SearchSource {
  const { config, resolvedRooms } = useConfig();
  const { entities } = useHA();
  return useMemo(() => ({ entityMap: config.entityMap, entities, resolvedRooms }),
    [config.entityMap, entities, resolvedRooms]);
}
