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
import { villaDevices, deviceFolding, type VillaDevices } from "./deviceGroups";
import { dismissedEntitySet } from "./dismissedEntities";
import { effectiveMapped, visibleEntitiesOf, visibleTo } from "./villaVisibility";
import type { Role } from "@/auth/roles";
import type { HassEntity } from "@/types/ha.types";
import {
  buildAttentionItems, groupAttention, villaHealthFrom, type AttentionGroup, type AttentionItem, type VillaHealth,
} from "@/components/cockpit/cockpitData";

export interface VillaAttention {
  unavailableIds: string[];
  selectableIds: string[];
  attentionItems: AttentionItem[];
  /** The same problems, one row per device (cockpitData.groupAttention) —
   *  what the badge, the phone menu and the Cockpit list COUNT and show. */
  attentionGroups: AttentionGroup[];
  health: VillaHealth;
}

/** The sets the villa model is built on — from useVillaSets, which the
 *  Dashboard calls (it also reads them itself, above the provider it renders). */
export interface VillaSets {
  /** Entities the 3D model carries, plus every mapping's linked and motion
   *  entity — dismissed ones excluded (villaVisibility.effectiveMapped). */
  mappedEntityIds: Set<string>;
  /** Entities the owner removed and HA no longer knows (dismissedEntitySet). */
  dismissedIds: Set<string>;
  /** Every entity a profile can see at all (hidden and diagnostic ones out). */
  visibleEntities: Record<string, HassEntity>;
}

export function useVillaSets(sceneEntityIds: Set<string>): VillaSets {
  const { entities, suppressedEntityIds } = useHA();
  const { config } = useConfig();
  const dismissedIds = useMemo(
    () => dismissedEntitySet(config.dismissedEntityIds, entities), [config.dismissedEntityIds, entities]);
  const mappedEntityIds = useMemo(
    () => effectiveMapped(sceneEntityIds, config.entityMap, dismissedIds), [sceneEntityIds, config.entityMap, dismissedIds]);
  const visibleEntities = useMemo(
    () => visibleEntitiesOf(entities, suppressedEntityIds), [entities, suppressedEntityIds]);
  return useMemo(() => ({ mappedEntityIds, dismissedIds, visibleEntities }), [mappedEntityIds, dismissedIds, visibleEntities]);
}

export interface VillaModel extends VillaSets {
  /** The villa's own devices, over every entity HA reports. */
  devices: VillaDevices;
  /** The same, over the entities a profile can SEE (hidden and diagnostic
   *  ones left out) — what the bottom bar counts. */
  visibleDevices: VillaDevices;
  /** What needs attention: unavailable devices, open faults, overdue
   *  schedules, active alarms — the HUD badge and Cockpit read this ONE. */
  attention: VillaAttention;
  /** The devices this profile's lists may name (villaVisibility.visibleTo) —
   *  the attention badge, the Cockpit list and anything else that asks. */
  visibleTo: (role: Role | null) => { has(id: string): boolean };
}

const Ctx = createContext<VillaModel | null>(null);

export function VillaModelProvider({ sets, children }: { sets: VillaSets; children: ReactNode }) {
  const { mappedEntityIds, visibleEntities } = sets;
  const { entities, entityDeviceIds } = useHA();
  const { config, resolvedRooms } = useConfig();
  const { data: fmData } = useFmData();
  const { entityMap, deviceGroups, dismissedEntityIds } = config;

  // Which entity stands for which device — a function of CONFIG and the
  // registry, so it is computed when those change, not on every state push.
  const folding = useMemo(() => deviceFolding(entityMap, deviceGroups, entityDeviceIds), [entityMap, deviceGroups, entityDeviceIds]);
  const devices = useMemo(
    () => villaDevices({ entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, entities, entityDeviceIds, folding }),
    [entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, entities, entityDeviceIds, folding],
  );
  const visibleDevices = useMemo(
    () => villaDevices({ entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, entities: visibleEntities, entityDeviceIds, folding }),
    [entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, visibleEntities, entityDeviceIds, folding],
  );
  const attention = useMemo((): VillaAttention => {
    const unavailableIds = devices.unavailable as string[];
    const selectableIds = devices.ids as string[];
    const attentionItems = buildAttentionItems({
      unavailableIds, entities, entityMap, alertThresholds: config.alertThresholds, resolvedRooms, fmData, selectableIds, folding });
    const attentionGroups = groupAttention(attentionItems);
    return { unavailableIds, selectableIds, attentionItems, attentionGroups, health: villaHealthFrom(attentionGroups) };
  }, [devices, entities, entityMap, config.alertThresholds, resolvedRooms, fmData, folding]);

  const value = useMemo(
    (): VillaModel => ({
      ...sets, devices, visibleDevices, attention,
      visibleTo: (role) => visibleTo(role, { mapped: mappedEntityIds, entityMap, entities }),
    }),
    [sets, mappedEntityIds, devices, visibleDevices, attention, entityMap, entities],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVillaModel(): VillaModel {
  const m = useContext(Ctx);
  if (!m) throw new Error("useVillaModel must be used within a VillaModelProvider (Dashboard)");
  return m;
}
