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
import { villaDevices, deviceFolding, deviceOf, deviceReadings, type VillaDevices } from "./deviceGroups";
import { dismissedEntitySet } from "./dismissedEntities";
import { effectiveMapped, visibleEntitiesOf, visibleTo } from "./villaVisibility";
import type { Role } from "@/auth/roles";
import type { HassEntity } from "@/types/ha.types";
import { buildAttentionItems, type VillaProblems } from "./attention";

/** The villa's problems, role-blind; a profile's view (grouped, with its
 *  health line) is attention.attentionFor — see useVillaAttention. */
export type { VillaProblems };

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
  /** What needs attention, role-blind: unavailable devices, open faults,
   *  overdue schedules, active alarms. Shown only through a profile's view
   *  (useVillaAttention → attention.attentionFor), never counted directly. */
  attention: VillaProblems;
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
  const { folding } = useDeviceIdentity();
  const devices = useMemo(
    () => villaDevices({ entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, entities, entityDeviceIds, folding }),
    [entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, entities, entityDeviceIds, folding],
  );
  const visibleDevices = useMemo(
    () => villaDevices({ entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, entities: visibleEntities, entityDeviceIds, folding }),
    [entityMap, deviceGroups, dismissedEntityIds, mappedEntityIds, visibleEntities, entityDeviceIds, folding],
  );
  const attention = useMemo((): VillaProblems => {
    const unavailableIds = devices.unavailable as string[];
    const selectableIds = devices.ids as string[];
    const attentionItems = buildAttentionItems({
      unavailableIds, entities, entityMap, alertThresholds: config.alertThresholds, resolvedRooms, fmData, selectableIds, folding });
    // NOT grouped here: grouping is per profile (attentionFor), and a
    // role-blind grouping had no reader (until 2.496.268 it ran anyway).
    return { unavailableIds, selectableIds, attentionItems };
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

/**
 * "Which device is this entity, and what else does it read?" — for every
 * opener (the map, Cockpit, the Agent, Facility, the lists) and for Settings
 * (2.496.260). A hook rather than a field of the villa model because the
 * Dashboard, which opens panels, is what PROVIDES that model. The fold is a
 * function of config and the registry only, so it is rebuilt when those
 * change, never on a state push.
 */
export function useDeviceIdentity() {
  const { entities, entityDeviceIds, suppressedEntityIds } = useHA();
  const { config } = useConfig();
  const { entityMap, deviceGroups } = config;
  const folding = useMemo(() => deviceFolding(entityMap, deviceGroups, entityDeviceIds), [entityMap, deviceGroups, entityDeviceIds]);
  return useMemo(() => ({
    folding,
    /** What a tap on anything of `id`'s device opens. */
    deviceOf: (id: string) => deviceOf(folding, id),
    /** The device's other readings, listed under its panel. */
    readingsOf: (rep: string) => deviceReadings(rep, folding, entities, suppressedEntityIds, deviceGroups),
  }), [folding, entities, suppressedEntityIds, deviceGroups]);
}

export function useVillaModel(): VillaModel {
  const m = useContext(Ctx);
  if (!m) throw new Error("useVillaModel must be used within a VillaModelProvider (Dashboard)");
  return m;
}
