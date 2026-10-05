// src/config/readingRows.ts
// The rows of "Also on this device" (DeviceReadings): a reading's name, its
// words, and — for a binary sensor — the colour its own window gives that
// state. Pure: tests/oracles/binary_status.mjs drives it by value.
//
// ⚠️ THE ROWS HAD WORDS AND NO COLOUR (until 2.496.297). A smoke detector's
// "Smoke detected" listed under its battery read in the same grey as "Clear",
// while the detector's own window showed it red. A binary row now takes its
// tone from config/binaryLook, the one rule the pill and the history bar use.

import type { HassEntity } from "@/types/ha.types";
import type { Threshold } from "./ThresholdConfig";
import { labelOf } from "./EntityMap";
import { binaryLook } from "./binaryLook";
import { deviceRowText } from "@/utils/entityValue";
import { domainOf } from "@/utils/entityDomain";

export interface ReadingRow {
  id: string;
  label: string;
  text: string;
  /** A `.status-pill` tone ("on", "danger", "unavailable"…) — binary sensors
   *  only; a measurement keeps the plain secondary colour. */
  tone?: string;
}

export function readingRows(
  ids: readonly string[],
  entities: Record<string, HassEntity>,
  entityMap: Record<string, { label?: string } | undefined>,
  alertThresholds: Record<string, Threshold>,
): ReadingRow[] {
  return ids.map((id) => {
    const e = entities[id];
    const domain = domainOf(id);
    return {
      id,
      label: labelOf(id, entityMap, entities),
      text: e ? deviceRowText(e, domain) : "",
      tone: e && domain === "binary_sensor"
        ? binaryLook(id, e.attributes.device_class as string | undefined, alertThresholds[id]?.alertState).tone(e.state)
        : undefined,
    };
  });
}
