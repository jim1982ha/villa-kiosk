// The profile picker shows which profiles can be entered FROM HERE (2.496.207).
// The add-on's /auth/roles now says `enabled` beside `pinRequired`: a profile
// with no passcode is closed — except Guest from inside Home Assistant. The
// picker greys a closed tile and says why, instead of offering a tile that
// fails on tap.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";

globalThis.window ??= {};
globalThis.location ??= { pathname: "/" };
const { parseProfileAccess } = await import("@/auth/PinVerifier");

console.log("  reading the server's answer:");
const a = parseProfileAccess({ roles: {
  guest: { pinRequired: false, enabled: false }, owner: { pinRequired: true, enabled: true }, ops: { pinRequired: true, enabled: true },
} });
ck("a closed passcode-less guest reads as closed", a.guest.pin === false && a.guest.enabled === false);
ck("a passcode-gated owner reads as gated and open", a.owner.pin === true && a.owner.enabled === true);
const b = parseProfileAccess({ roles: { guest: { pinRequired: false }, owner: { pinRequired: true } } });
ck("an answer without `enabled` (older add-on) falls back to 'open iff gated'", b.guest.enabled === false && b.owner.enabled === true);
ck("garbage reads as every profile closed and gated-off, never a throw",
   [null, {}, { roles: "x" }, { roles: { guest: 1 } }].every((v) => { const r = parseProfileAccess(v); return r.guest.pin === false && r.guest.enabled === false && r.ops.enabled === false; }));

console.log("\n  the picker:");
const gate = readFileSync(new URL("../../src/components/auth/ProfileGate.tsx", import.meta.url), "utf8");
ck("a closed profile's tile is disabled and says why",
   /const closed = !!access && !access\[r\]\.enabled;/.test(gate) && /disabled=\{!access \|\| closed\}/.test(gate)
   && /closed \? "No passcode set — not available from here\." : ROLE_DESCRIPTIONS\[r\]/.test(gate));
ck("a passcode-less OPEN profile still signs in with one tap", /if \(access && !access\[r\]\.pin\) \{/.test(gate));
ck("when the add-on cannot be asked, every profile is gated (never silently open)",
   /const gated = \{ pin: true, enabled: true \};\s*setAccess\(\{ guest: gated, owner: gated, ops: gated \}\)/.test(gate));

done("✅ the picker offers only what the add-on will open");
