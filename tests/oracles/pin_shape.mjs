// A passcode's length is the proxy's rule, stated once on the client (auth/pinShape.ts, 2.496.251).
//
// The client carried three separate copies of it (PinVerifier, PinPad,
// SuperadminGate) and nothing compared any of them with the proxy. This reads
// the proxy's own PIN_RE and SUPERADMIN_PIN_RE and drives isPinShape by value.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { PIN_LENGTH, SUPERADMIN_PIN_LENGTH, isPinShape } = await import("@/auth/pinShape");

const proxy = readFileSync(new URL("../../rootfs/usr/bin/supervisor-proxy.py", import.meta.url), "utf8");
const digits = (name) => Number((new RegExp(`^${name} = re\\.compile\\(r"\\^\\[0-9\\]\\{(\\d+)\\}\\$"\\)`, "m").exec(proxy) || [])[1]);
ck("a profile passcode has the proxy's PIN_RE length", PIN_LENGTH === digits("PIN_RE"), [PIN_LENGTH, digits("PIN_RE")]);
ck("the superadmin code has the proxy's SUPERADMIN_PIN_RE length", SUPERADMIN_PIN_LENGTH === digits("SUPERADMIN_PIN_RE"),
   [SUPERADMIN_PIN_LENGTH, digits("SUPERADMIN_PIN_RE")]);
ck("isPinShape: exactly that many digits, nothing else",
   isPinShape("0123", 4) && !isPinShape("012", 4) && !isPinShape("01234", 4) && !isPinShape("01a3", 4) && !isPinShape(" 123", 4)
   && isPinShape("012345", 6));

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
ck("no client file carries its own length any more",
   !/\{4\}|=\s*4;|length=\{[46]\}/.test(strip(src("auth/PinVerifier.ts")) + strip(src("components/auth/PinPad.tsx")) + strip(src("auth/SuperadminGate.tsx"))));
ck("  ...the three users read pinShape", /isPinShape\(pin, PIN_LENGTH\)/.test(src("auth/PinVerifier.ts"))
   && /length = PIN_LENGTH/.test(src("components/auth/PinPad.tsx")) && /length=\{SUPERADMIN_PIN_LENGTH\}/.test(src("auth/SuperadminGate.tsx")));

done("✅ a passcode's length is the proxy's, stated once");
