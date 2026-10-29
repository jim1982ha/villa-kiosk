// Advanced Settings joins Settings' Save / Cancel (owner, 2026-10-22; architecture review B #1). Its edits apply live
// and reach every tablet; the dialog that opened it remembers the villa's setup as it was (config/configSlice
// ADVANCED_SETTINGS_KEYS, in the dialog's one draft — hooks/useDraftedSlice): a change makes Save live, Save keeps it,
// Cancel writes the old setup back through the same update (so the store, and every tablet, get the old values). Since
// 2.496.499 the draft is a ledger of what the dialog's own controls set (configSlice recordEdit), item by item.
//
// Driven by value: the real edits each section of Advanced Settings makes, applied to a real config, through the
// slice's own rule and the config's own normalisation — then the wiring.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { ADVANCED_SETTINGS_KEYS: KEYS, sliceOf, EMPTY_LEDGER, recordEdit, ledgerDirty, revertLedger } =
  await import("@/config/configSlice");
const { DEFAULT_CONFIG, normaliseConfig } = await import("@/config/AppConfig");
const E = await import("@/config/mappingEdits");
const { groupEdit, removeGroup } = await import("@/config/deviceGroups");
const { withItem: withDevice } = await import("@/utils/listToggle");
// by content: a reverted map may list its items in another order
const sorted = (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v);
const J = (v) => JSON.stringify(v, sorted);

// the store's update: a patch (or an edit of the config) laid over it, normalised as every config entering memory is
const update = (c, change) => normaliseConfig({ ...c, ...(typeof change === "function" ? change(c) : change) });
const opened = normaliseConfig({ ...DEFAULT_CONFIG,
  entityMap: { "light.hall": { entityId: "light.hall", type: "light", label: "Hall" } },
  meshBindings: { lamp_mesh: "light.hall" }, latitude: -8.4, longitude: 115.2, northOffsetDeg: 30 });

// one edit from every section of Advanced Settings, as its control makes it
const EDITS = [
  ["Villa location", { latitude: -8.5 }],
  ["Model north offset (a slider drag)", { northOffsetDeg: 117 }],
  ["Villa empty sensor", { presenceSensor: "binary_sensor.example_empty" }],
  ["a device's fields (Devices)", E.patchMapping("light.hall", { label: "Hall lamp", requireConfirm: true, linkedEntityId: "switch.x" })],
  ["a device re-pointed", E.repointDevice("light.hall", "light.hall_2")],
  ["a stale device removed", E.forgetMappings(["light.hall"])],
  ["a 3D object bound", E.bindMesh("pump_mesh", "switch.pump")],
  ["a 3D object unbound", E.unbindMesh("lamp_mesh")],
  ["an entity prepared", E.addMapping("sensor.new")],
  ["a group made", (c) => groupEdit(c, { kind: "create", primaryEntityId: "light.hall", id: "g1" })],
  ["asleep between reports", (c) => ({ unavailableByDesign: withDevice(c.unavailableByDesign, "binary_sensor.door", true) })],
  ["records kept", { recordsKeptDays: 90 }],
];

console.log("  every section's edit, through the draft:");
for (const [name, edit] of EDITS) {
  const baseline = sliceOf(opened, KEYS);
  const patch = typeof edit === "function" ? edit(opened) : edit;
  const after = update(opened, edit);
  const ledger = recordEdit(EMPTY_LEDGER, KEYS, opened, after);   // the dialog's own write, recorded
  const reverted = update(after, revertLedger(ledger, after));    // Cancel: its items put back through the same update
  ck(`${name}: only draft keys written; dirty after it; Cancel restores exactly`,
     Object.keys(patch).every((k) => KEYS.includes(k))
     && ledgerDirty(ledger, after)
     && J(sliceOf(reverted, KEYS)) === J(baseline) && !ledgerDirty(ledger, reverted),
     { keys: Object.keys(patch), reverted: J(sliceOf(reverted, KEYS)) === J(baseline) });
}
ck("removing a group is in the draft too", Object.keys(removeGroup({ ...opened, deviceGroups: [{ id: "g", primaryEntityId: "x", memberEntityIds: [] }] }, "g")).every((k) => KEYS.includes(k)));
ck("an action is not in it: the model upload's rooms (teleportPoints) and the per-device look", !KEYS.includes("teleportPoints") && !KEYS.includes("theme"));

console.log("\n  the wiring:");
{
  const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
  const st = src("components/settings/SettingsModal.tsx"), adv = src("components/settings/ConfigEditorModal.tsx");
  const db = src("pages/Dashboard.tsx");
  ck("Settings' one draft holds Advanced Settings' keys", /\.\.\.ADVANCED_SETTINGS_KEYS,\s*\] as const;/.test(st) && /useDraftedSlice\(SETTINGS_KEYS\)/.test(st));
  ck("Advanced Settings over Settings closes back to it; on its own, the same draft is its own Save / Cancel",
     /const own = useDraftedSlice\(ADVANCED_SETTINGS_KEYS\);/.test(adv)
     && /const commit = withinSettings \? undefined : \{ dirty: own\.dirty, save: own\.save, discard: \(\) => \{ own\.discard\(\); \} \};/.test(adv)
     && /<ModalFooter onClose=\{back\} commit=\{commit\}/.test(adv) && /<Window kind="content" label="Advanced settings" onClose=\{exit\}/.test(adv)
     && /withinSettings=\{shown\("settings"\)\}/.test(db));
  ck("its controls write as the dialog (what the drafts record), the model upload's rooms do not",
     /return \(\s*<DialogEdits>\s*<PendingFields pending=\{own\.pending\}>\s*<Window\b/.test(adv)
     && /<\/Window>\s*<\/PendingFields>\s*<\/DialogEdits>/.test(adv)
     && /const glbUpload = useGlbUpload\(/.test(adv));
}

done("✅ Advanced Settings' changes are Settings' to save or cancel");
