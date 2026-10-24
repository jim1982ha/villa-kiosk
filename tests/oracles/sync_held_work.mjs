// Held work that the add-on refuses, that this profile may not send, or that belongs to another profile
// (architecture review J, 2026-10-23: utils/syncedDocument takeBack / canWrite / author, fm/fmApi fmUnsentKeeper,
// fm/FmDataContext, config/DeviceConfigSync, utils/keyedSync removedElsewhere).
//
//   j1  a change held offline that the add-on then REFUSED was "undone" by undoing the refresh's retry, an action that
//       changes nothing: it was kept again, refused at every refresh, and every later save carried it and was refused.
//   j2  held Facility work was one copy per tablet: the facility manager's "Started" was shown to the guest signed in
//       after a reload, sent under the guest's sign-in and refused, and the guest's own report, carrying it, too.
//   j3  an owner's setup change that could not be sent, then the tablet handed to the guest: every refresh re-pushed it
//       and was stopped before it went, so the tablet never read the store again, and the 04:00 reload waited for good.
//   j7  a fault erased on the phone came back "in progress" when a tablet that had marked it Started offline caught up.
//
// Driven by value: the real providers under React (tests/consistency/fakedom.mjs) against a fake add-on that acts as
// the proxy does for a guest (an empty reader view; only new open guest reports written), reloaded by mounting again
// over the same browser storage; the real unsentWorkHeld the 04:00 reload asks.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { FM_UNSENT_KEY, fmUnsentKey } = await import("@/fm/fmApi");
const { unsentWorkHeld } = await import("@/utils/syncedDocument");
const { applyKeyedMerging, mineWins, removedElsewhere } = await import("@/utils/keyedSync");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE_KEY = "villa-kiosk:profile:v1";

function browserStorage() {
  const map = new Map();
  return { map, api: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k),
    get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null } };
}

/** The add-on's Facility store, as the proxy serves it: a guest reads an empty record and may only file a new open
 *  report of its own; `tooLong`: a title past it is refused (400). */
function fmAddOn(data) {
  const srv = { data: structuredClone(data), rev: 1, down: false, session: "ops", puts: 0, refused: 0 };
  globalThis.fetch = async (url, init) => {
    await sleep(1);
    if (srv.down) throw new TypeError("Failed to fetch");
    if (!String(url).endsWith("fm-data")) return { ok: false, status: 404, json: async () => ({}) };
    if (init?.method === "PUT") {
      srv.puts++;
      const b = JSON.parse(init.body);
      if ((b.data.tickets ?? []).some((t) => t.title.length > 40)) { srv.refused++; return { ok: false, status: 400, json: async () => ({ error: "title too long" }) }; }
      if (srv.session === "guest") {
        const stored = new Map(srv.data.tickets.map((t) => [t.id, JSON.stringify(t)]));
        const touches = (b.data.tickets ?? []).some((t) => stored.has(t.id) && stored.get(t.id) !== JSON.stringify(t));
        const fresh = (b.data.tickets ?? []).filter((t) => !stored.has(t.id));
        if (touches || fresh.some((t) => t.status !== "open" || t.reportedBy !== "guest")) {
          srv.refused++;
          return { ok: false, status: 403, json: async () => ({ error: "Guests may only report a new problem." }) };
        }
        srv.data.tickets.push(...fresh); srv.rev++;
        return { ok: true, status: 200, json: async () => ({ rev: String(srv.rev) }) };
      }
      if (b.rev !== undefined && b.rev !== String(srv.rev)) return { ok: false, status: 409, json: async () => ({ data: structuredClone(srv.data), rev: String(srv.rev) }) };
      srv.data = b.data; srv.rev++;
      return { ok: true, status: 200, json: async () => ({ rev: String(srv.rev) }) };
    }
    const body = srv.session === "guest" ? structuredClone(EMPTY_FM_DATA) : structuredClone(srv.data);
    return { ok: true, status: 200, json: async () => ({ data: body, rev: String(srv.rev) }) };
  };
  return srv;
}

let fm, prof, page = null;
async function openFm(storage, srv, role) {
  if (page) await page.unmount();
  page = mountRoot();
  globalThis.localStorage = storage.api; globalThis.sessionStorage = storage.api;
  storage.api.setItem(PROFILE_KEY, JSON.stringify({ role, at: Date.now() }));
  srv.session = role;
  Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, screen: { width: 1024, height: 768 } });
  globalThis.window.location = { pathname: "/", href: "http://kiosk/", origin: "http://kiosk" };
  Object.assign(globalThis.document, { querySelector: () => null, visibilityState: "visible" });
  const { ProfileProvider, useProfile } = await import("@/auth/ProfileContext");
  const { FmDataProvider, useFmData } = await import("@/fm/FmDataContext");
  const Probe = () => { fm = useFmData(); prof = useProfile(); return null; };
  const h = page.React.createElement;
  fm = undefined;
  await page.render(h(ProfileProvider, null, h(FmDataProvider, null, h(Probe))));
}
async function until(cond) {
  for (let i = 0; i < 400 && !cond(); i++) await page.act(() => sleep(5));
  return cond();
}
const refresh = () => page.act(async () => { await fm.reload(); });
const titles = () => fm.data.tickets.map((t) => `${t.title} [${t.status}]`).join(", ");
const inAddOn = (srv) => srv.data.tickets.map((t) => `${t.title} [${t.status}]`).join(", ");
const pump = () => ({ id: "t1", title: "Pool pump noisy", status: "open", openedAt: "2026-10-20T08:00:00Z", photoIds: [],
  updates: [{ at: "2026-10-20T08:00:00Z", status: "open", photoIds: [] }] });

console.log("  j1: a change held offline, then refused by the add-on:");
{
  const storage = browserStorage();
  const srv = fmAddOn({ ...EMPTY_FM_DATA, tickets: [pump()] });
  await openFm(storage, srv, "ops");
  await until(() => fm.ready);
  srv.down = true;
  await page.act(async () => { await fm.updateTicket("t1", { title: "Pool pump noisy since the storm, rattles at night, check impeller" }); });
  ck("held offline: on the screen, and the daily reload waits", /since the storm/.test(titles()) && unsentWorkHeld());
  srv.down = false;
  await refresh();
  ck("the add-on back and refusing it: taken back on the screen, and said", titles() === "Pool pump noisy [open]"
     && fm.saveError === "The add-on refused this change: title too long", { screen: titles(), said: fm.saveError });
  ck("  ...nothing kept for after a reload, nothing held", !storage.map.has(fmUnsentKey("ops")) && !unsentWorkHeld());
  for (let i = 0; i < 4; i++) await refresh();
  ck("  ...sent ONCE: later refreshes send nothing", srv.puts === 1, srv.puts);
  let out;
  await page.act(async () => { out = await fm.addTicket({ title: "Gate motor slow", photoIds: [] }); });
  ck("  ...and the tablet works: a new fault is saved", out.result === "saved" && /Gate motor slow/.test(inAddOn(srv)), out);
}
{
  const storage = browserStorage();
  const srv = fmAddOn({ ...EMPTY_FM_DATA, tickets: [pump()] });
  await openFm(storage, srv, "ops");
  await until(() => fm.ready);
  srv.down = true;
  await page.act(async () => { await fm.updateTicket("t1", { title: "Pool pump noisy since the storm, rattles at night, check impeller" }); });
  await openFm(storage, srv, "ops");                     // the page reloads before the add-on is back
  srv.down = false;
  await until(() => fm.ready || fm.unreachable);
  if (srv.refused === 0) await refresh();                // the page's first read came while the add-on was still out
  ck("the same, the page reloaded first: refused once, taken back, and the record read at once (not called out of reach)",
     fm.ready && !fm.unreachable && titles() === "Pool pump noisy [open]" && srv.refused === 1 && !storage.map.has(fmUnsentKey("ops")),
     { ready: fm.ready, unreachable: fm.unreachable, screen: titles(), refused: srv.refused });
}

console.log("\n  j2: Facility work held on a shared tablet, then the guest signs in:");
{
  const storage = browserStorage();
  const srv = fmAddOn({ ...EMPTY_FM_DATA, tickets: [pump()] });
  storage.map.set(FM_UNSENT_KEY, JSON.stringify({ v: 1, baseline: EMPTY_FM_DATA, unsent: {} }));   // the single copy of before
  await openFm(storage, srv, "ops");
  await until(() => fm.ready);
  ck("a copy kept by an older version (whose, unknown): dropped, never replayed", !storage.map.has(FM_UNSENT_KEY));
  srv.down = true;
  await page.act(async () => { await fm.advanceTickets(["t1"], "in_progress", { who: "Pool Co", note: "Impeller replaced", photoIds: [] }); });
  ck("the facility manager's Started, held offline: kept under that profile", storage.map.has(fmUnsentKey("ops")));
  await openFm(storage, srv, "guest");                   // handed back to the guest, the page reloads
  ck("the guest's page: the manager's work is not on it, and the daily reload does not wait for it",
     titles() === "" && !unsentWorkHeld(), { screen: titles(), held: unsentWorkHeld() });
  srv.down = false;
  for (let i = 0; i < 3; i++) await refresh();
  ck("  ...the add-on back: nothing sent as the guest, the record read", srv.puts === 0 && fm.ready, { puts: srv.puts, ready: fm.ready });
  let out;
  await page.act(async () => { out = await fm.addTicket({ title: "Shower drain blocked", photoIds: [], reportedBy: "guest" }); });
  ck("  ...the guest's own report goes through", out.result === "saved" && /Shower drain blocked/.test(inAddOn(srv)), out);
  ck("  ...and the manager's work is still kept for them", storage.map.has(fmUnsentKey("ops")));
  srv.session = "ops";
  srv.down = true;
  await page.act(async () => { prof.login("ops"); });
  ck("the manager signs in again, the add-on out of reach: their work back on the screen, the record said out of reach "
     + "(what the guest read is not theirs)", await until(() => fm.unreachable) && /in_progress/.test(titles()), { screen: titles() });
  srv.down = false;
  await refresh();
  ck("  ...the add-on back: their work is sent, under their sign-in on the same page: their work is sent, under their sign-in",
     await until(() => /Pool pump noisy \[in_progress\]/.test(inAddOn(srv))) && !storage.map.has(fmUnsentKey("ops")), inAddOn(srv));
  ck("  ...and their screen holds it with the guest's report", await until(() => /in_progress/.test(titles()) && /Shower/.test(titles())), titles());
}

console.log("\n  j7: a fault erased on another device while a tablet held a step for it:");
{
  const storage = browserStorage();
  const srv = fmAddOn({ ...EMPTY_FM_DATA, tickets: [pump()] });
  await openFm(storage, srv, "ops");
  await until(() => fm.ready);
  srv.down = true;
  await page.act(async () => { await fm.advanceTickets(["t1"], "in_progress", { who: "Pool Co", note: "On my way", photoIds: [] }); });
  await openFm(storage, srv, "ops");
  srv.data.tickets = []; srv.rev++;                      // erased on the phone (superadmin), or purged
  srv.down = false;
  await until(() => fm.ready || fm.unreachable);
  await refresh(); await refresh();
  ck("the tablet back: the fault stays erased, in the add-on and on the screen", inAddOn(srv) === "" && titles() === "",
     { addOn: inAddOn(srv), screen: titles() });
  ck("  ...and the tablet says its step was not saved", fm.saveError === "This fault was removed on another device, so this step was not saved.",
     fm.saveError);
  ck("  ...nothing kept", !storage.map.has(fmUnsentKey("ops")));
}
{
  const was = { t1: { id: "t1", status: "open" } }, mine = { t1: { id: "t1", status: "in_progress" } };
  const change = { set: mine, del: [], was };
  const merge = (_w, m) => m;
  ck("keyedSync: a change to an item the store no longer holds is not replayed as a new one",
     JSON.stringify(applyKeyedMerging({ t2: { id: "t2" } }, change, merge)) === JSON.stringify({ t2: { id: "t2" } })
     && removedElsewhere(change, {}, "t1"));
  ck("  ...a new item (no `was`) still lands", "t3" in applyKeyedMerging({}, { set: { t3: { id: "t3" } }, del: [], was: {} }, merge));
  ck("  ...the other device's removal stands over this device's change of it",
     JSON.stringify(mineWins({ tickets: { set: {}, del: ["t1"] } }, { tickets: change }).tickets.del) === '["t1"]');
  ck("  ...a store that replaces items whole (no `was`) keeps this device's edit, as before",
     mineWins({ entityMap: { set: {}, del: ["a"] } }, { entityMap: { set: { a: 1 }, del: [] } }).entityMap.del.length === 0);
}
await page.unmount();

console.log("\n  j3: an owner's setup change not sent, then the tablet handed to the guest:");
{
  const { React, act, render } = mountRoot();
  Object.assign(globalThis, { screen: { width: 1024, height: 768 } });
  globalThis.window.location = { pathname: "/", href: "http://kiosk/", origin: "http://kiosk" };
  globalThis.sessionStorage = globalThis.localStorage;
  Object.assign(globalThis.document, { querySelector: () => null, visibilityState: "visible", hidden: false });
  const focus = new Set();
  globalThis.addEventListener = (type, fn) => { if (type === "focus") focus.add(fn); };
  globalThis.removeEventListener = (type, fn) => { if (type === "focus") focus.delete(fn); };
  const answer = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const srv = { config: { entityMap: { "light.a": { entityId: "light.a", type: "light", label: "Hall" } } }, rev: 1, put: 200, puts: 0 };
  globalThis.fetch = async (url, init = {}) => {
    await sleep(2);
    if (!String(url).endsWith("device-config")) return answer(404);
    if ((init.method ?? "GET") === "GET") return answer(200, { config: structuredClone(srv.config), rev: String(srv.rev) });
    srv.puts++;
    if (srv.put !== 200) return answer(srv.put, {});
    const body = JSON.parse(init.body);
    if (body.rev !== String(srv.rev)) return answer(409, {});
    srv.config = body.config; srv.rev++;
    return answer(200, { rev: String(srv.rev) });
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ role: "owner", at: Date.now() }));
  const { ProfileProvider, useProfile } = await import("@/auth/ProfileContext");
  const { ConfigProvider, useConfig } = await import("@/config/ConfigContext");
  const { default: DeviceConfigSync } = await import("@/config/DeviceConfigSync");
  const E = await import("@/config/mappingEdits");
  let cfg, who;
  const Probe = () => { cfg = useConfig(); who = useProfile(); return null; };
  const h = React.createElement;
  await render(h(ProfileProvider, null, h(ConfigProvider, null, h(DeviceConfigSync), h(Probe))));
  await act(() => sleep(40));
  const label = (id) => cfg.config.entityMap[id]?.label;
  const pull = async () => { await act(async () => { for (const fn of focus) fn(); await sleep(40); }); };
  srv.put = 502;
  await act(async () => { cfg.update(E.patchMapping("light.a", { label: "Hall lamp" })); });
  await act(() => sleep(900 + 150));
  ck("the owner's relabel, not sent: held, the daily reload waits", label("light.a") === "Hall lamp" && unsentWorkHeld());
  await act(async () => { who.login("guest"); });
  srv.put = 200;
  srv.config = { entityMap: { ...srv.config.entityMap, "light.b": { entityId: "light.b", type: "light", label: "Pool lamp" } } }; srv.rev++;
  const putsBefore = srv.puts;
  for (let i = 0; i < 3; i++) await pull();
  ck("the guest's tablet keeps reading the setup: a device another tablet added appears", label("light.b") === "Pool lamp", label("light.b"));
  ck("  ...the owner's change waits on this tablet, never sent as the guest", label("light.a") === "Hall lamp"
     && srv.puts === putsBefore && srv.config.entityMap["light.a"].label === "Hall", { puts: srv.puts - putsBefore });
  ck("  ...and the 04:00 reload no longer waits for an owner", !unsentWorkHeld());
  await act(async () => { who.login("owner"); });
  await pull(); await pull();
  ck("the owner signs in again: the change is sent, the other tablet's device kept",
     srv.config.entityMap["light.a"].label === "Hall lamp" && srv.config.entityMap["light.b"]?.label === "Pool lamp" && !unsentWorkHeld(),
     srv.config.entityMap);
}

done("✅ held work: a refusal is taken back once, a profile's work is its own, work not allowed is parked, an erased fault stays erased");
