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
import { useVillaModel, type VillaAttention } from "@/config/VillaModel";
import { useProfile } from "@/auth/ProfileContext";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { isMappingAllowed, listedDevices } from "@/auth/permissions";
import { attentionFor } from "./cockpitData";

export type { VillaAttention };

export function useVillaAttention(): VillaAttention {
  const { attention, mappedEntityIds } = useVillaModel();
  const { role } = useProfile();
  const { config } = useConfig();
  const { entities } = useHA();
  return useMemo(() => {
    const listed = listedDevices(role, { has: () => true }, mappedEntityIds);
    return attentionFor(attention, (id) => {
      if (!listed.has(id)) return false;
      const m = config.entityMap[id];
      return !m || (role != null && isMappingAllowed(role, id, m, entities[id]));
    });
  }, [attention, mappedEntityIds, role, config.entityMap, entities]);
}
