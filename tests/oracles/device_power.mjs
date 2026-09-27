// A device's power — which way its switch sits and the service that throws it
// (src/utils/devicePower.ts, round 11, 2.496.164). Eight sites decided it: a
// linked LOCK read "Off" when unlocked and was sent `homeassistant.toggle`
// (a lock has none); a paused TV's power button and its badge disagreed with
// nobody saying they answer different questions.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { devicePower, POWER_DOMAINS } = await import("@/utils/devicePower");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const e = (id, state) => ({ entity_id: id, state, attributes: {} });
const p = (id, state) => devicePower(e(id, state));
const flip = (x) => (x.flip ? `${x.flip.domain}.${x.flip.service}` : null);

ck("a light: on/off, its own toggle", p("light.a", "on").position === "on" && flip(p("light.a", "off")) === "light.toggle");
ck("a LOCK: unlocked is ON (the state acted on), flipped with lock/unlock — never homeassistant.toggle",
   p("lock.a", "unlocked").position === "on" && flip(p("lock.a", "unlocked")) === "lock.lock" && flip(p("lock.a", "locked")) === "lock.unlock");
ck("  ...a jammed lock is not secured (on → lock it); one in motion is unknown, no switch",
   flip(p("lock.a", "jammed")) === "lock.lock" && p("lock.a", "locking").position === "unknown" && p("lock.a", "locking").flip === null);
ck("a cover: open (or partly) is on, closed off, moving unknown; open/close_cover",
   flip(p("cover.a", "open")) === "cover.close_cover" && flip(p("cover.a", "closed")) === "cover.open_cover" && p("cover.a", "opening").position === "unknown");
ck("a TV's POWER: paused and idle are ON (its badge's activity is another question)",
   p("media_player.tv", "paused").position === "on" && p("media_player.tv", "idle").position === "on" && p("media_player.tv", "standby").position === "off"
   && flip(p("media_player.tv", "paused")) === "media_player.toggle");
ck("unavailable, or never reported: unknown, and nothing is sent", p("switch.a", "unavailable").flip === null && devicePower(undefined, "switch.a").position === "unknown");
ck("a domain with no toggle of its own: homeassistant.toggle", flip(p("climate.a", "heat")) === "homeassistant.toggle");
const table = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/ha-commands.json", import.meta.url), "utf8"));
const outside = POWER_DOMAINS.filter((d) => d === "homeassistant" ? !table.homeassistantServices.includes("toggle") : !table.serviceDomains.includes(d));
ck("every domain a flip can reach is in the one table of what the kiosk may send", outside.length === 0, outside);

const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
const sites = ["components/panels/FanPanel.tsx", "components/panels/LightPanel.tsx", "components/panels/SwitchPanel.tsx", "components/panels/MediaPanel.tsx"];
const own = sites.filter((f) => /const on = entity\?\.state ===/.test(src(f)) || /HAServices\.toggle/.test(src(f)));
ck("the power panels read and throw through devicePower, none by `state === \"on\"`", own.length === 0, own);
const d = src("pages/Dashboard.tsx");
ck("the quick tap and the linked switch throw through it; the linked switch knows 'unknown'",
   /HAServices\.power\(ws, entity, entityId\)/.test(d) && /HAServices\.power\(ws, entities\[linkedEntityId\], linkedEntityId\)/.test(d) && /known: linkedPower\?\.position !== "unknown"/.test(d));
ck("the map's linked ring and the device-list rows ask it",
   (src("babylon/EntityVisuals.ts").match(/devicePower\(/g) ?? []).length >= 2 && /devicePower\(e, id\)\.flip/.test(src("components/panels/SummaryGroupPanel.tsx")));
ck("HAServices keeps no per-domain toggle of its own", !/toggle(Light|Fan|Switch|Entity|Media)\b/.test(src("ha/HAServiceCalls.ts")));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ a device's power, decided once");
