// src/ai/models.ts
// The models the settings screen offers.
//
// ⚠️ A DATED LIST, AND THE FIELD STAYS FREE-TEXT BECAUSE OF IT. Anthropic
// releases models between our releases; a closed dropdown would make this
// add-on the thing standing between an operator and a model that already
// exists. The list is a convenience for the common case, and "Something else…"
// is the escape hatch for the rest.
//
// ⚠️ AND AN UNKNOWN MODEL IS NOT A FREE ONE. The layer's token meter prices
// what it knows and reports UNPRICED for what it does not — so typing a model
// this list has never heard of is safe in the only way that matters: it cannot
// quietly spend money nobody can account for.

export interface ModelChoice {
  id: string;
  label: string;
  /** What it costs, per million tokens, so the choice is an informed one. */
  note: string;
}

/** Published first-party rates as of 2026-06-24. */
export const MODEL_CHOICES: readonly ModelChoice[] = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5", note: "fastest, cheapest — $1 in / $5 out per Mtok" },
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "balanced — $2 in / $10 out per Mtok" },
  { id: "claude-opus-5", label: "Opus 5", note: "most capable — $5 in / $25 out per Mtok" },
  { id: "claude-opus-4-8", label: "Opus 4.8", note: "previous Opus — $5 in / $25 out per Mtok" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", note: "previous Sonnet — $3 in / $15 out per Mtok" },
];
