// Settings' live edits, baseline, Save and Discard (hooks/useDraftedSlice.ts).
//
// ⚠️ THE FAILURE IS SILENT AND ONE-SIDED. A key written by a control but not
// in the dialog's slice is un-revertable: Discard restores its siblings and
// leaves that one changed. Since 2.496.224 the dialog writes ONLY through the
// slice's `set`, whose type accepts only the slice's keys — so that gap is a
// type error. What stays for this oracle: the slice's rules, by value, and the
// one thing tsc cannot see — that the dialog did not take a second way to
// write (useConfig().update) around the slice.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { sliceOf, draftedView, sliceChanged } = await import("@/config/configSlice");

const KEYS = ["siteTitle", "render", "walkSpeed"];
const config = { siteTitle: "Home", render: { exposure: 1 }, walkSpeed: 1, theme: "dark", entityMap: { x: 1 } };
const J = JSON.stringify;

console.log("  the slice:");
ck("reads exactly its keys", J(Object.keys(sliceOf(config, KEYS))) === J(KEYS));
ck("the view is the live config with what is being typed laid over it",
   J(draftedView(config, KEYS, { siteTitle: "Home " })) === J({ siteTitle: "Home ", render: { exposure: 1 }, walkSpeed: 1 }));
ck("nothing typed: the view IS the config (a reverted config shows at once)",
   J(draftedView(config, KEYS, {})) === J(sliceOf(config, KEYS)));

console.log("\n  changed since it opened:");
const baseline = sliceOf(config, KEYS);
ck("the same config: unchanged", !sliceChanged(config, KEYS, baseline, false));
ck("an object value rebuilt with the same content: unchanged (compared by content)",
   !sliceChanged({ ...config, render: { exposure: 1 } }, KEYS, baseline, false));
ck("a key of the slice changed: changed", sliceChanged({ ...config, walkSpeed: 2 }, KEYS, baseline, false));
ck("a write still waiting: changed", sliceChanged(config, KEYS, baseline, true));
ck("a key OUTSIDE the slice changed: not this dialog's change", !sliceChanged({ ...config, theme: "light" }, KEYS, baseline, false));

console.log("\n  the Settings window writes only through its slice:");
const src = readFileSync(new URL("../../src/components/settings/SettingsModal.tsx", import.meta.url), "utf8");
ck("it declares its slice", /useDraftedSlice\(SETTINGS_KEYS\)/.test(src));
ck("it takes no `update` from useConfig (a second way to write, past Discard)",
   !/\{[^}]*\bupdate\b[^}]*\}\s*=\s*useConfig\(\)/.test(src) && !/useConfig\(\)\.update/.test(src));
ck("it keeps no copy of a value beside the slice (no useState seeded from config)",
   !/useState[^(]*\(\s*(?:\(\)\s*=>\s*)?[^)]*config\./.test(src));

done("✅ Settings edits one slice: Discard restores every key it can change");
