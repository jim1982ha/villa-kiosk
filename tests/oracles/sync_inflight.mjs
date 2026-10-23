// A change made while this tablet's own push (or pull) is out survives it, and is what the next push sends
// (2.496.498). The push used to write the server's whole copy over the config when it landed, key by key: a device
// edited during the round trip went back, and since the new baseline was that same copy, the next diff was empty, so
// the edit was lost without a word. Now the shared store hands on only what the OTHER tablets changed, item by item,
// and it is applied to the config as it is when the write lands (config/deviceConfig applyRemoteChange,
// config/ConfigContext mergeRemote, config/DeviceConfigSync).
//
// And the dialog says it when another tablet replaced one of ITS OWN changes already sent (configSlice
// ledgerOnRemote, the dialog's ledger of its own edits since 2.496.499): "Hall was changed on another tablet; your
// change was replaced."
//
// Driven by value: the real sync machine (utils/syncedDocument, with the shared store's own diff, apply and rebase)
// against a fake store, the real config normalisation, the real edits, the real draft rules.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { SyncedDocument } = await import("@/utils/syncedDocument");
const D = await import("@/config/deviceConfig");
const { DEFAULT_CONFIG, normaliseConfig } = await import("@/config/AppConfig");
const E = await import("@/config/mappingEdits");
const { labelOf } = await import("@/config/EntityMap");
const { ADVANCED_SETTINGS_KEYS: ADV, EMPTY_LEDGER, recordEdit, ledgerOnRemote, ledgerDirty, replacedLine, withReplaced } =
  await import("@/config/configSlice");

const update = (c, change) => normaliseConfig({ ...c, ...(typeof change === "function" ? change(c) : change) }, { maps: true });
const label = (c, id) => c.entityMap[id]?.label;
const relabel = (id, l) => E.patchMapping(id, { label: l });

const opened = normaliseConfig({ ...DEFAULT_CONFIG, entityMap: {
  "light.hall": { entityId: "light.hall", type: "light", label: "Hall" },
  "light.pool": { entityId: "light.pool", type: "light", label: "Pool" },
  "binary_sensor.door": { entityId: "binary_sensor.door", type: "binary_sensor", label: "Door" },
} }, { maps: true });

/** The add-on's store: one document and its revision; `during` runs while a fetch is out. */
function server(config) {
  const s = { config: { ...config }, rev: 1, during: null };
  s.fetch = async () => {
    const snap = { doc: D.baselineFromServer(s.config), rev: String(s.rev), raw: {}, config: { ...s.config } };
    if (s.during) { const f = s.during; s.during = null; await f(); }
    return snap;
  };
  s.save = async (next, rev) => {
    if (rev !== String(s.rev)) return { ok: false, conflict: true };
    s.config = { ...next }; s.rev++;
    return { ok: true, rev: String(s.rev) };
  };
  return s;
}

/** One tablet: its config, its sync document, and DeviceConfigSync's two merges (each ends in mergeRemote's write:
 *  the change applied to the config as it is THEN). */
function tablet(srv, config) {
  const t = { config };
  t.doc = new SyncedDocument({
    fetch: srv.fetch, save: srv.save,
    diff: D.diffSharedConfig, isEmpty: D.isSharedConfigDiffEmpty, apply: D.applySharedConfigDiff,
    rebase: (b, f) => ({ ...b, ...f }), serverEmpty: (f) => Object.keys(f.config).length === 0,
    empty: D.baselineFromServer({}),
  }, D.baselineFromServer(D.pickSharedConfig(config)));
  t.local = () => D.pickSharedConfig(t.config);
  t.merge = (change) => { t.heard = change; t.config = update(t.config, (c) => D.applyRemoteChange(c, change)); };
  t.push = async () => {
    const outcome = await t.doc.push(t.local());
    if (outcome.ok) t.merge(D.pushedChange(outcome));   // DeviceConfigSync pushOwnDiff
    return outcome;
  };
  t.pull = async () => {
    const synced = t.doc.baseline;
    const r = await t.doc.pull(t.local, (f) => JSON.stringify({ ...t.local(), ...D.mergeSharedConfig(t.config, f.config) }) !== JSON.stringify(t.local()));
    if (r.action === "apply") t.merge(D.remoteChange(synced, r.fetched.config));
    return r;
  };
  /** What the next push would send, by device. */
  t.pending = () => Object.keys(D.diffSharedConfig(t.doc.baseline, t.local()).entityMap.set);
  return t;
}

console.log("  an edit made while this tablet's push is out:");
{
  const srv = server(D.pickSharedConfig(opened));
  const me = tablet(srv, opened);
  me.config = update(me.config, relabel("light.hall", "Hall lamp"));
  srv.during = async () => { me.config = update(me.config, relabel("light.pool", "Pool lamp")); };
  const out = await me.push();
  ck("the push lands with the first edit", out.ok && srv.config.entityMap["light.hall"].label === "Hall lamp", out);
  ck("the edit made during it is still on screen", label(me.config, "light.pool") === "Pool lamp", label(me.config, "light.pool"));
  ck("  ...and is what the next push sends", JSON.stringify(me.pending()) === '["light.pool"]', me.pending());
  await me.push();
  ck("  ...which it does: the store holds both", srv.config.entityMap["light.pool"].label === "Pool lamp"
     && srv.config.entityMap["light.hall"].label === "Hall lamp", srv.config.entityMap);
  ck("the first edit stayed on screen too", label(me.config, "light.hall") === "Hall lamp");
}

console.log("\n  the same, with another tablet's change landing on the store before this push:");
{
  const srv = server(D.pickSharedConfig(opened));
  const me = tablet(srv, opened);
  srv.config = { ...srv.config, entityMap: { ...srv.config.entityMap,
    "binary_sensor.door": { ...srv.config.entityMap["binary_sensor.door"], label: "Front door" } } };
  srv.rev++;
  me.config = update(me.config, relabel("light.hall", "Hall lamp"));
  srv.during = async () => { me.config = update(me.config, relabel("light.pool", "Pool lamp")); };
  await me.push();
  ck("the other tablet's change arrives", label(me.config, "binary_sensor.door") === "Front door");
  ck("the edit made during the push survives it and is still to send",
     label(me.config, "light.pool") === "Pool lamp" && JSON.stringify(me.pending()) === '["light.pool"]',
     { pool: label(me.config, "light.pool"), pending: me.pending() });
}

console.log("\n  an edit landing between a pull's decision and its write:");
{
  const srv = server(D.pickSharedConfig(opened));
  const me = tablet(srv, opened);
  srv.config = { ...srv.config, entityMap: { ...srv.config.entityMap,
    "binary_sensor.door": { ...srv.config.entityMap["binary_sensor.door"], label: "Front door" } } };
  srv.rev++;
  // the pull decided on the config it read; an edit queued a moment later is what the write lands on
  const realMerge = me.merge;
  me.merge = (change) => { me.config = update(me.config, relabel("light.pool", "Pool lamp")); realMerge(change); };
  const r = await me.pull();
  ck("the pull applies the other tablet's change", r.action === "apply" && label(me.config, "binary_sensor.door") === "Front door", r.action);
  ck("the edit is still on screen", label(me.config, "light.pool") === "Pool lamp", label(me.config, "light.pool"));
  ck("  ...and is what the next push sends", JSON.stringify(me.pending()) === '["light.pool"]', me.pending());
}

console.log("\n  the change applied, item by item:");
{
  const synced = D.baselineFromServer(D.pickSharedConfig(opened));
  const mine = update(opened, relabel("light.hall", "Mine"));
  const theirs = { ...synced, entityMap: { ...synced.entityMap,
    "light.hall": { ...synced.entityMap["light.hall"], label: "Theirs" },
    "light.pool": { ...synced.entityMap["light.pool"], label: "Pool 2" } } };
  const patch = D.applyRemoteChange(mine, D.remoteChange(synced, theirs));
  const after = update(mine, patch);
  ck("an item only they changed takes theirs", label(after, "light.pool") === "Pool 2");
  ck("an item this tablet changed and has not synced keeps this tablet's (its push replays it last)", label(after, "light.hall") === "Mine");
  ck("nothing changed: nothing written", Object.keys(D.applyRemoteChange(mine, D.remoteChange(synced, synced))).length === 0);
  const fitted = { name: "Fitted", fitted: true, position: { x: 0, y: 0, z: 0 } };
  const withFitted = { ...mine, teleportPoints: [fitted] };
  const room = { ...synced, teleportPoints: [{ name: "Added", position: { x: 1, y: 0, z: 1 } }] };
  const rooms = D.applyRemoteChange(withFitted, D.remoteChange(synced, room)).teleportPoints ?? [];
  ck("a room another tablet added arrives, this tablet's fitted rooms stay", rooms.some((p) => p.name === "Added") && rooms.some((p) => p.name === "Fitted"),
     rooms.map((p) => p.name));
}

console.log("\n  the dialog says when another tablet replaced one of ITS OWN changes:");
{
  const KEYS = ["walkSpeed", ...ADV];
  const srv = server(D.pickSharedConfig(opened));
  const me = tablet(srv, opened);
  // Settings opens; its ledger records the dialog's own edit (ConfigContext editByDialog)
  const opening = me.config;
  me.config = update(me.config, relabel("light.hall", "Hall lamp"));
  const dialog = recordEdit(EMPTY_LEDGER, KEYS, opening, me.config);
  await me.push();                                // the dialog's change is sent
  const labels = (c) => (id) => labelOf(id, c.entityMap, {});

  const other = tablet(srv, update(opened, () => ({ entityMap: srv.config.entityMap })));
  other.config = update(other.config, relabel("light.hall", "Lobby"));
  await other.push();
  const before = me.config;
  await me.pull();
  const said = ledgerOnRemote(dialog, before, me.heard).replaced;
  ck("the other tablet's value is on screen", label(me.config, "light.hall") === "Lobby");
  ck("the same device: one line, naming it as the screen does",
     said.length === 1 && replacedLine(said[0], labels(me.config)) === "Lobby was changed on another tablet; your change was replaced.",
     said.map((s) => replacedLine(s, labels(me.config))));
  ck("  ...said once however often it is heard", withReplaced(said, said).length === 1);

  // another tablet changes a DIFFERENT device
  const srv2 = server(D.pickSharedConfig(opened));
  const me2 = tablet(srv2, opened);
  const opening2 = me2.config;
  me2.config = update(me2.config, relabel("light.hall", "Hall lamp"));
  const dialog2 = recordEdit(EMPTY_LEDGER, KEYS, opening2, me2.config);
  await me2.push();
  srv2.config = { ...srv2.config, entityMap: { ...srv2.config.entityMap,
    "light.pool": { ...srv2.config.entityMap["light.pool"], label: "Pool 2" } } };
  srv2.rev++;
  const before2 = me2.config;
  await me2.pull();
  ck("a change to another device says nothing", ledgerOnRemote(dialog2, before2, me2.heard).replaced.length === 0,
     ledgerOnRemote(dialog2, before2, me2.heard).replaced);

  // this dialog's change not sent yet, the other tablet's on the same device: this tablet's stays, nothing to say
  const synced = D.baselineFromServer(D.pickSharedConfig(opened));
  const unsent = update(opened, relabel("light.hall", "Hall lamp"));
  const dialog3 = recordEdit(EMPTY_LEDGER, KEYS, opened, unsent);
  const theirs = { ...synced, entityMap: { ...synced.entityMap, "light.hall": { ...synced.entityMap["light.hall"], label: "Lobby" },
    "light.pool": { ...synced.entityMap["light.pool"], label: "Pool 2" } } };
  ck("a change not sent yet is not replaced (its push replays it last): nothing to say",
     ledgerOnRemote(dialog3, unsent, D.remoteChange(synced, theirs)).replaced.length === 0,
     ledgerOnRemote(dialog3, unsent, D.remoteChange(synced, theirs)).replaced);

  // a device only the other tablet touched while this dialog changed nothing: nothing to say
  ck("nothing of this dialog's changed: nothing to say",
     ledgerOnRemote(EMPTY_LEDGER, opened, D.remoteChange(synced, theirs)).replaced.length === 0);

  // the ledger moves by the same change: Save goes grey with the line explaining why
  const moved = ledgerOnRemote(dialog, before, me.heard).ledger;
  ck("the ledger takes the other tablet's value as what Cancel goes back to (Save grey, the line says why)",
     moved.entityMap["light.hall"].before.label === "Lobby" && !ledgerDirty(moved, me.config), moved.entityMap);
}

done("✅ an edit made while a push or pull is out survives and is sent; a replaced change of the dialog's is said");
