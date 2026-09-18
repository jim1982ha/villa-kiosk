// src/components/cockpit/useVillaAttention.ts
// THE villa-wide "needs attention" count — shared by Cockpit's own Needs
// Attention section and every entry point that opens it (HUD's top-bar
// alert icon + its count badge, the phone overflow menu's "Cockpit (N)"
// row), so the number on the button and the number inside the modal it
// opens can never disagree.
//
// They did once: the button/menu badges were still computed as
// unavailableIds.length alone (this hook's own predecessor, written before
// Cockpit's Needs Attention section was unified in 2.86.0 to also include
// open faults, overdue schedules, and alarm-state binary_sensors), while
// CockpitModal's own list had already moved on to the fuller definition —
// reported as "the menu says 4 but the modal says 5 things need attention".
// One computation now, read by both.

import { useMemo } from "react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useFmData } from "@/fm/FmDataContext";
import { villaDevices } from "@/config/deviceGroups";
import { buildAttentionItems, villaHealthFrom, type AttentionItem, type VillaHealth } from "./cockpitData";

export interface VillaAttention {
  unavailableIds: string[];
  selectableIds: string[];
  attentionItems: AttentionItem[];
  health: VillaHealth;
}

export function useVillaAttention(mappedEntityIds: Set<string>): VillaAttention {
  const { entities, entityDeviceIds } = useHA();
  const { config, resolvedRooms } = useConfig();
  const { data: fmData } = useFmData();

  // ONE call, one memo — this was two, each restating the same five-tuple in
  // the same order and each with its own dependency array to keep in step.
  const devices = useMemo(
    () => villaDevices({
      entityMap: config.entityMap, deviceGroups: config.deviceGroups,
      dismissedEntityIds: config.dismissedEntityIds,
      mappedEntityIds, entities, entityDeviceIds,
    }),
    [config.entityMap, config.deviceGroups, config.dismissedEntityIds,
     mappedEntityIds, entities, entityDeviceIds],
  );
  const unavailableIds = devices.unavailable as string[];
  const selectableIds = devices.ids as string[];
  const attentionItems = useMemo(
    () => buildAttentionItems({ unavailableIds, entities, entityMap: config.entityMap, resolvedRooms, fmData, selectableIds }),
    [unavailableIds, entities, config.entityMap, resolvedRooms, fmData, selectableIds],
  );
  const health = useMemo(() => villaHealthFrom(attentionItems), [attentionItems]);

  return { unavailableIds, selectableIds, attentionItems, health };
}
