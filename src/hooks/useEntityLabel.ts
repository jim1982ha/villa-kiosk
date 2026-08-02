// src/hooks/useEntityLabel.ts
// "What do we call this device on screen", as one hook.
//
// displayLabelFor is already the single rule for resolving a name (the
// operator's own label, else Home Assistant's friendly name, else a tidied
// entity_id). What kept being rewritten was the line that FEEDS it — every
// screen reached into config.entityMap and the live entity table itself:
//
//   displayLabelFor(id, config.entityMap[id]?.label,
//                   entities[id]?.attributes.friendly_name)
//
// Seven call sites across the Facility tabs, the device panels and the
// Dashboard, each having to remember both lookups and their exact optional
// chaining. Nothing had gone wrong yet, but it is precisely the shape that
// drifts: one site forgetting the config label silently starts showing Home
// Assistant's name instead, on one screen only, and looks like a data bug.

import { useCallback } from "react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { displayLabelFor } from "@/config/EntityMap";

/** Resolve any entity_id to its display name. Stable across renders unless the
 *  entity map or the live entities actually change, so it is safe in a
 *  dependency array. */
export function useEntityLabel(): (entityId: string) => string {
  const { config } = useConfig();
  const { entities } = useHA();
  return useCallback(
    (entityId: string) => displayLabelFor(
      entityId,
      config.entityMap[entityId]?.label,
      entities[entityId]?.attributes.friendly_name,
    ),
    [config.entityMap, entities],
  );
}
