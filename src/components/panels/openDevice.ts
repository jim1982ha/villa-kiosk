// src/components/panels/openDevice.ts
// THE OPEN DEVICE WINDOW AS THE DEVICE IS SET NOW — one resolver, read on every render by the window (PanelRouter),
// its header (panelHeader) and its actions (useOpenPanelActions). Pure: tests/oracles/panel_header.mjs drives it.
//
// The screen state (pages/screen) holds WHICH device is open; its settings are read here, from the live config, through
// the one panel gate (permissions.panelMapping) and the one name rule (EntityMap.displayLabelFor). Null when the device
// was removed or this profile may no longer see it: the window closes.

import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";
import type { Role } from "@/auth/roles";
import type { ActivePanel, OpenDevice } from "@/types/panel.types";
import { panelMapping } from "@/auth/permissions";
import { displayLabelFor } from "@/config/EntityMap";

export function openDevice(
  panel: ActivePanel | null, entityMap: Record<string, EntityMapping>, role: Role | null,
  entities: Record<string, HassEntity>,
): OpenDevice | null {
  if (!panel) return null;
  const entity = entities[panel.entityId];
  const mapping = panelMapping(panel.entityId, entityMap, role, entity, { control: false });
  if (!mapping) return null;
  return { ...panel, mapping, label: displayLabelFor(panel.entityId, mapping.label, entity?.attributes.friendly_name) };
}
