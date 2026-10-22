// Cancel undoes only THIS dialog's changes (2.496.497). Since Advanced Settings joined Settings' draft (2.496.493),
// a change another tablet made while Settings was open arrived through the shared store's merge, lit Save by itself,
// and Cancel wrote the open-time copy back: the other tablet's edit was undone, and the sync pushed the undo to every
// tablet. Now the merge tells the draft what the others changed, item by item, and the draft's baseline moves by it
// (config/configSlice rebaseOnRemote, hooks/useDraftedSlice, config/ConfigContext mergeRemote, DeviceConfigSync).
//
// Driven by value: a real config, the store's own update (normalised), the shared store's own per-item diff and
// rebase loop (utils/keyedSync pushWithRebase), and the draft's own rules. Then the wiring.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { ADVANCED_SETTINGS_KEYS: ADV, sliceOf, sliceChanged, rebaseOnRemote } = await import("@/config/configSlice");
const { DEFAULT_CONFIG, normaliseConfig } = await import("@/config/AppConfig");
const D = await import("@/config/deviceConfig");
const { pushWithRebase } = await import("@/utils/keyedSync");
const E = await import("@/config/mappingEdits");
const { withDevice } = await import("@/components/settings/UnavailableByDesign");

// Settings' one draft: a few of its own keys plus Advanced Settings' (components/settings/SettingsModal SETTINGS_KEYS)
const KEYS = ["walkSpeed", "theme", ...ADV];
const update = (c, change) => normaliseConfig({ ...c, ...(typeof change === "function" ? change(c) : change) });
const dirty = (c, b) => sliceChanged(c, KEYS, b, false);
const label = (c, id) => c.entityMap[id]?.label;

const opened = normaliseConfig({ ...DEFAULT_CONFIG,
  entityMap: {
    "light.hall": { entityId: "light.hall", type: "light", label: "Hall" },
    "binary_sensor.door": { entityId: "binary_sensor.door", type: "binary_sensor", label: "Door" },
  },
  meshBindings: { lamp_mesh: "light.hall" }, latitude: -8.4, longitude: 115.2 });
// what the server holds = what this tablet last synced with
const synced = D.baselineFromServer(D.pickSharedConfig(opened));

// The pull: another tablet's copy arrives — the merge DeviceConfigSync applies, and the change it hands the drafts.
const pull = (config, baseline, server) => {
  const change = D.remoteChange(synced, server);
  return { config: update(config, D.applyRemoteChange(config, change)), baseline: rebaseOnRemote(baseline, KEYS, config, change) };
};

console.log("  another tablet's change while the dialog is open:");
{
  const baseline = sliceOf(opened, KEYS);
  const theirs = { ...synced,
    entityMap: { ...synced.entityMap, "binary_sensor.door": { ...synced.entityMap["binary_sensor.door"], label: "Front door" },
      "switch.pump": { entityId: "switch.pump", type: "switch", label: "Pump" } },
    unavailableByDesign: withDevice(synced.unavailableByDesign, "binary_sensor.door", true),
    latitude: -8.5 };
  const a = pull(opened, baseline, theirs);
  ck("the old baseline (the copy taken on open) read it as this dialog's change: Save lit by itself", dirty(a.config, baseline));
  ck("it arrives: Save stays dark", !dirty(a.config, a.baseline));
  const mine = update(a.config, E.patchMapping("light.hall", { label: "Hall lamp" }));
  ck("then this dialog relabels another device: Save lights", dirty(mine, a.baseline));
  const cancelled = update(mine, a.baseline);   // Cancel: the baseline written back through the same update
  ck("Cancel: this dialog's relabel is gone", label(cancelled, "light.hall") === "Hall", label(cancelled, "light.hall"));
  ck("  ...the other tablet's relabel, new device, asleep device and location are kept",
     label(cancelled, "binary_sensor.door") === "Front door" && label(cancelled, "switch.pump") === "Pump"
     && cancelled.unavailableByDesign.includes("binary_sensor.door") && cancelled.latitude === -8.5,
     { door: label(cancelled, "binary_sensor.door"), pump: label(cancelled, "switch.pump"), asleep: cancelled.unavailableByDesign, lat: cancelled.latitude });
  ck("  ...so the sync has nothing of theirs to undo: what this tablet then holds differs from the server's only by nothing",
     D.isSharedConfigDiffEmpty(D.diffSharedConfig(D.baselineFromServer(theirs), D.pickSharedConfig(cancelled))));
  ck("Save instead keeps both", label(mine, "light.hall") === "Hall lamp" && label(mine, "binary_sensor.door") === "Front door");
}

console.log("\n  this dialog's change first, then another tablet's on a DIFFERENT device:");
{
  const baseline = sliceOf(opened, KEYS);
  const mine = update(opened, E.patchMapping("light.hall", { label: "Hall lamp" }));
  const ownSynced = D.pickSharedConfig(mine);    // pushed: the server has it
  const theirs = { ...ownSynced, entityMap: { ...ownSynced.entityMap, "binary_sensor.door": { ...ownSynced.entityMap["binary_sensor.door"], label: "Front door" } } };
  const change = D.remoteChange(ownSynced, theirs);
  const config = update(mine, D.applyRemoteChange(mine, change));
  const b = rebaseOnRemote(baseline, KEYS, mine, change);
  ck("Save stays lit for this dialog's change only", dirty(config, b) && JSON.stringify(Object.keys(D.diffSharedConfig(D.pickSharedConfig(normaliseConfig({ ...config, ...b })), D.pickSharedConfig(config)).entityMap.set)) === '["light.hall"]');
  const cancelled = update(config, b);
  ck("Cancel: own relabel gone, theirs kept", label(cancelled, "light.hall") === "Hall" && label(cancelled, "binary_sensor.door") === "Front door");
}

console.log("\n  both change the SAME device (the push replays this tablet's change onto theirs):");
{
  const baseline = sliceOf(opened, KEYS);
  const mine = update(opened, E.patchMapping("light.hall", { label: "Mine" }));
  const fresh = { ...synced, entityMap: { ...synced.entityMap, "light.hall": { ...synced.entityMap["light.hall"], label: "Theirs" } } };
  const outcome = await pushWithRebase({
    diff: D.diffSharedConfig(synced, D.pickSharedConfig(mine)), isEmpty: D.isSharedConfigDiffEmpty, baseline: synced,
    fetchFresh: async () => ({ doc: fresh, rev: "2", raw: {} }), rebase: (b, f) => ({ ...b, ...f }),
    apply: D.applySharedConfigDiff, save: async () => ({ ok: true, rev: "3" }),
  });
  ck("the push hands back the copy it replayed onto (theirs, without this tablet's change)",
     outcome.ok && outcome.base.entityMap["light.hall"].label === "Theirs" && outcome.next.entityMap["light.hall"].label === "Mine");
  const change = D.remoteChange(synced, outcome.base);
  const config = update(mine, D.applyRemoteChange(mine, change));
  const b = rebaseOnRemote(baseline, KEYS, mine, change);
  ck("this dialog's value stays on screen and Save stays lit (Save keeps it)", label(config, "light.hall") === "Mine" && dirty(config, b));
  ck("Cancel puts THEIR value back, not the copy from before it", label(update(config, b), "light.hall") === "Theirs", label(update(config, b), "light.hall"));
  const fromNext = D.remoteChange(synced, outcome.next);
  ck("  ...(measured against what the push wrote, the change would hide theirs behind this tablet's: Cancel would write this tablet's own value)",
     label(update(config, rebaseOnRemote(baseline, KEYS, mine, fromNext)), "light.hall") === "Mine");
}

console.log("\n  the comparison:");
{
  const baseline = sliceOf(opened, KEYS);
  const reordered = { ...opened, entityMap: Object.fromEntries(Object.entries(opened.entityMap).reverse()) };
  ck("the same devices listed in another order (a merge rebuilds the map) is not a change", !dirty(reordered, baseline));
  ck("a setting of this dialog's own still is", dirty({ ...opened, walkSpeed: opened.walkSpeed + 1 }, baseline));
  ck("a change with nothing in it leaves the baseline as it is",
     rebaseOnRemote(baseline, KEYS, opened, D.remoteChange(synced, {})) === baseline);
}

console.log("\n  the wiring:");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = (p) => strip(readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8"));
  const sync = src("config/DeviceConfigSync.tsx"), ctx = src("config/ConfigContext.tsx"), hook = src("hooks/useDraftedSlice.ts");
  ck("both merges of the shared store (push and pull) hand on what the others changed, never a copy of the store",
     /mergeRemote\(remoteChange\(baseline \?\? outcome\.base, outcome\.base\)\)/.test(sync)
     && /mergeRemote\(remoteChange\(synced, r\.fetched\.config\)\)/.test(sync)
     && (sync.match(/mergeRemote\(/g) ?? []).length === 2 && !/\bupdate\(/.test(sync));
  ck("the drafts hear it before the write, and the write applies it to the config as it is then",
     /for \(const listener of remoteListeners\.current\) listener\(change\);\s*update\(\(prev\) => applyRemoteChange\(prev, change\)\);/.test(ctx));
  ck("the draft says which of its own changes the same change replaced, measured before its baseline moves",
     /const found = replacedByRemote\(b, k, now, change\);\s*if \(found\.length > 0\) setReplaced\(\(said\) => withReplaced\(said, found\)\);\s*setBaseline/.test(hook)
     && /replaced,\s*dismissReplaced: \(\) => setReplaced\(\[\]\)/.test(hook));
  const settings = src("components/settings/SettingsModal.tsx"), advanced = src("components/settings/ConfigEditorModal.tsx");
  ck("Settings and Advanced Settings show it, each from its own draft, just above the footer",
     /<RemoteReplacedNote replaced=\{slice\.replaced\} onDismiss=\{slice\.dismissReplaced\} \/>\s*<ModalFooter/.test(settings)
     && /<RemoteReplacedNote replaced=\{own\.replaced\} onDismiss=\{own\.dismissReplaced\} \/>\s*<ModalFooter/.test(advanced));
  ck("the draft moves its baseline by it",
     /setBaseline\(\(prev\) => rebaseOnRemote\(prev, k, now, change\)\);/.test(hook));
}

done("✅ Cancel undoes only this dialog's changes; another tablet's survive it");
