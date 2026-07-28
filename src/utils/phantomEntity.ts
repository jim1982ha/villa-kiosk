// src/utils/phantomEntity.ts
// A minimal, well-typed stand-in HassEntity for an entity_id the app knows
// about (it's bound to a mesh, or has an entityMap entry) but Home Assistant
// has never reported — typically because it was renamed or deleted in HA while
// the villa model still references it.
//
// Shared on purpose: the 3D badge layer and the device lists must agree about
// what such an entity looks like, or a device shows as faded-unavailable on the
// map while silently vanishing from the "unavailable devices" list — which is
// exactly the inconsistency this file was created to kill.
//
// state: "unavailable" is what routes it through every existing
// dim/desaturate/status-pill treatment (isUnavailable() already treats a
// MISSING entity the same way, so this is consistent with that convention);
// every other field is a harmless placeholder no "unavailable" path reads.

import type { HassEntity } from "@/types/ha.types";

export function phantomEntity(entityId: string): HassEntity {
  return {
    entity_id: entityId,
    state: "unavailable",
    attributes: {},
    last_changed: "", last_updated: "",
    context: { id: "", parent_id: null, user_id: null },
  };
}
