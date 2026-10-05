// src/fm/useFmTerms.ts
// The owner's maintenance contract terms, as every Facility screen reads
// them: the shared `fmContract` setting, resolved, with Home Assistant's
// currency (see fm/fmTypes.ts fmTerms).

import { useMemo } from "react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { fmTerms, type FmTerms } from "./fmTypes";

export function useFmTerms(): FmTerms {
  const { config } = useConfig();
  const { haConfig } = useHA();
  return useMemo(() => fmTerms(config.fmContract, haConfig?.currency), [config.fmContract, haConfig?.currency]);
}
