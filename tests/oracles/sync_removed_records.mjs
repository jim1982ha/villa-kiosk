// A record removed on another device stays removed, whatever its kind (architecture review K, 2026-10-24: fm/fmApi
// diffFmData / applyFmDiff / foldOthers, fm/fmSave removedOnAnotherDevice, config/deviceConfig diffSharedConfig /
// applySharedConfigDiff / applyRemoteChange).
//
//   k2  only a fault kept its `was`: a cost or a schedule the owner erased on the phone came back, everywhere, when a
//       tablet that had edited it offline caught up (the cost without its photo, already purged). The setup document
//       had the same shape: a viewpoint removed on one tablet came back from another that had renamed nothing but
//       moved it offline.
//
// Driven by value through the stores' own diff and replay, as the push runs them: the store's copy, the tablet's
// change replayed on it, and what the tablet's screen becomes and is told.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { diffFmData, applyFmDiff, foldOthers } = await import("@/fm/fmApi");
const { removedOnAnotherDevice, REMOVED_ON_ANOTHER_DEVICE } = await import("@/fm/fmSave");
const { baselineFromServer, diffSharedConfig, applySharedConfigDiff, pushedChange, applyRemoteChange } =
  await import("@/config/deviceConfig");

console.log("k2  a removal stands for every kind of record");
const fault = { id: "t1", title: "Noisy pump", status: "open", openedAt: "2026-10-20T08:00:00Z", photoIds: [], updates: [] };
const cost = { id: "co1", amount: 180, at: "2026-10-20T09:00:00Z", description: "Seal", photoIds: ["ph1"] };
const sched = { id: "sc1", title: "Clean filter", every: 7, createdAt: "2026-10-01T00:00:00Z" };
const done1 = { id: "cp1", scheduleId: "sc1", at: "2026-10-19T08:00:00Z", note: "" };
const doc = { id: "d1", title: "Invoice", at: "2026-10-19T08:00:00Z" };
const base = { ...structuredClone(EMPTY_FM_DATA), tickets: [fault], costs: [cost], schedules: [sched],
  completions: [done1], savedDocuments: [doc] };
// the tablet, offline, edits all five; meanwhile the owner erases them all on the phone
const tablet = { ...base, tickets: [{ ...fault, status: "in_progress" }], costs: [{ ...cost, amount: 185 }],
  schedules: [{ ...sched, every: 14 }], completions: [{ ...done1, note: "done" }], savedDocuments: [{ ...doc, title: "Bill" }] };
const store = { ...base, tickets: [], costs: [], schedules: [], completions: [], savedDocuments: [] };
const replayed = applyFmDiff(store, diffFmData(base, tablet));
for (const k of ["tickets", "costs", "schedules", "completions", "savedDocuments"])
  ck(`the store keeps ${k} erased elsewhere when the tablet catches up`, replayed[k].length === 0, replayed[k]);
const folded = foldOthers(tablet, { synced: base, others: diffFmData(base, store) });
ck("the tablet's screen drops them too", ["tickets", "costs", "schedules", "completions", "savedDocuments"]
  .every((k) => folded.doc[k].length === 0), folded.doc);
ck("the tablet is told each record removed, with its kind",
  folded.removedElsewhere.map((r) => `${r.kind}:${r.id}`).sort().join(" ")
  === "completions:cp1 costs:co1 savedDocuments:d1 schedules:sc1 tickets:t1", folded.removedElsewhere);
ck("a cost alone: the note names a cost", removedOnAnotherDevice(["costs"])
  === "This cost was removed on another device, so this change was not saved.", removedOnAnotherDevice(["costs"]));
ck("a fault alone: the note is the fault's step", removedOnAnotherDevice(["tickets"]) === REMOVED_ON_ANOTHER_DEVICE);
ck("several kinds: the note names each once", removedOnAnotherDevice(["costs", "schedules", "costs"])
  === "Some records (cost, task) were removed on another device, so these changes were not saved.",
  removedOnAnotherDevice(["costs", "schedules", "costs"]));
// a record NOT removed still takes the tablet's edit, and a new record is still added
const kept = applyFmDiff(base, diffFmData(base, { ...tablet, costs: [{ ...cost, amount: 185 }, { ...cost, id: "co2" }] }));
ck("an edit to a record still there lands, and a new one is added",
  kept.costs.map((c) => `${c.id}:${c.amount}`).sort().join(" ") === "co1:185 co2:180", kept.costs);

console.log("k2  the setup document follows the same rule");
const point = { name: "Terrace", floor: 1, x: 1, y: 2, z: 3, yaw: 0 };
const cbase = baselineFromServer({ teleportPoints: [point], entityMap: { a1: { room: "Room A" } } });
const cTablet = { ...cbase, teleportPoints: [{ ...point, x: 9 }], entityMap: { a1: { room: "Room B" } } };
const cStore = { ...cbase, teleportPoints: [], entityMap: {} };
const cReplayed = applySharedConfigDiff(cStore, diffSharedConfig(cbase, cTablet));
ck("a viewpoint removed elsewhere stays removed", cReplayed.teleportPoints.length === 0, cReplayed.teleportPoints);
ck("a device's setting removed elsewhere stays removed", Object.keys(cReplayed.entityMap).length === 0, cReplayed.entityMap);
const screen = applyRemoteChange({ ...cTablet }, pushedChange({ synced: cbase, others: diffSharedConfig(cbase, cStore) }));
ck("the tablet's setup drops them too", screen.teleportPoints?.length === 0 && Object.keys(screen.entityMap ?? { x: 1 }).length === 0, screen);
const cNew = applySharedConfigDiff(cbase, diffSharedConfig(cbase, { ...cTablet, teleportPoints: [{ ...point, x: 9 }, { ...point, name: "Pool" }] }));
ck("an edit to a viewpoint still there lands, and a new one is added",
  cNew.teleportPoints.map((p) => `${p.name}:${p.x}`).sort().join(" ") === "Pool:1 Terrace:9", cNew.teleportPoints);

done("✅ a record removed on another device stays removed, whatever its kind, in the Facility store and the setup");
