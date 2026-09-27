// What a failed sign-in says (auth/authErrorText), and that BOTH sign-in
// paths say it. Before 2.496.194 PinPad's `catch {}` discarded the server's
// reason for a 403 ("this profile is not available" — an owner profile with
// no passcode set) and blamed the connection; ProfileGate's un-gated path had
// the right rule, alone. The villa coordinates field is pinned here too: it
// held its own never-resynced draft (see ConfigEditorModal.VillaCoordinates).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync } from "node:fs";
const { authErrorText } = await import("@/auth/authErrorText");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

const F = "Check the connection.";
ck("the server's own reason is shown", authErrorText(new Error("this profile is not available"), F) === "this profile is not available");
ck("'auth service unavailable (HTTP 502)' is the fallback, not the raw text", authErrorText(new Error("auth service unavailable (HTTP 502)"), F) === F);
ck("a non-Error (a fetch TypeError-like string, undefined) is the fallback", authErrorText("boom", F) === F && authErrorText(undefined, F) === F);
ck("an Error with no message is the fallback", authErrorText(new Error(""), F) === F);

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
ck("PinPad shows authErrorText(err, …) — no bare catch", /catch \(err\) \{[\s\S]{0,120}setError\(authErrorText\(err, /.test(src("components/auth/PinPad.tsx")) && !/\} catch \{/.test(src("components/auth/PinPad.tsx")));
ck("ProfileGate uses the same rule, and keeps no copy of it", /setGateError\(authErrorText\(err, /.test(src("components/auth/ProfileGate.tsx")) && !/startsWith\("auth service unavailable"\)/.test(src("components/auth/ProfileGate.tsx")));
const cem = src("components/settings/ConfigEditorModal.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
ck("villa coordinates are a drafted field showing the LIVE value when no draft exists",
   /value=\{field\.drafts\[key\] \?\? String\(config\[key\]\)\}/.test(cem.replace(/\s+/g, " ")) && !/useState\(String\(config\.latitude\)\)/.test(cem));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one sign-in wording rule; coordinates follow the live config");
process.exit(fail ? 1 : 0);
