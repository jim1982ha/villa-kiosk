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

const { storeSaveResult, saveProblemLine, UNSAVED_LINE } = await import("@/utils/storeSave");
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
ck("refused, with a reason", saveProblemLine({ ok: false, reason: "refused", message: NO }) === `The add-on refused this change: ${NO}`);
ck("refused, none given", saveProblemLine({ ok: false, reason: "refused" }) === "The add-on refused this change, nothing was saved.");
ck("not landed: the Facility's words", saveProblemLine({ ok: false, reason: "transport" }) === UNSAVED_LINE
   && UNSAVED_LINE === "Couldn't save to the add-on, the change is only on this device."
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
let cfg;
const Probe = () => { cfg = useConfig(); return null; };
const h = React.createElement;
await render(h(ProfileProvider, null, h(ConfigProvider, null, h(DeviceConfigSync), h(Probe))));
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
  ck("  ...and said, with the add-on's reason", cfg.saveProblem === `The add-on refused this change: ${NO}`, cfg.saveProblem);
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
  srv.put = 200;
  await refresh();
  await act(() => sleep(60));
  ck("the add-on back: the next refresh sends it, and the line goes",
     srv.config.entityMap["light.a"].label === "Hall light" && cfg.saveProblem === null, { store: srv.config.entityMap["light.a"].label, said: cfg.saveProblem });
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
     /setSaveProblem\(line\)/.test(src("config/DeviceConfigSync.tsx")) && (src("fm/FmDataContext.tsx").match(/setSaveError\(saveProblemLine\(outcome\)\)/g) ?? []).length === 2);
  ck("Advanced Settings shows it above its footer",
     /<SaveProblemNote line=\{saveProblem\} onDismiss=\{\(\) => setSaveProblem\(null\)\} \/>\s*<ModalFooter/.test(src("components/settings/ConfigEditorModal.tsx")));
}

done("✅ one reading of the add-on's answer for both stores; a refused device-setup change is undone and said");
