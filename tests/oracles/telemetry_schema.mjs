// One telemetry event schema (round 11, 2.496.167). An event's own fields,
// report()'s stamps and the server's stamps shared one namespace with nothing
// naming the taken keys — the census's `at` and the lost session's `role`
// were overwritten in silence. Driven: report() runs against a stub browser
// and the fields it stamps must be exactly the reserved list minus the
// server's; the server's stamps are read from its handler.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

let sent = null;
globalThis.window = { innerWidth: 1, innerHeight: 1, devicePixelRatio: 1, matchMedia: () => ({ matches: false }), location: { pathname: "/" } };
globalThis.screen = { width: 1, height: 1 };
globalThis.document = { querySelector: () => null };
Object.defineProperty(globalThis, "navigator", { value: { sendBeacon: (_u, b) => { sent = b; return true; } }, configurable: true });
globalThis.performance ??= {};
const { report, RESERVED_TELEMETRY_FIELDS } = await import("@/utils/telemetry");


report("load", {});
const stamped = Object.keys(JSON.parse(await sent.text()));
const src = readFileSync(new URL("../../rootfs/usr/bin/supervisor-proxy.py", import.meta.url), "utf8");
const handler = src.slice(src.indexOf("async def telemetry_post_handler"), src.indexOf("async def telemetry_get_handler"));
const server = [...handler.matchAll(/body\["(\w+)"\]\s*=/g)].map((m) => m[1]);
ck("the handler was read (it stamps something)", server.length > 0, server);

const reserved = new Set(RESERVED_TELEMETRY_FIELDS);
const unreserved = [...stamped, ...server].filter((k) => !reserved.has(k));
ck("every field report() or the server stamps is reserved", unreserved.length === 0, unreserved);
const idle = [...reserved].filter((k) => !stamped.includes(k) && !server.includes(k) && k !== "mem" && k !== "shellH" && k !== "v");
ck("  ...and nothing is reserved that nobody stamps", idle.length === 0, idle);

// The two that collided, renamed at the source and read under the new name.
const s = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
const panel = s("components/settings/TelemetryPanel.tsx");
ck("the census reports atMs and the panel reads it", /atMs: CENSUS_DELAY_MS/.test(s("utils/bootTimeline.ts")) && /ms\(e\.atMs\)/.test(panel) && !/ms\(e\.at\)/.test(panel));
ck("the lost session reports lostRole, and the panel renders a session row",
   /lostRole: p\.role/.test(s("auth/ProfileContext.tsx")) && /case "session":[\s\S]{0,200}e\.lostRole/.test(panel));

done("✅ one telemetry schema");
