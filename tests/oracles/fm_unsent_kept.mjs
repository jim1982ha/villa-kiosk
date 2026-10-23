// Facility work the add-on has not got survives a reload (architecture review i_k3, 2026-10-23: utils/syncedDocument
// spec.keep and unsentWorkHeld, fm/fmApi fmUnsentKeeper, fm/FmDataContext, utils/autoReload).
//
// A fault reported, or work logged, while the add-on could not be reached was told "Saved on this device, it will be
// sent automatically when the add-on can be reached." — and lived in the page's memory alone: the tablet's 04:00
// reload, iOS dropping a background tab or a pull to refresh lost it, nothing said. Now the unsent work is kept in the
// browser's storage (the change and the records it touches, in a versioned format) until the add-on has it; the next
// page starts from it and its first refresh sends it, merged item by item like any push (a fault changed meanwhile on
// another device keeps that device's newer value); and the daily reload waits while a store holds a write out or failed.
//
// Driven by value: the real FmDataProvider under React (tests/consistency/fakedom.mjs) against a fake add-on that goes
// down and comes back, "reloaded" by unmounting it and mounting a new one over the same browser storage; the real sync
// machine with a fake keeper; the real daily reload at 04:00 with a fake clock.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { EMPTY_FM_DATA, FM_COLLECTIONS } = await import("@/fm/fmTypes");
const { FM_UNSENT_KEY, FM_UNSENT_FORMAT } = await import("@/fm/fmApi");
const { SyncedDocument, unsentWorkHeld } = await import("@/utils/syncedDocument");
const { installDailyAutoReload } = await import("@/utils/autoReload");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OFFLINE_NOTE = "Saved on this device, it will be sent automatically when the add-on can be reached.";

/** The browser's storage: it outlives the page. `broken`: every access throws (private mode, a full quota). */
function browserStorage() {
  const map = new Map();
  const s = { broken: false, map };
  const guard = (fn) => (...a) => { if (s.broken) throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); return fn(...a); };
  s.api = {
    getItem: guard((k) => map.get(k) ?? null), setItem: guard((k, v) => { map.set(k, String(v)); }),
    removeItem: guard((k) => { map.delete(k); }),
    get length() { if (s.broken) throw new DOMException("denied", "SecurityError"); return map.size; },
    key: guard((i) => [...map.keys()][i] ?? null),
  };
  return s;
}

/** The add-on's Facility store; `down`: out of reach; `refuse`: it says no to every write. */
function addOn(data) {
  const srv = { data: structuredClone(data), rev: 1, down: false, refuse: false, puts: 0 };
  globalThis.fetch = async (url, init) => {
    await sleep(1);
    if (srv.down) throw new TypeError("Failed to fetch");
    if (!String(url).endsWith("fm-data")) return { ok: false, status: 404, json: async () => ({}) };
    if (init?.method === "PUT") {
      srv.puts++;
      if (srv.refuse) return { ok: false, status: 403, json: async () => ({ error: "not allowed" }) };
      const b = JSON.parse(init.body);
      if (b.rev !== undefined && b.rev !== String(srv.rev)) {
        return { ok: false, status: 409, json: async () => ({ data: structuredClone(srv.data), rev: String(srv.rev) }) };
      }
      srv.data = b.data; srv.rev++;
      return { ok: true, status: 200, json: async () => ({ rev: String(srv.rev) }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: structuredClone(srv.data), rev: String(srv.rev) }) };
  };
  return srv;
}

let fm;
let page = null;
/** A page: the Facility store mounted over `storage`. Mounting a new one is the reload. */
async function openPage(storage) {
  if (page) await page.unmount();
  page = mountRoot();
  globalThis.localStorage = storage.api;          // fakedom makes a fresh storage per mount; the browser's stays
  Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, screen: { width: 1024, height: 768 } });
  globalThis.window.location = { pathname: "/", href: "http://kiosk/", origin: "http://kiosk" };
  globalThis.sessionStorage = storage.api;
  Object.assign(globalThis.document, { querySelector: () => null, visibilityState: "visible" });
  const { ProfileProvider } = await import("@/auth/ProfileContext");
  const { FmDataProvider, useFmData } = await import("@/fm/FmDataContext");
  const Probe = () => { fm = useFmData(); return null; };
  const h = page.React.createElement;
  fm = undefined;
  await page.render(h(ProfileProvider, null, h(FmDataProvider, null, h(Probe))));
}
/** Wait until `cond` holds (each turn lets the page's effects and requests run), at most two seconds. */
async function until(cond) {
  for (let i = 0; i < 400 && !cond(); i++) await page.act(() => sleep(5));
  return cond();
}
const settled = () => until(() => fm && (fm.ready || fm.unreachable));
const refresh = () => page.act(async () => { await fm.reload(); });
const kept = (storage) => storage.map.get(FM_UNSENT_KEY) ?? null;

const pump = { id: "t1", title: "Pool pump noisy", status: "open", openedAt: "2026-10-20T08:00:00Z", photoIds: [],
  updates: [{ at: "2026-10-20T08:00:00Z", status: "open", photoIds: [] }] };

console.log("  a fault reported with the add-on out of reach, then the page reloads:");
{
  const storage = browserStorage();
  const srv = addOn({ ...EMPTY_FM_DATA, tickets: [pump] });
  await openPage(storage);
  ck("the record read", await settled() && fm.ready && fm.data.tickets.length === 1);
  srv.down = true;
  let out;
  await page.act(async () => { out = await fm.addTicket({ title: "Water on the plant-room floor", photoIds: [] }); });
  ck("reported: told it is saved on this device, on the screen", out.note === OFFLINE_NOTE && fm.data.tickets.length === 2, out);
  ck("  ...and kept in the browser's storage, in this format, the change and the records it touches only",
     kept(storage) !== null && JSON.parse(kept(storage)).v === FM_UNSENT_FORMAT
     && JSON.parse(kept(storage)).baseline.tickets.length === 0, kept(storage));
  await openPage(storage);                                       // the 04:00 reload, the add-on still down
  ck("reloaded, the add-on still out of reach: the screens say it cannot be reached (the record was never read here)",
     await until(() => fm.unreachable) && !fm.ready);
  ck("  ...and the work is still kept", kept(storage) !== null);
  srv.down = false;
  await refresh();
  ck("the add-on back: the fault is in the add-on", srv.data.tickets.map((t) => t.title).sort().join()
     === "Pool pump noisy,Water on the plant-room floor", srv.data.tickets.map((t) => t.title));
  ck("  ...and on the screen, with the rest of the record", fm.ready && fm.data.tickets.length === 2, fm.data.tickets.length);
  ck("  ...and nothing kept any more", kept(storage) === null);
  await refresh();
  ck("  ...sent ONCE (a later refresh files no second copy)", srv.data.tickets.length === 2);
}

console.log("\n  the same fault changed on another device meanwhile: the store's own merge decides:");
{
  const storage = browserStorage();
  const srv = addOn({ ...EMPTY_FM_DATA, tickets: [pump] });
  await openPage(storage);
  await settled();
  srv.down = true;
  await page.act(async () => { await fm.updateTicket("t1", { title: "Pool pump rattling" }); });
  await page.act(async () => { await fm.advanceTickets(["t1"], "in_progress", { photoIds: [] }); });
  await openPage(storage);                                       // reloaded before the add-on came back
  // meanwhile the owner's phone closed the fault, and the VESTA Agent raised another one
  srv.data.tickets = [{ ...pump, status: "resolved", resolvedAt: "2026-10-23T09:00:00Z",
    updates: [...pump.updates, { at: "2026-10-23T09:00:00Z", status: "resolved", kind: "cleared", note: "Closed without action", photoIds: [], by: "Owner" }] },
  { id: "t2", title: "Gate offline", status: "open", openedAt: "2026-10-23T09:05:00Z", photoIds: [] }];
  srv.rev++;
  srv.down = false;
  await settled();
  await refresh();
  const t1 = srv.data.tickets.find((t) => t.id === "t1");
  ck("the other device's close stands (never overwritten by the older copy kept here)",
     t1?.status === "resolved" && t1.resolvedAt === "2026-10-23T09:00:00Z", t1);
  ck("  ...this device's rename, which nobody else changed, lands", t1?.title === "Pool pump rattling", t1?.title);
  ck("  ...the fault raised elsewhere meanwhile is kept, in the add-on and on the screen",
     srv.data.tickets.some((t) => t.id === "t2") && fm.data.tickets.some((t) => t.id === "t2"));
  ck("  ...and the screen says the fault was changed on another device", fm.saveError === "This fault was just changed on another device.",
     fm.saveError);
  ck("  ...nothing kept any more", kept(storage) === null);
}

console.log("\n  storage refused (private mode, a full quota): as before, never a crash:");
{
  const storage = browserStorage();
  const srv = addOn({ ...EMPTY_FM_DATA, tickets: [pump] });
  storage.broken = true;
  await openPage(storage);
  ck("the record read", await settled() && fm.ready);
  srv.down = true;
  let out;
  await page.act(async () => { out = await fm.addTicket({ title: "Water on the plant-room floor", photoIds: [] }); });
  ck("reported offline: the same words, on the screen", out.note === OFFLINE_NOTE && fm.data.tickets.length === 2);
  srv.down = false;
  await refresh();
  ck("  ...the page still up: the next refresh sends it", srv.data.tickets.length === 2);
  srv.down = true;
  await page.act(async () => { await fm.addTicket({ title: "Lights flicker", photoIds: [] }); });
  await openPage(storage);
  srv.down = false;
  await settled();
  ck("  ...reloaded first: it is lost, as it was before (no copy could be kept), and the page works",
     fm.ready && srv.data.tickets.length === 2 && fm.data.tickets.length === 2, srv.data.tickets.length);
}

console.log("\n  a kept copy it cannot trust is never replayed:");
for (const [what, raw] of [
  // well formed in every other way: only its format tells it apart
  ["another format (an older or newer app)", JSON.stringify({ v: FM_UNSENT_FORMAT + 1, baseline: { ...EMPTY_FM_DATA, tickets: [pump] },
    unsent: { ...Object.fromEntries(FM_COLLECTIONS.map((k) => [k, { set: {}, del: [] }])),
      tickets: { set: { x: { id: "x", title: "Ghost", status: "open", openedAt: "2026-10-23T00:00:00Z", photoIds: [] } }, del: ["t1"], was: {} } } })],
  ["no format at all", JSON.stringify({ baseline: EMPTY_FM_DATA, unsent: {} })],
  ["a change of the wrong shape", JSON.stringify({ v: FM_UNSENT_FORMAT, baseline: EMPTY_FM_DATA, unsent: { tickets: { set: [], del: "t1" } } })],
  ["not JSON", "{oops"],
]) {
  const storage = browserStorage();
  storage.map.set(FM_UNSENT_KEY, raw);
  const srv = addOn({ ...EMPTY_FM_DATA, tickets: [pump] });
  await openPage(storage);
  await settled();
  await refresh();
  ck(`${what}: dropped, nothing sent, the record as the add-on holds it`,
     srv.puts === 0 && fm.ready && fm.data.tickets.map((t) => t.id).join() === "t1" && kept(storage) === null,
     { puts: srv.puts, faults: fm.data.tickets.map((t) => t.id), kept: kept(storage) });
}

console.log("\n  what the add-on refuses is not kept:");
{
  const storage = browserStorage();
  const srv = addOn({ ...EMPTY_FM_DATA, tickets: [pump] });
  await openPage(storage);
  await settled();
  srv.refuse = true;
  let out;
  await page.act(async () => { out = await fm.addTicket({ title: "Water on the plant-room floor", photoIds: [] }); });
  ck("refused: taken back on the screen, and nothing kept for after a reload",
     out.result === "refused" && fm.data.tickets.length === 1 && kept(storage) === null, { out, kept: kept(storage) });
}

console.log("\n  an erasure that could not be sent is taken back, and never replayed after a reload:");
{
  const storage = browserStorage();
  const cost = { id: "c1", at: "2026-10-20T08:00:00Z", amount: 120, category: "minor", note: "Pump seal", photoIds: [] };
  const srv = addOn({ ...EMPTY_FM_DATA, tickets: [pump], costs: [cost] });
  await openPage(storage);
  await settled();
  srv.down = true;
  await page.act(async () => { await fm.addTicket({ title: "Water on the plant-room floor", photoIds: [] }); });
  await page.act(async () => { await fm.removeCost("c1", "single-use-token"); });
  ck("the erasure, the add-on out of reach: taken back on the screen", fm.data.costs.length === 1);
  await openPage(storage);
  srv.down = false;
  await settled();
  await refresh();
  ck("  ...reloaded, the add-on back: the fault reported before it lands, the spend entry is still there",
     srv.data.tickets.length === 2 && srv.data.costs.map((c) => c.id).join() === "c1", { faults: srv.data.tickets.length, costs: srv.data.costs });
}

console.log("\n  the sync machine keeps a write from the moment it is sent:");
{
  const saved = [];
  let release;
  const diff = (b, l) => ({ doc: { set: Object.fromEntries(Object.entries(l).filter(([k, v]) => b[k] !== v)), del: [] } });
  const spec = {
    fetch: async () => ({ doc: { a: 1 }, rev: "1", raw: {} }),
    save: () => new Promise((r) => { release = r; }),
    diff, isEmpty: (d) => Object.keys(d.doc.set).length === 0, apply: (t, d) => ({ ...t, ...d.doc.set }), rebase: (_b, f) => f,
    empty: {}, keep: { load: () => null, save: (c) => saved.push(c) },
  };
  const doc = new SyncedDocument(spec, { a: 1 });
  const untrack = doc.track();
  ck("nothing out: no store holds unsent work", unsentWorkHeld() === false);
  const p = doc.push({ a: 1, b: 2 });
  await sleep(5);
  ck("a write out (the page could reload now): kept already, and the daily reload waits",
     JSON.stringify(saved.at(-1)) === JSON.stringify({ baseline: { a: 1 }, unsent: { doc: { set: { b: 2 }, del: [] } } })
     && unsentWorkHeld() === true, saved);
  release({ ok: true, rev: "2" });
  await p;
  ck("  ...landed: forgotten, and nothing held", saved.at(-1) === null && unsentWorkHeld() === false, saved.at(-1));
  const back = new SyncedDocument({ ...spec, keep: { load: () => ({ baseline: { a: 1 }, unsent: { doc: { set: { b: 2 }, del: [] } } }), save() {} } }, { a: 1 });
  ck("a document started over a kept copy: its work is the local document, unsent, and held",
     JSON.stringify(back.restored) === JSON.stringify({ a: 1, b: 2 }) && back.hasUnsaved && back.holdsUnsentWork);
  const r = await back.pull(() => back.restored, () => true);
  ck("  ...its first refresh sends it (repush)", r.action === "repush", r.action);
  untrack();
}

console.log("\n  the daily reload at 04:00 waits while a store holds unsent work:");
{
  const storage = browserStorage();
  const srv = addOn({ ...EMPTY_FM_DATA, tickets: [pump] });
  await openPage(storage);
  await settled();
  let reloads = 0, tick = null;
  const realSetInterval = globalThis.setInterval, RealDate = globalThis.Date;
  globalThis.setInterval = (fn) => { tick = fn; return 1; };
  const stop = installDailyAutoReload(() => true);
  globalThis.setInterval = realSetInterval;
  globalThis.location.reload = () => { reloads++; };
  const at4 = new RealDate(2026, 9, 24, 4, 1).getTime();
  const tickAt4 = () => {
    globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [at4])); } static now() { return at4; } };
    try { tick(); } finally { globalThis.Date = RealDate; }
  };
  srv.down = true;
  await page.act(async () => { await fm.addTicket({ title: "Water on the plant-room floor", photoIds: [] }); });
  tickAt4();
  ck("04:01, nothing open, nobody near it, a fault not yet sent: no reload", reloads === 0 && unsentWorkHeld());
  srv.down = false;
  await refresh();
  tickAt4();
  ck("  ...sent: the next minute's check reloads", reloads === 1 && !unsentWorkHeld(), reloads);
  stop();
}

console.log("\n  the wiring:");
{
  const { readFileSync } = await import("node:fs");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = (p) => strip(readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8"));
  ck("both stores count in the daily reload's wait (the device setup's and the Facility's)",
     ["config/DeviceConfigSync.tsx", "fm/FmDataContext.tsx"].every((f) => /useEffect\(\(\) => doc\.track\(\), \[doc\]\)/.test(src(f))));
  ck("  ...the Facility store keeps its work through the keeper", /keep: fmUnsentKeeper,/.test(src("fm/FmDataContext.tsx")));
}

await page.unmount();
done("✅ Facility work the add-on has not got survives a reload, is sent once it answers, and holds the daily reload");
