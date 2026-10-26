// src/config/cockpitIssues.ts
// THE COCKPIT'S ISSUES FOR ONE PROFILE, AS DRAWN (architecture review, 2026-10-26): every card of the Overview, the
// open issues (one per device, cockpitCard) and the Watched list (the faults a person closed that the VESTA Agent reads
// again, fm/faultConfirm), from ONE profile's view of the villa (attention.attentionFor). Pure; CockpitOverview only
// draws what this returns, a check reads it by value.
//
// ⚠️ A HIDDEN DEVICE'S CLOSED FAULT STILL SHOWED (owner, 2026-10-25: "hidden means hidden everywhere"): the open issues
// left a hidden device out, and the Watched list was built beside them, in the page, through the profile's visibility
// alone, which never asks whether a device is hidden. Both lists now pass the one predicate the profile's view owns
// (VillaAttention.shows: not hidden, and the profile may open it).

import type { AgentCadence } from "@/agent/agentApi";
import { confirmingFaults } from "@/fm/faultConfirm";
import type { FmData } from "@/fm/fmTypes";
import type { HassEntity } from "@/types/ha.types";
import type { VillaAttention } from "./attention";
import { cockpitCard, confirmingCards, type CardView } from "./cockpitCard";
import type { labelOf } from "./EntityMap";

export interface CockpitIssues {
  /** The open issues, one card per device, in the list's order: what the title counts. */
  open: CardView[];
  /** The Watched list: closed faults the VESTA Agent confirms, never counted, the soonest verdict first. */
  watched: CardView[];
}

/** Every card the Overview draws for the profile whose view is `view` (useVillaAttention). `fmData`: the fault
 *  records; `cadence`: the VESTA Agent's own timing (null: it did not say); `now`: the moment the cards are read at. */
export function cockpitIssues(view: Pick<VillaAttention, "attentionGroups" | "devices" | "shows">, opts: {
  fmData: FmData;
  cadence: AgentCadence | null;
  now: Date;
  entities: Record<string, HassEntity>;
  entityMap: Parameters<typeof labelOf>[1];
  resolvedRooms: Record<string, string>;
}): CockpitIssues {
  const { fmData, cadence, now, entities, entityMap, resolvedRooms } = opts;
  return {
    open: view.attentionGroups.map((g) => cockpitCard(g, cadence, now)),
    watched: confirmingCards(confirmingFaults(fmData, cadence, now.getTime()),
      { devices: view.devices, entities, entityMap, resolvedRooms, may: view.shows }),
  };
}
