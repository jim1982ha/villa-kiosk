// src/config/observation.ts
// An observation card — the one shape the Weather window's advice and the
// Energy window's cards share: good (✓), neutral (·), caution or bad (!), a
// title and a detail. It was declared three times, identically (round 9,
// 2.496.143): WindowPieces.ObservationCard, energyObservations.EnergyCard and
// weatherStation.Advice.

export type ObservationTone = "good" | "caution" | "bad" | "neutral";
export interface Observation { tone: ObservationTone; title: string; detail: string }
