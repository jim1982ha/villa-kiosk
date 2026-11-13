// A villa's devices as the app's VillaDevices answers them (config/deviceGroups.villaDevices) — for the oracles that
// hand a device list to attentionOf, attentionFor or buildReadiness. Those ASK the list (architecture review,
// 2026-10-19: they were handed its ids, its offline ids, the fold and the critical list beside it, and restated them).
//
//   devicesOf({ ids, unavailable, folding, critical, hidden, partlyLost })   // folding: member → the entity standing for its device
//   partlyLost: { device: [its lost parts] } — devices that answer while those parts do not (VillaDevices.healthOf "partly")
export function devicesOf({ ids = [], unavailable = [], folding = new Map(), critical = new Set(), hidden = new Set(), partlyLost = {} } = {}) {
  const set = new Set(ids);
  const of = (id) => folding.get(id) ?? id;
  const crit = new Set([...critical].flatMap((e) => [e, of(e)]));
  return {
    ids, unavailable,
    partlyLost: Object.keys(partlyLost),
    healthOf: (id) => (unavailable.includes(id) ? { kind: "lost" } : partlyLost[id] ? { kind: "partly", lost: partlyLost[id] } : { kind: "alive" }),
    has: (id) => set.has(id),
    deviceOf: of,
    deviceOfRecord: (field) => of(String(field ?? "").split(",")[0].trim()),
    isCritical: (id) => crit.has(id),
    isHidden: (id) => hidden.has(id) || hidden.has(of(id)),
  };
}
