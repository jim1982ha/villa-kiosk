// Who gets the villa's messages (owner, 2026-11-03): the villa's two lists, read by every VESTA blueprint and by the
// VESTA Agent, edited on this tablet only. Drives the list's words through the pure module, and reads the setting's
// markup: one picker of the villa's notify entities per role, saved to that role's list.
import { readFileSync } from "node:fs";
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

const { ROLE_LISTS, LIST_MAX_CHARS, LISTS_WHERE, LISTS_TITLE, targetsOf, textOf, withChanges, heldChanges } =
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

console.log("\n  a list's changes, held until Save (owner, 2026-11-06: one way of saving):");
{
  const add = (id) => ({ id, on: true }), off = (id) => ({ id, on: false });
  const villa = ["notify.example_chat"];
  const one = heldChanges(villa, [], add("notify.example_phone"));
  const two = heldChanges(villa, one, off("notify.example_chat"));
  ck("two changes in a row both held, the card showing both",
     J(two) === J([add("notify.example_phone"), off("notify.example_chat")]) && J(withChanges(villa, two)) === J(["notify.example_phone"]), two);
  ck("  ...a chat taken off then added back is no change (Save greys again)",
     heldChanges(villa, heldChanges(villa, [], off("notify.example_chat")), add("notify.example_chat")).length === 0);
  ck("  ...a chat's last change only", J(heldChanges([], [add("notify.a"), add("notify.b")], off("notify.a"))) === J([add("notify.b")]));
  ck("  ...Save lays them over the villa's list as it is then: another tablet's chat added meanwhile is kept",
     J(withChanges(["notify.example_chat", "notify.example_other"], two)) === J(["notify.example_other", "notify.example_phone"]));
}

const view = readFileSync(new URL("../../src/components/settings/WhoGetsMessages.tsx", import.meta.url), "utf8");
ck("each role picks among the villa's notify entities, never typed",
   /ROLE_LISTS\.map\(/.test(view) && /<EntityPicker[^>]*domains=\{\["notify"\]\}/.test(view) && !/allowCustom/.test(view));
// owner, 2026-11-04: each role's add is an icon on the line of its name, opening there into the picker (common/AddOnLine,
// the one shared with Full-screen announcements)
{
  const { elements: els, parseTsx: parse, propText: prop } = await import("../consistency/jsx.mjs");
  const [line] = els(parse("components/settings/WhoGetsMessages.tsx"), "AddOnLine");
  const [ann] = els(parse("components/settings/MessagesSettings.tsx"), "AddOnLine");
  ck("each role's add is the shared icon on its name's line, named for the role, opening into the picker",
     !!line && prop(line, "label") === "`Add a chat or phone to ${who}`" && /<EntityPicker[^>]*startOpen/.test(view)
     && /done\(\); add\(id\);/.test(view) && !!ann && prop(ann, "label") === '"Add an announcement"',
     line && prop(line, "label"));
}
ck("a change is held in the dialog's store and Save sends the list over the villa's text then",
   /pending\.hold\(heldKey\(list\.role\), changes, send\(changes\)\)/.test(view)
   && /HAServices\.setText\(now, list\.entityId, text\)/.test(view) && /villaIds\(list\.entityId, snapshot\(\)\)/.test(view));
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
     /\{ids\.map\(\(id\) => \([\s\S]*<RecordCard[\s\S]*<Dropdown className="recipients-language"[\s\S]*onChange=\{\(code\) => setLanguage\(id, code\)\}/.test(view)
     && /Object\.entries\(CHAT_LANGUAGES\)/.test(view));
  // owner, 2026-11-06 (one way of saving; architecture review round 18 had made both "at once"): a chat's language is a
  // key of Settings' draft like every other, Cancel putting it back (driven in tests/oracles/settings_save.mjs)
  const { SETTINGS_KEYS } = await import("@/config/configSlice");
  ck("  ...the language is a key of Settings' draft, and the section writes it only through the dialog",
     SETTINGS_KEYS.includes("chatLanguages") && SETTINGS_KEYS.includes("fullScreen") && !/useConfig/.test(view));
  ck("  ...a chat on no list any more loses its language; one still on the other list keeps it",
     JSON.stringify(r.droppedChats([["notify.a"], ["notify.b"]], ["notify.a", "notify.b", "notify.c"])) === JSON.stringify(["notify.c"]));
}
// owner, 2026-11-03: in Settings › Messages itself (Advanced Settings' Messages tab is gone), for the profiles that edit
// the villa's setup: tests/oracles/messages_settings.mjs reads where, through the compiler's tree
const { elements, guardsOf, parseTsx } = await import("../consistency/jsx.mjs");
const who = elements(parseTsx("components/settings/SettingsModal.tsx"), "WhoGetsMessages");
ck("it is in Settings › Messages, only for a profile that edits the villa's setup",
   who.length === 1 && guardsOf(who[0]).includes('can("editConfig")'), who.map(guardsOf));

done("✅ who gets the messages is the villa's two lists, picked per role on this tablet");
