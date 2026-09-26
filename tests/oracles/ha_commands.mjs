// Everything the kiosk sends Home Assistant is in ONE table —
// rootfs/usr/share/vesta/ha-commands.json — which the proxy builds its
// non-owner allow-lists from (tests/proxy-rules.py checks that half).
//
// ⚠️ THE PROXY KEPT ITS OWN COPY, "IN SYNC" BY A COMMENT (round 10,
// 2.496.151). The app then sent energy/info (2.496.105), scene.turn_on and
// input_boolean.toggle, and every non-owner profile was refused all three
// while the app offered them — the Energy window silently lost its cost.
// This scans every literal command and service domain the app sends and
// fails on one the table does not list.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const table = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/ha-commands.json", import.meta.url), "utf8"));
const types = new Set([...table.websocket, ...table.camera]);
const domains = new Set(table.serviceDomains);

const SRC = new URL("../../src/", import.meta.url).pathname;
const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(p) && out.push(p); } return out; };
const files = walk(SRC).map((f) => ({ f: f.slice(SRC.length), src: readFileSync(f, "utf8") }));

// Websocket commands: every sendMessage/subscribeCommand literal, and every
// `type:` literal inside the socket module (auth, ping, subscribe…).
const sent = new Map();
for (const { f, src } of files) {
  for (const m of src.matchAll(/\b(?:sendMessage|subscribeCommand)(?:<[^>()]*>)?\(\s*"([a-z_/]+)"/g)) sent.set(m[1], f);
  if (f === "ha/HAWebSocket.ts") for (const m of src.matchAll(/\btype: "([a-z_/]+)"/g)) sent.set(m[1], f);
}
console.log(`  websocket commands the app sends: ${[...sent.keys()].sort().join(", ")}`);
ck("found the socket's own commands (a scan that finds nothing proves nothing)", ["auth", "get_states", "energy/info", "camera/stream"].every((t) => sent.has(t)), [...sent.keys()]);
const unlisted = [...sent].filter(([t]) => !types.has(t)).map(([t, f]) => `${t} (${f})`);
ck("every one is in the table", unlisted.length === 0, unlisted);

// Service calls: every literal domain; and the domains passed as a variable
// come from quickAction's toggle set, which must be in the table too.
const calls = new Map();
for (const { f, src } of files) {
  for (const m of src.matchAll(/\bcallService\(\s*"([a-z_]+)"\s*,\s*"([a-z_]+)"/g)) calls.set(`${m[1]}.${m[2]}`, f);
}
console.log(`  services the app calls by name: ${[...calls.keys()].sort().join(", ")}`);
ck("found the service calls", calls.has("light.toggle") && calls.has("scene.turn_on"), [...calls.keys()]);
const badCalls = [...calls].filter(([c]) => {
  const [d, s] = c.split(".");
  return d === "homeassistant" ? !table.homeassistantServices.includes(s) : !domains.has(d);
}).map(([c, f]) => `${c} (${f})`);
ck("every service domain is in the table (homeassistant.* by service)", badCalls.length === 0, badCalls);
const { TOGGLEABLE_DOMAINS } = await import("@/utils/quickAction");
const badToggle = [...TOGGLEABLE_DOMAINS].filter((d) => !domains.has(d));
ck("every domain a tile toggles by variable (quickAction's toggle set) is in the table", badToggle.length === 0, badToggle);

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ the app sends Home Assistant only what the proxy was told about");
