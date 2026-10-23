// A change put back while the push carrying it is still out reaches the store, and a request that never answers no
// longer holds every later save (2.496.500, utils/syncedDocument).
//
//   1. A push sends what this tablet changed against what it has PROMISED the store (the confirmed baseline with the
//      pushes out laid on it), and the config store's push gate compares with that. Against the confirmed baseline, a
//      relabel undone by Cancel while its push was out was no change at all: the undo was never sent, and every other
//      tablet kept the cancelled label. The Facility store the same: a record saved then removed while the save was out
//      stayed in the store (and came back on the screen).
//   2. One deadline for a push, in the shared piece: past it the push ends as a transport failure (its work stays
//      unsaved, so a refresh re-sends it), the request is aborted, and a late answer changes nothing.
//
// Driven by value: the real sync machine, the real stores' diff / apply / rebase, against fake stores.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { DEFAULT_CONFIG, normaliseConfig } = await import("@/config/AppConfig");
const D = await import("@/config/deviceConfig");
const E = await import("@/config/mappingEdits");
const F = await import("@/fm/fmApi");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { SyncedDocument, PUSH_DEADLINE_MS } = await import("@/utils/syncedDocument");
const { ADVANCED_SETTINGS_KEYS: KEYS, EMPTY_LEDGER, recordEdit, revertLedger, applyConfigChange } = await import("@/config/configSlice");

const tick = () => new Promise((r) => setTimeout(r, 5));

/** A store; `hold()` keeps the next save out until the returned function is called (a slow round trip). */
function store(doc, fetched = (d, rev) => ({ doc: structuredClone(d), rev, raw: {} })) {
  const s = { doc, rev: 1, gate: null, signals: [] };
  s.fetch = async () => { await tick(); return fetched(s.doc, String(s.rev)); };
  s.save = async (next, rev, _carry, signal) => {
    s.signals.push(signal);
    const gate = s.gate; s.gate = null;
    if (gate) await gate;
    await tick();
    if (rev !== String(s.rev)) return { ok: false, conflict: true };
    s.doc = structuredClone(next); s.rev++;
    return { ok: true, rev: String(s.rev) };
  };
  s.hold = () => { let release; s.gate = new Promise((r) => { release = r; }); return () => release(); };
  return s;
}

// ── the device-config store ─────────────────────────────────────────────────
const opened = normaliseConfig({ ...DEFAULT_CONFIG, entityMap: {
  "light.hall": { entityId: "light.hall", type: "light", label: "Hall" },
  "light.pool": { entityId: "light.pool", type: "light", label: "Pool" },
} }, { maps: true });

function configTablet() {
  const srv = store(D.baselineFromServer(D.pickSharedConfig(opened)),
    (d, rev) => ({ doc: structuredClone(d), rev, raw: {}, config: structuredClone(d) }));
  const doc = new SyncedDocument({
    fetch: (sig) => srv.fetch(sig), save: (...a) => srv.save(...a), diff: D.diffSharedConfig, isEmpty: D.isSharedConfigDiffEmpty,
    apply: D.applySharedConfigDiff, rebase: (b, f) => ({ ...b, ...f }), empty: D.baselineFromServer({}),
  }, srv.doc);
  const t = { srv, doc, config: opened, ledger: EMPTY_LEDGER };
  t.local = () => D.pickSharedConfig(t.config);
  // DeviceConfigSync's push gate (rule 2): a push is scheduled when the local slice differs from what is promised
  t.gateOpen = () => doc.promised !== null && JSON.stringify(t.local()) !== JSON.stringify(doc.promised);
  t.push = async () => {                                        // DeviceConfigSync pushOwnDiff
    const o = await doc.push(t.local());
    if (o.ok) t.config = applyConfigChange(t.config, (c) => D.applyRemoteChange(c, D.pushedChange(o))) ?? t.config;
    return o;
  };
  t.edit = (change) => { const next = applyConfigChange(t.config, change); t.ledger = recordEdit(t.ledger, KEYS, t.config, next); t.config = next; };
  t.cancel = () => { const undo = t.ledger; t.ledger = EMPTY_LEDGER; t.config = applyConfigChange(t.config, (c) => revertLedger(undo, c)) ?? t.config; };
  return t;
}
const label = (m, id) => m.entityMap[id]?.label;

console.log("  device settings: relabelled, then Cancel while the relabel's push is out:");
{
  const t = configTablet();
  t.edit(E.patchMapping("light.hall", { label: "Hall lamp" }));
  const release = t.srv.hold();
  const p1 = t.push();
  await tick();
  t.cancel();
  ck("this tablet shows the label back", label(t.config, "light.hall") === "Hall");
  ck("the push gate opens: the label put back differs from what is promised", t.gateOpen(),
     { local: label(t.local(), "light.hall"), promised: label(t.doc.promised, "light.hall") });
  const p2 = t.push();
  release();
  const [o1, o2] = await Promise.all([p1, p2]);
  ck("the relabel's push lands, then the Cancel's is sent (not 'nothing to push')", o1.ok && o2.ok, { o1: o1.reason, o2: o2.reason });
  ck("the store (every other tablet) holds the label back", label(t.srv.doc, "light.hall") === "Hall", label(t.srv.doc, "light.hall"));
  ck("  ...and this tablet still shows it", label(t.config, "light.hall") === "Hall");
  ck("nothing left to push once both landed", !t.gateOpen() && !t.doc.isAhead(t.local()));
}

console.log("\n  two quick edits from this tablet, the second push called while the first is out:");
{
  const t = configTablet();
  t.edit(E.patchMapping("light.hall", { label: "Hall lamp" }));
  const release = t.srv.hold();
  const p1 = t.push();
  t.edit(E.patchMapping("light.pool", { label: "Pool lights" }));
  const p2 = t.push();
  release();
  await Promise.all([p1, p2]);
  ck("both reach the store, the first never sent back undone",
     label(t.srv.doc, "light.hall") === "Hall lamp" && label(t.srv.doc, "light.pool") === "Pool lights", t.srv.doc.entityMap);
}

console.log("\n  the push ahead FAILED: the one waiting sends its work too:");
{
  const t = configTablet();
  const save = t.srv.save;
  let first = true;
  t.srv.save = async (...a) => { if (first) { first = false; await tick(); return { ok: false, conflict: false }; } return save(...a); };
  t.edit(E.patchMapping("light.hall", { label: "Hall lamp" }));
  const p1 = t.push();
  t.edit(E.patchMapping("light.pool", { label: "Pool lights" }));
  const p2 = t.push();
  const [o1, o2] = await Promise.all([p1, p2]);
  ck("the first ends as a transport failure, the second saves", !o1.ok && o1.reason === "transport" && o2.ok, { o1, o2: o2.ok });
  ck("the store holds BOTH edits", label(t.srv.doc, "light.hall") === "Hall lamp" && label(t.srv.doc, "light.pool") === "Pool lights",
     t.srv.doc.entityMap);
}

// ── the Facility store ──────────────────────────────────────────────────────
const withCost = (d, id) => ({ ...d, costs: [...d.costs, { id, at: "2026-10-23T00:00:00Z", amountIdr: 1, category: "minor", label: id, photoIds: [] }] });
const withoutCost = (d, id) => ({ ...d, costs: d.costs.filter((c) => c.id !== id) });
const fmDoc = (srv, extra = {}) => new SyncedDocument({ fetch: (sig) => srv.fetch(sig), save: (...a) => srv.save(...a), diff: F.diffFmData, isEmpty: F.fmDiffIsEmpty,
  apply: F.applyFmDiff, rebase: (_b, f) => f, empty: EMPTY_FM_DATA, ...extra }, EMPTY_FM_DATA);
const costIds = (d) => d.costs.map((c) => c.id).sort().join();

console.log("\n  Facility: a cost saved, then removed while the save is out:");
{
  const srv = store(EMPTY_FM_DATA), doc = fmDoc(srv);
  let local = EMPTY_FM_DATA;
  local = withCost(local, "c1");
  const release = srv.hold();
  const p1 = doc.push(local);
  local = withoutCost(local, "c1");           // FmDataContext mutate: the true copy, moved at once
  const p2 = doc.push(local);
  release();
  const [o1, o2] = await Promise.all([p1, p2]);
  ck("the save lands, then the removal is sent", o1.ok && o2.ok, { o1: o1.reason, o2: o2.reason });
  ck("the store no longer holds the cost", costIds(srv.doc) === "", costIds(srv.doc));
}

console.log("\n  Facility: two quick actions both reach the store:");
{
  const srv = store(EMPTY_FM_DATA), doc = fmDoc(srv);
  const a = withCost(EMPTY_FM_DATA, "c1"), b = withCost(a, "c2");
  await Promise.all([doc.push(a), doc.push(b)]);
  ck("both costs are in the store", costIds(srv.doc) === "c1,c2", costIds(srv.doc));
}

console.log("\n  a request that never answers:");
{
  const srv = store(EMPTY_FM_DATA);
  const doc = fmDoc(srv, { deadlineMs: 60 });
  let answer;
  const save = srv.save;
  srv.save = (next, rev, carry, signal) => {
    srv.signals.push(signal);
    // the Wi-Fi went half-way: its answer comes late, a conflict, which a live push would answer by trying again
    if (!answer) return new Promise((r) => { answer = () => r({ ok: false, conflict: true }); });
    return save(next, rev, carry, signal);
  };
  const started = Date.now();
  const o1 = await doc.push(withCost(EMPTY_FM_DATA, "c1"));
  ck("the push ends at its deadline as a transport failure", !o1.ok && o1.reason === "transport" && Date.now() - started < 1000,
     { o1, ms: Date.now() - started });
  ck("  ...its request is aborted", srv.signals[0]?.aborted === true);
  ck("  ...and its work stays unsaved, so a refresh sends it again", doc.hasUnsaved);
  const pull = await doc.pull(() => withCost(EMPTY_FM_DATA, "c1"), () => true);
  ck("a refresh is no longer held: it re-sends", pull.action === "repush", pull.action);
  const o2 = await doc.push(withCost(withCost(EMPTY_FM_DATA, "c1"), "c2"));
  ck("the next write saves, with the timed-out one's work", o2.ok && costIds(srv.doc) === "c1,c2", { ok: o2.ok, store: costIds(srv.doc) });
  const rev = doc.rev, baseline = doc.baseline, saves = srv.signals.length, held = srv.doc;
  answer();
  for (let i = 0; i < 6; i++) await tick();
  ck("the late answer changes nothing: no retry is sent, the baseline stays",
     srv.signals.length === saves && srv.doc === held && doc.rev === rev && doc.baseline === baseline && !doc.hasUnsaved,
     { saves: srv.signals.length - saves, rev: doc.rev });
}

console.log("\n  the deadline, once:");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = (p) => strip(readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8"));
  ck("one push deadline, 15 s", PUSH_DEADLINE_MS === 15_000, PUSH_DEADLINE_MS);
  ck("neither store sets its own", !/deadlineMs/.test(src("config/DeviceConfigSync.tsx")) && !/deadlineMs/.test(src("fm/FmDataContext.tsx")));
  ck("both stores hand the abort to their requests",
     /fetchSharedConfig\(signal\)/.test(src("config/DeviceConfigSync.tsx")) && /fetchFmData\(signal\)/.test(src("fm/FmDataContext.tsx"))
     && /saveFmData\(d, rev, carryOver, elevation, signal\)/.test(src("fm/FmDataContext.tsx")));
  ck("the config store's push gate compares with what is promised, never the confirmed baseline",
     /const promised = doc\.promised;/.test(src("config/DeviceConfigSync.tsx")) && !/serverJsonRef/.test(src("config/DeviceConfigSync.tsx")));
  const fm = src("fm/FmDataContext.tsx");
  const mutate = fm.slice(fm.indexOf("const mutate = useCallback"), fm.indexOf("retryRef.current = useCallback"));
  ck("the Facility store moves its copy before it pushes, and never lays the store's copy over the screen",
     /ref\.current = next;\s*setData\(next\);/.test(mutate) && mutate.indexOf("ref.current = next;") < mutate.indexOf("doc.push(")
     && !/setData\(outcome\.next\)|setData\(before\)/.test(mutate));
}

done("✅ a change put back while its push is out reaches the store; a push that never answers ends at its deadline");
