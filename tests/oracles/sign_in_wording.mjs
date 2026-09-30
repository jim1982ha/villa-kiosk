// What a failed sign-in says (auth/pinOutcome), and that BOTH sign-in
// paths say it. Before 2.496.194 PinPad's `catch {}` discarded the server's
// reason for a 403 ("this profile is not available" — an owner profile with
// no passcode set) and blamed the connection; ProfileGate's un-gated path had
// the right rule, alone. The villa coordinates field is pinned here too: it
// held its own never-resynced draft (see ConfigEditorModal.VillaCoordinates).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { readPinAnswer, DEFAULT_LOCKOUT_SECONDS } = await import("@/auth/pinOutcome");

// ONE answer for both passcodes since 2.496.233 (auth/pinOutcome) — the
// server's reason travels as data, not as an Error's message.
console.log("  what a passcode attempt came to:");
ck("accepted: a profile's {ok: true}, or the superadmin's token",
   readPinAnswer(200, { ok: true }).kind === "accepted" && readPinAnswer(200, { token: "t" }).token === "t");
ck("wrong: {ok: false} or a 401", readPinAnswer(200, { ok: false }).kind === "wrong" && readPinAnswer(401, {}).kind === "wrong");
ck("locked: its seconds, and 60 when the server did not say (the two paths disagreed)",
   readPinAnswer(429, { retryAfter: 12 }).retryAfter === 12 && readPinAnswer(429, {}).retryAfter === DEFAULT_LOCKOUT_SECONDS);
ck("closed: the server's OWN reason, shown to the person",
   readPinAnswer(403, { error: "Set a passcode for Owner in the add-on's options." }).text === "Set a passcode for Owner in the add-on's options.");
ck("  ...and a sentence even when the server gave none", readPinAnswer(403, null).kind === "closed" && readPinAnswer(403, null).text.length > 0);
ck("unavailable: an error page, or a body that is not ours",
   readPinAnswer(502, "<html>").kind === "unavailable" && readPinAnswer(200, null).kind === "unavailable" && readPinAnswer(200, { hello: 1 }).kind === "unavailable");

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
ck("the pad shows each outcome, the server's reason included, and catches nothing",
   /result\.kind === "closed"[\s\S]{0,160}setError\(result\.text\)/.test(src("components/auth/PinPad.tsx")) && !/catch \(/.test(src("components/auth/PinPad.tsx")));
ck("the profile screen shows the same reason, and parses no error text",
   /res\.kind === "closed"\) setGateError\(res\.text\)/.test(src("components/auth/ProfileGate.tsx")) && !/startsWith\(/.test(src("components/auth/ProfileGate.tsx")));
ck("the superadmin gate passes the outcome straight on (no second shape)", /return result;/.test(src("auth/SuperadminGate.tsx")) && !/throw new Error\("elevation/.test(src("auth/SuperadminGate.tsx")));
const cem = src("components/settings/ConfigEditorModal.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
ck("villa coordinates are a drafted field showing the LIVE value when no draft exists",
   /value=\{field\.drafts\[key\] \?\? String\(config\[key\]\)\}/.test(cem.replace(/\s+/g, " ")) && !/useState\(String\(config\.latitude\)\)/.test(cem));

done("✅ one sign-in wording rule; coordinates follow the live config");

