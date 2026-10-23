// This tablet's own writes are never another tablet's change, and its own edit wins on its screen (2.496.501,
// utils/syncedDocument `others`, utils/keyedSync withoutOwnWrites and mineWins).
//
//   1. A save that LANDED but answered after the push deadline ended as a failure: the next push found that write in
//      the store and handed it on as another tablet's. Settings took this tablet's own relabel as the value Cancel
//      puts back (Cancel kept the relabel); the Facility screen laid a fault's first version over its "Started".
//   2. The Facility store laid every record another device touched over the screen, the record this tablet had just
//      changed included: a fault marked started and retitled on a phone meanwhile came back "open" here, and the next
//      refresh sent "open" to every device. Now the store's rule is the config store's: this tablet's own edit wins.
//
// Driven by value: the real sync machine, the real stores' diff / apply and the real adapter steps (deviceConfig
// pushedChange / applyRemoteChange, configSlice ledgerOnRemote, fmApi foldOthers); then the real FmDataProvider under
// React (tests/consistency/fakedom.mjs), against a fake store.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { DEFAULT_CONFIG, normaliseConfig } = await import("@/config/AppConfig");
const D = await import("@/config/deviceConfig");
const E = await import("@/config/mappingEdits");
const S = await import("@/config/configSlice");
const F = await import("@/fm/fmApi");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { SyncedDocument } = await import("@/utils/syncedDocument");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A store whose save LANDS, then answers `late` ms later (slow Wi-Fi); `beforeFetch` runs once, as another device. */
function store(doc, fetched = (d, rev) => ({ doc: structuredClone(d), rev, raw: {} })) {
  const s = { doc, rev: 1, late: 0, beforeFetch: null };
  s.fetch = async () => {
    await sleep(2);
    const f = s.beforeFetch; s.beforeFetch = null; f?.();
    return fetched(s.doc, String(s.rev));
  };
  s.save = async (next, rev) => {
    await sleep(2);
    if (rev !== String(s.rev)) return { ok: false, conflict: true };
    s.doc = structuredClone(next); s.rev++;
    const late = s.late; s.late = 0;
    await sleep(late);
    return { ok: true, rev: String(s.rev) };
  };
  return s;
}
const DEADLINE = 50;

console.log("  Settings: a relabel whose save lands after the deadline, then a second relabel:");
{
  const opened = normaliseConfig({ ...DEFAULT_CONFIG, entityMap: {
    "light.hall": { entityId: "light.hall", type: "light", label: "Hall" },
    "light.pool": { entityId: "light.pool", type: "light", label: "Pool" },
  } }, { maps: true });
  const srv = store(D.baselineFromServer(D.pickSharedConfig(opened)),
    (d, rev) => ({ doc: structuredClone(d), rev, raw: {}, config: structuredClone(d) }));
  const doc = new SyncedDocument({
    fetch: (sig) => srv.fetch(sig), save: (...a) => srv.save(...a), diff: D.diffSharedConfig, isEmpty: D.isSharedConfigDiffEmpty,
    apply: D.applySharedConfigDiff, rebase: (b, f) => ({ ...b, ...f }), empty: D.baselineFromServer({}), deadlineMs: DEADLINE,
  }, srv.doc);
  let config = opened, ledger = S.EMPTY_LEDGER;
  const replaced = [];
  const edit = (change) => { const n = S.applyConfigChange(config, change); ledger = S.recordEdit(ledger, S.ADVANCED_SETTINGS_KEYS, config, n); config = n; };
  const push = async () => {                       // DeviceConfigSync pushOwnDiff -> ConfigContext mergeRemote (+ the draft)
    const o = await doc.push(D.pickSharedConfig(config));
    if (o.ok) {
      const change = D.pushedChange(o);
      const r = S.ledgerOnRemote(ledger, config, change); ledger = r.ledger; replaced.push(...r.replaced);
      config = S.applyConfigChange(config, (c) => D.applyRemoteChange(c, change)) ?? config;
    }
    return o;
  };
  edit(E.patchMapping("light.hall", { label: "Hall lamp" }));
  srv.late = 4 * DEADLINE;
  const o1 = await push();
  ck("the first save lands in the store but ends here as a failure (past the deadline)",
     !o1.ok && o1.reason === "transport" && srv.doc.entityMap["light.hall"].label === "Hall lamp" && doc.hasUnsaved, o1);
  edit(E.patchMapping("light.pool", { label: "Pool lights" }));
  const o2 = await push();
  ck("the second save lands", o2.ok, o2.reason);
  ck("  ...and hands on nothing as another tablet's: the relabel in the store is this tablet's own",
     o2.ok && D.isSharedConfigDiffEmpty(o2.others), o2.ok && D.describeSharedConfigDiff(o2.others));
  ck("  ...so the dialog says nothing was replaced", replaced.length === 0, replaced);
  ck("Cancel still knows what both devices showed before", JSON.stringify(ledger.entityMap?.["light.hall"]?.before?.label) === '"Hall"',
     ledger.entityMap?.["light.hall"]);
  const undo = ledger; ledger = S.EMPTY_LEDGER;
  config = S.applyConfigChange(config, (c) => S.revertLedger(undo, c)) ?? config;
  ck("Cancel puts BOTH back (it kept the first relabel)",
     config.entityMap["light.hall"].label === "Hall" && config.entityMap["light.pool"].label === "Pool",
     { hall: config.entityMap["light.hall"].label, pool: config.entityMap["light.pool"].label });
  await push();
  ck("  ...and every tablet gets the labels back", srv.doc.entityMap["light.hall"].label === "Hall" && srv.doc.entityMap["light.pool"].label === "Pool");
}

console.log("\n  Settings: both tablets relabel the same device (the push replays this tablet's onto theirs):");
{
  const opened = normaliseConfig({ ...DEFAULT_CONFIG, entityMap: {
    "light.hall": { entityId: "light.hall", type: "light", label: "Hall" } } }, { maps: true });
  const srv = store(D.baselineFromServer(D.pickSharedConfig(opened)),
    (d, rev) => ({ doc: structuredClone(d), rev, raw: {}, config: structuredClone(d) }));
  const doc = new SyncedDocument({
    fetch: (sig) => srv.fetch(sig), save: (...a) => srv.save(...a), diff: D.diffSharedConfig, isEmpty: D.isSharedConfigDiffEmpty,
    apply: D.applySharedConfigDiff, rebase: (b, f) => ({ ...b, ...f }), empty: D.baselineFromServer({}),
  }, srv.doc);
  let config = S.applyConfigChange(opened, E.patchMapping("light.hall", { label: "Mine" }));
  let ledger = S.recordEdit(S.EMPTY_LEDGER, S.ADVANCED_SETTINGS_KEYS, opened, config);
  srv.beforeFetch = () => {
    srv.doc = { ...srv.doc, entityMap: { ...srv.doc.entityMap, "light.hall": { ...srv.doc.entityMap["light.hall"], label: "Theirs" } } };
    srv.rev++;
  };
  const o = await doc.push(D.pickSharedConfig(config));
  const change = D.pushedChange(o);
  ledger = S.ledgerOnRemote(ledger, config, change).ledger;
  config = S.applyConfigChange(config, (c) => D.applyRemoteChange(c, change)) ?? config;
  ck("this tablet's label stays, as in the store", config.entityMap["light.hall"].label === "Mine" && srv.doc.entityMap["light.hall"].label === "Mine");
  ck("  ...and the other tablet's is still heard: Cancel puts THEIR label back, not the one from before it",
     S.revertLedger(ledger, config).entityMap?.["light.hall"]?.label === "Theirs", S.revertLedger(ledger, config).entityMap?.["light.hall"]);
}

const fmDoc = (srv, extra = {}) => new SyncedDocument({ fetch: (sig) => srv.fetch(sig), save: (...a) => srv.save(...a), diff: F.diffFmData,
  isEmpty: F.fmDiffIsEmpty, apply: F.applyFmDiff, rebase: (_b, f) => f, empty: EMPTY_FM_DATA, ...extra }, EMPTY_FM_DATA);
const fault = { id: "t1", title: "Pool pump noisy", status: "open" };
const status = (d) => d.tickets.find((t) => t.id === "t1")?.status;

console.log("\n  Facility: a fault logged, its save landing after the deadline, then marked started:");
{
  const srv = store(structuredClone(EMPTY_FM_DATA)), doc = fmDoc(srv, { deadlineMs: DEADLINE });
  let screen = EMPTY_FM_DATA;
  const pushed = [];
  const mutate = async (fn) => {                   // FmDataContext mutate: the copy moves at once, then the push
    screen = fn(screen);
    const o = await doc.push(screen);
    if (o.ok) { pushed.push(o); screen = F.foldOthers(screen, o); }
    return o.ok ? "saved" : o.reason;
  };
  srv.late = 4 * DEADLINE;
  const p1 = mutate((d) => ({ ...d, tickets: [fault] }));
  await sleep(5);
  const p2 = mutate((d) => ({ ...d, tickets: d.tickets.map((t) => ({ ...t, status: "in_progress" })) }));
  const [r1, r2] = [await p1, await p2];
  ck("the log ends as a failure though it landed; the status change saves", r1 === "transport" && r2 === "saved", { r1, r2 });
  ck("  ...which hands on nothing as another device's (the logged fault in the store is this tablet's own)",
     pushed.length === 1 && F.fmDiffIsEmpty(pushed[0].others), pushed[0] && pushed[0].others.tickets);
  ck("the screen and the store both read started", status(screen) === "in_progress" && status(srv.doc) === "in_progress",
     { screen: status(screen), store: status(srv.doc) });
  const before = doc.baseline;
  const r = await doc.pull(() => screen, (f) => JSON.stringify(f.doc) !== JSON.stringify(before));
  ck("  ...and the next refresh has nothing to send back", r.action === "noop" || r.action === "apply", r.action);
}

console.log("\n  Facility: a value this tablet once sent, set again later by a phone, still arrives:");
{
  const cost = (id, amount) => ({ id, amount, at: "2026-10-01T00:00:00Z", photoIds: [] });
  const amount = (d) => d.costs.find((c) => c.id === "c1")?.amount;
  const srv = store(structuredClone(EMPTY_FM_DATA)), doc = fmDoc(srv, { deadlineMs: DEADLINE });
  let screen = EMPTY_FM_DATA;
  const mutate = async (fn) => {
    screen = fn(screen);
    const o = await doc.push(screen);
    if (o.ok) screen = F.foldOthers(screen, o);
    return o.ok ? "saved" : o.reason;
  };
  const add = (c) => (d) => ({ ...d, costs: [...d.costs, c] });
  srv.late = 4 * DEADLINE;
  await mutate(add(cost("c1", 10)));               // lands late: a failure here
  await mutate(add(cost("c2", 1)));                // the next saves: the first is settled
  srv.doc = { ...srv.doc, costs: srv.doc.costs.map((c) => (c.id === "c1" ? { ...c, amount: 20 } : c)) }; srv.rev++;
  const p = await doc.pull(() => screen, () => true);
  if (p.action === "apply") screen = p.fetched.doc;
  srv.beforeFetch = () => { srv.doc = { ...srv.doc, costs: srv.doc.costs.map((c) => (c.id === "c1" ? { ...c, amount: 10 } : c)) }; srv.rev++; };
  await mutate(add(cost("c3", 1)));
  ck("the phone's 10 reaches the screen (once settled, a value this tablet sent long ago is anyone's)",
     amount(screen) === 10 && amount(srv.doc) === 10, { screen: amount(screen), store: amount(srv.doc), pulled: p.action });
}

console.log("\n  Facility: a fault marked started here while a phone retitles it (and another fault):");
{
  const other = { id: "t2", title: "Gate stuck", status: "open" };
  const srv = store({ ...structuredClone(EMPTY_FM_DATA), tickets: [fault, other] }), doc = fmDoc(srv);
  let screen = (await doc.pull(() => EMPTY_FM_DATA, () => true)).fetched.doc;
  srv.beforeFetch = () => {                        // the phone's write lands just before this tablet's push reads the store
    srv.doc = { ...srv.doc, tickets: [{ ...fault, title: "Pool pump bearing" }, { ...other, title: "Gate stuck open" }] };
    srv.rev++;
  };
  screen = { ...screen, tickets: screen.tickets.map((t) => (t.id === "t1" ? { ...t, status: "in_progress" } : t)) };
  const o = await doc.push(screen);
  if (o.ok) screen = F.foldOthers(screen, o);
  ck("the phone's change reaches this screen where this tablet changed nothing", o.ok && screen.tickets.find((t) => t.id === "t2").title === "Gate stuck open");
  ck("this tablet's own change stays on its screen (both changed the fault: this tablet's version wins, as in the store)",
     status(screen) === "in_progress" && status(srv.doc) === "in_progress", { screen: status(screen), store: status(srv.doc) });
  const before = doc.baseline;
  const r = await doc.pull(() => screen, (f) => JSON.stringify(f.doc) !== JSON.stringify(before));
  ck("  ...so the next refresh does not send 'open' to every device", r.action !== "repush" && status(srv.doc) === "in_progress",
     { action: r.action, store: status(srv.doc) });
}

console.log("\n  the same, through the real Facility store under React:");
{
  const { React, act, render } = mountRoot();
  // what the provider's refresh and telemetry read of the page
  Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, screen: { width: 1024, height: 768 } });
  globalThis.window.location = { pathname: "/", href: "http://kiosk/", origin: "http://kiosk" };
  globalThis.sessionStorage = globalThis.localStorage;
  Object.assign(globalThis.document, { querySelector: () => null, visibilityState: "visible" });
  const srv = { data: { ...structuredClone(EMPTY_FM_DATA), tickets: [fault] }, rev: 1, beforeFetch: null };
  const answer = (status, body) => ({ ok: status < 300, status, json: async () => body });
  globalThis.fetch = async (url, init = {}) => {
    await sleep(2);
    if (!String(url).endsWith("fm-data")) return answer(404, {});
    if ((init.method ?? "GET") === "GET") {
      const f = srv.beforeFetch; srv.beforeFetch = null; f?.();
      return answer(200, { data: structuredClone(srv.data), rev: String(srv.rev) });
    }
    const body = JSON.parse(init.body);
    if (body.rev !== String(srv.rev)) return answer(409, {});
    srv.data = body.data; srv.rev++;
    return answer(200, { rev: String(srv.rev) });
  };
  const { ProfileProvider } = await import("@/auth/ProfileContext");
  const { FmDataProvider, useFmData } = await import("@/fm/FmDataContext");
  let fm;
  const Probe = () => { fm = useFmData(); return null; };
  const h = React.createElement;
  await render(h(ProfileProvider, null, h(FmDataProvider, null, h(Probe))));
  await act(() => sleep(30));
  ck("the store is read", fm.ready && fm.data.tickets.length === 1, fm.data.tickets);
  srv.beforeFetch = () => { srv.data = { ...srv.data, tickets: [{ ...srv.data.tickets[0], title: "Pool pump bearing" }] }; srv.rev++; };
  let saved;
  await act(async () => { saved = await fm.updateTicket("t1", { status: "in_progress" }); });
  ck("marked started: saved, and the screen still reads started", saved.done && status(fm.data) === "in_progress",
     { saved, screen: status(fm.data) });
  await act(async () => { await fm.reload(); });
  ck("  ...and after the next refresh, the store and the screen both still read started",
     status(srv.data) === "in_progress" && status(fm.data) === "in_progress", { store: status(srv.data), screen: status(fm.data) });
}

console.log("\n  the wiring:");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = (p) => strip(readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8"));
  const fm = src("fm/FmDataContext.tsx"), sync = src("config/DeviceConfigSync.tsx"), dc = src("config/deviceConfig.ts");
  ck("both stores lay the push's `others`, never the store's copy: the Facility store under its own records",
     /const merged = foldOthers\(ref\.current, outcome\);/.test(fm) && /mergeRemote\(pushedChange\(outcome\)\)/.test(sync)
     && !/outcome\.base/.test(fm + sync));
  ck("one rule for 'this tablet's own edit wins', in both stores (keyedSync mineWins)",
     /mineWins\(change\.diff, diffSharedConfig\(change\.synced, local\)\)/.test(dc) && /mineWins\(pushed\.others, diffFmData\(pushed\.synced, screen\)\)/.test(src("fm/fmApi.ts")));
}

done("✅ this tablet's own writes are never another tablet's change; its own edit wins on its screen");
