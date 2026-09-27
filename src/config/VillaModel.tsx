// src/config/VillaModel.tsx
// THE villa's live device model, computed once for everything the Dashboard
// shows: which entities the model and its links put on the map, the villa's
// own devices (config/deviceGroups.villaDevices) over every entity and over
// the ones a profile can see, and what needs attention.
//
// ⚠️ IT WAS REBUILT WHEREVER IT WAS READ (round 10, 2.496.161). The same
// seven-argument villaDevices call, with its seven-entry dependency
// list, sat in useVillaAttention, FacilityModal and SummaryBar;
// useVillaAttention itself ran twice (the HUD's alert badge and the Cockpit
// the HUD opens); and `mappedEntityIds` was threaded by hand Dashboard → HUD →
// Cockpit / SummaryBar / Facility → SummaryGroupPanel. One provider now; each
// reader asks it (useVillaModel).

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "./ConfigContext";
import { useFmData } from "@/fm/FmDataContext";
import { villaDevices, type VillaDevices } from "./deviceGroups";
import {
  buildAttentionItems, villaHealthFrom, type AttentionItem, type VillaHealth,
} from "@/components/cockpit/cockpitData";

export interface VillaAttention {
  unavailableIds: string[];
  selectableIds: string[];
  attentionItems: AttentionItem[];
  health: VillaHealth;
}

export interface VillaModel {
  /** Entities the 3D model carries, plus every mapping's linked and motion
   *  entity — dismissed ones excluded (Dashboard's effectiveMappedEntityIds). */
  mappedEntityIds: Set<string>;
  /** The villa's own devices, over every entity HA reports. */
  devices: VillaDevices;
  /** The same, over the entities a profile can SEE (hidden and diagnostic
   *  ones left out) — what the bottom bar counts. */
  visibleDevices: VillaDevices;
  /** What needs attention: unavailable devices, open faults, overdue
   *  schedules, active alarms — the HUD badge and Cockpit read this ONE. */
  attention: VillaAttention;
}

const Ctx = createContext<VillaModel | null>(null);

export function VillaModelProvider({ mappedEntityIds, children }: { mappedEntityIds: Set<string>; children: ReactNode }) {
  const { entities, entityDeviceIds, suppressedEntityIds } = useHA();
  const { config, resolvedRooms } = useConfig();
  const { data: fmData } = useFmData();
  const { entityMap, deviceGroups, dismissedEntityIds } = config;

  const devices = useMemo(
    () => villaDevices({ entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, entities, entityDeviceIds }),
    [entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, entities, entityDeviceIds],
  );
  const visibleEntities = useMemo(() => {
    const out: typeof entities = {};
    for (const [id, e] of Object.entries(entities)) if (!suppressedEntityIds.has(id)) out[id] = e;
    return out;
  }, [entities, suppressedEntityIds]);
  const visibleDevices = useMemo(
    () => villaDevices({ entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, entities: visibleEntities, entityDeviceIds }),
    [entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, visibleEntities, entityDeviceIds],
  );
  const attention = useMemo((): VillaAttention => {
    const unavailableIds = devices.unavailable as string[];
    const selectableIds = devices.ids as string[];
    const attentionItems = buildAttentionItems({ unavailableIds, entities, entityMap, resolvedRooms, fmData, selectableIds });
    return { unavailableIds, selectableIds, attentionItems, health: villaHealthFrom(attentionItems) };
  }, [devices, entities, entityMap, resolvedRooms, fmData]);

  const value = useMemo(
    () => ({ mappedEntityIds, devices, visibleDevices, attention }),
    [mappedEntityIds, devices, visibleDevices, attention],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVillaModel(): VillaModel {
  const m = useContext(Ctx);
  if (!m) throw new Error("useVillaModel must be used within a VillaModelProvider (Dashboard)");
  return m;
}
