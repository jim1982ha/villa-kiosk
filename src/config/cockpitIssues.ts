// src/config/cockpitIssues.ts
// THE COCKPIT'S ISSUES FOR ONE PROFILE, AS DRAWN (architecture review, 2026-10-26): every card of Messages › Open issues, the
// open issues (one per device, cockpitCard) and the Watched list (the faults a person closed that the VESTA Agent reads
// again, fm/faultConfirm), from ONE profile's view of the villa (attention.attentionFor). Pure; Messages only
// draws what this returns, a check reads it by value.
//
// ⚠️ ONE PREDICATE FOR EVERY SECTION (owner, 2026-10-25): the Watched list was built beside the open issues, in the page,
// through a visibility of its own. Every section passes the one the profile's view owns for problems
// (VillaAttention.raises: the profile may open it), and files a hidden device's fault as the open issues do: under
// "Other", on no device card (architecture review item 5, 2026-11-13: hidden is no longer dropped).

import type { AgentCadence } from "@/agent/agentApi";
import type { ConfirmingFault } from "@/fm/faultConfirm";
import { confirmingFaults, watchAsOf } from "@/fm/faultStanding";
import type { FmData } from "@/fm/fmTypes";
import type { HassEntity } from "@/types/ha.types";
import type { OnWatch, VillaAttention } from "./attention";
import { CARD_TONE_RANK, closedCards, cockpitCard, confirmingCards, type CardView } from "./cockpitCard";
import type { labelOf } from "./EntityMap";

export interface CockpitIssues {
  /** The open issues, one card per device, in the list's order: what the title counts. */
  open: CardView[];
  /** The Watched list: closed faults the VESTA Agent confirms, never counted, the soonest verdict first. */
  watched: CardView[];
  /** The faults that are over, the last closed first: the Closed section's, with what VESTA told of them. */
  closed: CardView[];
}

/** Everything on Watch: the open faults right again or held as expected (`clearing`, each with its card's fields, made
 *  from its own record: fm/faultStanding) and the closed faults VESTA confirms (faultStanding.confirmingFaults), the
 *  soonest close first, those awaiting their moment last. ⚠️ NEVER LOOKED UP AGAIN (architecture review, 2026-11-13): a
 *  fault right again was found again here by its id in `fmData`, and dropped when it was not there: in neither list. */
function watchList(clearing: readonly OnWatch[], fmData: FmData, cadence: AgentCadence | null, now: Date): ConfirmingFault[] {
  const right = clearing.map((c) => watchAsOf(c.fault, now.getTime()));
  const order = (c: ConfirmingFault) => (Number.isNaN(c.at) ? Infinity : c.at);
  return [...right, ...confirmingFaults(fmData, cadence, now.getTime())].sort((a, b) => order(a) - order(b));
}

/** Every card Open issues draws for the profile whose view is `view` (useVillaAttention). `fmData`: the fault
 *  records; `cadence`: the VESTA Agent's own timing (null: it did not say); `now`: the moment the cards are read at. */
export function cockpitIssues(view: Pick<VillaAttention, "attentionGroups" | "devices" | "raises" | "clearing">, opts: {
  fmData: FmData;
  cadence: AgentCadence | null;
  now: Date;
  entities: Record<string, HassEntity>;
  entityMap: Parameters<typeof labelOf>[1];
  resolvedRooms: Record<string, string>;
}): CockpitIssues {
  const { fmData, cadence, now, entities, entityMap, resolvedRooms } = opts;
  const cards = { devices: view.devices, entities, entityMap, resolvedRooms, may: view.raises };
  return {
    // ⚠️ IN THEIR COLOUR'S ORDER (owner, 2026-11-05): red, amber, grey, then what is being handled; within a colour the
    // grouping's own order (attention.groupAttention), a stable sort
    open: view.attentionGroups.map((g) => cockpitCard(g, cadence, now))
      .sort((a, b) => CARD_TONE_RANK[a.tone ?? "warn"] - CARD_TONE_RANK[b.tone ?? "warn"]),
    // ⚠️ RIGHT AGAIN IS ON WATCH (owner, 2026-11-12): a fault waiting out the Agent's clear wait (attention's `clearing`)
    // beside the closed faults VESTA confirms, one card per device, the soonest close first
    watched: confirmingCards(watchList(view.clearing ?? [], fmData, cadence, now), cards),
    closed: closedCards(fmData, cadence, now, cards),
  };
}
