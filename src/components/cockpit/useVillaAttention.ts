// src/components/cockpit/useVillaAttention.ts
// THE villa-wide "needs attention" count — shared by Cockpit's own Needs
// Attention section and every entry point that opens it (HUD's top-bar
// alert icon + its count badge, the phone overflow menu's "Cockpit (N)"
// row), so the number on the button and the number inside the modal it
// opens can never disagree ("the menu says 4 but the modal says 5").
//
// Computed ONCE by the villa model (config/VillaModel, 2.496.161) — this hook
// ran twice, once for the HUD and once for the Cockpit the HUD opens.

import { useVillaModel, type VillaAttention } from "@/config/VillaModel";

export type { VillaAttention };

export function useVillaAttention(): VillaAttention {
  return useVillaModel().attention;
}
