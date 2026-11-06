// ONE WAY OF SAVING in Settings and Advanced Settings (owner, 2026-11-06): a chat taken off "Who gets the messages" was
// written to the villa at once while the dialog's Save stayed grey, so the owner could not tell it was saved, and its
// language was written past the draft. Now every control of both dialogs goes through the dialog's Save / Cancel: a
// change lights Save, Save keeps it, Cancel puts back exactly what was not yet saved.
//
// Driven under React itself (tests/consistency/fakedom.mjs): the real ConfigProvider, the real dialog draft
// (hooks/useDraftedSlice with configSlice SETTINGS_KEYS), the real pending store, and the section's real hook
// (WhoGetsMessages useRecipientLists) over a villa whose writes are recorded. Then every control's write of Settings, by
// value through the same draft, and the tree: every handler of Settings writes through it (Advanced Settings' edits are
// driven by tests/oracles/advanced_draft.mjs, its typed fields by dialog_pending.mjs).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
// asked before the alias hook (registered last): the store's context exported, as the screenshot harness does
register(`data:text/javascript,${encodeURIComponent(`
export async function load(url, context, next) {
  const r = await next(url, context);
  if (!url.endsWith("/src/ha/HAStateStore.tsx")) return r;
  return { ...r, source: String(r.source) + "\\nexport { HAStateContext as __Ctx };", shortCircuit: true };
}`)}`);
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
import ts from "typescript";
import { parseTsx } from "../consistency/jsx.mjs";
const { React, act, render } = mountRoot();
const h = React.createElement;
const { ConfigProvider, useConfig } = await import("@/config/ConfigContext");
const { __Ctx: HACtx } = await import("@/ha/HAStateStore");
const { useDraftedSlice } = await import("@/hooks/useDraftedSlice");
const { PendingFields } = await import("@/hooks/usePendingField");
const { useRecipientLists } = await import("@/components/settings/WhoGetsMessages");
const { SETTINGS_KEYS, ADVANCED_SETTINGS_KEYS } = await import("@/config/configSlice");
const { ROLE_LISTS } = await import("@/messages/recipients");
const J = JSON.stringify;

// the villa: its two lists (the agreement's helpers), every write to it recorded, refused when `refuse` is set
const OWNER = ROLE_LISTS[0].entityId, FM = ROLE_LISTS[1].entityId;
let entities = {};
const villa = (owner, fm) => {
  entities = { [OWNER]: { entity_id: OWNER, state: owner, attributes: {} }, [FM]: { entity_id: FM, state: fm, attributes: {} } };
};
const sent = [];
let refuse = false;
const ws = { callService: async (domain, service, data, target) => {
  sent.push({ domain, service, value: data.value, target: target?.entity_id });
  return { ok: !refuse };
} };
const ha = () => ({ entities, getEntitiesSnapshot: () => entities, ws });

let config, dialog, lists;
function Probe() { config = useConfig().config; return null; }
/** Settings: its one draft, its pending store around Who gets the messages, which gets the draft's languages. */
function Settings() {
  dialog = useDraftedSlice(SETTINGS_KEYS);
  return h(PendingFields, { pending: dialog.pending }, h(Section));
}
function Section() {
  lists = useRecipientLists({ languages: dialog.view.chatLanguages,
    onLanguages: (chatLanguages) => dialog.set({ chatLanguages }, { now: true }) });
  return null;
}
const app = () => h(ConfigProvider, null, h(Probe), h(HACtx.Provider, { value: ha() }, h(Settings)));
const ids = (role) => lists.lists.find((l) => l.role === role).ids;
const open = async (owner, fm) => { villa(owner, fm); sent.length = 0; refuse = false; await render(app()); };

console.log("  Who gets the messages: a chat taken off, then Cancel:");
{
  await open("notify.example_owner_chat", "notify.example_fm_group");
  await act(() => lists.lists[1].remove("notify.example_fm_group"));
  ck("the card goes at once and Save lights (it stayed grey)", J(ids("fm")) === "[]" && dialog.dirty, { ids: ids("fm"), dirty: dialog.dirty });
  ck("  ...nothing is written to the villa before Save (it was written at once)", sent.length === 0, sent);
  await act(() => { dialog.discard(); });
  ck("Cancel puts it back on the card, Save grey again", J(ids("fm")) === '["notify.example_fm_group"]' && !dialog.dirty);
  ck("  ...and the villa was never written", sent.length === 0, sent);
}

console.log("\n  a chat added, its language set, then Save:");
{
  await open("notify.example_owner_chat", "");
  await act(() => lists.lists[0].add("notify.example_phone"));
  await act(() => lists.setLanguage("notify.example_phone", "de"));
  ck("the chat and its language show at once, Save lit", J(ids("owner")) === '["notify.example_owner_chat","notify.example_phone"]'
     && dialog.view.chatLanguages["notify.example_phone"] === "de" && dialog.dirty);
  // another tablet adds a chat to the same list before this one's Save
  entities = { ...entities, [OWNER]: { ...entities[OWNER], state: "notify.example_owner_chat, notify.example_other" } };
  let ok;
  await act(async () => { ok = await dialog.save(); });
  ck("Save sends the list once, over the villa's list as it is then (the other tablet's chat kept)",
     ok === true && J(sent) === J([{ domain: "input_text", service: "set_value",
       value: "notify.example_owner_chat, notify.example_other, notify.example_phone", target: OWNER }]), sent);
  ck("  ...the language kept, nothing left to save", config.chatLanguages["notify.example_phone"] === "de" && !dialog.dirty);
}

console.log("\n  the villa refuses the list:");
{
  await open("notify.example_owner_chat", "");
  refuse = true;
  await act(() => lists.lists[0].remove("notify.example_owner_chat"));
  let ok;
  await act(async () => { ok = await dialog.save(); });
  ck("Save says it and the dialog stays open, the change still waiting", ok === false && dialog.dirty
     && dialog.problem === "The Owner's list could not be saved: try again.", { ok, problem: dialog.problem });
  refuse = false;
  await act(async () => { ok = await dialog.save(); });
  ck("  ...Save again sends it", ok === true && sent.length === 2 && sent[1].value === "" && !dialog.dirty && dialog.problem === null, sent);
}

console.log("\n  a chat's language, then Cancel; a chat taken off every list:");
{
  await open("notify.example_owner_chat", "notify.example_fm_group");
  await act(() => lists.setLanguage("notify.example_fm_group", "fr"));
  ck("a language set lights Save (it was saved at once, past the draft)", dialog.dirty && config.chatLanguages["notify.example_fm_group"] === "fr");
  await act(() => { dialog.save(); });
  await act(() => lists.lists[1].remove("notify.example_fm_group"));
  ck("a chat on no list any more loses its language with it", config.chatLanguages["notify.example_fm_group"] === undefined && dialog.dirty);
  await act(() => { dialog.discard(); });
  ck("  ...Cancel brings back both, the chat and its language", J(ids("fm")) === '["notify.example_fm_group"]'
     && config.chatLanguages["notify.example_fm_group"] === "fr" && !dialog.dirty && sent.length === 0, config.chatLanguages);
  await act(() => lists.lists[1].remove("notify.example_fm_group"));
  await act(() => lists.lists[1].add("notify.example_fm_group"));
  ck("a chat taken off then added back is no change: nothing to send", !dialog.pending.held().length, dialog.pending.held());
  await act(() => { dialog.discard(); });
}

console.log("\n  every control of Settings, through the same draft (a change lights Save, Cancel puts it back):");
{
  await open("", "");
  const opened = JSON.parse(J(config));
  // [control, its write as the control makes it, written at once (a toggle) or after a pause (a slider, a title)]
  const CONTROLS = [
    ["Interface theme", { theme: opened.theme === "dark" ? "light" : "dark" }, true],
    ["Dashboard title", { siteTitle: "Example House" }, false],
    ["Clickable Glow", { highlightInteractive: !opened.highlightInteractive }, true],
    ["Room glow", { roomGlowAndCones: !opened.roomGlowAndCones }, true],
    ["Natural Scroll", { naturalScrolling: !opened.naturalScrolling }, true],
    ["Brightness", { render: { ...opened.render, exposure: 1.4 } }, false],
    ["Night dimming", { render: { ...opened.render, nightDimming: 0.2 } }, false],
    ["Light effect strength", { render: { ...opened.render, lightPoolIntensity: 1.7 } }, false],
    ["Villa lighting", { render: { ...opened.render, dayNightPreview: "night" } }, false],
    ["Map look", { badgeStyle: opened.badgeStyle === "card" ? "classic" : "card" }, true],
    ["Summary bar", { showSummaryBar: !opened.showSummaryBar }, true],
    ["Eye height", { eyeHeight: 1.9 }, false],
    ["Walk speed", { walkSpeed: 2.2 }, false],
    ["Full screen on this tablet", { ringsFullScreen: !opened.ringsFullScreen }, true],
    ["Full-screen announcements: one added", { fullScreen: [{ title: "Front gate doorbell", seconds: 60 }] }, true],
    ["Language on this tablet", { tabletLanguage: "de" }, true],
    ["A chat's language", { chatLanguages: { "notify.example_chat": "id" } }, true],
  ];
  for (const [name, write, now] of CONTROLS) {
    await act(() => dialog.set(write, { now }));
    const lit = dialog.dirty;
    await act(() => { dialog.discard(); });
    await act(() => new Promise((r) => setTimeout(r, 600)));
    const back = Object.keys(write).every((k) => J(config[k]) === J(opened[k]));
    ck(`${name}: lights Save, and Cancel puts it back`, lit && back && !dialog.dirty, { lit, back });
  }
  ck("  ...each a key of the one draft, Advanced Settings' keys in it too",
     CONTROLS.every(([, w]) => Object.keys(w).every((k) => SETTINGS_KEYS.includes(k))) && ADVANCED_SETTINGS_KEYS.every((k) => SETTINGS_KEYS.includes(k)));
}

console.log("\n  the tree: every handler of Settings writes through its draft, nothing at once:");
{
  /** Every `on…` prop of every JSX element in a file, as text. */
  const handlers = (rel) => {
    const out = [];
    const visit = (n) => {
      if (ts.isJsxAttribute(n) && /^on[A-Z]/.test(n.name.getText()) && n.initializer)
        out.push([n.name.getText(), n.initializer.getText().replace(/\s+/g, " ")]);
      ts.forEachChild(n, visit);
    };
    visit(parseTsx(rel));
    return out;
  };
  // a write of the draft (slice.set, its helpers), or no write (opening Advanced Settings, a tab, the window's exits)
  const THROUGH = /slice\.(set|flush|dismissReplaced)\b|\bapply(Render|EyeHeight|WalkSpeed|SiteTitle)\b|^\{(onOpenConfigEditor|onTab|onClose|closeModal)\}$/;
  const loose = handlers("components/settings/SettingsModal.tsx").filter(([, t]) => !THROUGH.test(t));
  ck("Settings: every handler is the draft's write or no write", loose.length === 0, loose);
  const who = handlers("components/settings/WhoGetsMessages.tsx");
  const hook = parseTsx("components/settings/WhoGetsMessages.tsx").getText();
  ck("Who gets the messages: its handlers add, remove or set a language, and its one villa write is the send Save runs",
     who.every(([, t]) => /\b(add|remove|setLanguage|done)\(/.test(t)) && (hook.match(/HAServices\.\w+\(/g) ?? []).length === 1
     && /const send = \(changes: readonly ListChange\[\]\) => async \(\) =>/.test(hook) && !/useConfig/.test(hook), who);
}

done("✅ one way of saving: every Settings control, Who gets the messages included, waits for Save; Cancel undoes it");
