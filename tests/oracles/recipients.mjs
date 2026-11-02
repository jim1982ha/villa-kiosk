// Who gets the villa's messages (owner, 2026-11-03): the villa's two lists, read by every VESTA blueprint and by the
// VESTA Agent, edited on this tablet only. Drives the list's words through the pure module, and reads the setting's
// markup: one picker of the villa's notify entities per role, saved to that role's list.
import { readFileSync } from "node:fs";
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

const { ROLE_LISTS, LIST_MAX_CHARS, targetsOf, textOf } = await import("@/messages/recipients");

ck("two lists, the owner's and the facility manager's, each its own helper",
   ROLE_LISTS.map((r) => r.role).join() === "owner,fm" && new Set(ROLE_LISTS.map((r) => r.entityId)).size === 2
   && ROLE_LISTS.every((r) => r.entityId === `input_text.vesta_${r.role}_targets`));
ck("a list reads its notify entities once each, in order, whatever the spacing or case",
   JSON.stringify(targetsOf(" notify.A_chat ,notify.phone,, notify.a_chat, sensor.x")) === '["notify.a_chat","notify.phone"]');
ck("an unreadable helper names nobody", targetsOf("unknown").length === 0 && targetsOf(undefined).length === 0);
ck("a list is kept as its ids apart by \", \"", textOf(["notify.a", "notify.b", "notify.a"]) === "notify.a, notify.b");
ck("an empty list is kept as nothing", textOf([]) === "");
const long = Array.from({ length: 12 }, (_, i) => `notify.telegram_chat_number_${i}`);
ck(`a list longer than the helper holds (${LIST_MAX_CHARS} characters) is refused, never cut`, textOf(long) === null);

const view = readFileSync(new URL("../../src/components/settings/WhoGetsMessages.tsx", import.meta.url), "utf8");
ck("each role picks among the villa's notify entities, never typed",
   /ROLE_LISTS\.map\(/.test(view) && /<EntityPicker[^>]*domains=\{\["notify"\]\}/.test(view) && !/allowCustom/.test(view));
ck("a change is saved to that role's list, as the text textOf makes",
   /HAServices\.setText\(ws, list\.entityId, text\)/.test(view) && /const text = textOf\(/.test(view));
// owner, 2026-11-03: in Settings › Messages itself (Advanced Settings' Messages tab is gone), for the profiles that edit
// the villa's setup: tests/oracles/messages_settings.mjs reads where, through the compiler's tree
const { elements, guardsOf, parseTsx } = await import("../consistency/jsx.mjs");
const who = elements(parseTsx("components/settings/SettingsModal.tsx"), "WhoGetsMessages");
ck("it is in Settings › Messages, only for a profile that edits the villa's setup",
   who.length === 1 && guardsOf(who[0]).includes('can("editConfig")'), who.map(guardsOf));

done("✅ who gets the messages is the villa's two lists, picked per role on this tablet");
