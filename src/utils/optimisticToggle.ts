// src/utils/optimisticToggle.ts
// Shared "flip now, reconcile with Home Assistant in the background" helper —
// used by BOTH the map's quick-tap (Dashboard.onEntityPicked) and every device
// panel's PowerToggle, so on/off feels equally instant everywhere in the UI
// (not just the map). Reads the LIVE entity snapshot (getEntitiesSnapshot),
// never a React-closure `entity` prop/value — see HAStateStore.commitEntities'
// docstring for why that distinction is what makes a rapid re-tap (ON then
// OFF) resolve in the right direction instead of silently no-opping and
// waiting on HA's echo.

import type { HassEntity } from "@/types/ha.types";

export function optimisticToggle(
  entityId: string,
  getEntitiesSnapshot: () => Record<string, HassEntity>,
  optimistic: (entityId: string, state: string, attrs?: Record<string, unknown>) => void,
  sendCommand: () => Promise<void>,
): void {
  const prev = getEntitiesSnapshot()[entityId]?.state;
  // Only guess for a genuine on/off pair — "unavailable"/"unknown" (or any
  // other domain-specific state) has no safe flip direction to predict, so
  // those cases just send the command and wait for the real echo, same as
  // before this feature existed.
  const canGuess = prev === "on" || prev === "off";
  if (canGuess) optimistic(entityId, prev === "on" ? "off" : "on");
  sendCommand().catch(() => {
    if (canGuess) optimistic(entityId, prev); // command failed — revert the guess
  });
}
