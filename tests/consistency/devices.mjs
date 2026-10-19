// A villa's devices as the app's VillaDevices answers them (config/deviceGroups.villaDevices) — for the oracles that
// hand a device list to buildAttentionItems, attentionFor or buildReadiness. Those ASK the list (architecture review,
// 2026-10-19: they were handed its ids, its offline ids, the fold and the critical list beside it, and restated them).
//
//   devicesOf({ ids, unavailable, folding, critical })   // folding: member → the entity standing for its device
export function devicesOf({ ids = [], unavailable = [], folding = new Map(), critical = new Set() } = {}) {
  const set = new Set(ids);
  const of = (id) => folding.get(id) ?? id;
  const crit = new Set([...critical].flatMap((e) => [e, of(e)]));
  return {
    ids, unavailable,
    has: (id) => set.has(id),
    deviceOf: of,
    deviceOfRecord: (field) => of(String(field ?? "").split(",")[0].trim()),
    isCritical: (id) => crit.has(id),
  };
}
