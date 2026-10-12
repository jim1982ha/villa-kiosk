// src/config/useRoomFloors.ts
// devicePlace.roomFloors over the live sources — the one room → floor answer every device list reads.
import { useMemo } from "react";
import { useConfig } from "./ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { roomFloors } from "./devicePlace";

export function useRoomFloors(): Map<string, number | null> {
  const { config, resolvedRooms } = useConfig();
  const { entityFloorNumbers } = useHA();
  return useMemo(() => roomFloors(resolvedRooms, config.sh3dRooms, entityFloorNumbers),
    [resolvedRooms, config.sh3dRooms, entityFloorNumbers]);
}
