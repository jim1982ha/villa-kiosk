// A session the server stopped honouring returns the kiosk to its profile
// screen (src/auth/sessionLost.ts, round 10, 2.496.152).
//
// ⚠️ NOBODY OWNED IT. The proxy ends a socket with 4401 and answers 401 once a
// session is logged out everywhere or expired (2.496.24); the socket
// reconnected forever and the stores read 401 as "unreachable" — a wall kiosk
// on the villa, "connecting", never showing the PIN screen.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
register("../consistency/alias-hook.mjs", import.meta.url);
const S = await import("@/auth/sessionLost");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

console.log("  the decision:");
ck("signed in, and the server confirms no session: sign out", S.sessionLostDecision("guest", "none") === "sign-out");
ck("the server cannot be asked (offline wall kiosk): KEEP the profile", S.sessionLostDecision("guest", "unknown") === "keep");
ck("the server still names a role: keep", S.sessionLostDecision("guest", { role: "guest" }) === "keep");
ck("nobody signed in (a 401 before sign-in is expected — /addon-config): nothing to do", S.sessionLostDecision(null, "none") === "keep");

console.log("\n  the signal:");
{
  const heard = [];
  const off = S.onSessionLost((src) => heard.push(src));
  globalThis.fetch = async (url) => ({ status: String(url).includes("fm-data") ? 401 : 200 });
  await S.backendFetch("/api/hassio_ingress/x/fm-data");
  await S.backendFetch("/api/hassio_ingress/x/device-config");
  ck("a 401 from the add-on raises it, naming the route; a 200 does not", heard.length === 1 && heard[0] === "http fm-data", heard);
  const r = await S.backendFetch("/x/fm-data");
  ck("  ...and the caller still gets its response", r.status === 401);
  off();
  S.reportSessionLost("socket 4401");
  ck("unsubscribing stops it", heard.length === 2);
}

console.log("\n  the wiring:");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
ck("the socket reports the proxy's 4401 close", /if \(ev\.code === 4401\) reportSessionLost\("socket 4401"\);/.test(src("ha/HAWebSocket.ts")));
const pc = src("auth/ProfileContext.tsx");
ck("ProfileContext answers it: confirms with the server, decides by sessionLostDecision, signs out locally",
   /onSessionLost\(/.test(pc) && /serverSession\(\)/.test(pc) && /sessionLostDecision\(role, server\) !== "sign-out"/.test(pc) && /setRole\(null\)/.test(pc));
ck("  ...and its telemetry waits for the NEXT sign-in (the proxy refuses telemetry from the dead session it reports)",
   /localStorage\.setItem\(PENDING_LOST_KEY/.test(pc) && /const pending = localStorage\.getItem\(PENDING_LOST_KEY\);/.test(pc)
     && !/onSessionLost\([\s\S]{0,600}reportTelemetry\(/.test(pc));
ck("serverSession answers in three: a role, none, unknown (a failed request is never 'none')",
   /if \(!resp\.ok\) return "unknown";/.test(src("auth/PinVerifier.ts")) && /\} catch \{\s*return "unknown";/.test(src("auth/PinVerifier.ts")));
const SRC = new URL("../../src/", import.meta.url).pathname;
const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(p) && out.push(p); } return out; };
const raw = walk(SRC).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\bfetch\((?:`\$\{)?ingressPath\("([^"]+)"/g)].map((m) => `${f.slice(SRC.length)}:${m[1]}`))
  .filter((x) => !/:auth\//.test(x));
ck("every call to the add-on's own routes goes through backendFetch (only the sign-in routes may not — their 401 means a wrong code)", raw.length === 0, raw);

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ a session the server ended ends on the wall too");
