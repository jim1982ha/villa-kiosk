// src/components/cockpit/useVillaAttention.ts
// THE "needs attention" set a profile is shown — shared by Cockpit's own Needs
// Attention section and every entry point that opens it (HUD's top-bar alert
// icon + its count badge, the phone overflow menu's "Cockpit (N)" row), so the
// number on the button and the number inside the modal it opens can never
// disagree ("the menu says 4 but the modal says 5").
//
// Computed ONCE by the villa model (config/VillaModel, 2.496.161); what this
// adds is the PROFILE: only devices this role may open, over the devices its
// lists cover (permissions.listedDevices) — the villa model is role-blind, and
// a guest's badge counted devices their list would not show (2.496.191).

import { useMemo } from "react";
import { useVillaModel, useVillaModelOrNull } from "@/config/VillaModel";
import { useProfile, useProfileOrNull } from "@/auth/ProfileContext";
import { attentionFor, issueSeverity, type AttentionSeverity, type VillaAttention } from "@/config/attention";
import { cockpitIssues, type CockpitIssues } from "@/config/cockpitIssues";
import { useFmData } from "@/fm/FmDataContext";
import { useAgent } from "@/agent/AgentContext";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useNow } from "@/hooks/useInterval";

export type { VillaAttention };

/** What needs attention, as THIS profile may see it — the villa model's
 *  attention through its visibleTo(role). */
export function useVillaAttention(): VillaAttention {
  const { attention, visibleTo } = useVillaModel();
  const { role } = useProfile();
  return useMemo(() => {
    const sees = visibleTo(role);
    return attentionFor(attention, (id) => sees.has(id));
  }, [attention, visibleTo, role]);
}

/** Every card of the Cockpit's Overview for THIS profile (config/cockpitIssues): the open issues and the Watched
 *  list, from the same view the top bar counts. Read again every minute: a watched card past its moment goes, a
 *  "closes at about" turns to "at the next check", even when nothing else changes. */
export function useCockpitIssues(): CockpitIssues {
  const view = useVillaAttention();
  const { data } = useFmData();
  const { status } = useAgent();
  const { entities } = useHA();
  const { config, resolvedRooms } = useConfig();
  const now = useNow(60_000);
  const cadence = status?.cadence ?? null;
  return useMemo(() => cockpitIssues(view, { fmData: data, cadence, now: new Date(now), entities,
    entityMap: config.entityMap, resolvedRooms }), [view, data, cadence, now, entities, config.entityMap, resolvedRooms]);
}

/** How serious the issues are that the Cockpit's Overview lists for these entities' devices (a device window: the
 *  device and its linked entity), as this profile sees them; null when it lists none — or outside the villa model (a
 *  window drawn on its own). The window's warning reads it: live, so it appears and goes by itself. */
export function useDeviceIssue(ids: readonly string[]): AttentionSeverity | null {
  const m = useVillaModelOrNull();
  const role = useProfileOrNull()?.role ?? null;
  const key = ids.join("|");
  return useMemo(() => {
    if (!m || !key) return null;
    const sees = m.visibleTo(role);
    const att = attentionFor(m.attention, (id) => sees.has(id));
    return issueSeverity(att.attentionGroups, key.split("|"), m.devices.deviceOf);
  }, [m, role, key]);
}
