// Cancel takes back what the dialog ITSELF changed, and nothing else (2.496.499). The draft was a copy of the slice
// taken when Settings (or Advanced Settings) opened, so every write while it was open read as the dialog's: a 3D model
// uploaded from Advanced Settings reloads the view, the devices it finds are written to the device list (the 3D view's
// mappingEdits.adoptDetected), Save lit by itself, and Cancel deleted those devices on every tablet. Now the draft is a
// ledger of the dialog's own writes, item by item (configSlice recordEdit, heard through ConfigContext editByDialog
// inside DialogEdits); Cancel puts back exactly those items (revertLedger).
//
// And two pushes of this tablet's never overlap (utils/syncedDocument): the second waits for the first and reports
// what the others changed against the baseline it actually sent from. Overlapping, it re-sent the first edit and heard
// it back as another tablet's: the dialog's ledger moved to it, and Cancel after two quick edits undid only the second.
//
// Driven by value: the real config normalisation, the real edits, the real sync machine against a fake store, the
// shared store's own diff, merge and remote change. Then the wiring.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { DEFAULT_CONFIG, normaliseConfig } = await import("@/config/AppConfig");
const D = await import("@/config/deviceConfig");
const E = await import("@/config/mappingEdits");
const { SyncedDocument } = await import("@/utils/syncedDocument");
const { ADVANCED_SETTINGS_KEYS: ADV, EMPTY_LEDGER, applyConfigChange, recordEdit, ledgerDirty, revertLedger, ledgerOnRemote } =
  await import("@/config/configSlice");

const KEYS = ["walkSpeed", "render", ...ADV];        // Settings' one draft (SettingsModal SETTINGS_KEYS)
const label = (c, id) => c.entityMap[id]?.label;

/** This tablet's config store (ConfigContext): `update` for any write, `editByDialog` for a dialog's own, which the
 *  open draft records (useDraftedSlice), and a remote change heard by the draft before it is applied (mergeRemote). */
function tablet(config) {
  const t = { config, ledger: EMPTY_LEDGER };
  t.update = (change) => { t.config = applyConfigChange(t.config, change) ?? t.config; };
  t.editByDialog = (change) => {
    const next = applyConfigChange(t.config, change);
    if (!next) return;
    t.ledger = recordEdit(t.ledger, KEYS, t.config, next);
    t.config = next;
  };
  t.mergeRemote = (change) => {
    t.ledger = ledgerOnRemote(t.ledger, t.config, change).ledger;
    t.update((c) => D.applyRemoteChange(c, change));
  };
  t.dirty = () => ledgerDirty(t.ledger, t.config);
  t.cancel = () => { const undo = t.ledger; t.ledger = EMPTY_LEDGER; t.update((c) => revertLedger(undo, c)); };
  return t;
}

const opened = normaliseConfig({ ...DEFAULT_CONFIG, entityMap: {
  "light.hall": { entityId: "light.hall", type: "light", label: "Hall" },
  "light.pool": { entityId: "light.pool", type: "light", label: "Pool" },
} }, { maps: true });

console.log("  a write from elsewhere on this tablet while the dialog is open (the reloaded model's devices):");
{
  const me = tablet(opened);
  me.update(E.adoptDetected([{ entityId: "switch.pump", type: "light", label: "Pump" }], () => true));
  const synced = D.baselineFromServer(D.pickSharedConfig(me.config));     // pushed: every tablet has it
  ck("the device found is in the list", label(me.config, "switch.pump") === "Pump");
  ck("Save stays grey: it is not the dialog's change", !me.dirty(), me.ledger);
  me.editByDialog(E.patchMapping("light.hall", { label: "Hall lamp" }));
  me.editByDialog({ walkSpeed: opened.walkSpeed + 1 });
  ck("the dialog's own relabel and walk speed light it", me.dirty());
  me.cancel();
  ck("Cancel: the dialog's changes are gone", label(me.config, "light.hall") === "Hall" && me.config.walkSpeed === opened.walkSpeed,
     { hall: label(me.config, "light.hall"), walk: me.config.walkSpeed });
  ck("  ...the device found is kept (it was deleted)", label(me.config, "switch.pump") === "Pump", Object.keys(me.config.entityMap));
  const next = D.diffSharedConfig(synced, D.pickSharedConfig(me.config));
  ck("  ...so the next push deletes nothing on the other tablets", next.entityMap.del.length === 0, next.entityMap);
}

console.log("\n  a device the dialog itself added, then cancelled:");
{
  const me = tablet(opened);
  me.editByDialog(E.addMapping("sensor.new"));
  ck("it lights Save", me.dirty());
  me.cancel();
  ck("Cancel removes it, and only it", !("sensor.new" in me.config.entityMap) && label(me.config, "light.pool") === "Pool");
}

/** The add-on's store, logging each fetch and save; `hold` keeps the first save out until released. */
function store(config) {
  const s = { doc: D.baselineFromServer(config), rev: 1, log: [] };
  const tick = () => new Promise((r) => setTimeout(r, 5));
  s.fetch = async () => { s.log.push("fetch"); await tick(); return { doc: structuredClone(s.doc), rev: String(s.rev), raw: {}, config: structuredClone(s.doc) }; };
  s.save = async (next, rev) => {
    s.log.push("save"); await tick();
    if (rev !== String(s.rev)) return { ok: false, conflict: true };
    s.doc = next; s.rev++; s.log.push("saved");
    return { ok: true, rev: String(s.rev) };
  };
  return s;
}

console.log("\n  two quick edits, the second push sent while the first is out:");
{
  const srv = store(D.pickSharedConfig(opened));
  const me = tablet(opened);
  const doc = new SyncedDocument({
    fetch: srv.fetch, save: srv.save, diff: D.diffSharedConfig, isEmpty: D.isSharedConfigDiffEmpty,
    apply: D.applySharedConfigDiff, rebase: (b, f) => ({ ...b, ...f }), empty: D.baselineFromServer({}),
  }, srv.doc);
  // DeviceConfigSync pushOwnDiff: what the others changed, against the baseline the push sent from
  const heard = [];
  const pushOwnDiff = async () => {
    const outcome = await doc.push(D.pickSharedConfig(me.config));
    if (!outcome.ok) return outcome.reason;
    const change = D.remoteChange(outcome.synced, outcome.base);
    heard.push(D.describeSharedConfigDiff(change.diff));
    me.mergeRemote(change);
    return outcome;
  };
  me.editByDialog(E.patchMapping("light.hall", { label: "Hall lamp" }));
  const a = pushOwnDiff();
  me.editByDialog(E.patchMapping("light.pool", { label: "Pool lights" }));
  const b = pushOwnDiff();
  const [ra, rb] = await Promise.all([a, b]);
  ck("the second push waits: it reads the store only once the first is saved",
     srv.log.join() === "fetch,save,saved,fetch,save,saved", srv.log);
  ck("  ...and sends from what the first committed", ra.ok && rb.ok && rb.synced === ra.next, { a: ra.ok, b: rb.ok });
  ck("neither hears this tablet's own edit as another tablet's", heard.every((h) => Object.keys(h).length === 0), heard);
  ck("the store holds both", srv.doc.entityMap["light.hall"].label === "Hall lamp" && srv.doc.entityMap["light.pool"].label === "Pool lights");
  ck("Save is lit", me.dirty());
  me.cancel();
  ck("Cancel undoes BOTH edits (it undid only the second)", label(me.config, "light.hall") === "Hall" && label(me.config, "light.pool") === "Pool",
     { hall: label(me.config, "light.hall"), pool: label(me.config, "light.pool") });
}

console.log("\n  a waiting push sends its own change, never the first one's undone:");
{
  const srv = store({ ...D.pickSharedConfig(opened) });
  const doc = new SyncedDocument({
    fetch: srv.fetch, save: srv.save, diff: D.diffSharedConfig, isEmpty: D.isSharedConfigDiffEmpty,
    apply: D.applySharedConfigDiff, rebase: (b, f) => ({ ...b, ...f }), empty: D.baselineFromServer({}),
  }, srv.doc);
  const base = D.pickSharedConfig(opened);
  const first = { ...base, entityMap: { ...base.entityMap, "light.hall": { ...base.entityMap["light.hall"], label: "Hall lamp" } } };
  // the second was read before the first edit reached it (the Facility screen: two actions before a render)
  const second = { ...base, entityMap: { ...base.entityMap, "light.pool": { ...base.entityMap["light.pool"], label: "Pool lights" } } };
  await Promise.all([doc.push(first), doc.push(second)]);
  ck("both reach the store", srv.doc.entityMap["light.hall"].label === "Hall lamp" && srv.doc.entityMap["light.pool"].label === "Pool lights",
     srv.doc.entityMap);
}

console.log("\n  the wiring:");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = (p) => strip(readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8"));
  const ctx = src("config/ConfigContext.tsx"), hook = src("hooks/useDraftedSlice.ts"), canvas = src("components/canvas/BabylonCanvas.tsx");
  ck("the config store tells the drafts a dialog's write with the config it lands on, inside the write",
     /const next = applyConfigChange\(prev, change\);\s*if \(!next\) return prev;\s*for \(const listener of dialogListeners\.current\) listener\(prev, next\);/.test(ctx)
     && /update: ctx\.editByDialog/.test(ctx));
  ck("the draft writes as the dialog, and Cancel puts back its ledger on the config as it is then",
     /useDraftCommit<Partial<AppConfig>>\(\(_key, patch\) => editByDialog\(patch\)/.test(hook) && /editByDialog\(stored\);/.test(hook)
     && /update\(\(now\) => revertLedger\(undo, now\)\);/.test(hook) && !/update\(baseline\)/.test(hook));
  ck("the 3D view's devices found on load are written as any write, never as the dialog's",
     /update\(adoptDetected\(/.test(canvas) && !/editByDialog|DialogEdits/.test(canvas));
  const dirs = ["components", "pages", "hooks", "config"];
  const { tsFiles } = await import("../consistency/check.mjs");
  const users = dirs.flatMap((d) => tsFiles(new URL(`../../src/${d}`, import.meta.url).pathname))
    .filter((f) => /<DialogEdits>/.test(readFileSync(f, "utf8"))).map((f) => f.replace(/^.*\/src\//, ""));
  ck("only Advanced Settings' controls sit in it", users.join() === "components/settings/ConfigEditorModal.tsx", users);
}

done("✅ Cancel takes back only what the dialog set; this tablet's pushes go one at a time");
