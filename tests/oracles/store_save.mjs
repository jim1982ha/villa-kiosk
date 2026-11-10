// One reading of the add-on's answer to a store write, for both shared stores, and a save that did not land is said
// (architecture review H, 2026-10-23: utils/storeSave, config/deviceConfig saveSharedConfig, fm/fmApi saveFmData,
// config/DeviceConfigSync, Advanced Settings).
//
// The Facility store read 400/403/413 as the add-on's NO (final: undone and said); the device-setup store read every
// failure as a Wi-Fi blip. A refused device-setup change was kept, marked unsaved and sent again on every refresh for
// good, this tablet took no other tablet's change while it waited, and nobody was told; a save that did not land was
// never said either. Now: one mapping; a refused change is undone (the store's copy) and said; an unsaved one is said
// with the Facility's words; both above Advanced Settings' footer.
//
// Driven by value: the mapping on fake answers through BOTH real adapters, the real sync machine, then the real
// ConfigProvider + DeviceConfigSync under React (tests/consistency/fakedom.mjs) against a fake add-on.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { React, act, render } = mountRoot();
Object.assign(globalThis, { screen: { width: 1024, height: 768 } });
globalThis.window.location = { pathname: "/", href: "http://kiosk/", origin: "http://kiosk" };
globalThis.sessionStorage = globalThis.localStorage;
Object.assign(globalThis.document, { querySelector: () => null, visibilityState: "visible", hidden: false });
// the window's wake signals (utils/deviceWake): "focus" is how this test asks for a refresh
const focus = new Set();
globalThis.addEventListener = (type, fn) => { if (type === "focus") focus.add(fn); };
globalThis.removeEventListener = (type, fn) => { if (type === "focus") focus.delete(fn); };

const { storeSaveResult, saveProblemLine, UNSAVED_LINE, NOT_STORED_LINE } = await import("@/utils/storeSave");
const { landPush } = await import("@/utils/syncedDocument");
const D = await import("@/config/deviceConfig");
const F = await import("@/fm/fmApi");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { SyncedDocument } = await import("@/utils/syncedDocument");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const answer = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const NO = "Only the owner profile may edit device configuration.";

console.log("  the add-on's answer, read once:");
{
  const r = async (status, body) => storeSaveResult(answer(status, body));
  const ok = await r(200, { rev: "7" });
  ck("200: saved, at the revision it says", ok.ok && ok.rev === "7", ok);
  ck("409: another write landed first", (await r(409)).conflict === true);
  for (const status of [400, 403, 413]) {
    const x = await r(status, { error: NO });
    ck(`${status}: refused, with the add-on's reason`, !x.ok && x.refused === true && x.message === NO, x);
  }
  for (const status of [401, 500, 502]) {
    const x = await r(status);
    ck(`${status}: a transport failure (kept, sent again)`, !x.ok && !x.refused && x.conflict === false, x);
  }
}

console.log("\n  both stores read it the same:");
for (const status of [200, 403, 409, 413, 502, "throw"]) {
  globalThis.fetch = async () => { if (status === "throw") throw new TypeError("Failed to fetch"); return answer(status, { error: NO, rev: "3" }); };
  const config = await D.saveSharedConfig(D.baselineFromServer({}), "1");
  const fm = await F.saveFmData(EMPTY_FM_DATA, "1");
  ck(`${status}: the device setup's answer is the Facility's`, JSON.stringify(config) === JSON.stringify(fm), { config, fm });
}

console.log("\n  what a screen says:");
ck("refused, with a reason", saveProblemLine({ ok: false, reason: "refused", message: NO }) === `The server refused this change: ${NO}`);
ck("refused, none given", saveProblemLine({ ok: false, reason: "refused" }) === "The server refused this change, nothing was saved.");
ck("not landed: the Facility's words", saveProblemLine({ ok: false, reason: "transport" }) === UNSAVED_LINE
   && UNSAVED_LINE === "Couldn't save to the server, the change is only on this device."
   && saveProblemLine({ ok: false, reason: "conflict-retries-exhausted" }) === UNSAVED_LINE);
ck("saved, or nothing to send: nothing", saveProblemLine({ ok: true }) === null && saveProblemLine({ ok: false, reason: "nothing-to-push" }) === null);

// ── the device setup under React ─────────────────────────────────────────────────────────────────────────────────────
const srv = { config: { entityMap: { "light.a": { entityId: "light.a", type: "light", label: "Hall" } } }, rev: 1, put: 403, puts: 0 };
globalThis.fetch = async (url, init = {}) => {
  await sleep(2);
  if (!String(url).endsWith("device-config")) return answer(404);
  if ((init.method ?? "GET") === "GET") return answer(200, { config: structuredClone(srv.config), rev: String(srv.rev) });
  srv.puts++;
  if (srv.put !== 200) return answer(srv.put, { error: NO });
  const body = JSON.parse(init.body);
  if (body.rev !== String(srv.rev)) return answer(409, {});
  srv.config = body.config; srv.rev++;
  return answer(200, { rev: String(srv.rev) });
};
localStorage.setItem("villa-kiosk:profile:v1", JSON.stringify({ role: "owner", at: Date.now() }));
const { ProfileProvider } = await import("@/auth/ProfileContext");
const { ConfigProvider, useConfig } = await import("@/config/ConfigContext");
const { default: DeviceConfigSync } = await import("@/config/DeviceConfigSync");
const E = await import("@/config/mappingEdits");
const { default: ProblemNotices } = await import("@/components/hud/ProblemNotices");
let cfg;
const Probe = () => { cfg = useConfig(); return null; };
const h = React.createElement;
// the red notices of the villa view (hud/ProblemNotices), read as drawn: each one's words and its ✕
let notices = [], raised = [];
const Said = () => { notices = React.Children.toArray(ProblemNotices({ raised, onDrop: (line) => { raised = raised.filter((l) => l !== line); } }).props.children); return null; };
const said = () => notices.map((n) => n.props.line);
const tree = () => h(ProfileProvider, null, h(ConfigProvider, null, h(DeviceConfigSync), h(Probe), h(Said)));
await render(tree());
await act(() => sleep(40));
const label = (id) => cfg.config.entityMap[id]?.label;
const refresh = async () => { await act(async () => { for (const fn of focus) fn(); await sleep(40); }); };
const PUSHED = 900 + 120;                            // DeviceConfigSync's debounce, and the push itself

console.log("\n  Advanced Settings, the add-on refusing the change:");
{
  ck("the store is read", label("light.a") === "Hall", cfg.config.entityMap);
  await act(async () => { cfg.update(E.patchMapping("light.a", { label: "Hall lamp" })); });
  await act(() => sleep(PUSHED));                    // the push is scheduled once the edit has rendered
  ck("the refused relabel is undone on this tablet (the store's copy)", label("light.a") === "Hall" && srv.puts === 1,
     { shows: label("light.a"), puts: srv.puts });
  ck("  ...and said, with the add-on's reason", cfg.saveProblem === `The server refused this change: ${NO}`, cfg.saveProblem);
  ck("  ...as one red notice of the villa view, over whatever window is open (it was a line in Advanced Settings only)",
     JSON.stringify(said()) === JSON.stringify([`The server refused this change: ${NO}`]), said());
  await act(async () => { notices[0].props.onGone(); });
  ck("  ...which its ✕ closes", cfg.saveProblem === null && said().length === 0, said());
  srv.config = { entityMap: { ...srv.config.entityMap, "light.b": { entityId: "light.b", type: "light", label: "Pool lamp" } } };
  srv.rev++;
  await refresh();
  await refresh();
  ck("it is not sent again, and another tablet's device reaches this one", srv.puts === 1 && label("light.b") === "Pool lamp",
     { puts: srv.puts, b: label("light.b") });
}

console.log("\n  Advanced Settings, the add-on out of reach:");
{
  srv.put = 502;
  await act(async () => { cfg.update(E.patchMapping("light.a", { label: "Hall light" })); });
  await act(() => sleep(PUSHED));                    // the push is scheduled once the edit has rendered
  ck("the relabel stays on this tablet, and the Facility's words say it is only here",
     label("light.a") === "Hall light" && cfg.saveProblem === UNSAVED_LINE, { shows: label("light.a"), said: cfg.saveProblem });
  raised = [UNSAVED_LINE, '"Latitude" needs a number: the one before was kept.'];
  await render(tree());
  ck("  ...one notice for it, however many say the same words, beside any other problem",
     JSON.stringify(said()) === JSON.stringify([UNSAVED_LINE, '"Latitude" needs a number: the one before was kept.']), said());
  ck("  ...a line raised by name passes by itself, one a store holds stands while it is true",
     notices[0].props.passes === false && notices[1].props.passes === true, notices.map((n) => n.props.passes));
  raised = [];
  await render(tree());
  srv.put = 200;
  await refresh();
  await act(() => sleep(60));
  ck("the add-on back: the next refresh sends it, and the line goes",
     srv.config.entityMap["light.a"].label === "Hall light" && cfg.saveProblem === null && said().length === 0,
     { store: srv.config.entityMap["light.a"].label, said: cfg.saveProblem, notices: said() });
}

console.log("\n  this device's own settings, its storage refusing them:");
{
  const set = localStorage.setItem;
  ck("nothing is said for the copy written as the page opens", cfg.storeProblem === null);
  localStorage.setItem = (k, v) => { if (k === "villa-kiosk:config:v2") throw new Error("QuotaExceededError"); set(k, v); };
  await act(async () => { cfg.update({ walkSpeed: cfg.config.walkSpeed + 1 }); });
  ck("a change it could not keep is said (it was a line in the console)", said().includes(NOT_STORED_LINE), said());
  await act(async () => { notices.find((n) => n.props.line === NOT_STORED_LINE).props.onGone(); });
  await act(async () => { cfg.update({ walkSpeed: cfg.config.walkSpeed + 1 }); });
  ck("  ...once while it lasts: not again at every change after its ✕", !said().includes(NOT_STORED_LINE), said());
  localStorage.setItem = set;
  await act(async () => { cfg.update({ walkSpeed: cfg.config.walkSpeed - 2 }); });
  localStorage.setItem = (k, v) => { if (k === "villa-kiosk:config:v2") throw new Error("QuotaExceededError"); set(k, v); };
  await act(async () => { cfg.update({ walkSpeed: cfg.config.walkSpeed + 1 }); });
  ck("  ...stored again, then refused again: said again", said().includes(NOT_STORED_LINE), said());
  localStorage.setItem = set;
  await act(async () => { cfg.update({ walkSpeed: cfg.config.walkSpeed - 1 }); });
  ck("  ...and the line goes with the next change that is stored", cfg.storeProblem === null && !said().includes(NOT_STORED_LINE), said());
  await act(() => sleep(PUSHED));
}

console.log("\n  what the page is asked to say (hud/AppNotice): news passes, a problem is kept beside it");
{
  const { useRaisedNotices } = await import("@/components/hud/AppNotice");
  let page;
  const Page = () => { page = useRaisedNotices(); return null; };
  await render(h(Page));
  const LINE = "Not deleted: the server could not be reached, nothing was changed. Try again.";
  await act(async () => { page.raise({ text: LINE, tone: "alert" }); page.raise({ text: "Saved", tone: "info" }); page.raise({ text: LINE, tone: "alert" }); });
  ck("news said after a problem never replaces it, and the same problem said twice is one line",
     page.passing?.text === "Saved" && JSON.stringify(page.problems) === JSON.stringify([LINE]), page);
  await act(async () => { page.expire(); });
  ck("  ...the news passes, the problem stays for its own time", page.passing === null && page.problems.length === 1, page);
  await act(async () => { page.drop(LINE); });
  ck("  ...and leaves at its ✕", page.problems.length === 0, page);
}

console.log("\n  the wiring:");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = (p) => strip(readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8"));
  const fnOf = (text, name) => text.slice(text.indexOf(`export async function ${name}(`), text.indexOf("\n}\n", text.indexOf(`export async function ${name}(`)));
  const saves = fnOf(src("config/deviceConfig.ts"), "saveSharedConfig") + fnOf(src("fm/fmApi.ts"), "saveFmData");
  ck("both adapters hand the answer to the one mapping, and read no status themselves",
     /return await storeSaveResult\(resp\);/.test(saves) && /return await storeSaveResult\(r\);/.test(saves) && !/\.status\b/.test(saves));
  ck("both stores say a save's problem with the one line",
     /const \{ line \} = landPush\(outcome, \{/.test(src("config/DeviceConfigSync.tsx")) && /setSaveProblem\(line\)/.test(src("config/DeviceConfigSync.tsx"))
       && /const \{ verdict, line \} = landPush\(outcome, \{/.test(src("fm/FmDataContext.tsx")) && /if \(line !== null\) setSaveError\(line\);/.test(src("fm/FmDataContext.tsx"))
       // a delete under its single-use code is the write that cannot be sent again (landPush `once`)
       && /once: elevation \? \{ undo, what: "deleted" \} : undefined,/.test(src("fm/FmDataContext.tsx"))
       && ![src("config/DeviceConfigSync.tsx"), src("fm/FmDataContext.tsx")].some((t) => /saveProblemLine|refused by the add-on|outcome\.takeBack/.test(t)));
}

console.log("\n  what a save's answer means for a screen, decided once for both stores (landPush, architecture review O)");
{
  const run = (outcome, once) => {
    const calls = [];
    const r = landPush(outcome, {
      landed: (o) => { calls.push(["landed", o.rev]); return o.rev === "7" ? "Changed on another tablet" : null; },
      takeBack: (d) => calls.push(["takeBack", d]),
      once: once ? { undo: () => calls.push(["undo"]), what: "deleted" } : undefined,
    });
    return { ...r, calls };
  };
  const landed = run({ ok: true, rev: "7", next: {}, attempts: 1, synced: {}, others: {} });
  ck("landed: the store's merge runs on the screen copy, and what it says is the line", landed.verdict === "saved"
     && landed.line === "Changed on another tablet" && JSON.stringify(landed.calls) === '[["landed","7"]]', landed);
  for (const reason of ["nothing-to-push", "not-allowed", "not-pulled"]) {
    const r = run({ ok: false, reason }, true);
    ck(`  ...${reason}: nothing said, nothing undone (even a single-use delete)`, r.verdict === "unchanged" && r.line === null && r.calls.length === 0, r);
  }
  const no = run({ ok: false, reason: "refused", message: "Not allowed for a guest", takeBack: { tickets: 1 } }, true);
  ck("refused: what was sent taken back, said with the add-on's reason", no.verdict === "refused"
     && JSON.stringify(no.calls) === '[["takeBack",{"tickets":1}]]' && no.line === "The server refused this change: Not allowed for a guest", no);
  const wifi = run({ ok: false, reason: "transport" });
  ck("not reached: kept on this device, said as unsaved, nothing undone", wifi.verdict === "unsent" && wifi.line === UNSAVED_LINE && wifi.calls.length === 0, wifi);
  const del = run({ ok: false, reason: "transport" }, true);
  ck("a delete under its single-use code, not reached: put back and said with its TRUE cause, never 'refused'",
     del.verdict === "undone" && JSON.stringify(del.calls) === '[["undo"]]'
       && del.line === "Not deleted: the server could not be reached, nothing was changed. Try again." && !/refused/.test(del.line), del);
  const clash = run({ ok: false, reason: "conflict-retries-exhausted" }, true);
  ck("  ...another tablet saving at the same moment: said so", clash.verdict === "undone"
     && clash.line === "Not deleted: another device was saving at the same moment, nothing was changed. Try again.", clash.line);
  const refusedDelete = run({ ok: false, reason: "refused", takeBack: {} }, true);
  ck("  ...the add-on's own no: taken back as any refusal, said as refused", refusedDelete.verdict === "refused"
     && JSON.stringify(refusedDelete.calls) === '[["takeBack",{}]]' && /refused/.test(refusedDelete.line), refusedDelete);
}

done("✅ one reading of the add-on's answer for both stores; a refused device-setup change is undone and said");
