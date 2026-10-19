// src/components/fm/useRecordPlace.ts
// fm/recordPlace bound to the live config: the villa's rooms, and a device's name on screen for a record whose name
// nobody typed (a guest's report from a device's panel). The three forms that file a record about a device call
// this and nothing else to say where it is.

import { useCallback } from "react";
import { useConfig } from "@/config/ConfigContext";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { recordPlace, type RecordPlace } from "@/fm/recordPlace";

export function useRecordPlace(): (entityId: string | undefined, deviceText?: string) => RecordPlace {
  const { resolvedRooms } = useConfig();
  const label = useEntityLabel();
  return useCallback(
    (entityId, deviceText) => recordPlace(entityId, deviceText ?? (entityId ? label(entityId) : undefined), resolvedRooms),
    [resolvedRooms, label],
  );
}
