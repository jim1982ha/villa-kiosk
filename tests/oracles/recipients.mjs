// Who gets the villa's messages (owner, 2026-11-03): the villa's two lists, read by every VESTA blueprint and by the
// VESTA Agent, edited on this tablet only. Drives the list's words through the pure module, and reads the setting's
// markup: one picker of the villa's notify entities per role, saved to that role's list.
import { readFileSync } from "node:fs";
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

const { ROLE_LISTS, LIST_MAX_CHARS, LISTS_WHERE, LISTS_TITLE, targetsOf, textOf, listBase, planChange } =
  await import("@/messages/recipients");
const contract = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
const agreed = contract.recipients;
const J = JSON.stringify;

console.log("  the agreement's lists (agent-contract.json `recipients`, read by the VESTA Agent too):");
ck("two lists, the owner's and the facility manager's, each the agreement's helper",
   ROLE_LISTS.map((r) => r.role).join() === "owner,fm" && new Set(ROLE_LISTS.map((r) => r.entityId)).size === 2
   && ROLE_LISTS.every((r) => r.entityId === agreed.lists[r.role]) && J(Object.keys(agreed.lists)) === J(["owner", "fm"]));
ck("  ...each read as the agreement's examples say (spaces, case, a duplicate, another domain, nothing)",
   agreed.examples.length >= 4 && agreed.examples.every((e) => J(targetsOf(e.text)) === J(e.targets)),
   agreed.examples.map((e) => [e.text, targetsOf(e.text)]));
ck("  ...the examples cover what the reading must agree on",
   agreed.examples.some((e) => e.text.includes(" ") && /[A-Z]/.test(e.text))
   && agreed.examples.some((e) => e.targets.length > 0 && e.text.split(",").length > e.targets.length)
   && agreed.examples.some((e) => e.text === "" && e.targets.length === 0));
ck("  ...a helper holds the agreement's characters, and the menus name the agreement's place",
   LIST_MAX_CHARS === agreed.maxChars && LISTS_WHERE === agreed.where && LISTS_WHERE.startsWith("Settings › Messages › ")
   && LISTS_TITLE === agreed.where.split(" › ")[2]);
ck("a list reads its notify entities once each, in order, whatever the spacing or case",
   JSON.stringify(targetsOf(" notify.A_chat ,notify.phone,, notify.a_chat, sensor.x")) === '["notify.a_chat","notify.phone"]');
ck("an unreadable helper names nobody", targetsOf("unknown").length === 0 && targetsOf(undefined).length === 0);
ck("a list is kept as its ids apart by \", \"", textOf(["notify.a", "notify.b", "notify.a"]) === "notify.a, notify.b");
ck("an empty list is kept as nothing", textOf([]) === "");
const long = Array.from({ length: 12 }, (_, i) => `notify.telegram_chat_number_${i}`);
ck(`a list longer than the helper holds (${LIST_MAX_CHARS} characters) is refused, never cut`, textOf(long) === null);

console.log("\n  two changes in a row, the second before the villa shows the first (architecture review round 17):");
{
  const add = (id) => (ids) => [...ids, id];
  // the villa shows "" all along: both changes are planned over the same screen
  const first = planChange("", null, add("notify.example_chat"));
  const second = planChange("", first.sent, add("notify.example_phone"));
  ck("the second builds on the first: both are on the list sent",
     first.text === "notify.example_chat" && second.text === "notify.example_chat, notify.example_phone", [first.text, second.text]);
  // the villa now shows the first: a third still builds on the second, still landing
  const third = planChange("notify.example_chat", second.sent, (ids) => ids.filter((x) => x !== "notify.example_chat"));
  ck("  ...while the villa shows the first one landed, a third builds on the second", third.text === "notify.example_phone", third.text);
  ck("  ...once the villa shows another tablet's change, it builds on the villa's",
     J(listBase("notify.example_other", second.sent)) === J(["notify.example_other"]));
  ck("  ...a list too long is not sent and changes nothing", (() => {
    const p = planChange("", first.sent, () => Array.from({ length: 12 }, (_, i) => `notify.telegram_chat_number_${i}`));
    return p.text === null && p.sent === first.sent;
  })());
}

const view = readFileSync(new URL("../../src/components/settings/WhoGetsMessages.tsx", import.meta.url), "utf8");
ck("each role picks among the villa's notify entities, never typed",
   /ROLE_LISTS\.map\(/.test(view) && /<EntityPicker[^>]*domains=\{\["notify"\]\}/.test(view) && !/allowCustom/.test(view));
ck("a change is saved to that role's list, planned over the villa's latest text and what this tablet sent",
   /HAServices\.setText\(ws, list\.entityId, plan\.text\)/.test(view)
   && /planChange\(getEntitiesSnapshot\(\)\[list\.entityId\]\?\.state, sentRef\.current\[list\.role\]/.test(view)
   && !/save\(withItem\(ids/.test(view));
// owner, 2026-11-03: each chat's language is set here beside it, never on the VESTA Agent's page
{
  const r = await import("@/messages/recipients");
  const contract = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
  ck("the chats' languages are the agreement's menu, the Agent's own list", JSON.stringify(r.CHAT_LANGUAGES) === JSON.stringify(contract.recipients.languages)
     && r.CHAT_LANGUAGES.en === "English");
  const set = r.withChatLanguage({ "notify.a": "de" }, "notify.b", "fr");
  ck("  ...choosing a chat's language writes that chat's only; English is kept as no entry",
     JSON.stringify(set) === JSON.stringify({ "notify.a": "de", "notify.b": "fr" })
     && JSON.stringify(r.withChatLanguage(set, "notify.a", "en")) === JSON.stringify({ "notify.b": "fr" }));
  ck("  ...a menu beside each chat of the list, its choices the agreement's",
     /\{ids\.map\(\(id\) => \([\s\S]*<RemovablePill[\s\S]*<Dropdown className="recipients-language"[\s\S]*onChange=\{\(code\) => setLanguage\(id, code\)\}/.test(view)
     && /Object\.entries\(CHAT_LANGUAGES\)/.test(view));
  // architecture review round 18, card 1: a chat was saved at once and its language with Save, so ✕ said "nothing was
  // kept" over a chat that was
  const settingsSrc = readFileSync(new URL("../../src/components/settings/SettingsModal.tsx", import.meta.url), "utf8");
  const draftKeys = /const SETTINGS_KEYS = \[([\s\S]*?)\] as const/.exec(settingsSrc)?.[1] ?? "";
  ck("  ...the section saves a chat and its language the same way, at once: the language is no key of Settings' draft",
     draftKeys.includes('"fullScreen"') && !draftKeys.includes("chatLanguages")
     && /update\(\(c\) => \(\{ chatLanguages: withChatLanguage\(c\.chatLanguages, id, code\) \}\)\)/.test(view));
  ck("  ...a chat on no list any more loses its language; one still on the other list keeps it",
     JSON.stringify(r.droppedChats([["notify.a"], ["notify.b"]], ["notify.a", "notify.b", "notify.c"])) === JSON.stringify(["notify.c"])
     && /if \(sent\.ok\) for \(const gone of droppedChats\([\s\S]*setLanguage\(gone, "en"\)/.test(view));
}
// owner, 2026-11-03: in Settings › Messages itself (Advanced Settings' Messages tab is gone), for the profiles that edit
// the villa's setup: tests/oracles/messages_settings.mjs reads where, through the compiler's tree
const { elements, guardsOf, parseTsx } = await import("../consistency/jsx.mjs");
const who = elements(parseTsx("components/settings/SettingsModal.tsx"), "WhoGetsMessages");
ck("it is in Settings › Messages, only for a profile that edits the villa's setup",
   who.length === 1 && guardsOf(who[0]).includes('can("editConfig")'), who.map(guardsOf));

done("✅ who gets the messages is the villa's two lists, picked per role on this tablet");
