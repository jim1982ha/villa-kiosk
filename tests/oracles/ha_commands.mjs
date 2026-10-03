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
import { ck, done, tsFiles } from "../consistency/check.mjs";

const table = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/ha-commands.json", import.meta.url), "utf8"));
const types = new Set([...table.websocket, ...table.camera]);
const domains = new Set(table.serviceDomains);

const SRC = new URL("../../src/", import.meta.url).pathname;
const walk = tsFiles;
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
ck("found the service calls (the power flips are devicePower's — held to this table by device_power.mjs)", calls.has("light.turn_on") && calls.has("scene.turn_on"), [...calls.keys()]);
const badCalls = [...calls].filter(([c]) => {
  const [d, s] = c.split(".");
  return d === "homeassistant" ? !table.homeassistantServices.includes(s) : !domains.has(d);
}).map(([c, f]) => `${c} (${f})`);
ck("every service domain is in the table (homeassistant.* by service)", badCalls.length === 0, badCalls);
const { TOGGLEABLE_DOMAINS } = await import("@/utils/quickAction");
const badToggle = [...TOGGLEABLE_DOMAINS].filter((d) => !domains.has(d));
ck("every domain a tile toggles by variable (quickAction's toggle set) is in the table", badToggle.length === 0, badToggle);

// ── and reads only the domains the proxy will relay to a non-owner ────────
// The proxy narrows get_states / events / history / logbook / the registry to
// `readDomains` for guest and ops (2.496.208). Every domain the app draws
// (ENTITY_DOMAINS) or reads by a fixed id / prefix scan must be in it, or a
// non-owner surface goes blank with nothing in the console to say why.
const { ENTITY_DOMAINS } = await import("@/types/ha.types");
const readable = new Set(table.readDomains);
const undrawn = ENTITY_DOMAINS.filter((d) => !readable.has(d));
ck("every drawn domain is readable by a non-owner", undrawn.length === 0, undrawn);
const scanned = new Map();
for (const { f, src } of files) {
  for (const m of src.matchAll(/entities\["([a-z_]+)\.[a-z_]+"\]|entity_id === "([a-z_]+)\.[a-z_]+"|startsWith\("([a-z_]+)\."\)/g)) scanned.set(m[1] ?? m[2] ?? m[3], f);
}
// `update.*` is the one owner-only scan (Cockpit's updates count sits behind seeUpdates).
const unread = [...scanned].filter(([d]) => d !== "update" && !readable.has(d)).map(([d, f]) => `${d} (${f})`);
ck(`every domain read by a fixed id or prefix scan is readable (${[...scanned.keys()].sort().join(", ")})`, scanned.has("sun") && scanned.has("scene") && unread.length === 0, unread);

done("✅ the app sends Home Assistant only what the proxy was told about, and reads only what it relays");
