// tests/consistency/kiosk_view.ts
// What the KIOSK says about a deployment, as JSON on stdout.
//
// Run: node --import ./tests/consistency/register.mjs \
//        tests/consistency/kiosk_view.ts <fixture.json>
//
// ⚠️ THIS IS HALF OF AN INSTRUMENT, NOT A TEST. Its counterpart is
// `reports/devices.py` with `reports/standing.py` and `reports/ledger.py`,
// which answer the same questions about the same fixture from the add-on's
// side, and `tests/py/test_consistency_parity.py` imports those three, runs
// THIS file through `node --experimental-strip-types`, and diffs the two.
// (This comment named a single `reports/consistency.py` until 2.608.0. No such
// module has ever existed — the Python side is those three, which is why the
// parity test imports three names and not one.) The whole point is to make "the tablet and the briefing agree"
// a thing CI can fail on, rather than a thing a person notices from a
// screenshot — which is how every divergence in this subsystem has been found
// so far, including the one that prompted the work.
//
// ⚠️ IT IMPORTS THE APP'S OWN MODULES. A transcription of the rule would agree
// with itself forever while the shipped rule moved; that is the failure this
// harness exists to prevent, so it may not commit it in its own implementation.

import { selectableDeviceIds, unavailableDeviceIds } from "../../src/config/deviceGroups.ts";
// ⚠️ D12: the FACILITY REPORT's own arithmetic, from the module that prints
// it. `fmReport`'s "Faults and response" section is `ticketStats` rendered,
// so comparing this is comparing that report against the brief.
import { isTicketOpen, ticketStats } from "../../src/fm/fmEngine.ts";
import { buildAttentionItems, villaHealthFrom } from "../../src/components/cockpit/cockpitData.ts";
import { effectiveCategory } from "../../src/config/EntityCategories.ts";
import type { AppConfig } from "../../src/config/AppConfig.ts";
import type { FmData } from "../../src/fm/fmTypes.ts";
import type { HassEntity } from "../../src/types/ha.types.ts";
import type { EntityMapping } from "../../src/types/scene.types.ts";

interface Fixture {
  name: string;
  /** Full HA states, keyed by entity_id — as `useHA().entities` holds them. */
  states: Record<string, HassEntity>;
  /** The shared `/data/device-config.json` document, unwrapped. */
  deviceConfig: {
    entityMap?: Record<string, EntityMapping>;
    deviceGroups?: AppConfig["deviceGroups"];
    dismissedEntityIds?: string[];
  };
  /** `/data/fm-data.json`, unwrapped. */
  fmData: FmData;
  /** Entity ids the loaded model has geometry for — the kiosk derives these
   *  from mesh names; the add-on reads them out of the GLB (reports/model.py). */
  meshEntityIds: string[];
  /** Room per entity, as `useConfig().resolvedRooms` resolves it. */
  resolvedRooms?: Record<string, string>;
}

const file = process.argv[2];
if (!file) {
  console.error("usage: kiosk_view.ts <fixture.json>");
  process.exit(2);
}
const fx: Fixture = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));

const entityMap = fx.deviceConfig.entityMap ?? {};
const deviceGroups = fx.deviceConfig.deviceGroups ?? [];
const dismissed = fx.deviceConfig.dismissedEntityIds ?? [];
const mapped = new Set(fx.meshEntityIds ?? []);
const fmData: FmData = {
  schedules: [], completions: [], costs: [], tickets: [], savedDocuments: [],
  ...(fx.fmData ?? {}),
};

const selectable = selectableDeviceIds(entityMap, deviceGroups, mapped, fx.states, dismissed);
const unavailable = unavailableDeviceIds(entityMap, deviceGroups, mapped, fx.states, dismissed);
const attention = buildAttentionItems({
  unavailableIds: unavailable,
  entities: fx.states,
  entityMap,
  resolvedRooms: fx.resolvedRooms ?? {},
  fmData,
  selectableIds: selectable,
});

// ⚠️ SORTED, AND THE SUBJECT IS WHAT IS COMPARED. Neither side promises an
// order — the kiosk's list is the order it paints and the add-on's is the order
// it composes — so comparing sequences would fail on a difference nobody can
// see. `id` is the stable subject key (`unavailable:<entity>`, `fault:<uuid>`),
// which is exactly what P3's deduplication will key on.
process.stdout.write(JSON.stringify({
  source: "kiosk",
  fixture: fx.name,
  selectable: [...selectable].sort(),
  unavailable: [...unavailable].sort(),
  attention: attention
    .map((a) => ({ id: a.id, kind: a.kind, title: a.title, room: a.room ?? "" }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  health: villaHealthFrom(attention).level,
  // ⚠️ `open + inProgress`, NOT `open`. The Facility Report shows the two
  // separately and the brief shows one list; they agree when the SUM matches,
  // and an in-progress fault dropped from either is the divergence.
  faultsOpen: ticketStats(fmData.tickets).open
            + ticketStats(fmData.tickets).inProgress,
  faultsResolved: ticketStats(fmData.tickets).resolved,
  // ⚠️ THE IDS, NOT ONLY THE COUNTS. Two rules that disagree about which
  // tickets are open can still produce the same TOTAL when their errors offset
  // — the first version of this fixture did exactly that (tkt-4 moved one way,
  // tkt-6 the other) and a mutation reverting the add-on's rule passed
  // cleanly. A count is the weakest possible pin because it survives a swap.
  faultsOpenIds: fmData.tickets.filter(isTicketOpen)
    .map((t) => String(t.id)).sort(),
  // ⚠️ THE CATEGORY OF EVERY DEVICE, BY ID (2026-09-04). `adapters/
  // categories.py` is a second implementation of `effectiveCategory` — the
  // agent needs it to keep its ranked excerpt from being all energy — and this
  // is what pins the two together. Inputs as `buildCategoryTiles` passes
  // them, with the domain standing in for `type` when the map has no row.
  categories: Object.fromEntries([...selectable].sort().map((id) => [
    id,
    effectiveCategory(
      id,
      entityMap[id]?.type ?? (id.split(".")[0] as EntityMapping["type"]),
      entityMap[id]?.category,
      fx.states[id]?.attributes?.device_class as string | undefined,
    ),
  ])),
}, null, 2) + "\n");
