// src/config/readingRows.ts
// The rows of "Also on this device" (DeviceReadings): a reading's name, its
// words, and — for a sensor — the colour its own window gives that state.
// Pure: tests/oracles/binary_status.mjs drives it by value.
//
// ⚠️ THE ROWS HAD WORDS AND NO COLOUR (until 2.496.297). A smoke detector's
// "Smoke detected" listed under its battery read in the same grey as "Clear",
// while the detector's own window showed it red. A sensor's row now takes its
// tone from config/reading — the one answer its own window gives.

import type { HassEntity } from "@/types/ha.types";
import { labelOf } from "./EntityMap";
import { readingOf, rowText, rowTone } from "./reading";
import { domainOf } from "@/utils/entityDomain";

export interface ReadingRow {
  id: string;
  label: string;
  text: string;
  /** A `.status-pill` tone ("on", "danger", "unavailable", "warning"…) for a
   *  sensor (config/reading.rowTone); a normal number keeps the row's quiet
   *  colour, and other domains have none. */
  tone?: string;
}

export function readingRows(
  ids: readonly string[],
  entities: Record<string, HassEntity>,
  entityMap: Record<string, { label?: string } | undefined>,
): ReadingRow[] {
  return ids.map((id) => {
    const e = entities[id];
    const domain = domainOf(id);
    return {
      id,
      label: labelOf(id, entityMap, entities),
      text: e ? rowText(id, e) : "",
      // A sensor's row takes the tone its own window gives it (config/reading): a binary state's pill tone.
      tone: e && (domain === "binary_sensor" || domain === "sensor")
        ? rowTone(readingOf(id, e, domain))
        : undefined,
    };
  });
}
