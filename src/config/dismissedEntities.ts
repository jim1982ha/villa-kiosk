// src/config/dismissedEntities.ts
// THE single definition of what "dismissed" means (see
// AppConfig.dismissedEntityIds), so every surface that can show an entity —
// Advanced Settings' auto-detected list, the unavailable-devices modal, the
// HUD's alert badge, Facility readiness — answers the question identically.
//
// It deliberately is NOT "is this id in the list": a dismissal only applies
// while Home Assistant still doesn't know the entity. Splitting that rule
// across callers is exactly how the two halves of this bug happened in the
// first place — one surface read entityMap (where removal worked) while
// another read mesh-derived ids (where it didn't), and they disagreed about
// the same device. One function, one answer.

import type { HassEntity } from "@/types/ha.types";

export function dismissedEntitySet(
  dismissedEntityIds: readonly string[],
  entities: Record<string, HassEntity>,
): Set<string> {
  return new Set(dismissedEntityIds.filter((id) => !entities[id]));
}
