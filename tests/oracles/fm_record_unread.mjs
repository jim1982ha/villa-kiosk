// The maintenance record unread is never shown as an empty one (architecture review H, 2026-10-23: utils/syncedDocument
// `hasRead`, fm/FmDataContext `ready` / `unreachable`, fm/fmSave fmRecordLine, the Cockpit window).
//
// The add-on restarting (an update) or a Wi-Fi blip on opening: the first read failed, and the store set `ready` over
// the EMPTY record all the same. The Cockpit's Open issues, every Facility tab and the map's fault badges showed no
// fault and said nothing, while fmApi promised a failed read "must never be shown as an empty maintenance record".
// Now: "Loading the maintenance record…" until the record is read, "Can't reach the add-on. Retrying." when the read
// failed; the screens wait for it; a record read once stays as it was when a later refresh fails.
//
// Driven by value: the real sync machine against a fake store, then the real FmDataProvider under React
// (tests/consistency/fakedom.mjs) against a fake add-on that is down, then back.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { SyncedDocument } = await import("@/utils/syncedDocument");
const { fmRecordLine } = await import("@/fm/fmSave");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("  the sync machine says whether the store was ever read:");
{
  const s = { doc: { a: 1 }, rev: 1, down: true };
  const doc = new SyncedDocument({
    fetch: async () => (s.down ? null : { doc: { ...s.doc }, rev: String(s.rev), raw: {} }),
    save: async (next) => { s.doc = { ...next }; s.rev++; return { ok: true, rev: String(s.rev) }; },
    diff: (b, l) => ({ doc: { set: Object.fromEntries(Object.entries(l).filter(([k, v]) => b[k] !== v)), del: [] } }),
    isEmpty: (d) => Object.keys(d.doc.set).length === 0, apply: (t, d) => ({ ...t, ...d.doc.set }), rebase: (_b, f) => f, empty: {},
  }, {});
  ck("started from an empty copy: not read", doc.hasRead === false);
  const r1 = await doc.pull(() => ({}), () => true);
  ck("  ...a read that failed: still not read", r1.action === "unreachable" && doc.hasRead === false, r1.action);
  s.down = false;
  await doc.pull(() => ({}), () => true);
  ck("  ...a read that landed: read", doc.hasRead === true);
  const pushed = new SyncedDocument({
    fetch: async () => ({ doc: { ...s.doc }, rev: String(s.rev), raw: {} }), save: async () => ({ ok: true, rev: "9" }),
    diff: (b, l) => ({ doc: { set: Object.fromEntries(Object.entries(l).filter(([k, v]) => b[k] !== v)), del: [] } }),
    isEmpty: (d) => Object.keys(d.doc.set).length === 0, apply: (t, d) => ({ ...t, ...d.doc.set }), rebase: (_b, f) => f, empty: {},
  }, {});
  await pushed.push({ b: 2 });
  ck("  ...a write that landed read the store too", pushed.hasRead === true);
}

console.log("\n  what the screens say:");
ck("reading", fmRecordLine({ ready: false, unreachable: false }) === "Loading the maintenance record…");
ck("the read failed", fmRecordLine({ ready: false, unreachable: true }) === "Can't reach the add-on. Retrying.");
ck("read: nothing (the record itself shows)", fmRecordLine({ ready: true, unreachable: false }) === null
   && fmRecordLine({ ready: true, unreachable: true }) === null);

console.log("\n  the real Facility store, the add-on down on opening, then back:");
{
  const { React, act, render } = mountRoot();
  Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, screen: { width: 1024, height: 768 } });
  globalThis.window.location = { pathname: "/", href: "http://kiosk/", origin: "http://kiosk" };
  globalThis.sessionStorage = globalThis.localStorage;
  Object.assign(globalThis.document, { querySelector: () => null, visibilityState: "visible" });
  const fault = { id: "t1", title: "Pool pump not running", status: "open", openedAt: "2026-10-01T00:00:00Z", photoIds: [] };
  const srv = { data: { ...structuredClone(EMPTY_FM_DATA), tickets: [fault] }, rev: 1, down: true };
  globalThis.fetch = async (url) => {
    await sleep(2);
    if (srv.down) throw new TypeError("Failed to fetch");       // the add-on restarting after an update
    if (!String(url).endsWith("fm-data")) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ data: structuredClone(srv.data), rev: String(srv.rev) }) };
  };
  const { ProfileProvider } = await import("@/auth/ProfileContext");
  const { FmDataProvider, useFmData } = await import("@/fm/FmDataContext");
  let fm;
  const Probe = () => { fm = useFmData(); return null; };
  const h = React.createElement;
  await render(h(ProfileProvider, null, h(FmDataProvider, null, h(Probe))));
  await act(() => sleep(30));
  ck("the read failed: not ready, and the screens say the add-on cannot be reached (never an empty record)",
     fm.ready === false && fm.unreachable === true && fmRecordLine(fm) === "Can't reach the add-on. Retrying.",
     { ready: fm.ready, unreachable: fm.unreachable });
  srv.down = false;
  await act(async () => { await fm.reload(); });
  ck("the add-on back: the next refresh reads the record, and the line goes",
     fm.ready && !fm.unreachable && fm.data.tickets.length === 1 && fmRecordLine(fm) === null,
     { ready: fm.ready, faults: fm.data.tickets.length });
  srv.down = true;
  await act(async () => { await fm.reload(); });
  ck("a later refresh that fails keeps the record read as it was, nothing said",
     fm.ready && !fm.unreachable && fm.data.tickets.length === 1 && fmRecordLine(fm) === null);
}

console.log("\n  the wiring:");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = (p) => strip(readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8"));
  const cockpit = src("components/cockpit/CockpitModal.tsx"), sections = src("components/fm/FacilitySections.tsx");
  const body = cockpit.slice(cockpit.indexOf('<div className="modal-body">'));
  ck("the Cockpit window says it over every tab, the Overview's too, before either draws",
     /const recordLine = fmRecordLine\(\{ ready, unreachable \}\);/.test(cockpit)
     && body.indexOf("{recordLine && <p") >= 0 && body.indexOf("{recordLine && <p") < body.indexOf("<FacilitySections")
     && body.indexOf("{recordLine && <p") < body.indexOf("<CockpitOverview"));
  ck("  ...and the Facility tabs draw nothing of the record until it is read",
     (sections.match(/\{ready && tab === "/g) ?? []).length === 4 && !/Loading the maintenance record/.test(sections));
  const ctx = src("fm/FmDataContext.tsx");
  const unreachable = ctx.slice(ctx.indexOf('case "unreachable":'), ctx.indexOf("const fresh = r.fetched;"));
  ck("a failed read never sets the store ready", !/setReady\(true\)/.test(unreachable));
}

done("✅ the maintenance record unread is never shown as an empty one");
