// src/config/cockpitIssues.ts
// THE COCKPIT'S ISSUES FOR ONE PROFILE, AS DRAWN (architecture review, 2026-10-26): every card of Messages › Open issues, the
// open issues (one per device, cockpitCard) and the Watched list (the faults a person closed that the VESTA Agent reads
// again, fm/faultConfirm), from ONE profile's view of the villa (attention.attentionFor). Pure; Messages only
// draws what this returns, a check reads it by value.
//
// ⚠️ A HIDDEN DEVICE'S CLOSED FAULT STILL SHOWED (owner, 2026-10-25: "hidden means hidden everywhere"): the open issues
// left a hidden device out, and the Watched list was built beside them, in the page, through the profile's visibility
// alone, which never asks whether a device is hidden. Both lists now pass the one predicate the profile's view owns
// (VillaAttention.shows: not hidden, and the profile may open it).

import type { AgentCadence } from "@/agent/agentApi";
import { clearingFault, confirmingFaults, type ConfirmingFault } from "@/fm/faultConfirm";
import type { FmData } from "@/fm/fmTypes";
import type { HassEntity } from "@/types/ha.types";
import type { AttentionItem, VillaAttention } from "./attention";
import { CARD_TONE_RANK, closedCards, cockpitCard, confirmingCards, holdsText, type CardView } from "./cockpitCard";
import type { labelOf } from "./EntityMap";

export interface CockpitIssues {
  /** The open issues, one card per device, in the list's order: what the title counts. */
  open: CardView[];
  /** The Watched list: closed faults the VESTA Agent confirms, never counted, the soonest verdict first. */
  watched: CardView[];
  /** The faults that are over, the last closed first: the Closed section's, with what VESTA told of them. */
  closed: CardView[];
}

/** Everything on Watch: the faults right again (`clearing`), still open, and the closed faults VESTA confirms
 *  (faultConfirm.confirmingFaults), the soonest close first, those awaiting their moment last. */
function watchList(clearing: readonly AttentionItem[], fmData: FmData, cadence: AgentCadence | null, now: Date): ConfirmingFault[] {
  const right = clearing.flatMap((i) => {
    const t = i.closing && fmData.tickets.find((x) => x.id === i.ticketId);
    return t && i.closing ? [clearingFault(t, Date.parse(i.closing.at), holdsText(i.closing), cadence, now.getTime())] : [];
  });
  const order = (c: ConfirmingFault) => (Number.isNaN(c.at) ? Infinity : c.at);
  return [...right, ...confirmingFaults(fmData, cadence, now.getTime())].sort((a, b) => order(a) - order(b));
}

/** Every card Open issues draws for the profile whose view is `view` (useVillaAttention). `fmData`: the fault
 *  records; `cadence`: the VESTA Agent's own timing (null: it did not say); `now`: the moment the cards are read at. */
export function cockpitIssues(view: Pick<VillaAttention, "attentionGroups" | "devices" | "shows" | "clearing">, opts: {
  fmData: FmData;
  cadence: AgentCadence | null;
  now: Date;
  entities: Record<string, HassEntity>;
  entityMap: Parameters<typeof labelOf>[1];
  resolvedRooms: Record<string, string>;
}): CockpitIssues {
  const { fmData, cadence, now, entities, entityMap, resolvedRooms } = opts;
  const cards = { devices: view.devices, entities, entityMap, resolvedRooms, may: view.shows };
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
