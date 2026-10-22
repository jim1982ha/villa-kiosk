// A value still being typed belongs to the dialog (2.496.500, config/pendingEdits through hooks/useDraftedSlice and
// hooks/usePendingField), and the 3D view follows what Settings shows (hooks/useScenePreview).
//
//   1. Advanced Settings' coordinates, the days records are kept, and a device's label and intensity each waited in a
//      store of their own (hooks/useDraftCommit): Save stayed grey while one was typed, and closing the dialog before
//      the pause dropped the value (its "commit on unmount" ran inside a state updater that never runs once the field
//      is gone). Now they wait in the dialog's one store: Save lights, Save keeps, Cancel drops, Back writes.
//   2. Settings' Eye height and Walk speed sliders moved the camera themselves, and Cancel re-applied only the look:
//      Cancel within the half-second the write waits left the camera at the cancelled height. Now the view follows
//      the dialog's `view`, so Cancel puts it back by the same path.
//
// Driven under React itself (tests/consistency/fakedom.mjs): the real ConfigProvider, the real dialog draft, the real
// field hook and preview seam, mounted, typed into, closed. Then the wiring of the real dialogs.
import { register } from "node:module";
import { readFileSync, existsSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { React, act, render } = mountRoot();
const h = React.createElement;
const { ConfigProvider, useConfig, DialogEdits } = await import("@/config/ConfigContext");
const { useDraftedSlice } = await import("@/hooks/useDraftedSlice");
const { PendingFields, usePendingField } = await import("@/hooks/usePendingField");
const { useScenePreview } = await import("@/hooks/useScenePreview");
const { eyeHeightOf } = await import("@/babylon/walkerSpawn");
const { ADVANCED_SETTINGS_KEYS: ADV } = await import("@/config/configSlice");

const PAUSE = 60;                                     // the field's pause, short for the test
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The 3D view: what the preview drives, and what the scene re-applies on a config change (CameraController.updateConfig). */
const scene = { eye: null, walk: null, renders: 0 };
const target = {
  setRenderConfig() { scene.renders++; },
  camera: { setEyeHeight(v) { scene.eye = v; }, setWalkSpeed(v) { scene.walk = v; } },
};
let config;
function Scene() {
  const { config: c } = useConfig();
  React.useEffect(() => {
    config = c;
    if (c.eyeHeight && c.eyeHeight !== scene.eye) scene.eye = eyeHeightOf(c.eyeHeight);
    if (c.walkSpeed) scene.walk = c.walkSpeed;
  }, [c]);
  return null;
}

let settings, advanced, lat, lng;
const SLOW = 300;                                     // a second field, for a Cancel then typed again
/** Advanced Settings: its own draft, its fields under its pending store, every control writing as the dialog. */
function Advanced() {
  advanced = useDraftedSlice(ADV);
  return h(DialogEdits, null, h(PendingFields, { pending: advanced.pending }, h(Coordinate)));
}
function Coordinate() { lat = usePendingField("latitude", PAUSE); lng = usePendingField("longitude", SLOW); return null; }
/** Settings: its draft (its keys and Advanced Settings'), the preview seam on its view, Advanced Settings over it. */
function Settings({ withAdvanced }) {
  settings = useDraftedSlice(["eyeHeight", "walkSpeed", "render", ...ADV]);
  useScenePreview(target, settings.view);
  return withAdvanced ? h(Advanced) : null;
}
const app = (children) => h(ConfigProvider, null, h(Scene), children);
const type = (text) => act(() => lat.draft(text, Number.isFinite(Number(text)) && text.trim() !== "" ? { latitude: Number(text) } : null));

console.log("  Advanced Settings on its own, a latitude typed:");
{
  await render(app(h(Advanced)));
  const before = config.latitude;
  await type("-8.65");
  ck("the field shows it at once", lat.shown === "-8.65");
  ck("Save is lit while it waits (it was grey)", advanced.dirty && config.latitude === before, { dirty: advanced.dirty });
  await act(() => advanced.save());
  ck("Save keeps it, and nothing is left to cancel", config.latitude === -8.65 && !advanced.dirty, { lat: config.latitude });
  await render(app(null));
}

console.log("\n  Advanced Settings on its own, Cancel while a latitude waits:");
{
  await render(app(h(Advanced)));
  const before = config.latitude;
  await type("12.5");
  await act(() => advanced.discard());
  await act(() => wait(PAUSE * 3));
  ck("the value is dropped, never written after the pause", config.latitude === before && !advanced.dirty, { lat: config.latitude });
  ck("the field shows the stored value again", lat.shown === undefined);
  await render(app(null));
}

console.log("\n  Cancel, then the same field typed again at once:");
{
  await render(app(h(Advanced)));
  const before = config.longitude;
  await act(() => lng.draft("100", { longitude: 100 }));
  await act(() => wait(SLOW * 2 / 3));
  await act(() => advanced.discard());
  await act(() => lng.draft("101", { longitude: 101 }));
  await act(() => wait(SLOW / 2));                     // past the cancelled value's pause, before the new one's
  ck("the new value waits its own pause (the cancelled one's timer died with it)", config.longitude === before && lng.shown === "101",
     { lng: config.longitude });
  await act(() => advanced.discard());
  await render(app(null));
}

console.log("\n  Advanced Settings over Settings, a latitude typed, then Back before the pause:");
{
  await render(app(h(Settings, { withAdvanced: true })));
  const before = config.latitude;
  await type("-7.25");
  await render(app(h(Settings, { withAdvanced: false })));        // Back: the dialog goes away (no blur, no flush)
  ck("the value is written as it closes (it was dropped)", config.latitude === -7.25, { lat: config.latitude });
  ck("Settings' Save is lit for it", settings.dirty);
  await act(() => wait(PAUSE * 3));
  ck("  ...written once, nothing waits after", config.latitude === -7.25);
  await act(() => { settings.discard(); });
  ck("Settings' Cancel puts it back", config.latitude === before, { lat: config.latitude });
  await render(app(null));
}

console.log("\n  a half-typed number writes nothing:");
{
  await render(app(h(Advanced)));
  const before = config.latitude;
  await type("-");
  ck("Save is lit while it is typed", advanced.dirty);
  await act(() => wait(PAUSE * 3));
  ck("after the pause nothing is written, and the field falls back", config.latitude === before && lat.shown === undefined && !advanced.dirty);
  await render(app(null));
}

console.log("\n  Settings: Eye height dragged, then Cancel before the write:");
{
  await render(app(h(Settings, { withAdvanced: false })));
  const stored = eyeHeightOf(config.eyeHeight), walk = config.walkSpeed;
  ck("opening Settings moves nothing", scene.eye === stored && scene.renders === 0, scene);
  await act(() => settings.set({ eyeHeight: stored + 0.5 }));
  ck("the drag is felt at once", scene.eye === stored + 0.5 && config.eyeHeight === stored, { camera: scene.eye, stored: config.eyeHeight });
  await act(() => settings.set({ walkSpeed: walk + 1 }));
  ck("  ...the walk speed too", scene.walk === walk + 1);
  await act(() => { settings.discard(); });
  await act(() => wait(700));
  ck("Cancel puts the camera back at the stored eye height (it stayed at the cancelled one)",
     scene.eye === stored && eyeHeightOf(config.eyeHeight) === stored, { camera: scene.eye, stored: config.eyeHeight });
  ck("  ...and the walk speed", scene.walk === walk && config.walkSpeed === walk, { walk: scene.walk });
  await act(() => settings.set({ render: { ...settings.view.render, exposure: 1.3 } }));
  ck("a look slider is previewed too", scene.renders === 1, scene.renders);
  await act(() => { settings.discard(); });
  ck("  ...and Cancel re-applies the stored look", scene.renders === 2, scene.renders);
  await act(() => settings.set({ eyeHeight: stored + 0.25 }));
  await act(() => settings.save());
  await act(() => wait(50));
  ck("Save keeps the dragged height on the camera and in the config", scene.eye === stored + 0.25 && config.eyeHeight === stored + 0.25,
     { camera: scene.eye, stored: config.eyeHeight });
  await render(app(null));
}

console.log("\n  the wiring:");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = (p) => strip(readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8"));
  const st = src("components/settings/SettingsModal.tsx"), adv = src("components/settings/ConfigEditorModal.tsx");
  const mf = src("components/settings/MappingFields.tsx");
  ck("Settings' scene follows its view, and no slider moves the scene itself",
     /useScenePreview\(manager, v\);/.test(st) && !/manager\?\.(camera|setRenderConfig)/.test(st));
  ck("Advanced Settings' fields wait in its draft's store",
     /<PendingFields pending=\{own\.pending\}>/.test(adv)
     && ["latitude", "longitude", "recordsKeptDays"].every((k) => new RegExp(`usePendingField<string>\\("${k}"`).test(adv)));
  ck("over Settings, Back writes what is still typed", /const back = \(\) => \{ own\.flush\(\); onBack\(\); \};/.test(adv)
     && /onClose=\{back\}/.test(adv));
  ck("a device's label, intensity and fields wait there too",
     /usePendingField<string>\(`device:\$\{entryKey\}:label`/.test(mf) && /usePendingField<number>\(`device:\$\{entryKey\}:intensity`/.test(mf)
     && /usePendingField<Partial<EntityMapping>>\(`device:\$\{entryKey\}:fields`/.test(mf));
  ck("no field keeps a store of its own any more", !existsSync(new URL("../../src/hooks/useDraftCommit.ts", import.meta.url)));
}

done("✅ a typed value is the dialog's: Save lights, Back keeps it; Settings' Cancel puts the camera back");
